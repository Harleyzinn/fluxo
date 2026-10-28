import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.ANDROID_HOME || process.env.LOCALAPPDATA + '/Android/Sdk'}/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, ['-s', process.env.ANDROID_SERIAL || 'emulator-5554', ...args], { encoding: 'utf8', timeout: 30000 }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page, savedSettings;
const report = { startedAt: new Date().toISOString() };
const track = { id: 'qa-renderer', title: 'Renderer recovery', artist: 'Test', duration: 90, source: 'local', url: '' };
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
async function connect() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
      shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
      browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 2000 });
      page = browser.contexts()[0].pages()[0];
      await page.locator('.navigation').waitFor({ timeout: 2000 }); return;
    } catch { await browser?.close().catch(() => {}); await delay(500); }
  }
  throw new Error('The renderer did not recover');
}
async function crashRenderer() {
  const session = await page.context().newCDPSession(page);
  await Promise.race([session.send('Page.crash').catch(() => {}), delay(5000)]);
  await browser.close().catch(() => {});
}
try {
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable');
  shell('shell', 'am', 'force-stop', 'com.fluxo.music.mobile');
  shell('shell', 'am', 'start', '-W', '-n', 'com.fluxo.music.mobile/.MainActivity'); await connect();
  savedSettings = await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2 || '{}').settings || {});
  await call('configure', { ...savedSettings, diagnosticEnabled: true });
  await call('command', { action: 'clear' });
  const wav = Buffer.alloc(44 + 8000 * 90 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await call('removeDownload', { id: track.id });
  for (let offset = 0; offset < wav.length; offset += 262144) await call('migrateAudio', { track, offset, data: wav.subarray(offset, offset + 262144).toString('base64'), complete: offset + 262144 >= wav.length });
  await call('setQueue', { tracks: [track] }); await delay(2200);
  assert.equal((await call('getState')).playing, true);
  const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
  const before = await call('getState'), focus = (await call('diagnostics')).focusRequests;
  await crashRenderer(); await connect();
  assert.equal(shell('shell', 'pidof', 'com.fluxo.music.mobile'), pid);
  let state = await call('getState'); assert.equal(state.playing, true); assert.ok(state.position > before.position); assert.equal(state.queue[0].id, track.id);
  assert.equal((await call('diagnostics')).focusRequests, focus); report.foregroundAudioSurvives = true;
  console.log('Foreground recovery preserved audio and process');
  shell('shell', 'input', 'keyevent', 'KEYCODE_HOME'); await delay(500);
  const position = (await call('getState')).position;
  await crashRenderer(); await delay(2500);
  assert.equal(shell('shell', 'pidof', 'com.fluxo.music.mobile'), pid);
  assert.equal(shell('shell', 'dumpsys', 'activity', 'activities').split('\n').filter(line => line.includes('topResumedActivity')).some(line => line.includes('com.fluxo.music.mobile')), false);
  shell('shell', 'am', 'start', '-W', '-n', 'com.fluxo.music.mobile/.MainActivity'); await connect();
  state = await call('getState'); assert.equal(state.playing, true); assert.ok(state.position > position);
  assert.equal((await call('diagnostics')).focusRequests, focus); report.backgroundRecoveryDeferred = true;
  console.log('Background recovery was deferred and preserved audio');
  await call('command', { action: 'clear' });
  await delay(1200); const requests = (await call('diagnostics')).focusRequests;
  await crashRenderer(); await delay(1000);
  shell('shell', 'uiautomator', 'dump', '--compressed', '/sdcard/fluxo-renderer.xml');
  const xml = shell('shell', 'cat', '/sdcard/fluxo-renderer.xml');
  const bounds = execFileSync('powershell.exe', ['-NoProfile', '-Command', '$doc = [xml]($input | Out-String); $node = $doc.SelectSingleNode(\'//node[@class="android.widget.Button" and contains(translate(@text,"ABCDEFGHIJKLMNOPQRSTUVWXYZ","abcdefghijklmnopqrstuvwxyz"),"reabrir interface")]\'); if (-not $node) { throw "Recovery control missing" }; $node.GetAttribute("bounds")'], { input: xml, encoding: 'utf8', timeout: 10000 });
  const [x1, y1, x2, y2] = bounds.match(/\d+/g).map(Number);
  await writeFile('.qa/screenshots/renderer-recovery.png', execFileSync(adb, ['-s', process.env.ANDROID_SERIAL || 'emulator-5554', 'exec-out', 'screencap', '-p']));
  shell('shell', 'input', 'tap', String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2))); await connect();
  assert.equal((await call('diagnostics')).focusRequests, requests); assert.equal((await call('diagnostics')).serviceActive, false);
  report.idleRecoveryDoesNotStartAudio = true;
  report.recoveryLoopGuard = true;
  assert.ok((await call('audioLog')).events.some(event => event.event === 'renderer_gone'));
  await writeFile('.qa/native-renderer-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  if (page && !page.isClosed()) {
    await call('command', { action: 'clear' }).catch(() => {});
    await call('removeDownload', { id: track.id }).catch(() => {});
    if (savedSettings) await call('configure', savedSettings).catch(() => {});
  }
  await browser?.close();
}
