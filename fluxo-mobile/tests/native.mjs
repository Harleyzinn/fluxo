import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
const call = (method, data = {}) => page.evaluate(async ({ method, data }) => window.Capacitor.Plugins.FluxoAudio[method](data), { method, data });
await mkdir('.qa/screenshots', { recursive: true });
try {
  console.log('Page:', await page.title(), 'Native:', await page.evaluate(() => window.Capacitor.isNativePlatform()));
  console.log('Initial state:', await call('getState'));
  await page.screenshot({ path: '.qa/screenshots/android.png' });
  if (process.argv[2] === 'search') {
    const start = Date.now();
    for (const provider of ['youtube']) {
      try {
        const response = await call('search', { query: 'Big Buck Bunny Blender', provider });
        console.log('Search', provider, response.tracks.length, 'tracks', Date.now() - start, 'ms');
        await writeFile(`.qa/${provider}-results.json`, JSON.stringify(response.tracks, null, 2));
        if (response.tracks.length && provider === 'youtube') {
          const track = response.tracks[0];
          console.log('Playing:', track.title);
          await call('setQueue', { tracks: [track], index: 0 });
          let played = false;
          for (let i = 0; i < 45; i++) {
            await new Promise(r => setTimeout(r, 1000));
            const s = await call('getState');
            if (s.playing || s.error) { played = !!s.playing; console.log('Playback:', { playing: s.playing, position: s.position, error: s.error, elapsedMs: Date.now() - start }); break; }
          }
          assert.ok(played, 'The online stream must start');
        }
      } catch (e) { console.log('Search failed', provider, e.message); throw e; }
    }
    await page.screenshot({ path: '.qa/screenshots/android-search-test.png' });
  }
} finally { await browser.close(); }
