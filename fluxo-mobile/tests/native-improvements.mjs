import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 20000 }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
let browser;
for (let i = 0; i < 30; i++) {
  try {
    const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
    shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
    browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 5000 }); break;
  } catch (error) { if (i === 29) throw error; await delay(500); }
}
const page = browser.contexts()[0].pages()[0];
await page.locator('.navigation').waitFor();
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
const original = await page.evaluate(() => localStorage.fluxo_mobile_v2);
const saved = JSON.parse(original);
const desired = await page.evaluate(async () => (await import('./model.js')).libraryTracks(JSON.parse(localStorage.fluxo_mobile_v2)));
const fixture = { id: 'qa-radio-local', title: 'Radio test fixture', artist: 'Test', duration: 12, url: '', source: 'local' };
const alternative = { ...fixture, id: 'qa-radio-allowed', title: 'Allowed radio fixture' };
const manual = { id: 'qa-manual-download', title: 'Manual download fixture', artist: 'Android fixture', url: 'https://storage.googleapis.com/exoplayer-test-media-0/play.mp3', source: 'direct' };
const unrelated = { ...manual, id: 'qa-unrelated-library', title: 'Unrelated library fixture' };
const report = {};
async function waitFor(method, test, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { const result = await call(method); if (test(result)) return result; await delay(500); }
  throw new Error(`Timed out waiting for ${method}: ${JSON.stringify(await call(method))}`);
}
try {
  const wav = Buffer.alloc(44 + 8000 * 12 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (const track of [fixture, alternative]) {
    await call('removeDownload', { id: track.id });
    await call('migrateAudio', { track, offset: 0, data: wav.toString('base64'), complete: true });
  }
  const files = (await call('downloads')).tracks.filter(track => track.status === 'ready' && track.id !== fixture.id);
  assert.ok(files.length >= 2, 'Import/download two tracks before this test');
  const seed = files.find(track => track.duration > 60) || files[0];
  const other = files.find(track => track.id === alternative.id);
  await call('command', { action: 'sleep', value: 0 }); await call('command', { action: 'repeat', value: 0 });
  await call('setQueue', { tracks: [seed, other], index: 0 });
  let state = await waitFor('getState', state => state.playing);
  const position = Math.min(7, state.duration / 2);
  await call('command', { action: 'seek', value: position });
  await call('radio', { track: seed, offline: true });
  state = await waitFor('getState', state => state.radio && state.playing);
  assert.ok(state.position >= position - 0.3); report.radioPreservesPosition = true;
  assert.ok(state.queue.some(track => track.id === other.id && !track.radioGenerated)); report.manualQueuePreserved = true;
  await call('setQueue', { tracks: [seed], index: 0 });
  await call('radioExclusions', { tracks: [fixture] });
  await call('radio', { track: seed, offline: true });
  state = await waitFor('getState', state => state.radio && !state.radioLoading && state.queue.length > 1);
  assert.ok(!state.queue.some(track => track.id === fixture.id)); report.radioExclusions = true;
  console.log('Native radio continuity, manual queue and exclusions passed. Checking persistent manual downloads.');
  await call('command', { action: 'clear' });

  await page.evaluate(() => { const model = JSON.parse(localStorage.fluxo_mobile_v2); model.settings.autoDownload = false; model.settings.wifiOnly = true; localStorage.fluxo_mobile_v2 = JSON.stringify(model); });
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable'); await delay(1500);
  await call('removeDownload', { id: manual.id });
  await call('syncLibrary', { tracks: [...desired, unrelated], enabled: false, wifiOnly: true });
  const start = Date.now(); await call('downloadBatch', { tracks: [manual], wifiOnly: true }); report.manualScheduleMs = Date.now() - start;
  let records = (await call('downloads')).tracks;
  assert.equal(records.find(track => track.id === manual.id)?.status, 'queued');
  assert.ok(!records.some(track => track.id === unrelated.id)); report.onlyRequestedTracksScheduled = true;
  await call('syncLibrary', { tracks: desired, enabled: false, wifiOnly: true });
  assert.equal((await call('downloads')).tracks.find(track => track.id === manual.id)?.status, 'queued'); report.manualSurvivesAutoDisabledSync = true;
  await page.reload(); await page.locator('.navigation').waitFor(); await delay(1000);
  assert.equal((await call('downloads')).tracks.find(track => track.id === manual.id)?.status, 'queued'); report.manualSurvivesReload = true;
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByRole('button', { name: /Central de downloads/ }).click();
  await page.getByRole('button', { name: /^Pendentes/ }).click();
  await page.getByRole('button', { name: `Cancelar download de ${manual.title}`, exact: true }).click();
  await delay(500); assert.ok(!(await call('downloads')).tracks.some(track => track.id === manual.id)); report.cancelFromUi = true;
  await call('download', { track: manual, wifiOnly: true });
  shell('shell', 'svc', 'wifi', 'enable');
  records = (await waitFor('downloads', result => result.tracks.some(track => track.id === manual.id && track.status === 'ready'), 240000)).tracks;
  const completed = records.find(track => track.id === manual.id);
  assert.equal(completed.bytes, 965128); report.manualDownloadBytes = completed.bytes;
  assert.equal((await call('removeDownload', { id: manual.id, pendingOnly: true })).cancelled, false);
  assert.equal((await call('downloads')).tracks.find(track => track.id === manual.id).status, 'ready'); report.cancelPreservesCompletedFiles = true;
  shell('shell', 'svc', 'wifi', 'disable');
  await call('setQueue', { tracks: [completed], index: 0 }); await waitFor('getState', state => state.playing);
  await delay(1500); assert.ok((await call('getState')).position > 1); report.manualPlaysOffline = true;
  await writeFile('.qa/native-improvements-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  await call('command', { action: 'clear' }).catch(() => {});
  for (const id of [fixture.id, alternative.id, manual.id, unrelated.id]) await call('removeDownload', { id }).catch(() => {});
  await page.evaluate(value => localStorage.fluxo_mobile_v2 = value, original).catch(() => {});
  await call('radioExclusions', { tracks: saved.radioExcluded || [] }).catch(() => {});
  await call('syncLibrary', { tracks: desired, enabled: saved.settings.autoDownload !== false, wifiOnly: !!saved.settings.wifiOnly }).catch(() => {});
  await browser.close();
}
