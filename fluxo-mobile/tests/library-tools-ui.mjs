import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
const report = {}, errors = [];
await mkdir('.qa/screenshots', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message)); page.setDefaultTimeout(12000);
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5174');
  const wav = Buffer.alloc(44 + 8000 * 90 * 2);
  wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
  const picker = page.waitForEvent('filechooser'); await page.locator('.topbar [data-action=import]').click();
  await (await picker).setFiles(['Zeta', 'Alfa', 'Beta'].map(name => ({ name: `${name}.wav`, mimeType: 'audio/wav', buffer: wav })));
  await page.waitForFunction(() => document.querySelectorAll('#filtered-list .track').length === 3);
  await page.evaluate(async () => {
    const { commands } = await import('./platform.js'); const tracks = await commands.downloads(); tracks.sort((a, b) => ['Zeta', 'Alfa', 'Beta'].indexOf(a.title) - ['Zeta', 'Alfa', 'Beta'].indexOf(b.title));
    localStorage.fluxo_mobile_v2 = JSON.stringify({ library: tracks, favorites: [tracks[0]], history: [tracks[0]], playlists: [{ id: 'tools', title: 'Dias de música', tracks, offlineOnly: true, description: 'Uma seleção pessoal para ouvir onde estiver.' }], settings: { autoDownload: false } });
  });
  await page.reload(); await page.locator('.playlist-card').first().click();
  await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click(); await page.getByRole('button', { name: 'Editar playlist', exact: true }).click();
  await page.getByRole('textbox', { name: 'Descrição da playlist', exact: true }).fill('Favoritas para viagens, trabalho e momentos tranquilos.');
  await page.getByRole('checkbox', { name: 'Download automático desta playlist', exact: true }).check();
  await page.getByRole('button', { name: 'Salvar playlist', exact: true }).click();
  assert.match(await page.locator('.playlist-sync-label').textContent(), /ativo/); assert.match(await page.locator('.playlist-description').textContent(), /viagens/); report.playlistDetails = true;
  await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click(); await page.getByRole('button', { name: 'Organizar músicas', exact: true }).click(); await page.getByRole('button', { name: 'Nome', exact: true }).click();
  assert.deepEqual(await page.locator('#filtered-list .track-copy strong').allTextContents(), ['Alfa', 'Beta', 'Zeta']);
  await page.getByRole('button', { name: 'Desfazer', exact: true }).click(); assert.deepEqual(await page.locator('#filtered-list .track-copy strong').allTextContents(), ['Zeta', 'Alfa', 'Beta']); report.permanentSortAndUndo = true;
  await page.locator('#filtered-list [data-action=track-menu]').nth(1).click(); await page.locator('.menu-section summary').filter({ hasText: 'Reprodução' }).click();
  await page.getByRole('button', { name: 'Reproduzir a partir daqui', exact: true }).click(); await page.locator('#mini [aria-label=Pausar]').waitFor();
  assert.equal(await page.evaluate(async () => { const { commands } = await import('./platform.js'); let state; await commands.init(value => state = value); return state.queue.length; }), 2);
  // Restore the app listener after inspecting the browser player state.
  await page.reload(); await page.locator('.playlist-card').first().click();
  await page.locator('#filtered-list [data-action=track-menu]').first().click(); await page.locator('.menu-section summary').filter({ hasText: 'Biblioteca' }).click();
  await page.getByRole('button', { name: 'Editar nome e artista', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nome da música', exact: true }).fill('Zeta revisada'); await page.getByRole('textbox', { name: 'Artista da música', exact: true }).fill('Minha banda'); await page.getByRole('button', { name: 'Salvar alterações', exact: true }).click();
  await page.getByRole('button', { name: 'Tocar Zeta revisada', exact: true }).waitFor();
  const metadata = await page.evaluate(async () => { const { commands } = await import('./platform.js'); return { model: JSON.parse(localStorage.fluxo_mobile_v2), downloads: await commands.downloads() }; });
  const editedId = metadata.model.library[0].id;
  for (const key of ['library', 'favorites', 'history']) assert.equal(metadata.model[key].find(t => t.id === editedId).title, 'Zeta revisada'); assert.equal(metadata.downloads.find(t => t.id === editedId).title, 'Zeta revisada'); report.editAllCopies = true;
  const exported = page.waitForEvent('download'); await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click(); await page.getByRole('button', { name: 'Exportar playlist', exact: true }).click();
  const file = await exported; assert.match(file.suggestedFilename(), /^fluxo-playlist-.*\.json$/);
  const read = await file.createReadStream(); const chunks = []; for await (const chunk of read) chunks.push(chunk); const content = Buffer.concat(chunks);
  assert.equal(JSON.parse(content).format, 'fluxo-playlist'); report.exportPlaylist = true;
  await page.locator('.navigation [data-tab=settings]').click(); await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click();
  const imported = page.waitForEvent('filechooser'); await page.getByRole('button', { name: 'Importar playlist', exact: true }).click(); await (await imported).setFiles({ name: 'playlist.json', mimeType: 'application/json', buffer: content });
  await page.waitForFunction(() => JSON.parse(localStorage.fluxo_mobile_v2).playlists.length === 2);
  const state = await page.evaluate(() => JSON.parse(localStorage.fluxo_mobile_v2)); assert.notEqual(state.playlists[0].id, state.playlists[1].id); assert.equal(state.settings.autoDownload, false); assert.equal(state.playlists[1].tracks[0].title, 'Zeta revisada'); report.importWithoutReplacing = true;
  for (const viewport of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 820, height: 1180 }]) {
    await page.setViewportSize(viewport); await page.screenshot({ path: `.qa/screenshots/library-tools-playlist-${viewport.width}.png`, fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Opções da playlist', exact: true }).click(); await page.getByRole('button', { name: 'Editar playlist', exact: true }).click();
    await page.screenshot({ path: `.qa/screenshots/library-tools-editor-${viewport.width}.png` });
    assert.equal(await page.locator('#sheet').evaluate(el => el.scrollWidth > el.clientWidth), false); await page.getByRole('button', { name: 'Fechar', exact: true }).click();
  }
  await page.locator('.navigation [data-tab=settings]').click(); await page.getByRole('tab', { name: 'Biblioteca', exact: true }).click(); await page.getByRole('button', { name: /Central de downloads/ }).click();
  await page.waitForFunction(() => document.querySelector('#storage-free')?.textContent.includes('disponíveis')); report.storage = true;
  assert.equal(await page.getByRole('combobox', { name: 'Ordenar músicas', exact: true }).locator('option[value=size]').count(), 1);
  assert.deepEqual(errors, []); report.responsive = true; await writeFile('.qa/library-tools-ui-report.json', JSON.stringify(report, null, 2)); console.log(report);
} finally { await browser.close(); }
