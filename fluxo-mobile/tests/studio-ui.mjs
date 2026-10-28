import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const errors = [], report = {};
await mkdir('.qa/screenshots', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5175');
  await page.evaluate(() => localStorage.fluxo_mobile_v2 = JSON.stringify({ library: [{ id: 'studio', title: 'Minha seleção', artist: 'Minha banda', url: '' }], favorites: [], playlists: [{ id: 'p', title: 'Dias tranquilos', description: 'Músicas para acompanhar o dia.', tracks: [], offlineOnly: true }], settings: { autoDownload: false } })); await page.reload();
  await page.locator('.navigation [data-tab=settings]').click(); await page.getByRole('tab', { name: 'Desempenho', exact: true }).waitFor(); assert.equal(await page.getByRole('tab').count(), 5);
  await page.getByRole('tab', { name: 'Desempenho', exact: true }).click(); await page.getByRole('combobox', { name: 'Modo de desempenho', exact: true }).selectOption('battery');
  await page.getByRole('checkbox', { name: 'Downloads em segundo plano', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Cache temporário', exact: true }).click(); await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).library.length), 1); report.safeCacheClear = true;
  await page.getByRole('tab', { name: 'Áudio', exact: true }).click(); assert.equal(await page.getByRole('checkbox', { name: 'Sons dos controles', exact: true }).isEnabled(), false);
  await page.getByRole('checkbox', { name: 'Silenciar interface', exact: true }).uncheck(); await page.getByRole('checkbox', { name: 'Sons dos controles', exact: true }).check(); report.soundPreferences = true;
  await page.getByRole('tab', { name: 'Sistema', exact: true }).click(); await page.getByRole('checkbox', { name: 'Registrar diagnóstico', exact: true }).check();
  await page.getByRole('button', { name: 'Estado do áudio e serviços', exact: true }).click(); assert.equal(await page.locator('.diagnostic-metrics > div').count(), 6); await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('tab', { name: 'Visual', exact: true }).click(); await page.getByRole('combobox', { name: 'Modo de cor', exact: true }).selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForFunction(() => document.documentElement.style.colorScheme === 'light');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForFunction(() => document.documentElement.style.colorScheme === 'dark'); report.systemColors = true;
  await page.reload(); await page.locator('.navigation [data-tab=settings]').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).settings);
  assert.equal(saved.performanceMode, 'battery'); assert.equal(saved.backgroundDownloads, false); assert.equal(saved.diagnosticEnabled, true); assert.equal(saved.uiSounds, true); assert.equal(saved.silentInterface, false); report.persistence = true;
  await page.evaluate(async () => {
    const { commands } = await import('./platform.js');
    window.configuredSettings = null;
    commands.configure = async settings => { window.configuredSettings = { ...settings }; };
  });
  await page.getByRole('tab', { name: 'Sistema', exact: true }).click();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restaurar backup', exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: 'studio-backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ format: 'fluxo-mobile', version: 2, library: [], favorites: [], playlists: [], settings: { performanceMode: 'balanced', backgroundDownloads: true, silentInterface: true, diagnosticEnabled: false } })) });
  await page.waitForFunction(() => window.configuredSettings?.performanceMode === 'balanced');
  assert.equal(await page.evaluate(() => configuredSettings.backgroundDownloads), true);
  assert.equal(await page.evaluate(() => configuredSettings.diagnosticEnabled), false);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).library.length), 1);
  report.restoredSettingsAppliedImmediately = true;
  await page.locator('#toast').waitFor({ state: 'hidden' });
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    for (const mode of ['light', 'dark']) {
      await page.getByRole('tab', { name: 'Visual', exact: true }).click(); await page.getByRole('combobox', { name: 'Modo de cor', exact: true }).selectOption(mode);
      for (const tab of ['Áudio', 'Desempenho', 'Sistema']) {
        await page.getByRole('tab', { name: tab, exact: true }).click(); await page.screenshot({ path: `.qa/screenshots/studio-${mode}-${tab}-${viewport.width}.png`, fullPage: true });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const overlaps = await page.locator('.setting').evaluateAll(rows => rows.some(row => { const label = row.querySelector('div'), control = row.querySelector('select,input'); return label && control && label.getBoundingClientRect().right > control.getBoundingClientRect().left - 2; })); assert.equal(overlaps, false);
      }
    }
  }
  assert.deepEqual(errors, []); report.responsive = true; await writeFile('.qa/studio-ui-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally { await browser.close(); }
