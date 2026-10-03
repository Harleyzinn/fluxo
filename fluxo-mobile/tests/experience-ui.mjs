import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    if (!localStorage.fluxo_mobile_v2) localStorage.fluxo_mobile_v2 = JSON.stringify({
      library: Array.from({ length: 250 }, (_, i) => ({ id: `song-${i}`, title: `Faixa ${String(i).padStart(3, '0')}`, artist: 'Artista', url: `https://example.com/${i}.mp3`, duration: 120 })),
      favorites: [], history: [], playlists: [], settings: { autoDownload: false, offline: true }
    });
  });
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5174');
  await page.getByRole('tab', { name: 'Salvas', exact: true }).click();
  assert.equal(await page.locator('#view .track').count(), 80);
  await page.getByRole('button', { name: 'Carregar mais músicas', exact: true }).click();
  assert.equal(await page.locator('#view .track').count(), 160);
  await page.getByRole('searchbox', { name: 'Filtrar músicas', exact: true }).fill('Faixa 249');
  assert.equal(await page.locator('#view .track').count(), 1);
  await page.getByRole('tab', { name: 'Coleções', exact: true }).click();
  await page.getByRole('button', { name: 'Criar playlist', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Nome da playlist' }).fill('Seleção de teste');
  await page.getByRole('checkbox', { name: 'Somente músicas baixadas', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Salvar playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Adicionar músicas', exact: true }).first().click();
  await page.getByRole('searchbox', { name: 'Buscar músicas para adicionar' }).fill('Faixa 249');
  await page.getByRole('checkbox', { name: 'Selecionar visíveis', exact: true }).check();
  assert.equal(await page.locator('#playlist-selection-count').textContent(), '1 selecionadas');
  await page.getByRole('searchbox', { name: 'Buscar músicas para adicionar' }).fill('Faixa 00');
  await page.getByRole('checkbox', { name: 'Selecionar visíveis', exact: true }).check();
  assert.equal(await page.locator('#playlist-selection-count').textContent(), '11 selecionadas');
  await page.getByRole('button', { name: 'Adicionar selecionadas' }).click();
  assert.equal(await page.locator('#view .track').count(), 11);
  await page.getByRole('searchbox', { name: 'Filtrar músicas', exact: true }).fill('Faixa 249');
  await page.getByRole('button', { name: 'Opções de Faixa 249', exact: true }).click();
  await page.getByRole('button', { name: 'Mover para cima', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).playlists[0].tracks[9].id), 'song-249');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).playlists[0].tracks[0].id), 'song-0');
  await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click();
  await page.getByRole('button', { name: 'Duplicar playlist', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).playlists.length), 2);

  const chooserPromise = page.waitForEvent('filechooser');
  await page.locator('.topbar [data-action=import]').click();
  const chooser = await chooserPromise;
  const wav = Buffer.alloc(44 + 8000 * 45 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  await chooser.setFiles(['Alfa', 'Beta'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wav })));
  await page.getByRole('button', { name: 'Tocar Alfa', exact: true }).waitFor();
  await page.getByRole('button', { name: /^Prontas/ }).click();
  assert.equal(await page.locator('#view .track').count(), 2);
  await page.getByRole('button', { name: /^Falhas/ }).click();
  assert.equal(await page.locator('#view .track').count(), 0);
  await page.getByRole('button', { name: /^Prontas/ }).click();
  await page.getByRole('button', { name: 'Tocar Alfa', exact: true }).click();
  await page.getByRole('button', { name: 'Pausar', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Abrir player', exact: true }).click();
  await page.locator('#seek').evaluate(input => { input.value = '7'; input.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Infinite Radio', exact: true }).click();
  await page.getByRole('button', { name: 'Rádio das músicas baixadas', exact: true }).click();
  assert.ok(Number(await page.locator('#seek').inputValue()) >= 7);
  await page.getByRole('button', { name: 'Minimizar player' }).click();
  await page.locator('.navigation [data-tab=queue]').click();
  await page.getByRole('heading', { name: 'Na sequência', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Salvar fila como playlist', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da playlist' }).fill('Meu rádio salvo');
  await page.getByRole('button', { name: 'Salvar playlist', exact: true }).click();
  await page.getByRole('heading', { name: 'Meu rádio salvo', exact: true }).waitFor();
  assert.equal(await page.locator('#view .track').count(), 2);
  assert.equal(await page.locator('.playlist-offline progress').getAttribute('value'), '2');
  await page.getByRole('button', { name: 'Opções de Beta', exact: true }).click();
  await page.getByRole('button', { name: 'Não recomendar no rádio', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).radioExcluded.length), 1);
  await page.locator('.navigation [data-tab=settings]').click();
  await page.getByRole('button', { name: /Preferências do rádio/ }).click();
  await page.getByRole('button', { name: 'Voltar a recomendar Beta', exact: true }).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2).radioExcluded.length), 0);
  await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
  await page.getByRole('button', { name: /Central de downloads/ }).click();
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    for (const element of await page.locator('.download-filters button').all()) assert.ok(await element.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: `.qa/screenshots/downloads-2.3-${viewport.width}.png`, fullPage: true });
  }
  assert.deepEqual(errors, []);
  console.log('Experience passed: 250-track library, progressive loading, filtered selection, filtered reordering, duplicate playlist, queue snapshot, radio continuity/exclusions, offline status and responsive download manager.');
} finally { await browser.close(); }
