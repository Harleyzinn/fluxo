import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
const report = {};
const fixture = { id: 'qa-background-radio', title: 'Background radio fixture', artist: 'Test', duration: 12, url: '', source: 'local' };
let notificationLayout;
await mkdir('.qa/screenshots', { recursive: true });
async function waitFor(test, timeout = 60000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { const state = await call('getState'); if (test(state)) return state; await delay(500); }
  throw new Error('Timed out: ' + JSON.stringify(await call('getState')));
}
async function asleep(seconds) {
  const before = await call('getState');
  shell('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  shell('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  console.log(`Screen-off playback test: ${seconds} seconds`);
  await delay(seconds * 1000);
  assert.ok(shell('shell', 'dumpsys', 'power').includes('mWakefulness=Asleep'));
  const after = await call('getState');
  assert.ok(after.playing && after.position - before.position > seconds - 5, 'Audio must progress beyond the maximum streaming buffer while screen is off');
  assert.ok(shell('shell', 'dumpsys', 'activity', 'services', 'com.fluxo.music.mobile/.PlaybackService').includes('isForeground=true'));
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  return { seconds, advanced: after.position - before.position, foreground: true };
}
async function notificationButton(pattern) {
  shell('shell', 'cmd', 'statusbar', 'expand-notifications'); await delay(1500);
  // Capture controls while paused: Android's animated playing seekbar can prevent
  // the shell UiAutomator dumper from ever reaching its idle state.
  if (!notificationLayout) {
    shell('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/fluxo-notification.xml');
    notificationLayout = shell('shell', 'cat', '/sdcard/fluxo-notification.xml');
  }
  const xml = notificationLayout;
  const point = await page.evaluate(({ xml, source }) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const nodes = [...doc.querySelectorAll('node')];
    const element = nodes.find(node => ((source === '^Pause$' || source === '^Play$')
      ? node.getAttribute('resource-id')?.endsWith('/actionPlayPause')
      : new RegExp(source, 'i').test(node.getAttribute('content-desc') || '')) && node.getAttribute('enabled') === 'true');
    if (!element) return { descriptions: nodes.map(n => n.getAttribute('content-desc')).filter(Boolean) };
    const [x1, y1, x2, y2] = element.getAttribute('bounds').match(/\d+/g).map(Number);
    return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
  }, { xml, source: pattern });
  assert.ok(point.x, `Notification control missing: ${JSON.stringify(point)}`);
  shell('shell', 'input', 'tap', String(point.x), String(point.y)); await delay(500);
}
try {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'cmd', 'statusbar', 'collapse');
  shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity'); await delay(1200);
  await waitFor(() => true);
  await call('command', { action: 'sleep', value: 0 }); await call('command', { action: 'repeat', value: 0 });
  await call('command', { action: 'speed', value: 1 }); await call('command', { action: 'shuffle', value: 0 });
  shell('shell', 'pm', 'grant', 'com.fluxo.music.mobile', 'android.permission.POST_NOTIFICATIONS');
  const wav = Buffer.alloc(44 + 8000 * 12 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await call('removeDownload', { id: fixture.id });
  await call('migrateAudio', { track: fixture, offset: 0, data: wav.toString('base64'), complete: true });
  const localTracks = (await call('downloads')).tracks.filter(t => t.status === 'ready');
  assert.ok(localTracks.length >= 2, 'Import/download two tracks before this test');
  const radioFixture = localTracks.find(track => track.id === fixture.id);
  assert.ok(radioFixture?.localUri, 'The imported fixture must include its native file URI');
  await page.goto('https://localhost/#library'); await delay(1200);
  await page.getByRole('tab', { name: 'Baixadas', exact: true }).click();
  await page.locator('[data-action="track-play"]').first().click();
  await waitFor(s => s.playing);
  assert.equal((await call('getState')).queue.length, 1); report.noAutomaticQueue = true;
  const online = JSON.parse(await readFile('.qa/youtube-results.json', 'utf8')).find(track => !localTracks.some(local => local.id === track.id || local.url === track.url));
  assert.ok(online, 'Choose a stream that is not already downloaded');
  await call('setQueue', { tracks: [online, radioFixture], index: 0 });
  const start = Date.now(); await waitFor(s => s.playing); report.onlineStartMs = Date.now() - start;
  await call('command', { action: 'pause' });
  await notificationButton('^Play$'); await waitFor(s => s.playing);
  shell('shell', 'cmd', 'statusbar', 'collapse');
  report.onlineScreenOff = await asleep(Number(process.env.BACKGROUND_SECONDS || 180));
  await writeFile('.qa/native-background-report.json', JSON.stringify(report, null, 2));
  await notificationButton('^Pause$'); await waitFor(s => !s.playWhenReady); report.notificationPause = true;
  await notificationButton('^Play$'); await waitFor(s => s.playing); report.notificationPlay = true;
  await notificationButton('^Next( track)?$'); await waitFor(s => s.index === 1 && s.playing); report.notificationNext = true;
  await writeFile('.qa/screenshots/android-notification.png', execFileSync(adb, ['exec-out', 'screencap', '-p']));
  shell('shell', 'cmd', 'statusbar', 'collapse');
  shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
  await call('radio', { track: online, offline: false });
  await waitFor(s => s.radio && !s.radioLoading && s.queue.length > 1, 90000);
  let state = await call('getState'); assert.equal(new Set(state.queue.map(t => t.id)).size, state.queue.length);
  report.onlineRadio = { count: state.queue.length, duplicateFree: true };
  await call('command', { action: 'radio-stop' }); state = await call('getState');
  assert.equal(state.radio, false); assert.equal(state.queue.length, 1); report.radioStopClearsRecommendations = true;
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable');
  await call('radio', { track: localTracks[0], offline: true });
  await waitFor(s => s.radio && s.radioOffline && s.queue.length > 1 && s.playing);
  await call('command', { action: 'next' }); await waitFor(s => s.index > 0 && s.playing);
  report.offlineRadio = true;
  await call('command', { action: 'sleep', value: -1 });
  state = await call('getState'); await call('command', { action: 'seek', value: Math.max(0, state.duration - 1) });
  await waitFor(s => !s.playWhenReady && !s.sleepEnd, 15000); report.sleepEnd = true;
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  await call('command', { action: 'clear' });
  await writeFile('.qa/native-background-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  await call('removeDownload', { id: fixture.id }).catch(() => {});
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable'); shell('shell', 'cmd', 'statusbar', 'collapse');
  await call('command', { action: 'pause' }).catch(() => {}); await browser.close();
}
