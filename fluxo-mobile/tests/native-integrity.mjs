import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, savedModel, savedState;
async function connect() {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'cmd', 'statusbar', 'collapse'); shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
  await delay(2000);
  const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
  shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  browser = await chromium.connectOverCDP('http://127.0.0.1:9223'); page = browser.contexts()[0].pages()[0];
  await page.locator('.navigation').waitFor();
}
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
async function waitFor(test, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const state = await call('getState'); if (test(state)) return state; await delay(250); }
  throw new Error('Timed out: ' + JSON.stringify(await call('getState')));
}
const primary = { id: 'qa-integrity-primary', title: 'Integrity primary', artist: 'Test', url: 'https://example.invalid/qa-primary.mp3', source: 'direct', duration: 20 };
const secondary = { ...primary, id: 'qa-integrity-secondary', title: 'Integrity secondary', url: 'https://example.invalid/qa-secondary.mp3' };
const wav = Buffer.alloc(44 + 8000 * 20 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
const report = {};
try {
  await connect(); savedModel = await page.evaluate(() => localStorage.fluxo_mobile_v2); savedState = await call('getState');
  await call('command', { action: 'clear' });
  for (const track of [primary, secondary]) {
    await call('removeDownload', { id: track.id });
    await call('migrateAudio', { track, offset: 0, data: wav.toString('base64'), complete: true });
  }
  const firstRecord = (await call('downloads')).tracks.find(track => track.id === primary.id);
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable');
  await call('setQueue', { tracks: [primary], index: 0 });
  await waitFor(state => state.playing); report.nativePrefersStoredOfflineFile = true;
  assert.equal(await page.locator('#mini [data-action=next]').isDisabled(), true);
  await call('append', { track: secondary, next: false }); await delay(1000);
  assert.equal(await page.locator('#mini [data-action=next]').isDisabled(), false); report.nextControlRefresh = true;
  await call('command', { action: 'pause' }); await call('command', { action: 'next' });
  assert.equal((await call('getState')).playWhenReady, false); report.pausedNextStaysPaused = true;
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  await page.getByRole('button', { name: 'Volume do app', exact: true }).click();
  await page.locator('#volume-slider').evaluate(input => { input.value = '.33'; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); });
  await waitFor(state => Math.abs(state.volume - .33) < .001); report.nativeVolumeFromUi = true;
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await delay(800); await browser.close();
  shell('shell', 'am', 'force-stop', 'com.fluxo.music.mobile'); await connect();
  assert.ok(Math.abs((await call('getState')).volume - .33) < .001); report.volumeSurvivesProcessRestart = true;
  assert.equal((await call('getState')).playWhenReady, false); report.restoredQueueDoesNotAutoplay = true;
  await call('setQueue', { tracks: [{ ...firstRecord, localUri: firstRecord.localUri + '.old' }], index: 0 });
  await waitFor(state => state.playing); report.staleQueueUriUsesCurrentFile = true;
  await call('command', { action: 'pause' });
  const file = new URL(firstRecord.localUri).pathname;
  assert.match(file, /^\/data\/user\/0\/com\.fluxo\.music\.mobile\/files\/music\/[a-f0-9-]+\.audio$/);
  // Only delete this generated fixture, never a user's existing audio file.
  shell('shell', 'run-as', 'com.fluxo.music.mobile', 'rm', file);
  assert.equal((await call('downloads')).tracks.find(track => track.id === primary.id).status, 'failed'); report.missingFileNoLongerReady = true;
  await call('setQueue', { tracks: [{ ...firstRecord, url: '' }], index: 0 });
  const failure = await waitFor(state => !!state.error && !state.buffering);
  assert.match(failure.error, /arquivo/i); report.missingFileTerminatesLoading = true;
  await writeFile('.qa/native-integrity-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  if (page && !page.isClosed()) {
    await call('command', { action: 'clear' }).catch(() => {});
    for (const track of [primary, secondary]) await call('removeDownload', { id: track.id }).catch(() => {});
    if (savedModel) await page.evaluate(value => localStorage.fluxo_mobile_v2 = value, savedModel);
    if (savedState) { await call('command', { action: 'volume', value: savedState.volume ?? 1 }).catch(() => {}); }
  }
  await browser?.close();
}
