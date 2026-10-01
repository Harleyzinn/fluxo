import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
await mkdir('.qa/screenshots', { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5174');
  await page.getByRole('heading', { name: 'Sua biblioteca' }).waitFor();
  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.topbar [data-action=import]').click();
  const wav = Buffer.alloc(44 + 8000 * 60 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(Math.round(500 * Math.sin(i * .16)), i);
  await (await chooserPromise).setFiles([{ name: 'Minha faixa.wav', mimeType: 'audio/wav', buffer: wav }]);
  await page.getByRole('button', { name: 'Tocar Minha faixa', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByRole('button', { name: /Personalizar aparência/ }).click();
  await page.getByRole('combobox', { name: 'Espaçamento', exact: true }).selectOption('compact');
  await page.getByRole('combobox', { name: 'Tamanho do texto', exact: true }).selectOption('large');
  await page.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption('mono');
  await page.getByRole('combobox', { name: 'Formato das capas', exact: true }).selectOption('round');
  await page.getByRole('combobox', { name: 'Cantos', exact: true }).selectOption('4');
  await page.getByRole('checkbox', { name: 'Reduzir animações' }).check();
  for (const [label, value] of [['Cor de destaque', '#54c7e8'], ['Cor secundária', '#ff7c7c'], ['Cor de fundo', '#f4f6f5']]) {
    await page.getByRole('checkbox', { name: `Personalizar ${label.toLowerCase()}` }).check();
    await page.locator(`input[aria-label="${label}"]`).evaluate((el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
  }
  assert.equal(await page.evaluate(() => document.documentElement.style.colorScheme), 'light');
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--cyan')), '#54c7e8');
  await page.screenshot({ path: '.qa/screenshots/appearance-light.png', fullPage: true });
  await page.getByRole('button', { name: /Temas do Fluxo/ }).click();
  await page.getByRole('button', { name: 'Favoritar tema Fluxo Bug', exact: true }).click();
  await page.getByRole('button', { name: 'Favoritos', exact: true }).click();
  assert.equal(await page.locator('.theme-option:visible').count(), 1);
  await page.getByRole('searchbox', { name: 'Encontrar tema' }).fill('No match');
  await page.getByRole('heading', { name: 'Nenhum tema encontrado' }).waitFor();
  await page.getByRole('searchbox', { name: 'Encontrar tema' }).fill('');
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('tab', { name: 'Estilos salvos', exact: true }).click();
  await page.getByRole('button', { name: 'Salvar estilo atual', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Nome do estilo' }).fill('Meu visual claro');
  await page.getByRole('button', { name: 'Salvar estilo', exact: true }).click();
  await page.getByRole('tab', { name: 'Visual', exact: true }).click();
  await page.getByRole('combobox', { name: 'Fonte', exact: true }).selectOption('serif');
  await page.getByRole('tab', { name: 'Estilos salvos', exact: true }).click();
  await page.locator('[data-action=apply-profile]').click();
  assert.equal(await page.evaluate(() => document.body.dataset.font), 'mono');
  await page.getByRole('button', { name: 'Restaurar aparência', exact: true }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
  const settings = await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).settings);
  assert.equal(settings.profiles.length, 1); assert.equal(settings.themeFavorites.length, 1); assert.equal(settings.font, 'system');
  await page.getByRole('button', { name: 'Voltar aos ajustes', exact: true }).click();
  await page.locator('.navigation [data-tab=library]').click();
  await page.getByRole('tab', { name: 'Coleções', exact: true }).click();
  await page.getByRole('button', { name: 'Criar playlist', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Nome da playlist' }).fill('Minha seleção');
  await page.getByRole('combobox', { name: 'Estilo da capa' }).selectOption('symbol');
  await page.getByRole('radio', { name: 'Ícone headphones', exact: true }).check();
  await page.getByRole('radio', { name: 'Cor #54c7e8', exact: true }).check();
  assert.ok(await page.locator('#playlist-cover-preview [data-lucide=headphones]').count());
  await page.getByRole('button', { name: 'Salvar playlist' }).click();
  await page.getByRole('button', { name: 'Voltar à biblioteca' }).click();
  await page.getByRole('button', { name: 'Playlists em lista', exact: true }).click();
  assert.equal(await page.locator('.playlist-grid').evaluate(el => getComputedStyle(el).display), 'flex');
  await page.getByRole('button', { name: 'Playlists em grade', exact: true }).click();
  await page.screenshot({ path: '.qa/screenshots/library-custom-playlist.png', fullPage: true });
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1280, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.locator('.navigation [data-tab=settings]').click();
    await page.getByRole('button', { name: /Personalizar aparência/ }).click();
    await page.getByRole('combobox', { name: 'Tamanho do texto', exact: true }).selectOption('large');
    for (const lookTab of ['Visual', 'Player', 'Estilos salvos']) {
      await page.getByRole('tab', { name: lookTab, exact: true }).click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `Appearance overflow: ${viewport.width} ${lookTab}`);
      await page.screenshot({ path: `.qa/screenshots/appearance-${lookTab}-${viewport.width}.png`, fullPage: true });
    }
    await page.getByRole('tab', { name: 'Player', exact: true }).click();
    for (const layout of ['cover', 'compact']) for (const visualizer of ['bars', 'wave', 'off']) {
      await page.getByRole('combobox', { name: 'Layout do player', exact: true }).selectOption(layout);
      await page.getByRole('combobox', { name: 'Visualizador', exact: true }).selectOption(visualizer);
      await page.getByRole('button', { name: 'Abrir player', exact: true }).first().click();
      await page.waitForTimeout(250);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.ok(await page.locator('#player .player-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1), `Player controls: ${viewport.width} ${layout} ${visualizer}`);
      assert.equal(await page.locator('#audio-visual').isVisible(), visualizer !== 'off');
      await page.screenshot({ path: `.qa/screenshots/player-${layout}-${visualizer}-${viewport.width}.png` });
      await page.getByRole('button', { name: 'Minimizar player' }).click();
    }
    await page.getByRole('button', { name: 'Voltar aos ajustes', exact: true }).click();
  }
  await page.reload();
  const persisted = await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2));
  assert.equal(persisted.settings.playerLayout, 'compact'); assert.equal(persisted.settings.visualizer, 'off');
  assert.equal(persisted.playlists[0].coverIcon, 'headphones');
  assert.equal(persisted.playlists[0].coverColor, '#54c7e8');
  assert.deepEqual(errors, []);
  console.log('Appearance passed: colors, text, fonts, density, theme favorites, saved styles, reset, playlist covers, persistence, 24 responsive player combinations.');
} finally { await browser.close(); }
