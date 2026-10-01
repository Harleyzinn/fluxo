import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8' }).trim();
const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
shell('shell', 'pm', 'grant', 'com.fluxo.music.mobile', 'android.permission.POST_NOTIFICATIONS');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
try {
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByRole('button', { name: /Temas do Fluxo/ }).click();
  assert.equal(await page.locator('.theme-tile').count(), 68);
  await page.getByRole('button', { name: 'Tema Portal / Aperture', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'light');
  await page.getByRole('button', { name: 'Tema Fluxo Bug', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: /Músicas no dispositivo/ }).click();
  await page.getByRole('button', { name: 'Tocar Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Abrir player' }).click();
  await page.waitForTimeout(450);
  assert.ok(await page.locator('#player .player-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
  await page.screenshot({ path: '.qa/screenshots/final-apk-player.png' });
  await page.getByRole('button', { name: 'Pausar', exact: true }).last().click();
  await page.getByRole('button', { name: 'Minimizar player' }).click();
  console.log('Final APK UI passed: 68 themes, light mode, downloaded playback, player controls.');
} finally { await browser.close(); }
