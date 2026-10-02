import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser, page;
async function connect() {
  const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
  shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
  for (let i = 0; i < 30; i++) {
    try { browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 5000 }); break; }
    catch (error) { if (i === 29) throw error; await delay(500); }
  }
  page = browser.contexts()[0].pages()[0];
}
await connect();
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
const original = await page.evaluate(async () => {
  const { libraryTracks } = await import('./model.js');
  const model = JSON.parse(localStorage.getItem('fluxo_mobile_v2'));
  return { tracks: libraryTracks(model), enabled: model.settings.autoDownload !== false, wifiOnly: !!model.settings.wifiOnly };
});
const track = { id: 'qa-automatic-download', title: 'Media3 test audio', artist: 'Android test fixture',
  url: 'https://storage.googleapis.com/exoplayer-test-media-0/play.mp3', source: 'direct' };
const options = { tracks: [...original.tracks, track], enabled: true, wifiOnly: true };
const report = {};
try {
  await call('removeDownload', { id: track.id });
  shell('shell', 'svc', 'wifi', 'disable'); shell('shell', 'svc', 'data', 'disable'); await delay(2000);
  await call('syncLibrary', { ...options, retry: true });
  let record = (await call('downloads')).tracks.find(t => t.id === track.id);
  assert.equal(record.status, 'queued'); report.waitsForWifi = true;
  await delay(2500); record = (await call('downloads')).tracks.find(t => t.id === track.id); assert.equal(record.status, 'queued');
  shell('shell', 'input', 'keyevent', 'KEYCODE_HOME'); shell('shell', 'input', 'keyevent', 'KEYCODE_SLEEP');
  shell('shell', 'svc', 'wifi', 'enable');
  console.log('Automatic library download with screen off, waiting for completion');
  await delay(45000);
  assert.ok(shell('shell', 'dumpsys', 'power').includes('mWakefulness=Asleep'));
  const savedDuringSleep = shell('shell', 'run-as', 'com.fluxo.music.mobile', 'cat', 'shared_prefs/library.xml');
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'am', 'start', '-W', '-n', 'com.fluxo.music.mobile/.MainActivity');
  await browser.close().catch(() => {}); await connect();
  const completedAsleep = await page.evaluate(({ xml, id }) => {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const records = JSON.parse(doc.querySelector('string[name="tracks"]').textContent);
    return records.find(t => t.id === id)?.status === 'ready';
  }, { xml: savedDuringSleep, id: track.id });
  report.completedWithScreenOff = completedAsleep;
  console.log('Completed while asleep:', completedAsleep);
  for (let i = 0; i < 240; i++) {
    await delay(1000); record = (await call('downloads')).tracks.find(t => t.id === track.id);
    if (record?.status === 'ready') break;
    if (record?.status === 'failed' && i > 100) throw new Error(record.statusDetail);
  }
  assert.equal(record?.status, 'ready'); assert.ok(record.bytes > 0);
  report.backgroundDownloadBytes = record.bytes; report.privateFile = record.localUri.startsWith('file://');
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
  shell('shell', 'svc', 'wifi', 'disable');
  await call('setQueue', { tracks: [record], index: 0 }); await delay(2500);
  assert.ok((await call('getState')).playing); report.downloadedFilePlaysOffline = true;
  await call('command', { action: 'clear' });
  await call('removeDownload', { id: track.id });
  await call('syncLibrary', options);
  assert.equal((await call('downloads')).tracks.some(t => t.id === track.id), false); report.cancelDoesNotRedownload = true;
  await call('syncLibrary', { ...options, retry: true });
  assert.equal((await call('downloads')).tracks.find(t => t.id === track.id).status, 'queued'); report.retryUnblocks = true;
  await writeFile('.qa/native-downloads-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally {
  shell('shell', 'svc', 'wifi', 'enable'); shell('shell', 'svc', 'data', 'enable');
  shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
  await call('removeDownload', { id: track.id }).catch(() => {});
  await call('syncLibrary', original).catch(() => {});
  await browser.close();
}
