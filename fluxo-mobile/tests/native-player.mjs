import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.ANDROID_HOME || process.env.LOCALAPPDATA + '/Android/Sdk'}/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, ['-s', process.env.ANDROID_SERIAL || 'emulator-5554', ...args], { encoding: 'utf8', timeout: 30000 }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const tracks = ['a', 'b'].map(id => ({ id: `qa-player-state-${id}`, title: `Player ${id}`, artist: 'Test', url: `https://example.invalid/player-${id}.wav`, duration: 90, source: 'direct' }));
let browser, page, savedModel, savedState;
const report = {};
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
async function until(operation, timeout = 15000) {
  const start = Date.now(); while (Date.now() - start < timeout) { const result = await operation(); if (result) return result; await delay(250); }
  throw new Error('Player verification timed out');
}
const owner = state => ({ index: state.index, id: state.queue[state.index].id, url: state.queue[state.index].url });
try {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard'); shell('shell', 'cmd', 'statusbar', 'collapse');
  shell('shell', 'am', 'start', '-W', '-n', 'com.fluxo.music.mobile/.MainActivity');
  const pid = await until(async () => { try { return shell('shell', 'pidof', 'com.fluxo.music.mobile'); } catch { return false; } }, 30000);
  shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  browser = await until(async () => { try { return await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 2000 }); } catch { return false; } }, 30000);
  page = await until(async () => browser.contexts()[0]?.pages()[0]);
  await page.locator('.navigation').waitFor(); savedModel = await page.evaluate(() => localStorage.fluxo_mobile_v2); savedState = await call('getState');
  console.log('Connected to the Android player');
  await call('configure', { performanceMode: 'battery', visualizer: 'off', diagnosticEnabled: true, downloadNotifications: false, silentInterface: true, prefetchNext: false });
  await call('configure', { haptics: true });
  assert.equal((await call('diagnostics')).audioMeterEnabled, false, 'A partial settings change must not re-enable the meter');
  assert.equal((await call('diagnostics')).diagnosticEnabled, true, 'A partial settings change must not disable diagnostics');
  const runtime = await call('diagnostics');
  assert.equal(runtime.performanceMode, 'battery'); assert.equal(runtime.visualizer, 'off');
  assert.equal(runtime.downloadNotifications, false); assert.equal(runtime.prefetchNext, false); assert.equal(runtime.silentInterface, true);
  await call('configure', { performanceMode: 'invalid', visualizer: 'invalid' });
  assert.equal((await call('diagnostics')).audioMeterEnabled, false); report.partialConfigurationPreserved = true;
  await call('configure', JSON.parse(savedModel || '{}').settings || { performanceMode: 'balanced', visualizer: 'bars', diagnosticEnabled: false });
  await call('command', { action: 'clear' }); await until(async () => !(await call('diagnostics')).serviceActive);
  const requests = (await call('diagnostics')).focusRequests;
  await assert.rejects(call('command', { action: 'seek', value: 20, expectedItem: { index: 0, id: tracks[0].id, url: tracks[0].url } }), /musica mudou/i);
  assert.equal((await call('diagnostics')).serviceActive, false); assert.equal((await call('diagnostics')).focusRequests, requests); report.staleSeekDoesNotStartService = true;
  console.log('Cold stale command rejected without audio service');
  const wav = Buffer.alloc(44 + 8000 * 90 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let sample = 0; sample < 8000 * 90; sample++) wav.writeInt16LE(Math.round(Math.sin(sample * 2 * Math.PI * 440 / 8000) * 6000), 44 + sample * 2);
  for (const track of tracks) {
    await call('removeDownload', { id: track.id });
    for (let offset = 0; offset < wav.length; offset += 262144) await call('migrateAudio', { track, offset, data: wav.subarray(offset, offset + 262144).toString('base64'), complete: offset + 262144 >= wav.length });
  }
  await call('configure', { performanceMode: 'balanced', visualizer: 'bars' });
  console.log('Native audio fixtures ready');
  await call('setQueue', { tracks, index: 0 }); await until(async () => (await call('getState')).playing);
  await call('command', { action: 'pause' }); const first = owner(await call('getState'));
  await call('command', { action: 'seek', value: 30, expectedItem: first });
  let state = await call('getState'); assert.ok(Math.abs(state.position - 30) < .5); assert.equal(state.playWhenReady, false); report.validSeekPreservesPause = true;
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  try { shell('shell', 'am', 'stopservice', '-n', 'com.fluxo.music.mobile/.PlaybackService'); }
  catch (error) { if (!String(error.stderr).includes('Service stopped')) throw error; }
  await until(async () => !(await call('diagnostics')).serviceActive);
  const coldRequests = (await call('diagnostics')).focusRequests;
  await call('command', { action: 'seek', value: 44, expectedItem: first });
  await page.waitForFunction(() => Number(document.querySelector('#seek').value) === 44);
  assert.equal((await call('diagnostics')).serviceActive, false); assert.equal((await call('diagnostics')).focusRequests, coldRequests);
  assert.equal((await call('getState')).position, 44); report.coldSeekUpdatesWithoutService = true;
  await call('command', { action: 'shuffle', value: 1 });
  await page.waitForFunction(() => document.querySelector('#player [data-action=shuffle]').getAttribute('aria-pressed') === 'true');
  await call('command', { action: 'shuffle', value: 0 });
  await call('append', { track: tracks[0] });
  await page.waitForFunction(() => document.querySelector('.player-position span').textContent === '1 de 3');
  assert.equal((await call('diagnostics')).serviceActive, false); report.coldQueueAndSettingsNotifyUi = true;
  await call('command', { action: 'jump', index: 1 }); await until(async () => (await call('getState')).playing); await call('command', { action: 'pause' });
  state = await call('getState');
  await assert.rejects(call('command', { action: 'seek', value: 70, expectedItem: first }), /musica mudou/i);
  assert.equal((await call('getState')).index, 1); assert.ok(Math.abs((await call('getState')).position - state.position) < .5); report.staleSeekCannotMoveNextTrack = true;
  await assert.rejects(call('command', { action: 'seek', value: 70, expectedItem: { ...owner(state), url: 'https://example.invalid/changed' } }), /musica mudou/i); report.changedSourceRejected = true;
  await call('command', { action: 'seek', value: 40, expectedItem: owner(state) }); assert.ok(Math.abs((await call('getState')).position - 40) < .5);
  console.log('Atomic seek checks passed');
  await call('configure', { performanceMode: 'battery', visualizer: 'bars' }); assert.equal((await call('diagnostics')).audioMeterEnabled, false);
  await call('command', { action: 'play' }); await until(async () => (await call('getState')).playing);
  assert.ok((await call('getState')).levels.every(level => level === 0)); report.batteryModeDisablesMeter = true;
  await call('configure', { performanceMode: 'balanced', visualizer: 'off' }); assert.equal((await call('diagnostics')).audioMeterEnabled, false);
  await call('configure', { performanceMode: 'balanced', visualizer: 'bars' }); assert.equal((await call('diagnostics')).audioMeterEnabled, true);
  await until(async () => (await call('getState')).levels.some(level => level > .01)); report.meterResumes = true;
  console.log('Native meter preferences passed');
  if (!await page.locator('#player').evaluate(el => el.open)) await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  await call('command', { action: 'speed', value: 1.1 });
  report.nativeSpeedRaw = (await call('getState')).speed;
  await page.waitForFunction(() => document.querySelector('#player [data-action=speed] span').textContent === '1,1×'); report.nativeSpeedLabel = true;
  await page.evaluate(() => { window.originalSeek = document.querySelector('#seek'); originalSeek.value = '55'; originalSeek.dispatchEvent(new Event('input', { bubbles: true })); });
  await delay(1700); assert.equal(await page.evaluate(() => document.querySelector('#seek') === originalSeek), true); assert.equal(await page.locator('#seek').inputValue(), '55');
  await page.locator('#seek').dispatchEvent('change'); await until(async () => (await call('getState')).position >= 55); report.nativeScrubbingStable = true;
  await call('command', { action: 'pause' });
  await page.screenshot({ path: '.qa/screenshots/native-player-2.10.png', animations: 'disabled', timeout: 15000 });
  await writeFile('.qa/native-player-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  if (page && !page.isClosed()) {
    await call('command', { action: 'clear' }).catch(() => {});
    if (savedState) await call('command', { action: 'speed', value: savedState.speed || 1 }).catch(() => {});
    if (savedState) await call('command', { action: 'shuffle', value: savedState.shuffle ? 1 : 0 }).catch(() => {});
    for (const track of tracks) await call('removeDownload', { id: track.id }).catch(() => {});
    if (savedModel) { const settings = JSON.parse(savedModel).settings || {}; await call('configure', settings).catch(() => {}); await page.evaluate(value => localStorage.fluxo_mobile_v2 = value, savedModel); await page.reload().catch(() => {}); }
  }
  await browser?.close();
}
