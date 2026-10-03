import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, savedModel, savedState;
const tracks = ['a', 'b'].map((name, i) => ({ id: `qa-professional-${name}`, title: `Faixa ${name.toUpperCase()}`, artist: 'Álvaro & Banda', source: 'direct', url: `https://example.invalid/qa-professional-${name}.wav`, duration: 90 }));
const report = {};
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
async function waitFor(test, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const state = await call('getState'); if (test(state)) return state; await delay(250); }
  throw new Error('Timed out: ' + JSON.stringify(await call('getState')));
}
try {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard'); shell('shell', 'cmd', 'statusbar', 'collapse');
  shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity'); await delay(1800);
  const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile'); shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223'); page = browser.contexts()[0].pages()[0];
  await page.locator('.navigation').waitFor(); savedModel = await page.evaluate(() => localStorage.fluxo_mobile_v2); savedState = await call('getState');
  await call('command', { action: 'clear' });
  const wav = Buffer.alloc(44 + 8000 * 90 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (const track of tracks) {
    await call('removeDownload', { id: track.id });
    for (let offset = 0; offset < wav.length; offset += 262144) await call('migrateAudio', { track, offset, data: wav.subarray(offset, offset + 262144).toString('base64'), complete: offset + 262144 >= wav.length });
  }
  await call('append', { track: tracks[0], next: true });
  assert.equal((await call('getState')).queue.length, 1); assert.equal((await call('getState')).playWhenReady, false); report.playNextIntoEmptyQueue = true;
  await call('command', { action: 'clear' }); await call('command', { action: 'clear-upcoming' }); report.emptyQueueCleanup = true;
  await call('setQueue', { tracks, index: 0 }); await waitFor(state => state.playing);
  await call('command', { action: 'pause' });
  const snapshot = (await call('getState')).queue;
  await call('append', { track: tracks[0] });
  await assert.rejects(call('command', { action: 'remove', index: 1, expectedQueue: snapshot }), /fila mudou/i);
  assert.equal((await call('getState')).queue.length, 3); report.atomicStaleQueueCheck = true;
  await call('command', { action: 'remove', index: 2, expectedQueue: (await call('getState')).queue });
  assert.equal((await call('getState')).queue.length, 2); assert.equal((await call('getState')).playWhenReady, false); report.validQueueChangePreservesPause = true;
  await page.evaluate(tracks => localStorage.fluxo_mobile_v2 = JSON.stringify({ library: tracks.map(t => ({ ...t, id: `alias-${t.id}` })), playlists: [], favorites: [], history: [], settings: { autoDownload: false } }), tracks);
  await page.evaluate(() => location.hash = 'library'); await page.reload(); await page.locator('.navigation').waitFor(); await delay(1500);
  await page.getByRole('button', { name: /Artistas.*biblioteca/ }).click();
  await page.getByRole('searchbox', { name: 'Buscar artistas', exact: true }).fill('alvaro');
  assert.equal(await page.locator('.artist-row').count(), 1); await page.locator('.artist-row').click();
  assert.equal(await page.locator('#filtered-list .track').count(), 2);
  assert.match(await page.locator('#filtered-list .track').first().getAttribute('data-row'), /^alias-/);
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable');
  await page.getByRole('button', { name: 'Tocar esta seleção', exact: true }).click(); await waitFor(state => state.playing && state.queue[0]?.id.startsWith('alias-'));
  assert.match((await call('getState')).queue[0].id, /^alias-/); report.artistOfflineAliasPlayback = true;
  await page.getByRole('button', { name: 'Criar playlist deste artista', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar playlist', exact: true }).click();
  assert.equal((await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2))).playlists[0].tracks.length, 2); report.artistPlaylist = true;
  await page.locator('#filtered-list [data-action=track-menu]').first().click();
  await page.getByRole('button', { name: 'Informações da música', exact: true }).click();
  assert.match(await page.locator('.track-facts').textContent(), /Pronta para ouvir offline/);
  await page.getByRole('button', { name: 'Copiar link da música', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('Link copiado')); report.nativeClipboardAndInformation = true;
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  await page.getByRole('button', { name: 'Timer', exact: true }).click(); await page.getByRole('button', { name: '15 minutos', exact: true }).click();
  assert.match(await page.locator('[data-sleep-label]').textContent(), /14:5\d/); report.nativeCountdown = true;
  await page.getByRole('button', { name: 'Minimizar player', exact: true }).click(); await call('command', { action: 'sleep', value: 0 });
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable'); await delay(2500);
  await page.locator('.navigation [data-tab=search]').click();
  await page.evaluate(async () => { const { commands } = await import('./platform.js'); const search = commands.search.bind(commands); window.nativeSearchCalls = 0; commands.search = async (...args) => { nativeSearchCalls++; return search(...args); }; });
  await page.getByRole('searchbox', { name: 'Buscar músicas', exact: true }).fill('lofi hip hop');
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('#view .track').length > 0, null, { timeout: 45000 });
  report.nativeSearchResults = await page.locator('#view .track').count();
  await page.getByRole('button', { name: 'Pesquisar', exact: true }).click(); await delay(500);
  assert.equal(await page.evaluate(() => nativeSearchCalls), 1); assert.match(await page.locator('.search-sources').textContent(), /Busca recente/); report.nativeSearchCache = true;
  await writeFile('.qa/native-professional-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  if (page && !page.isClosed()) {
    await call('command', { action: 'clear' }).catch(() => {});
    for (const track of tracks) await call('removeDownload', { id: track.id }).catch(() => {});
    if (savedModel) await page.evaluate(value => localStorage.fluxo_mobile_v2 = value, savedModel);
    if (savedState) await call('command', { action: 'volume', value: savedState.volume ?? 1 }).catch(() => {});
    await page.goto('https://localhost/#library').catch(() => {});
  }
  await browser?.close();
}
