import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const adb = `${process.env.LOCALAPPDATA}/Android/Sdk/platform-tools/adb.exe`;
const shell = (...args) => execFileSync(adb, args, { encoding: 'utf8', timeout: 15000 }).trim();
shell('shell', 'input', 'keyevent', 'KEYCODE_WAKEUP');
shell('shell', 'wm', 'dismiss-keyguard');
shell('shell', 'am', 'start', '-n', 'com.fluxo.music.mobile/.MainActivity');
shell('shell', 'pm', 'grant', 'com.fluxo.music.mobile', 'android.permission.POST_NOTIFICATIONS');
let browser;
for (let i = 0; i < 20; i++) {
  try {
    const pid = shell('shell', 'pidof', 'com.fluxo.music.mobile');
    shell('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${pid}`);
    browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 5000 });
    break;
  }
  catch (error) { if (i === 19) throw error; await new Promise(resolve => setTimeout(resolve, 300)); }
}
const page = browser.contexts()[0].pages()[0];
try {
  await page.locator('.navigation [data-tab=settings]').waitFor();
  const downloads = await page.evaluate(async () => (await window.Capacitor.Plugins.FluxoAudio.downloads()).tracks);
  const track = downloads.find(item => item.status === 'ready');
  assert.ok(track, 'Download or import a track before this test');
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByRole('button', { name: /Temas do Fluxo/ }).click();
  assert.equal(await page.locator('.theme-tile').count(), 68);
  await page.getByRole('button', { name: 'Tema Portal / Aperture', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'light');
  await page.getByRole('button', { name: 'Tema Fluxo Bug', exact: true }).click();
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('button', { name: /Músicas no dispositivo/ }).evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.getByRole('button', { name: /Músicas no dispositivo/ }).click();
  await page.getByRole('button', { name: `Tocar ${track.title}`, exact: true }).first().click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Abrir player' }).click();
  await page.waitForTimeout(450);
  assert.ok(await page.locator('#player .player-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
  await page.screenshot({ path: '.qa/screenshots/final-apk-player.png' });
  await page.getByRole('button', { name: 'Pausar', exact: true }).last().click();
  await page.getByRole('button', { name: 'Minimizar player' }).click();
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByRole('button', { name: /Personalizar aparência/ }).click();
  await page.getByRole('combobox', { name: 'Espaçamento', exact: true }).selectOption('compact');
  await page.getByRole('combobox', { name: 'Formato das capas', exact: true }).selectOption('round');
  await page.getByRole('tab', { name: 'Player', exact: true }).click();
  await page.getByRole('combobox', { name: 'Layout do player', exact: true }).selectOption('compact');
  await page.getByRole('combobox', { name: 'Visualizador', exact: true }).selectOption('wave');
  await page.getByRole('button', { name: 'Abrir player', exact: true }).first().click();
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => document.body.dataset.playerLayout), 'compact');
  assert.ok(await page.locator('#player .player-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1));
  await page.screenshot({ path: '.qa/screenshots/native-2.1-compact.png' });
  await page.getByRole('button', { name: 'Minimizar player' }).click();
  await page.getByRole('tab', { name: 'Estilos salvos', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar estilo atual', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Nome do estilo' }).fill('Meu player Android');
  await page.getByRole('button', { name: 'Salvar estilo', exact: true }).click();
  await page.getByRole('button', { name: 'Restaurar aparência', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  await page.locator('[data-action=apply-profile]').last().click();
  assert.equal(await page.evaluate(() => document.body.dataset.playerLayout), 'compact');
  await page.getByRole('button', { name: 'Voltar aos ajustes', exact: true }).click();
  await page.locator('.navigation [data-tab=library]').click();
  console.log('Final APK UI passed: 68 themes, light mode, downloaded playback, compact player, artwork shape, saved styles, reset and player controls.');
} finally { await browser.close(); }
