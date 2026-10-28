import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const report = {}, errors = [];
const platform = await readFile(new URL('../www/platform.js', import.meta.url), 'utf8');
const fixture = `
const songs = [
  { id: 'player-a', title: 'Um encontro com todas as músicas que fazem parte da nossa história', artist: 'Orquestra de testes e convidados', url: 'https://example.invalid/a.mp3', duration: 120 },
  { id: 'player-b', title: 'Outra música', artist: 'Outra banda', url: 'https://example.invalid/b.mp3', duration: 120 }
];
commands.downloads = async () => songs.map(t => ({ ...t, status: 'ready' }));
commands.init = async listener => {
  window.playerFixture = { queue: songs, index: 0, playing: false, playWhenReady: false, buffering: false, error: '', duration: 120, position: 10, buffered: 80, canNext: true, levels: Array(32).fill(.65), speed: 1, volume: 1 };
  window.playerCommands = [];
  window.emitPlayer = patch => { window.playerFixture = { ...window.playerFixture, ...patch }; listener(window.playerFixture); };
  commands.command = async options => {
    if (options.expectedItem && !samePlaybackItem(window.playerFixture, options.expectedItem)) throw new Error('A música mudou.');
    window.playerCommands.push(options);
    if (options.action === 'seek') window.emitPlayer({ position: options.value });
    if (options.action === 'pause') window.emitPlayer({ playing: false, playWhenReady: false, buffering: false });
    if (options.action === 'play') window.emitPlayer({ playing: true, playWhenReady: true, buffering: false });
    if (options.action === 'speed') window.emitPlayer({ speed: options.value });
    if (options.action === 'sleep') window.emitPlayer({ sleepAt: Date.now() + options.value * 60000 });
  };
  window.emitPlayer({});
};
`;
const pixels = page => page.locator('#audio-visual').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data].some((v, i) => i % 4 === 3 && v > 0));
try {
  await mkdir('.qa/screenshots', { recursive: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => { if (!localStorage.fluxo_mobile_v2) localStorage.fluxo_mobile_v2 = JSON.stringify({ library: [], playlists: [], favorites: [], settings: { autoDownload: false } }); });
  await page.route('**/platform.js', route => route.fulfill({ contentType: 'text/javascript', body: platform + fixture }));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5176');
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  await page.evaluate(() => { window.seekNode = document.querySelector('#seek'); window.emitPlayer({ playWhenReady: true, buffering: true }); });
  await page.locator('#player [aria-label=Pausar]').click();
  assert.equal(await page.evaluate(() => playerCommands.at(-1).action), 'pause'); report.bufferingPause = true;
  await page.evaluate(() => emitPlayer({ playing: true, playWhenReady: true })); await page.waitForTimeout(150); assert.equal(await pixels(page), true);
  await page.locator('#player [aria-label=Pausar]').click(); await page.waitForTimeout(80); assert.equal(await pixels(page), false);
  await page.locator('#player [aria-label=Reproduzir]').click(); await page.waitForTimeout(150); assert.equal(await pixels(page), true); report.visualizerResumes = true;
  await page.locator('#seek').focus();
  await page.locator('#seek').evaluate(el => { el.value = '42'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.evaluate(() => emitPlayer({ position: 12, buffering: true }));
  assert.equal(await page.evaluate(() => document.querySelector('#seek') === seekNode), true);
  assert.equal(await page.locator('#seek').inputValue(), '42'); assert.equal(await page.locator('#elapsed').textContent(), '0:42');
  assert.equal(await page.locator('#seek').evaluate(el => document.activeElement === el), true);
  await page.locator('#seek').dispatchEvent('change');
  await page.waitForFunction(() => playerCommands.some(c => c.action === 'seek' && c.value === 42 && c.expectedItem.id === 'player-a'));
  await page.evaluate(() => emitPlayer({ position: 45, buffering: false })); assert.equal(await page.locator('#seek').inputValue(), '45'); report.stableScrubbing = true;
  await page.evaluate(() => {
    window.controlMutations = 0;
    window.controlWatch = new MutationObserver(rows => controlMutations += rows.length);
    controlWatch.observe(document.querySelector('.player-controls'), { childList: true, subtree: true, attributes: true });
    emitPlayer({ position: 46 }); emitPlayer({ position: 45 });
  });
  await page.waitForTimeout(50); assert.equal(await page.evaluate(() => controlMutations), 0); await page.evaluate(() => controlWatch.disconnect()); report.progressDoesNotRepaintControls = true;
  await page.getByRole('button', { name: 'Mostrar tempo restante', exact: true }).click(); assert.equal(await page.locator('#total').textContent(), '-1:15'); report.remainingTime = true;
  await page.evaluate(() => emitPlayer({ speed: 1.100000023841858 })); assert.equal(await page.locator('#player [data-action=speed] span').textContent(), '1,1×'); report.compactSpeedLabel = true;
  await page.locator('#seek').evaluate(el => { el.value = '80'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('pointercancel', { bubbles: true })); });
  assert.equal(await page.locator('#seek').inputValue(), '45'); report.cancelledScrub = true;
  await page.evaluate(() => { window.oldSeek = document.querySelector('#seek'); oldSeek.value = '90'; oldSeek.dispatchEvent(new Event('input', { bubbles: true })); window.commandCount = playerCommands.length; emitPlayer({ index: 1, position: 0 }); oldSeek.dispatchEvent(new Event('change', { bubbles: true })); });
  assert.equal(await page.evaluate(() => playerCommands.length === commandCount), true); assert.equal(await page.locator('#seek').inputValue(), '0'); report.trackChangeDropsOldSeek = true;
  await page.evaluate(() => emitPlayer({ playing: false, playWhenReady: false, sleepAt: Date.now() + 65000 }));
  const timer = await page.locator('[data-sleep-label]').textContent(); await page.waitForTimeout(1600);
  assert.notEqual(await page.locator('[data-sleep-label]').textContent(), timer); report.pausedTimerUpdates = true;
  await page.evaluate(() => emitPlayer({ radio: true, radioOffline: false, sleepAt: 0 }));
  assert.equal(await page.locator('.player-status span').textContent(), 'Infinite Radio');
  await page.evaluate(() => emitPlayer({ radioOffline: true }));
  assert.equal(await page.locator('.player-status span').textContent(), 'Infinite Radio offline'); report.radioModeUpdates = true;
  await page.getByRole('button', { name: 'Minimizar player', exact: true }).click();
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByLabel('Intervalo dos atalhos', { exact: true }).selectOption('30');
  await page.getByRole('checkbox', { name: 'Mostrar tempo restante', exact: true }).check();
  await page.reload();
  assert.equal(await page.getByLabel('Intervalo dos atalhos', { exact: true }).inputValue(), '30');
  assert.equal(await page.getByRole('checkbox', { name: 'Mostrar tempo restante', exact: true }).isChecked(), true);
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  assert.equal(await page.locator('#total').textContent(), '-1:50');
  await page.getByRole('button', { name: 'Avançar 30 segundos', exact: true }).click();
  assert.equal(await page.evaluate(() => playerCommands.at(-1).value), 40); report.playbackPreferencesPersist = true;
  await page.locator('#player [data-action=speed]').click();
  await page.locator('.speed-presets [data-value="1.25"]').click();
  assert.equal(await page.locator('#player [data-action=speed] span').textContent(), '1,25×'); report.speedPresets = true;
  await page.evaluate(() => emitPlayer({ sleepAt: Date.now() + 60000 }));
  await page.locator('#player [data-action=sleep]').click();
  await page.getByRole('button', { name: 'Adicionar 5 minutos', exact: true }).click();
  assert.ok(await page.evaluate(() => Math.abs(playerCommands.at(-1).value - 6) < .1)); report.sleepExtension = true;
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    for (const layout of ['cover', 'compact']) for (const colorMode of ['dark', 'light']) {
      await page.evaluate(({ layout, colorMode }) => { const value = JSON.parse(localStorage.fluxo_mobile_v2); Object.assign(value.settings, { playerLayout: layout, colorMode, textSize: 'large' }); localStorage.fluxo_mobile_v2 = JSON.stringify(value); }, { layout, colorMode });
      await page.reload(); await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
      const sizes = await page.locator('#player').evaluate(el => ({ overflow: el.scrollWidth > el.clientWidth, footer: el.querySelector('.player-footer').getBoundingClientRect().bottom, viewport: innerHeight }));
      assert.equal(sizes.overflow, false, JSON.stringify({ viewport, layout, colorMode }));
      assert.ok(sizes.footer <= sizes.viewport + 1, `Footer outside viewport: ${JSON.stringify({ viewport, layout, colorMode, sizes })}`);
      for (const control of await page.locator('#player .player-controls button').all()) assert.ok(await control.evaluate(el => el.getBoundingClientRect().width >= 44));
      await page.screenshot({ path: `.qa/screenshots/player-2.10-${viewport.width}-${layout}-${colorMode}.png`, animations: 'disabled' });
    }
  }
  report.responsive = true; assert.deepEqual(errors, []);
  await writeFile('.qa/player-ui-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally { await browser.close(); }
