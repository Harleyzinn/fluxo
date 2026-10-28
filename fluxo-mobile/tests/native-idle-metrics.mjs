import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
const adb = `${process.env.ANDROID_HOME}/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, ['-s', process.env.ANDROID_SERIAL || 'emulator-5554', ...args], { encoding: 'utf8' }).trim();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const baseline = process.env.FOCUS_BASELINE === '1';
shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP'); shell('shell', 'wm', 'dismiss-keyguard');
shell('shell', 'am', 'force-stop', 'com.fluxo.music.mobile');
const launch = shell('shell', 'am', 'start', '-W', '-n', 'com.fluxo.music.mobile/.MainActivity'); await delay(2200);
const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile'); shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
let browser;
for (let i = 0; i < 20; i++) { try { browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 3000 }); break; } catch (error) { if (i === 19) throw error; await delay(500); } }
try {
  const page = browser.contexts()[0].pages()[0]; await page.locator('.navigation').waitFor();
  await page.evaluate(async () => { window.idleEvents = 0; window.idleWatch = await window.Capacitor.Plugins.FluxoAudio.addListener('state', () => idleEvents++); });
  await delay(6500);
  const report = { baseline, unsolicitedStateEvents: await page.evaluate(() => idleEvents), totalLaunchMs: Number(launch.match(/TotalTime:\s*(\d+)/)?.[1] || 0),
    pssKb: Number(shell('shell', 'dumpsys', 'meminfo', 'com.fluxo.music.mobile').match(/TOTAL PSS:\s*(\d+)/)?.[1] || 0),
    servicePresent: /ServiceRecord/.test(shell('shell', 'dumpsys', 'activity', 'services', 'com.fluxo.music.mobile/.PlaybackService')) };
  await page.evaluate(async () => idleWatch.remove());
  const run = process.env.METRICS_RUN;
  if (run && !/^\d+$/.test(run)) throw new Error('METRICS_RUN must be numeric');
  await writeFile(`.qa/idle-${baseline ? 'baseline' : 'fixed'}${run ? `-${run}` : ''}.json`, JSON.stringify(report, null, 2)); console.log(report);
} finally { await browser.close(); }
