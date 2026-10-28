import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.ANDROID_HOME || process.env.LOCALAPPDATA + '/Android/Sdk'}/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, ['-s', process.env.ANDROID_SERIAL || 'emulator-5554', ...args], { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseline = process.env.FOCUS_BASELINE === '1', report = { baseline, startedAt: new Date().toISOString() };
const downloadFixture = { id: 'qa-focus-download', title: 'Focus download fixture', artist: 'Test', url: 'https://raw.githubusercontent.com/androidx/media/8c6678b657ede1e7883fc164ef73ed483c7796c3/libraries/test_data/src/test/assets/media/mp3/play-trimmed.mp3', source: 'direct' };
let browser, page, chargingSounds;
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
const probe = () => JSON.parse(shell('shell', 'run-as', 'com.fluxo.qa.audio', 'cat', 'files/state.json'));
async function startProbe(focus) {
  shell('shell', 'am', 'force-stop', 'com.fluxo.qa.audio');
  shell('shell', 'run-as', 'com.fluxo.qa.audio', 'rm', '-f', 'files/state.json');
  shell('shell', 'am', 'start', '-W', '-n', 'com.fluxo.qa.audio/.ProbeActivity', '--ei', 'focus', String(focus));
  const started = Date.now();
  while (Date.now() - started < 30000) {
    let state; try { state = probe(); } catch {}
    if (state?.playing && Number.isFinite(state.playedMs) && state.playedMs >= 300) return;
    await delay(250);
  }
  throw new Error('The external probe did not produce a fresh playing snapshot');
}
const showFluxo = () => shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
async function connect() {
  for (let i = 0; i < 40; i++) {
    const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile'); shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 3000 }); break; }
    catch (error) { if (i === 39) throw error; await delay(500); }
  }
  page = browser.contexts()[0].pages()[0]; await page.locator('.navigation').waitFor();
}
try {
  await mkdir('.qa', { recursive: true });
  if (!baseline) { chargingSounds = shell('shell', 'settings', 'get', 'global', 'charging_sounds_enabled'); shell('shell', 'settings', 'put', 'global', 'charging_sounds_enabled', '0'); }
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard'); showFluxo(); await delay(1800); await connect(); await call('command', { action: 'clear' });
  if (!baseline) { await call('configure', { diagnosticEnabled: true }); await call('clearAudioLog'); }
  await startProbe(1); showFluxo();
  for (const tab of ['search', 'settings', 'library', 'queue', 'settings', 'library']) { await page.locator(`.navigation [data-tab=${tab}]`).click(); await delay(200); }
  await call('command', { action: 'refresh' }); await delay(2500); report.passiveNavigation = probe();
  assert.equal(report.passiveNavigation.playing, true); assert.equal(report.passiveNavigation.losses, 0);
  shell('shell', 'am', 'force-stop', 'com.fluxo.qa.audio'); showFluxo();
  await call('setQueue', { tracks: [{ id: 'qa-focus-failed', title: 'Focus failure fixture', artist: 'Test', url: 'https://10.0.2.2:1/fail.mp3', source: 'direct' }] });
  await startProbe(2); console.log('Waiting past the 45-second buffering watchdog'); await delay(65000);
  report.failedStreamWithOtherFocus = probe(); report.fluxo = await call('getState');
  await writeFile(`.qa/audio-focus-${baseline ? 'baseline' : 'fixed'}.json`, JSON.stringify(report, null, 2));
  if (!baseline) {
    assert.equal(report.failedStreamWithOtherFocus.playing, true); assert.equal(report.failedStreamWithOtherFocus.losses, 0);
    report.log = await call('audioLog');
    assert.ok(report.log.events.some(e => e.event === 'focus_request')); assert.ok(report.log.events.some(e => e.event === 'focus_release'));
    assert.equal(JSON.stringify(report.log).includes('fail.mp3'), false);
    await writeFile('.qa/audio-focus-fixed.json', JSON.stringify(report, null, 2));
    console.log('Core focus regression passed');
    await call('command', { action: 'clear' }); await startProbe(1); showFluxo();
  }
  if (!baseline) {
    report.scenarios = {};
    const preserve = async (name, operation, wait = 1200) => {
      const before = probe(), ownBefore = (await call('diagnostics')).focusRequests;
      await operation(); await delay(wait); const after = probe(), ownAfter = (await call('diagnostics')).focusRequests;
      await writeFile('.qa/audio-focus-progress.json', JSON.stringify({ ...report, currentScenario: name, before, after, ownBefore, ownAfter }, null, 2));
      assert.equal(ownAfter, ownBefore, `${name}: Fluxo must not request focus`);
      assert.equal(after.playing, true, name); assert.equal(after.losses, 0, name); assert.ok(after.playedMs > before.playedMs, name); report.scenarios[name] = true;
    };
    await preserve('interfaceSounds', async () => { await call('configure', { diagnosticEnabled: true, silentInterface: false, uiSounds: true, alertSounds: true }); await call('feedback'); await call('feedback', { error: true }); });
    await call('configure', { diagnosticEnabled: true, silentInterface: true });
    await preserve('background', async () => shell('shell', 'input', 'keyevent', 'KEYCODE_HOME'), 5000);
    await preserve('lockedScreen', async () => shell('shell', 'input', 'keyevent', 'KEYCODE_SLEEP'), 20000);
    assert.match(shell('shell', 'dumpsys', 'power'), /mWakefulness=Asleep/); shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard'); showFluxo(); await delay(800);
    await preserve('notifications', async () => shell('shell', 'am', 'startservice', '-n', 'com.fluxo.qa.audio/.ProbeService', '-a', 'notify'));
    await preserve('networkLoss', async () => { shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable'); });
    await preserve('networkReturn', async () => { shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable'); }, 2200);
    if (process.env.FOCUS_TEST_BATTERY === '1') {
    await preserve('batterySaver', async () => {
      shell('shell', 'cmd', 'battery', 'unplug'); shell('shell', 'cmd', 'battery', 'set', 'level', '20'); shell('shell', 'cmd', 'power', 'set-mode', '1');
      await delay(1500);
      assert.equal(shell('shell', 'settings', 'get', 'global', 'low_power'), '1');
      const power = shell('shell', 'dumpsys', 'power');
      assert.ok(/mFullEnabled=true|mSettingBatterySaverEnabled=true/.test(power), 'Battery saver must actually be enabled');
    }); shell('shell', 'cmd', 'power', 'set-mode', '0'); shell('shell', 'cmd', 'battery', 'reset');
    } else report.skippedScenarios = { batterySaver: 'Not exercised in this run; separate power-mode validation required.' };
    await preserve('rapidAppSwitching', async () => { for (let i = 0; i < 4; i++) { shell('shell', 'input', 'keyevent', 'KEYCODE_HOME'); showFluxo(); } });
    await preserve('idleAudioPreferences', async () => { await call('command', { action: 'volume', value: .4 }); await call('command', { action: 'speed', value: 1 }); await call('clearCache'); });
    await preserve('downloadCompletion', async () => {
      await call('configure', { diagnosticEnabled: true, downloadNotifications: true });
      shell('shell', 'pm', 'grant', 'com.fluxo.music.mobile', 'android.permission.POST_NOTIFICATIONS');
      await call('removeDownload', { id: downloadFixture.id }); await call('download', { track: downloadFixture, wifiOnly: true });
      const start = Date.now(); let complete;
      while (Date.now() - start < 240000) {
        complete = (await call('downloads')).tracks.find(t => t.id === downloadFixture.id && t.status === 'ready');
        if (complete) break; await delay(800);
      }
      assert.ok(complete?.bytes > 0, 'A real download must finish'); await delay(1000);
      assert.ok((await call('audioLog')).events.some(e => e.event === 'silent_notice'));
      const notices = shell('shell', 'dumpsys', 'notification', '--noredact');
      assert.match(notices, /tag=fluxo_download/);
      assert.match(notices, /mId='fluxo_downloads'[^\n]*mSound=null/);
    });
  }
  console.log(JSON.stringify(report, null, 2));
  await writeFile(`.qa/audio-focus-${baseline ? 'baseline' : 'fixed'}.json`, JSON.stringify(report, null, 2));
} finally {
  if (page && !page.isClosed()) await call('command', { action: 'clear' }).catch(() => {});
  if (!baseline && page && !page.isClosed()) await call('removeDownload', { id: downloadFixture.id }).catch(() => {});
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable'); shell('shell', 'cmd', 'power', 'set-mode', '0');
  shell('shell', 'cmd', 'battery', 'reset');
  if (chargingSounds !== undefined) { if (chargingSounds === 'null') shell('shell', 'settings', 'delete', 'global', 'charging_sounds_enabled'); else shell('shell', 'settings', 'put', 'global', 'charging_sounds_enabled', chargingSounds); }
  shell('shell', 'am', 'force-stop', 'com.fluxo.qa.audio'); shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); await browser?.close();
}
