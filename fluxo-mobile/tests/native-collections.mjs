import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, savedModel, savedState;
let repairOriginal;
async function connect() {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'cmd', 'statusbar', 'collapse'); shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
  await delay(2000); const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
  shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223'); page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15000); await page.locator('.navigation').waitFor();
}
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
async function waitFor(test, timeout = 15000) {
  const started = Date.now(); while (Date.now() - started < timeout) { const state = await call('getState'); if (test(state)) return state; await delay(250); }
  throw new Error('Timed out: ' + JSON.stringify(await call('getState')));
}
const fixtures = ['Alfa', 'Beta', 'Gama'].map((title, i) => ({ id: `qa-collections-file-${i}`, title, artist: 'QA local', url: `https://example.invalid/qa-collections-${i}.wav`, source: 'direct', duration: 150 }));
const repairFixture = { ...fixtures[0], id: 'qa-collections-repair', title: 'Migration repair fixture', url: '' };
const aliases = fixtures.map((track, i) => ({ ...track, id: `qa-collections-alias-${i}` }));
const wav = Buffer.alloc(44 + 8000 * 150 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const report = {};
try {
  await mkdir('.qa/screenshots', { recursive: true }); await connect();
  savedModel = await page.evaluate(() => localStorage.fluxo_mobile_v2); savedState = await call('getState');
  await call('command', { action: 'clear' }); await call('syncLibrary', { tracks: [], enabled: false, wifiOnly: true });
  for (const track of fixtures) {
    await call('removeDownload', { id: track.id });
    for (let offset = 0; offset < wav.length; offset += 262144) { const chunk = wav.subarray(offset, offset + 262144); await call('migrateAudio', { track, offset, data: chunk.toString('base64'), complete: offset + chunk.length >= wav.length }); }
  }
  for (const record of (await call('downloads')).tracks.filter(track => fixtures.some(item => item.id === track.id))) {
    const path = new URL(record.localUri).pathname;
    assert.match(path, /^\/data\/user\/0\/com\.fluxo\.music\.mobile\/files\/music\/[a-f0-9-]+\.audio$/);
    const stored = execFileSync(adb, ['exec-out', 'run-as', 'com.fluxo.music.mobile', 'cat', path], { maxBuffer: 10000000 });
    assert.equal(createHash('sha256').update(stored).digest('hex'), createHash('sha256').update(wav).digest('hex'), 'Migrated audio bytes must exactly match the fixture');
  }
  console.log('Native fixture checksums verified');
  report.chunkedMigrationIntegrity = true;
  await call('removeDownload', { id: repairFixture.id });
  await call('migrateAudio', { track: repairFixture, offset: 0, data: wav.subarray(0, 51200).toString('base64'), complete: true });
  repairOriginal = (await call('downloads')).tracks.find(track => track.id === repairFixture.id).localUri;
  for (let offset = 0; offset < wav.length; offset += 262144) { const chunk = wav.subarray(offset, offset + 262144); await call('migrateAudio', { track: repairFixture, offset, data: chunk.toString('base64'), complete: offset + chunk.length >= wav.length, repair: true }); }
  const repaired = (await call('downloads')).tracks.find(track => track.id === repairFixture.id);
  assert.equal(repaired.bytes, wav.length); assert.notEqual(repaired.localUri, repairOriginal);
  const originalPath = new URL(repairOriginal).pathname;
  assert.match(originalPath, /^\/data\/user\/0\/com\.fluxo\.music\.mobile\/files\/music\/[a-f0-9-]+\.audio$/);
  const previousBytes = execFileSync(adb, ['exec-out', 'run-as', 'com.fluxo.music.mobile', 'cat', originalPath]);
  assert.deepEqual(previousBytes, wav.subarray(0, 51200)); report.repairKeepsPreviousFile = true;
  const repairedBytes = execFileSync(adb, ['exec-out', 'run-as', 'com.fluxo.music.mobile', 'cat', new URL(repaired.localUri).pathname], { maxBuffer: 10000000 });
  assert.equal(createHash('sha256').update(repairedBytes).digest('hex'), createHash('sha256').update(wav).digest('hex'));
  await call('setQueue', { tracks: [{ ...repairFixture, localUri: repairOriginal }], index: 0 }); await waitFor(state => state.playing);
  await call('command', { action: 'clear' }); report.repairedFilePlaysFromOldQueue = true;
  await page.evaluate(tracks => { localStorage.fluxo_mobile_v2 = JSON.stringify({ library: tracks, favorites: [], history: [], playlists: [], settings: { offline: true, autoDownload: false } }); location.hash = 'library'; }, aliases);
  await page.reload(); await page.locator('.navigation').waitFor();
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable');
  await page.getByRole('tab', { name: 'Salvas', exact: true }).click();
  await page.getByRole('button', { name: 'Selecionar músicas', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Selecionar todas as 3 músicas filtradas', exact: true }).check();
  await page.getByRole('button', { name: 'Adicionar selecionadas a uma playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Criar playlist com a seleção', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da playlist', exact: true }).fill('Coleção Android');
  await page.getByRole('button', { name: 'Salvar playlist', exact: true }).click();
  assert.equal(await page.locator('#filtered-list .track').count(), 3); report.nativeBulkPlaylist = true;
  await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Fixar playlist', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Filtrar músicas', exact: true }).fill('Beta');
  await page.getByRole('button', { name: 'Tocar esta seleção', exact: true }).click();
  const playing = await waitFor(state => state.playing);
  assert.equal(playing.queue[playing.index].id, aliases[1].id); report.aliasIdentityPreserved = true;
  await call('setQueue', { tracks: aliases, index: 1 });
  const indexed = await waitFor(state => state.playing && state.index === 1);
  assert.equal(indexed.queue[indexed.index].title, 'Beta'); report.offlineQueueStartsAtRequestedAlias = true;
  await call('command', { action: 'pause' }); await call('command', { action: 'seek', value: 35 });
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  await page.getByRole('button', { name: 'Voltar 10 segundos', exact: true }).click();
  await waitFor(state => Math.abs(state.position - 25) < .6);
  await page.getByRole('button', { name: 'Avançar 10 segundos', exact: true }).click();
  await waitFor(state => Math.abs(state.position - 35) < .6); report.nativeSeekSteps = true;
  await page.screenshot({ path: '.qa/screenshots/native-player-2.5.png' });
  await page.getByRole('button', { name: 'Minimizar player', exact: true }).click();
  await page.locator('.navigation [data-tab=queue]').click();
  await call('append', { track: aliases[1] }); await call('append', { track: { ...aliases[2], id: 'qa-collections-duplicate-url' } });
  await delay(500); assert.equal(await page.locator('[data-queue-index].playing').count(), 1);
  await page.getByRole('button', { name: 'Organizar fila', exact: true }).click();
  await page.getByRole('button', { name: 'Remover repetidas a seguir', exact: true }).click();
  let state = await call('getState'); assert.equal(state.queue.length, 3); assert.equal(state.index, 1); assert.ok(Math.abs(state.position - 35) < .6); assert.equal(state.playWhenReady, false); report.nativeDedupPreservesPausedPosition = true;
  await page.getByRole('button', { name: 'Organizar fila', exact: true }).click();
  await page.getByRole('button', { name: 'Remover músicas anteriores', exact: true }).click();
  state = await call('getState'); assert.equal(state.index, 0); assert.equal(state.queue.length, 2); assert.ok(Math.abs(state.position - 35) < .6); report.removePlayedPreservesPosition = true;
  await page.getByRole('button', { name: 'Organizar fila', exact: true }).click();
  await page.getByRole('button', { name: 'Limpar próximas músicas', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  state = await call('getState'); assert.equal(state.queue.length, 1); assert.equal(state.playWhenReady, false); assert.ok(Math.abs(state.position - 35) < .6); report.clearUpcomingPreservesCurrent = true;
  await call('command', { action: 'remove', index: 0 });
  state = await call('getState'); assert.equal(state.queue.length, 0); assert.equal(state.playWhenReady, false); assert.equal(state.error, ''); report.removeLastResetsPlayback = true;
  await browser.close(); shell('shell', 'am', 'force-stop', 'com.fluxo.music.mobile'); await connect();
  const stored = await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2));
  assert.equal(stored.playlists[0].pinned, true); assert.equal(stored.playlists[0].tracks.length, 3);
  assert.equal((await call('downloads')).tracks.filter(track => fixtures.some(item => item.id === track.id) && track.status === 'ready').length, 3); report.playlistsAndFilesSurviveRestart = true;
  await page.locator('.playlist-card').first().click();
  await page.screenshot({ path: '.qa/screenshots/native-collections-2.5.png' });
  await writeFile('.qa/native-collections-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  if (page && !page.isClosed()) {
    await call('command', { action: 'clear' }).catch(() => {});
    for (const track of [...fixtures, repairFixture]) await call('removeDownload', { id: track.id }).catch(() => {});
    if (repairOriginal) { const path = new URL(repairOriginal).pathname; assert.match(path, /^\/data\/user\/0\/com\.fluxo\.music\.mobile\/files\/music\/[a-f0-9-]+\.audio$/); shell('shell', 'run-as', 'com.fluxo.music.mobile', 'rm', '-f', path); }
    if (savedModel) await page.evaluate(value => localStorage.fluxo_mobile_v2 = value, savedModel);
    if (savedState) await call('command', { action: 'volume', value: savedState.volume ?? 1 }).catch(() => {});
    await page.reload().catch(() => {});
  }
  await browser?.close();
}
