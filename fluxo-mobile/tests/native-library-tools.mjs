import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, savedModel, originalTargets;
const local = { id: 'qa-tools-local', title: 'Original', artist: 'Banda original', source: 'direct', url: 'https://example.invalid/tools.wav', duration: 90 };
const alias = { ...local, id: 'qa-tools-alias' };
const network = { id: 'qa-tools-download', title: 'Download por playlist', artist: 'Android fixture', source: 'direct', url: 'https://storage.googleapis.com/exoplayer-test-media-0/play.mp3', _autoDownload: true };
const networkAlias = { ...network, id: 'qa-tools-download-alias' };
const unrelated = { ...network, id: 'qa-tools-unrelated', url: 'https://example.invalid/unrelated.wav', _autoDownload: false };
const report = {};
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
async function until(test, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await test(); if (result) return result; await delay(300); }
  throw new Error('Native library-tools wait timed out');
}
const hash = uri => shell('shell', 'run-as', 'com.fluxo.music.mobile', 'sha256sum', uri.replace(/^file:\/\//, '')).split(/\s+/)[0];
try {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard'); shell('shell', 'cmd', 'statusbar', 'collapse');
  shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity'); await delay(2000);
  const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile'); shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223'); page = browser.contexts()[0].pages()[0]; await page.locator('.navigation').waitFor();
  savedModel = await page.evaluate(() => localStorage.fluxo_mobile_v2);
  originalTargets = await page.evaluate(async () => { const { syncTargets } = await import('./collection-tools.js'); const model = JSON.parse(localStorage.fluxo_mobile_v2); return { tracks: syncTargets(model), enabled: model.settings.autoDownload !== false, wifiOnly: !!model.settings.wifiOnly }; });
  await call('command', { action: 'clear' }); await call('syncLibrary', { tracks: [], enabled: false });
  await call('removeDownload', { id: local.id });
  const wav = Buffer.alloc(44 + 8000 * 90 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let offset = 0; offset < wav.length; offset += 262144) await call('migrateAudio', { track: local, offset, data: wav.subarray(offset, offset + 262144).toString('base64'), complete: offset + 262144 >= wav.length });
  const record = (await call('downloads')).tracks.find(t => t.id === local.id), beforeHash = hash(record.localUri);
  await call('downloadBatch', { tracks: [local, alias] }); await delay(700);
  assert.equal((await call('downloads')).tracks.filter(t => t.url === local.url).length, 1); report.readyAliasesDoNotRedownload = true;
  await call('setQueue', { tracks: [alias, local], index: 0 }); await until(async () => (await call('getState')).playing);
  await call('command', { action: 'seek', value: 20 }); await delay(700); const before = await call('getState');
  await call('updateTrack', { track: alias, fields: { title: 'Nome revisado', artist: 'Artista revisado' } }); const after = await call('getState');
  assert.equal(after.playing, true); assert.ok(after.position >= before.position && after.position < before.position + 3); assert.equal(after.index, before.index);
  assert.deepEqual(after.queue.map(t => t.title), ['Nome revisado', 'Nome revisado']); assert.deepEqual(after.queue.map(t => t.id), [alias.id, local.id]);
  assert.equal(hash((await call('downloads')).tracks.find(t => t.id === local.id).localUri), beforeHash); report.editPreservesPositionAndAudioHash = true;
  await call('command', { action: 'pause' }); const paused = await call('getState');
  await call('updateTrack', { track: local, fields: { title: 'Ainda pausada', artist: 'Minha banda' } });
  assert.equal((await call('getState')).playWhenReady, false); assert.ok(Math.abs((await call('getState')).position - paused.position) < .5); report.editPreservesPause = true;
  await assert.rejects(call('updateTrack', { track: local, fields: { title: ' ', artist: 'Band' } })); report.invalidEditRejected = true;
  const storage = await call('storage'); assert.ok(storage.available > 0 && storage.total >= storage.available); report.storageBytes = storage.available;
  await call('command', { action: 'clear' });
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable'); await delay(1500);
  const options = { tracks: [network, networkAlias, unrelated], enabled: false, wifiOnly: true, retry: true };
  await call('syncLibrary', options); const queued = (await call('downloads')).tracks;
  assert.equal(queued.find(t => t.id === network.id)?.status, 'queued'); assert.equal(queued.some(t => t.id === unrelated.id), false); report.playlistDownloadsWithGlobalDisabled = true;
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  const completed = await until(async () => (await call('downloads')).tracks.find(t => t.url === network.url && t.status === 'ready'), 240000); await delay(1500);
  assert.ok(completed.bytes > 0); assert.equal((await call('downloads')).tracks.filter(t => t.url === network.url && t.status === 'ready').length, 1); report.concurrentAliasesUseOneFile = true;
  const pendingAliasId = completed.id === network.id ? networkAlias.id : network.id;
  assert.equal((await call('removeDownload', { id: pendingAliasId, pendingOnly: true })).cancelled, false);
  assert.equal((await call('downloads')).tracks.find(t => t.id === completed.id)?.status, 'ready'); report.finishedAliasIsNotCancelled = true;
  await call('removeDownload', { id: pendingAliasId }); await call('syncLibrary', { ...options, retry: false }); await delay(700);
  assert.equal((await call('downloads')).tracks.some(t => t.url === network.url), false); report.removalBlocksAllAliases = true;
  shell('shell', 'svc', 'wifi', 'disable'); await call('download', { track: networkAlias, wifiOnly: true });
  assert.equal((await call('downloads')).tracks.find(t => t.id === networkAlias.id)?.status, 'queued'); report.explicitDownloadUnblocks = true;
  await call('removeDownload', { id: networkAlias.id, pendingOnly: true }); await call('syncLibrary', { ...options, retry: false });
  assert.equal((await call('downloads')).tracks.some(t => t.url === network.url), false); report.cancelBlocksAliases = true;
  await call('shareText', { title: 'Fluxo', text: local.url }); await delay(900); assert.match(shell('shell', 'dumpsys', 'activity', 'activities'), /ChooserActivity/); shell('shell', 'input', 'keyevent', 'KEYCODE_BACK'); report.nativeShareChooser = true;
  await page.evaluate(track => localStorage.fluxo_mobile_v2 = JSON.stringify({ library: [track], favorites: [track], playlists: [{ id: 'native-tools', title: 'Minha seleção', tracks: [track], offlineOnly: true, description: 'Músicas comigo, em qualquer lugar.', autoDownload: true }], settings: { autoDownload: false } }), alias);
  await page.goto('https://localhost/#library'); await page.reload(); await page.locator('.navigation').waitFor();
  await page.locator('.playlist-card').first().click(); await page.screenshot({ path: '.qa/screenshots/native-library-tools.png' });
  assert.match(await page.locator('.playlist-description').textContent(), /qualquer lugar/);
  await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click(); await page.getByRole('button', { name: 'Exportar playlist', exact: true }).click(); await delay(900);
  assert.match(shell('shell', 'dumpsys', 'activity', 'activities'), /android.intent.action.CREATE_DOCUMENT/); shell('shell', 'input', 'keyevent', 'KEYCODE_BACK'); report.nativePlaylistExportPicker = true;
  await writeFile('.qa/native-library-tools-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable'); shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  if (/topResumedActivity=.*(?:documentsui|ChooserActivity)/.test(shell('shell', 'dumpsys', 'activity', 'activities'))) shell('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  if (page && !page.isClosed()) {
    await call('command', { action: 'clear' }).catch(() => {});
    for (const track of [local, alias, network, networkAlias, unrelated]) await call('removeDownload', { id: track.id }).catch(() => {});
    if (savedModel) await page.evaluate(value => localStorage.fluxo_mobile_v2 = value, savedModel);
    if (originalTargets) await call('syncLibrary', originalTargets).catch(() => {});
    await page.goto('https://localhost/#library').catch(() => {}); await page.reload().catch(() => {});
  }
  await browser?.close();
}
