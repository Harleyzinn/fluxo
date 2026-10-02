import { themes } from './themes.js';
import { loadModel, unique, cleanTrack, libraryTracks, filterTracks, duration, size, publicBackup, validateBackup } from './model.js';
import { commands, native, artURL } from './platform.js';
import { startVisualizer, stopVisualizer } from './visualizer.js';
import { appearanceDefaults, normalizeSettings, normalizeAppearance, playlistAppearance, playlistIcons, playlistColors, surfacePalette, contrastText } from './appearance.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const ib = (name, action, label, attrs = '', cls = '') => `<button class="icon-button ${cls}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
const button = (name, action, label, attrs = '', cls = '') => `<button class="text-button ${cls}" data-action="${action}" ${attrs}>${icon(name)}${esc(label)}</button>`;
const model = loadModel(localStorage);
model.settings = normalizeSettings(model.settings);
model.searches ||= [];
model.library = unique(model.library || []);
let syncChain = Promise.resolve();
let downloads = [];
let current = { queue: [], index: 0, duration: 0, position: 0, playing: false, buffering: false, repeat: 0, shuffle: false, speed: 1 };
let tab = 'library';
let libraryTab = 'home';
let playlistId = '';
let query = '';
let sort = 'recent';
let results = [];
let searchTerm = '';
let provider = 'youtube';
let searching = false;
let searchError = '';
let searchToken = 0;
let visibleTracks = [];
let menuTrack;
let menuIndex = -1;
let menuContext = '';
let playerKey = '';
let historyId = '';
let toastTimer;
let permissionAsked = localStorage.getItem('fluxo_v2_permissions') === 'yes';
let appearanceOpen = false;
let appearanceTab = 'visual';
let themeFavoritesOnly = false;
let themeQuery = '';
const offline = () => model.settings.offline || !navigator.onLine;
const ready = () => downloads.filter(t => t.status === 'ready');
const downloaded = track => ready().find(t => t.id === track?.id || (t.url && t.url === track?.url));
const available = track => ({ ...track, ...(downloaded(track) || {}) });
const find = id => unique([...results, ...current.queue, ...downloads, ...libraryTracks(model), ...model.history]).find(t => t.id === id);
const favorite = track => model.favorites.some(t => t.id === track?.id);
function save() { localStorage.setItem('fluxo_mobile_v2', JSON.stringify(model)); }
async function syncLibrary(retry = false, force = false) {
  const tracks = libraryTracks(model);
  const enabled = force || model.settings.autoDownload;
  const wifiOnly = model.settings.wifiOnly;
  syncChain = syncChain.catch(() => {}).then(() => commands.syncLibrary(tracks, enabled, wifiOnly, retry));
  await syncChain; await refreshDownloads();
}
const savedTrack = track => libraryTracks(model).some(t => t.id === track?.id);
function icons() { window.lucide?.createIcons(); }
function toast(message) { clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 4200); }
function theme() {
  const id = themes.some(t => t.id === model.settings.theme) ? model.settings.theme : 'fluxobug';
  document.body.className = `theme-${id}${current.queue.length ? ' has-player' : ''}`;
  document.body.style.setProperty('--cyan', model.settings.customAccent ? model.settings.accent : '');
  document.body.style.setProperty('--pink', model.settings.customSecondary ? model.settings.secondary : '');
  for (const key of ['--bg', '--panel', '--panel-2', '--text', '--muted']) document.body.style.removeProperty(key);
  if (model.settings.customBackground) for (const [key, value] of Object.entries(surfacePalette(model.settings.background))) document.body.style.setProperty(key, value);
  document.body.style.setProperty('--accent-ink', contrastText(getComputedStyle(document.body).getPropertyValue('--cyan').trim()));
  document.body.style.setProperty('--radius', `${model.settings.radius}px`);
  for (const key of ['density', 'textSize', 'font', 'artworkShape', 'playlistView', 'playerLayout', 'visualizer', 'reducedMotion']) document.body.dataset[key] = String(model.settings[key]);
  const rgb = getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g)?.map(Number) || [0, 0, 0];
  document.documentElement.style.colorScheme = (rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722) > 140 ? 'light' : 'dark';
  document.querySelector('meta[name=theme-color]').content = getComputedStyle(document.body).getPropertyValue('--bg').trim();
}
function connection() { $('#connection').innerHTML = offline() ? `${icon('wifi-off')}Offline` : native ? '' : 'Prévia'; icons(); }
function heading(title, subtitle = '', action = '') { return `<div class="page-heading"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action}</div>`; }
function empty(name, title, text = '', action = '', compact = false) { return `<div class="empty ${compact ? 'compact' : ''}">${icon(name)}<h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}${action}</div>`; }
function art(track, cls = 'track-cover') {
  const thumbnail = downloaded(track)?.thumbnail || track?.thumbnail;
  if (thumbnail) return `<img class="${cls}" src="${esc(artURL(thumbnail))}" alt="" loading="lazy">`;
  const color = [...String(track?.id || '')].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
  return `<span class="${cls} artwork-placeholder art-${color}" aria-hidden="true"><span class="record-ring"></span>${icon('music-2')}<span class="art-mark">FLUXO</span></span>`;
}
function playlistArt(playlist) {
  const look = playlistAppearance(playlist);
  const covers = playlist.tracks.slice(0, 4);
  if (!covers.length || look.coverStyle === 'symbol') return `<div class="playlist-art playlist-symbol" ${look.coverColor !== 'auto' ? `style="--cover-color:${look.coverColor}"` : ''}>${icon(look.coverIcon === 'list-music' && playlist.offlineOnly ? 'hard-drive-download' : look.coverIcon)}<span>${esc(playlist.title?.slice(0, 1) || 'F')}</span></div>`;
  return `<div class="playlist-art playlist-mosaic ${covers.length === 1 ? 'single' : ''}">${covers.map(t => art(t, 'mosaic-image')).join('')}</div>`;
}
function trackCopy(track) { const record = downloads.find(t => t.id === track.id); return `<span class="track-copy"><strong>${esc(track.title)}</strong><small>${downloaded(track) ? icon('circle-check') : ''}${esc(record?.statusDetail || track.artist)}</small></span>`; }
function list(tracks, context = 'list') {
  visibleTracks = tracks;
  return `<div class="track-list">${tracks.map((track, i) => {
    const dl = downloads.find(t => t.id === track.id);
    return `<div class="track ${current.queue[current.index]?.id === track.id ? 'playing' : ''}" data-row="${esc(track.id)}">
      ${context === 'queue' ? `<span class="queue-number">${i === current.index ? icon('audio-lines') : i + 1}</span>` : ''}
      <button class="track-main" data-action="${context === 'queue' ? 'jump' : 'track-play'}" data-index="${i}" data-track="${esc(track.id)}" aria-label="Tocar ${esc(track.title)}">${art(track)}${trackCopy(track)}</button>
      ${dl?.status === 'downloading' ? `<progress class="download-progress" value="${dl.progress || 0}" max="100" aria-label="Download"></progress>` : `<span class="track-time">${dl?.status === 'failed' ? 'Falhou' : track.duration ? duration(track.duration) : ''}</span>`}
      ${ib('ellipsis-vertical', 'track-menu', `Opções de ${track.title}`, `data-track="${esc(track.id)}" data-index="${i}" data-context="${context}"`)}
    </div>`;
  }).join('')}</div>`;
}
function filterBar() { return `<div class="row-tools"><label class="field">${icon('list-filter')}<input id="library-filter" type="search" value="${esc(query)}" placeholder="Filtrar músicas" aria-label="Filtrar músicas"></label><select id="sort" aria-label="Ordenar músicas"><option value="recent">Recentes</option><option value="title" ${sort === 'title' ? 'selected' : ''}>Título</option><option value="artist" ${sort === 'artist' ? 'selected' : ''}>Artista</option></select></div>`; }
function library() {
  if (playlistId) return playlistPage();
  const tabs = [['home', 'Coleções'], ['saved', 'Salvas'], ['downloads', 'Baixadas'], ['favorites', 'Favoritas']];
  let html = heading('Sua biblioteca', `${ready().length} músicas no dispositivo`, ib('plus', 'new-playlist', 'Criar playlist'));
  html += `<div class="segmented" role="tablist" aria-label="Biblioteca">${tabs.map(([id, label]) => `<button role="tab" aria-selected="${libraryTab === id}" class="${libraryTab === id ? 'active' : ''}" data-action="library-tab" data-value="${id}">${label}</button>`).join('')}</div>`;
  if (libraryTab === 'home') {
    html += radioStrip();
    html += `<div class="stats"><button class="collection" data-action="library-tab" data-value="downloads"><strong>${ready().length}</strong>${icon('download')}<small>Músicas baixadas</small></button><button class="collection" data-action="library-tab" data-value="favorites"><strong>${model.favorites.length}</strong>${icon('heart')}<small>Suas favoritas</small></button></div>`;
    html += `<div class="section-heading"><h2>Playlists</h2><div class="section-tools"><div class="view-switch" role="group" aria-label="Visualização das playlists">${ib('layout-grid', 'playlist-view', 'Playlists em grade', 'data-value="grid"', model.settings.playlistView === 'grid' ? 'active' : '')}${ib('list', 'playlist-view', 'Playlists em lista', 'data-value="list"', model.settings.playlistView === 'list' ? 'active' : '')}</div>${ib('plus', 'new-playlist', 'Nova playlist')}</div></div>`;
    html += model.playlists.length ? `<div class="playlist-grid">${model.playlists.map(p => `<button class="playlist-card" data-action="open-playlist" data-id="${esc(p.id)}">${playlistArt(p)}<div><strong>${esc(p.title)}</strong><small>${p.tracks.length} músicas${p.offlineOnly ? ' · Offline' : ''}</small></div></button>`).join('')}</div>` : empty('list-music', 'Sua primeira playlist', '', button('plus', 'new-playlist', 'Criar playlist'), true);
    html += `<div class="section-heading"><h2>Ouvidas recentemente</h2>${model.history.length ? ib('trash-2', 'clear-history', 'Limpar histórico') : ''}</div>`;
    html += model.history.length ? list(model.history.slice(0, 8)) : empty('disc-3', 'Dê o primeiro play', '', button('folder-plus', 'import', 'Importar músicas'), true);
  } else {
    const tracks = libraryTab === 'downloads' ? [...downloads].reverse() : libraryTab === 'saved' ? libraryTracks(model) : model.favorites;
    html += filterBar();
    html += `<div id="filtered-list">${tracks.length ? list(filterTracks(tracks, query, sort)) : empty(libraryTab === 'downloads' ? 'download' : libraryTab === 'saved' ? 'library' : 'heart', libraryTab === 'downloads' ? 'Nenhuma música baixada' : libraryTab === 'saved' ? 'Nenhuma música salva' : 'Nenhuma favorita ainda', '', libraryTab === 'downloads' ? button('folder-plus', 'import', 'Importar músicas') : button('search', 'go-search', 'Buscar músicas'))}</div>`;
  }
  return html;
}
function playlistPage() {
  const p = model.playlists.find(p => p.id === playlistId);
  if (!p) { playlistId = ''; return library(); }
  let html = `<div class="section-heading">${ib('arrow-left', 'back-library', 'Voltar à biblioteca')}<span class="muted">PLAYLIST${p.offlineOnly ? ' OFFLINE' : ''}</span>${ib('ellipsis', 'playlist-menu', 'Opções da playlist')}</div>`;
  html += `<div class="playlist-heading">${playlistArt(p)}<div><h1>${esc(p.title)}</h1><p>${p.tracks.length} músicas · ${p.tracks.filter(downloaded).length} offline</p></div></div>`;
  html += `<div class="playlist-toolbar">${button('play', 'playlist-play', 'Reproduzir', p.tracks.length ? '' : 'disabled', 'primary')}${ib('shuffle', 'playlist-shuffle', 'Embaralhar playlist')}${ib('plus', 'playlist-add', 'Adicionar músicas')}</div>`;
  html += p.tracks.length ? list(p.tracks, 'playlist') : empty('list-music', 'Playlist vazia', '', button('plus', 'playlist-add', 'Adicionar músicas'));
  return html;
}
function searchPage() {
  let html = heading('Buscar', '', ib('link', 'add-link', 'Abrir link de áudio'));
  html += `<form id="search-form" class="search-form"><label class="field">${icon('search')}<input id="search-input" type="search" enterkeyhint="search" placeholder="Música, artista ou álbum" value="${esc(searchTerm)}" aria-label="Buscar músicas" required></label><button class="icon-button primary" type="submit" aria-label="Pesquisar">${icon('arrow-right')}</button></form>`;
  html += `<div class="search-sources"><small>YouTube</small>${searchTerm ? `<small>${results.length ? `${results.length} resultados` : ''}</small>` : ''}</div>`;
  if (offline()) return html + empty('wifi-off', 'Você está offline', '', button('library', 'go-downloads', 'Abrir músicas baixadas'));
  if (searching) return html + `<div class="loading">${icon('loader-circle', 'spin')}Buscando músicas...</div>`;
  if (searchError) return html + `<div class="error-state"><p>${esc(searchError)}</p>${ib('rotate-cw', 'retry-search', 'Tentar busca novamente')}</div>`;
  if (searchTerm) return html + (results.length ? list(results, 'search') : empty('search', 'Nenhum resultado', 'Tente outro nome.'));
  if (model.searches.length) html += `<div class="section-heading"><h2>Buscas recentes</h2>${ib('trash-2', 'clear-searches', 'Limpar buscas')}</div>${model.searches.map((q, i) => `<div class="recent-search"><button data-action="recent-search" data-index="${i}">${icon('history')}${esc(q)}</button>${ib('arrow-up-left', 'recent-search', `Buscar ${q}`, `data-index="${i}"`)}</div>`).join('')}`;
  html += `<div class="section-heading"><h2>Explorar</h2></div><div class="radio-grid">${['Lo-fi', 'Rock', 'Eletrônica', 'Jazz', 'MPB', 'Synthwave'].map(q => `<button class="radio-item" data-action="genre" data-value="${esc(q)}">${icon('radio')}${esc(q)}</button>`).join('')}</div>`;
  return html;
}
function queuePage() {
  return heading('Na sequência', `${current.queue.length} músicas${current.queue.length ? ` · ${duration(current.queue.reduce((n, t) => n + t.duration, 0))}` : ''}`, current.queue.length ? ib('trash-2', 'clear-queue', 'Limpar fila') : '')
    + radioStrip()
    + (current.error ? `<div class="error-state"><p>${esc(current.error)}</p>${ib('rotate-cw', 'retry-play', 'Tentar reprodução novamente')}</div>` : '')
    + (current.queue.length ? list(current.queue, 'queue') : empty('list-music', 'A fila está vazia', '', button('library', 'go-library', 'Abrir biblioteca')));
}
function radioStrip() {
  if (!current.radio) return '';
  return `<div class="radio-strip">${icon('radio')}<div><strong>Infinite Radio${current.radioOffline ? ' offline' : ''}</strong><small>${esc(current.radioError || (current.radioLoading ? 'Preparando próximas músicas' : current.radioSeed?.title || 'Ativo'))}</small></div>${current.radioError ? ib('rotate-cw', 'radio-retry', 'Renovar rádio') : ''}${ib('square', 'radio-stop', 'Encerrar rádio')}</div>`;
}
async function startRadio(track, local = offline()) {
  track = track || current.queue[current.index] || ready()[0];
  if (!track) throw new Error('Escolha uma música para iniciar o rádio.');
  if (local && ready().length < 2) throw new Error('Baixe pelo menos duas músicas para o rádio offline.');
  if (local && !downloaded(track)) track = ready()[0];
  await permissions(); closeSheet();
  await commands.radio(available(track), local, ready());
  toast(local ? 'Rádio offline iniciado.' : 'Infinite Radio iniciado.');
}
const setting = (name, title, description, control) => `<div class="setting">${icon(name)}<div><strong>${esc(title)}</strong>${description ? `<small>${esc(description)}</small>` : ''}</div>${control}</div>`;
const toggle = (id, label) => `<input class="toggle" type="checkbox" data-setting="${id}" aria-label="${esc(label)}" ${model.settings[id] ? 'checked' : ''}>`;
const actionSetting = (name, title, desc, action) => `<button class="setting action-row" data-action="${action}">${icon(name)}<div><strong>${esc(title)}</strong>${desc ? `<small>${esc(desc)}</small>` : ''}</div>${icon('chevron-right', 'chevron')}</button>`;
function settingsPage() {
  if (appearanceOpen) return appearancePage();
  return heading('Ajustes')
    + `<section class="settings-group"><h2>Reprodução</h2>${setting('wifi-off', 'Modo offline', '', toggle('offline', 'Modo offline'))}${actionSetting('moon', 'Temporizador', current.sleepAt ? `${Math.max(1, Math.ceil((current.sleepAt - Date.now()) / 60000))} min restantes` : 'Desativado', 'sleep')}${actionSetting('gauge', 'Velocidade', `${current.speed || 1}×`, 'speed')}</section>`
    + (native ? actionSetting('audio-lines', 'Equalizador', ['Normal', 'Graves', 'Voz', 'Agudos'][current.eqPreset || 0], 'equalizer') : '')
    + `<section class="settings-group"><h2>Aparência</h2>${actionSetting('palette', 'Temas do Fluxo', `${themes.length} temas · ${themes.find(t => t.id === model.settings.theme)?.name || 'Fluxo Bug'}`, 'themes')}${actionSetting('paintbrush', 'Personalizar aparência', `${model.settings.density === 'compact' ? 'Compacto' : 'Confortável'} · ${model.settings.profiles.length} estilos salvos`, 'appearance')}</section>`
    + `<section class="settings-group"><h2>Biblioteca e downloads</h2>${setting('cloud-download', 'Download automático', '', toggle('autoDownload', 'Download automático'))}${setting('wifi', 'Baixar só no Wi-Fi', '', toggle('wifiOnly', 'Baixar só no Wi-Fi'))}${actionSetting('download', 'Central de downloads', `${downloads.filter(t => t.status === 'queued' || t.status === 'downloading').length} pendentes · ${downloads.filter(t => t.status === 'failed').length} falhas`, 'downloads-center')}${actionSetting('hard-drive', 'Músicas no dispositivo', `${ready().length} arquivos · ${size(downloads.reduce((n, d) => n + (d.bytes || 0), 0))}`, 'go-downloads')}${actionSetting('folder-plus', 'Importar arquivos', '', 'import')}</section>`
    + `<section class="settings-group"><h2>Dados e permissões</h2>${actionSetting('file-down', 'Exportar backup', 'Playlists, favoritos e preferências', 'export')}${actionSetting('file-up', 'Restaurar backup', '', 'restore')}${native ? actionSetting('shield-check', 'Tela apagada e notificações', '', 'background-settings') : ''}${actionSetting('info', 'Sobre o Fluxo Mobile', 'Versão 2.2.0', 'about')}</section>`;
}
function selectSetting(key, label, options) {
  return `<select data-preference="${key}" aria-label="${esc(label)}">${options.map(([value, text]) => `<option value="${value}" ${model.settings[key] === value ? 'selected' : ''}>${esc(text)}</option>`).join('')}</select>`;
}
function appearancePage() {
  const t = current.queue[current.index] || model.history[0] || { id: 'preview', title: 'Fluxo Mobile', artist: themes.find(t => t.id === model.settings.theme)?.name || 'Fluxo Bug' };
  let html = `<div class="appearance-heading">${ib('arrow-left', 'back-settings', 'Voltar aos ajustes')}<h1>Aparência</h1>${ib('rotate-ccw', 'reset-appearance', 'Restaurar aparência')}</div>`;
  html += `<div class="appearance-preview" aria-label="Prévia da aparência">${art(t)}<div><strong>${esc(t.title)}</strong><small>${esc(t.artist)}</small></div><span class="preview-accent">${icon('audio-lines')}</span></div>`;
  html += `<div class="segmented" role="tablist" aria-label="Personalização">${[['visual', 'Visual'], ['player', 'Player'], ['profiles', 'Estilos salvos']].map(([id, label]) => `<button role="tab" aria-selected="${appearanceTab === id}" data-action="appearance-tab" data-value="${id}" class="${appearanceTab === id ? 'active' : ''}">${label}</button>`).join('')}</div>`;
  if (appearanceTab === 'visual') {
    html += `<section class="settings-group"><h2>Cores</h2>${actionSetting('palette', 'Temas do Fluxo', themes.find(t => t.id === model.settings.theme)?.name || 'Fluxo Bug', 'themes')}`;
    for (const [flag, key, label] of [['customAccent', 'accent', 'Cor de destaque'], ['customSecondary', 'secondary', 'Cor secundária'], ['customBackground', 'background', 'Cor de fundo']]) {
      html += setting('pipette', label, '', `<input class="color-input" type="color" data-color="${key}" value="${model.settings[key]}" aria-label="${label}" ${model.settings[flag] ? '' : 'disabled'}>${toggle(flag, `Personalizar ${label.toLowerCase()}`)}`);
    }
    html += `</section><section class="settings-group"><h2>Layout e leitura</h2>`
      + setting('rows-3', 'Espaçamento', '', selectSetting('density', 'Espaçamento', [['comfortable', 'Confortável'], ['compact', 'Compacto']]))
      + setting('type', 'Tamanho do texto', '', selectSetting('textSize', 'Tamanho do texto', [['normal', 'Padrão'], ['large', 'Maior']]))
      + setting('case-sensitive', 'Fonte', '', selectSetting('font', 'Fonte', [['system', 'Sistema'], ['mono', 'Mono'], ['serif', 'Serifada']]))
      + setting('square', 'Cantos', '', selectSetting('radius', 'Cantos', [[0, 'Retos'], [4, 'Suaves'], [8, 'Arredondados']]))
      + setting('disc-3', 'Formato das capas', '', selectSetting('artworkShape', 'Formato das capas', [['square', 'Quadradas'], ['round', 'Circulares']]))
      + setting('layout-grid', 'Playlists', '', selectSetting('playlistView', 'Visualização das playlists', [['grid', 'Grade'], ['list', 'Lista']]))
      + setting('sparkles', 'Reduzir animações', '', toggle('reducedMotion', 'Reduzir animações')) + '</section>';
  } else if (appearanceTab === 'player') {
    html += `<section class="settings-group"><h2>Player</h2>`
      + setting('panels-top-left', 'Layout do player', '', selectSetting('playerLayout', 'Layout do player', [['cover', 'Capa em destaque'], ['compact', 'Compacto']]))
      + setting('audio-lines', 'Visualizador', '', selectSetting('visualizer', 'Visualizador', [['bars', 'Barras'], ['wave', 'Onda'], ['off', 'Desativado']]))
      + actionSetting('play', 'Abrir player', t.title, 'open-player') + '</section>';
  } else {
    html += `<div class="section-heading"><h2>Meus estilos</h2>${ib('plus', 'save-profile', 'Salvar estilo atual')}</div>`;
    html += model.settings.profiles.length ? model.settings.profiles.map(p => `<div class="profile-row"><button class="profile-main" data-action="apply-profile" data-id="${esc(p.id)}"><span class="profile-swatch" style="background:${p.values.accent};border-color:${p.values.secondary}"></span><span><strong>${esc(p.name)}</strong><small>${esc(themes.find(t => t.id === p.values.theme)?.name || 'Fluxo')}</small></span>${icon('arrow-up-right')}</button>${ib('trash-2', 'delete-profile', `Excluir estilo ${p.name}`, `data-id="${esc(p.id)}"`)}</div>`).join('') : empty('bookmark', 'Nenhum estilo salvo', '', button('plus', 'save-profile', 'Salvar estilo atual'));
  }
  return html;
}
function applyAppearance() {
  model.settings = normalizeSettings(model.settings); save(); theme(); render(); renderPlayer(true);
  stopVisualizer(); if ($('#player').open && model.settings.visualizer !== 'off') startVisualizer(() => current, () => model.settings);
}
function themeTiles() {
  return themes.map(t => `<div class="theme-option" data-theme-id="${t.id}" data-name="${esc(t.name.toLowerCase())}"><button class="theme-tile ${t.id === model.settings.theme ? 'active' : ''}" data-action="theme" data-id="${t.id}" aria-label="Tema ${esc(t.name)}"><span class="theme-swatch theme-${t.id}"><span></span><span></span><span></span></span><strong>${esc(t.name)}</strong></button>${ib('star', 'favorite-theme', `${model.settings.themeFavorites.includes(t.id) ? 'Desfavoritar' : 'Favoritar'} tema ${t.name}`, `data-id="${t.id}"`, `theme-star ${model.settings.themeFavorites.includes(t.id) ? 'active' : ''}`)}</div>`).join('');
}
function filterThemes() {
  document.querySelectorAll('.theme-option').forEach(t => t.hidden = !t.dataset.name.includes(themeQuery.toLowerCase()) || (themeFavoritesOnly && !model.settings.themeFavorites.includes(t.dataset.themeId)));
  $('#themes-empty').hidden = !!document.querySelector('.theme-option:not([hidden])');
}
function showThemes() {
  modal('Temas', `<div class="theme-search"><label class="field">${icon('search')}<input id="theme-filter" type="search" value="${esc(themeQuery)}" placeholder="Encontrar tema" aria-label="Encontrar tema"></label><div class="theme-filter-tabs" role="group" aria-label="Filtro de temas">${button('palette', 'all-themes', 'Todos', '', themeFavoritesOnly ? '' : 'active')}${button('star', 'favorite-themes', 'Favoritos', '', themeFavoritesOnly ? 'active' : '')}</div></div><div class="theme-grid">${themeTiles()}</div><div id="themes-empty" hidden>${empty('star', 'Nenhum tema encontrado', '', '', true)}</div>`); filterThemes();
}
function render() {
  $('#view').innerHTML = ({ library, search: searchPage, queue: queuePage, settings: settingsPage })[tab]();
  document.querySelectorAll('[data-tab]').forEach(a => { a.classList.toggle('active', a.dataset.tab === tab); a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'); });
  connection(); icons();
}
function route() {
  const next = location.hash.slice(1);
  tab = ['library', 'search', 'queue', 'settings'].includes(next) ? next : 'library';
  render(); window.scrollTo(0, 0);
}
function modal(title, html) {
  const sheet = $('#sheet');
  sheet.innerHTML = `<div class="sheet-header"><h2 id="sheet-title">${esc(title)}</h2>${ib('x', 'close-sheet', 'Fechar')}</div><div class="sheet-body">${html}</div>`;
  if (!sheet.open) sheet.showModal(); icons();
}
const closeSheet = () => $('#sheet').close();
function confirm(title, message, action) {
  modal(title, `<p class="footnote">${esc(message)}</p><div class="sheet-actions">${button('x', 'close-sheet', 'Cancelar')}${button('check', action, 'Confirmar', '', 'primary')}</div>`);
}
function newPlaylist(edit = false) {
  const p = edit ? model.playlists.find(p => p.id === playlistId) : null;
  const look = playlistAppearance(p || {});
  modal(edit ? 'Editar playlist' : 'Nova playlist', `<form id="playlist-form" data-edit="${edit}"><label class="field"><input name="title" type="text" placeholder="Nome da playlist" aria-label="Nome da playlist" maxlength="100" value="${esc(p?.title || '')}" required></label><label class="check-label"><input name="offline" type="checkbox" ${!p || p.offlineOnly ? 'checked' : ''}>Somente músicas baixadas</label><div class="playlist-customize"><label class="form-label">Capa<select name="coverStyle" aria-label="Estilo da capa"><option value="mosaic" ${look.coverStyle === 'mosaic' ? 'selected' : ''}>Capas das músicas</option><option value="symbol" ${look.coverStyle === 'symbol' ? 'selected' : ''}>Ícone personalizado</option></select></label><fieldset class="icon-choices"><legend>Ícone</legend>${playlistIcons.map((name, i) => `<label title="${['Playlist', 'Fones', 'Disco', 'Favoritas', 'Rádio', 'Música', 'Brilho'][i]}"><input type="radio" name="coverIcon" value="${name}" ${look.coverIcon === name ? 'checked' : ''} aria-label="Ícone ${name}">${icon(name)}</label>`).join('')}</fieldset><fieldset class="color-choices"><legend>Cor</legend>${['auto', ...playlistColors].map(color => `<label title="${color === 'auto' ? 'Cor do tema' : color}" style="--swatch:${color === 'auto' ? 'var(--cyan)' : color}"><input type="radio" name="coverColor" value="${color}" ${look.coverColor === color ? 'checked' : ''} aria-label="Cor ${color === 'auto' ? 'do tema' : color}"><span></span></label>`).join('')}</fieldset></div><button class="text-button primary full" type="submit">${icon('check')}Salvar playlist</button></form>`);
  $('#playlist-form .playlist-customize').insertAdjacentHTML('afterbegin', '<div id="playlist-cover-preview" class="playlist-cover-preview" aria-label="Prévia da capa"></div>');
  updatePlaylistPreview();
}
function updatePlaylistPreview() {
  const form = $('#playlist-form'); if (!form) return;
  const values = Object.fromEntries(new FormData(form));
  const p = form.dataset.edit === 'true' ? model.playlists.find(p => p.id === playlistId) : null;
  $('#playlist-cover-preview').innerHTML = playlistArt({ ...p, ...playlistAppearance(values), title: String(values.title || 'Playlist'), tracks: p?.tracks || [] });
  form.querySelectorAll('fieldset').forEach(el => el.hidden = values.coverStyle !== 'symbol'); icons();
}
function playlistAdd() {
  const p = model.playlists.find(p => p.id === playlistId);
  const tracks = unique([...ready(), ...libraryTracks(model), ...model.history, ...results]).filter(t => !p.tracks.some(x => x.id === t.id));
  modal('Adicionar músicas', tracks.length ? `<form id="playlist-tracks">${tracks.map(t => `<label class="selection-row"><input type="checkbox" name="tracks" value="${esc(t.id)}">${art(t)}<span>${esc(t.title)}<small>${esc(t.artist)}</small></span></label>`).join('')}<button type="submit" class="text-button primary full">${icon('plus')}Adicionar selecionadas</button></form>` : empty('music-2', 'Nenhuma música disponível', p.offlineOnly ? 'Baixe ou importe músicas primeiro.' : 'Busque ou favorite músicas primeiro.', button('folder-plus', 'import', 'Importar músicas'), true));
}
function trackMenu(track, index = -1, context = '') {
  menuTrack = track; menuIndex = index; menuContext = context;
  const dl = downloads.find(t => t.id === track.id);
  const mi = (name, label, action, attrs = '') => `<button class="menu-item" data-action="${action}" ${attrs}>${icon(name)}${esc(label)}</button>`;
  modal('Música', `<div class="sheet-track">${art(track)}${trackCopy(track)}</div>`
    + mi('radio', 'Iniciar Infinite Radio', 'track-radio')
    + mi('list-end', 'Adicionar à fila', 'enqueue') + mi('list-start', 'Tocar a seguir', 'enqueue-next')
    + '<hr class="menu-divider">'
    + mi('library', savedTrack(track) ? 'Remover da biblioteca' : 'Salvar na biblioteca', 'save-track')
    + mi('heart', favorite(track) ? 'Remover das favoritas' : 'Favoritar', 'favorite')
    + mi('list-plus', 'Adicionar a uma playlist', 'choose-playlist')
    + (dl ? mi(dl.status === 'ready' ? 'trash-2' : 'x', dl.status === 'ready' ? 'Remover download' : 'Cancelar download', 'remove-download') : mi('download', 'Baixar música', 'download'))
    + (dl?.status === 'failed' ? mi('rotate-cw', 'Tentar download novamente', 'download') : '')
    + (context === 'queue' ? `${index > 0 ? mi('arrow-up', 'Subir na fila', 'queue-up') : ''}${index < current.queue.length - 1 ? mi('arrow-down', 'Descer na fila', 'queue-down') : ''}${mi('list-minus', 'Remover da fila', 'queue-remove')}` : '')
    + (context === 'playlist' ? `${index > 0 ? mi('arrow-up', 'Mover para cima', 'playlist-up') : ''}${index < model.playlists.find(p => p.id === playlistId).tracks.length - 1 ? mi('arrow-down', 'Mover para baixo', 'playlist-down') : ''}${mi('list-minus', 'Remover da playlist', 'playlist-remove')}` : ''));
}
function showPlayer() { if (!current.queue.length) return toast('Escolha uma música primeiro.'); renderPlayer(true); if (!$('#player').open) $('#player').showModal(); if (model.settings.visualizer !== 'off') startVisualizer(() => current, () => model.settings); }
function renderPlayer(force = false) {
  const t = current.queue[current.index];
  const key = JSON.stringify([t?.id, current.playing, current.playWhenReady, current.buffering, current.error, current.repeat, current.shuffle, favorite(t), current.speed, current.sleepAt, current.sleepEnd, current.radio, current.recovering]);
  if (!force && key === playerKey) return updateProgress();
  playerKey = key;
  const mini = $('#mini');
  mini.hidden = !t; document.body.classList.toggle('has-player', !!t);
  if (!t) { if ($('#player').open) $('#player').close(); return; }
  const loading = current.buffering && current.playWhenReady !== false;
  const status = current.error ? 'Falha ao reproduzir' : loading ? 'Preparando áudio...' : t.artist;
  const toggleIcon = current.error ? 'rotate-cw' : loading ? 'loader-circle' : current.playing ? 'pause' : 'play';
  mini.innerHTML = `<button class="track-main" data-action="open-player" aria-label="Abrir player">${art(t)}<span class="track-copy"><strong>${esc(t.title)}</strong><small>${esc(status)}</small></span></button>${ib(toggleIcon, 'toggle', current.playing ? 'Pausar' : 'Reproduzir', '', current.buffering ? 'spin' : '')}${ib('skip-forward', 'next', 'Próxima música')}<div class="mini-progress"></div>`;
  if ($('#player').open || force) {
    $('#player').innerHTML = `<div class="player-header">${ib('chevron-down', 'close-player', 'Minimizar player')}<small>Reproduzindo agora</small>${ib('ellipsis', 'current-menu', 'Opções da música')}</div>${art(t, 'player-art')}<div class="player-info"><div><h2>${esc(t.title)}</h2><p>${esc(t.artist)}</p></div>${ib('heart', 'favorite-current', favorite(t) ? 'Desfavoritar' : 'Favoritar', '', favorite(t) ? 'active' : '')}</div><input class="seek" id="seek" type="range" min="0" max="${Math.max(1, current.duration)}" step="0.1" value="${current.position || 0}" aria-label="Posição da música"><div class="time-labels"><span id="elapsed">${duration(current.position)}</span><span id="total">${duration(current.duration)}</span></div><div class="player-controls">${ib('shuffle', 'shuffle', 'Reprodução aleatória', '', current.shuffle ? 'active' : '')}${ib('skip-back', 'previous', 'Música anterior')}${ib(toggleIcon, 'toggle', current.playing ? 'Pausar' : 'Reproduzir', '', `big-play ${current.buffering ? 'spin' : ''}`)}${ib('skip-forward', 'next', 'Próxima música')}${ib(current.repeat === 1 ? 'repeat-1' : 'repeat', 'repeat', current.repeat === 0 ? 'Repetição desativada' : current.repeat === 1 ? 'Repetir uma' : 'Repetir fila', '', current.repeat ? 'active' : '')}</div><div class="player-status">${esc(current.error || (current.buffering ? 'Preparando áudio...' : downloaded(t) ? 'Reprodução offline' : ''))}</div><div class="player-footer"><button data-action="current-download">${icon(downloaded(t) ? 'circle-check' : 'download')}<span>${downloaded(t) ? 'Baixada' : 'Baixar'}</span></button><button data-action="sleep">${icon('moon')}<span>Timer</span></button><button data-action="speed">${icon('gauge')}<span>${current.speed || 1}×</span></button><button data-action="player-queue">${icon('list-music')}<span>Fila</span></button></div>`;
  }
  if ($('#player').open || force) {
    const info = $('#player .player-info');
    $('#player .player-footer').insertAdjacentHTML('afterbegin', `<button data-action="radio-options" class="${current.radio ? 'active' : ''}" aria-label="Infinite Radio">${icon('radio')}<span>Rádio</span></button>`);
    const artwork = $('#player .player-art');
    const stage = document.createElement('div'); stage.className = 'player-stage';
    artwork.before(stage); stage.append(artwork, info);
    stage.insertAdjacentHTML('afterend', '<canvas id="audio-visual" class="audio-visual" aria-hidden="true"></canvas>');
    const statusLabel = $('#player .player-status');
    if (statusLabel) statusLabel.textContent = current.error || (current.recovering ? 'Reconectando áudio...' : loading ? 'Preparando áudio...' : current.sleepEnd ? 'Parar ao fim desta música' : current.radio ? `Infinite Radio${current.radioOffline ? ' offline' : ''}` : downloaded(t) ? 'Reprodução offline' : '');
  }
  if (!loading) document.querySelectorAll('#mini .spin,#player .spin').forEach(button => button.classList.remove('spin'));
  icons(); updateProgress();
}
function updateProgress() {
  const progress = $('.mini-progress'); if (progress) progress.style.width = `${Math.min(100, (current.position || 0) / (current.duration || 1) * 100)}%`;
  const seek = $('#seek'); if (seek && document.activeElement !== seek) { seek.max = Math.max(1, current.duration); seek.value = current.position || 0; }
  if ($('#elapsed')) $('#elapsed').textContent = duration(current.position);
  if ($('#total')) $('#total').textContent = duration(current.duration);
}
async function permissions() { if (!permissionAsked && native) { permissionAsked = true; localStorage.setItem('fluxo_v2_permissions', 'yes'); await commands.notifications(); } }
async function play(tracks, index = 0, strict = false) {
  const selected = tracks[index];
  let playable = tracks.map(available);
  if (strict || offline()) playable = playable.filter(downloaded);
  if (!playable.length) throw new Error('Nenhuma música desta seleção está baixada.');
  if ((strict || offline()) && !downloaded(selected)) throw new Error('Esta música não está disponível offline.');
  await permissions();
  await commands.setQueue({ tracks: playable, index: Math.max(0, playable.findIndex(t => t.id === selected.id)) });
}
async function refreshDownloads() {
  const fresh = await commands.downloads();
  const structural = rows => JSON.stringify(rows.map(t => [t.id, t.status, t.thumbnail]));
  const changed = structural(fresh) !== structural(downloads);
  downloads = fresh;
  if (changed) {
    const focused = document.activeElement?.id === 'library-filter';
    const selection = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    if (tab === 'library' || tab === 'settings') render();
    if (focused && $('#library-filter')) { $('#library-filter').focus(); $('#library-filter').setSelectionRange(...selection); }
    renderPlayer(true);
  } else document.querySelectorAll('[data-row]').forEach(row => {
    const record = fresh.find(t => t.id === row.dataset.row);
    if (!record || record.status === 'ready') return;
    const progress = row.querySelector('progress'); if (progress) progress.value = record.progress || 0;
    const subtitle = row.querySelector('.track-copy small'); if (subtitle) subtitle.textContent = record.statusDetail || record.artist;
  });
}
async function download(track) {
  if (downloaded(track)) return toast('Esta música já está baixada.');
  if (offline()) throw new Error('Conecte-se à internet para baixar.');
  if (!track.url) throw new Error('Importe este arquivo pelo botão de pasta.');
  closeSheet(); await permissions(); toast('Preparando download...');
  await commands.download(track, !!model.settings.wifiOnly); await refreshDownloads(); toast('Download adicionado à biblioteca.');
}
async function runSearch(value = searchTerm) {
  const token = ++searchToken;
  searchTerm = value.trim(); if (!searchTerm) return;
  if (/^https:\/\//i.test(searchTerm)) return openLink(searchTerm);
  if (offline()) { render(); return; }
  model.searches = [searchTerm, ...model.searches.filter(q => q !== searchTerm)].slice(0, 8); save();
  searching = true; searchError = ''; results = []; render();
  let timeout;
  try {
    const result = await Promise.race([commands.search(searchTerm, provider), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('A busca demorou demais. Tente outra fonte.')), 30000); })]);
    if (token === searchToken) results = unique(result);
  } catch (e) { if (token === searchToken) searchError = e.message; }
  finally { clearTimeout(timeout); if (token === searchToken) { searching = false; if (tab === 'search') render(); } }
}
function openLink(value = '') {
  modal('Abrir link', `<form id="link-form"><label class="field">${icon('link')}<input type="url" name="url" value="${esc(value)}" placeholder="https://..." aria-label="Link da música" required></label><label class="field"><input type="text" name="title" placeholder="Nome da música" aria-label="Nome da música" maxlength="200"></label><button type="submit" class="text-button primary full">${icon('play')}Reproduzir</button></form>`);
}
async function toggleFavorite(track) {
  model.favorites = favorite(track) ? model.favorites.filter(t => t.id !== track.id) : [cleanTrack(track), ...model.favorites]; save(); render(); renderPlayer(true);
  if (favorite(track)) await permissions();
  await syncLibrary();
}
async function backgroundSettings() {
  const status = await commands.diagnostics();
  const xiaomi = /xiaomi|poco|redmi/i.test(status.manufacturer);
  modal('Tela apagada e notificações', `<div class="device-status"><strong>${esc(status.manufacturer)} ${esc(status.model)}</strong><small>Android ${esc(status.android)}</small></div>`
    + actionSetting('bell', 'Notificações', status.notifications ? 'Permitidas' : 'Bloqueadas', 'notification-settings')
    + actionSetting('battery', 'Bateria', status.batteryUnrestricted ? 'Sem otimização do Android' : 'Otimização do Android ativa', 'battery-settings')
    + actionSetting('smartphone', xiaomi ? 'Ajustes do HyperOS' : 'Ajustes do aplicativo', '', 'app-settings')
    + setting('audio-lines', 'Serviço de áudio', status.foreground ? 'Ativo em primeiro plano' : 'Sem reprodução ativa', '')
    + (!status.notifications ? button('bell-plus', 'permissions', 'Permitir notificações', '', 'full primary') : ''));
}
async function action(name, el) {
  const index = Number(el?.dataset.index || 0);
  const cmd = (action, value = 0, index = 0) => commands.command({ action, value, index });
  switch (name) {
    case 'close-sheet': closeSheet(); break;
    case 'close-player': $('#player').close(); stopVisualizer(); break;
    case 'appearance': appearanceOpen = true; appearanceTab = 'visual'; render(); window.scrollTo(0, 0); break;
    case 'back-settings': appearanceOpen = false; render(); window.scrollTo(0, 0); break;
    case 'appearance-tab': appearanceTab = el.dataset.value; render(); window.scrollTo(0, 0); break;
    case 'playlist-view': model.settings.playlistView = el.dataset.value; applyAppearance(); break;
    case 'reset-appearance': confirm('Restaurar aparência?', 'Seus estilos salvos, músicas e playlists serão mantidos.', 'reset-appearance-confirm'); break;
    case 'reset-appearance-confirm': Object.assign(model.settings, appearanceDefaults); closeSheet(); applyAppearance(); break;
    case 'save-profile':
      if (model.settings.profiles.length >= 12) throw new Error('Você pode salvar até 12 estilos.');
      modal('Salvar estilo', `<form id="profile-form"><label class="field"><input type="text" name="name" aria-label="Nome do estilo" placeholder="Nome do estilo" maxlength="40" required></label><button class="text-button primary full" type="submit">${icon('check')}Salvar estilo</button></form>`); break;
    case 'apply-profile': { const profile = model.settings.profiles.find(p => p.id === el.dataset.id); if (profile) { Object.assign(model.settings, normalizeAppearance(profile.values)); applyAppearance(); toast(`Estilo ${profile.name} aplicado.`); } break; }
    case 'delete-profile': confirm('Excluir estilo?', 'A aparência atual será mantida.', 'delete-profile-confirm'); $('#sheet [data-action=delete-profile-confirm]').dataset.id = el.dataset.id; break;
    case 'delete-profile-confirm': model.settings.profiles = model.settings.profiles.filter(p => p.id !== el.dataset.id); closeSheet(); applyAppearance(); break;
    case 'open-player': showPlayer(); break;
    case 'go-library': closeSheet(); location.hash = 'library'; break;
    case 'go-search': closeSheet(); location.hash = 'search'; break;
    case 'go-downloads': closeSheet(); playlistId = ''; libraryTab = 'downloads'; location.hash = 'library'; tab = 'library'; render(); break;
    case 'library-tab': libraryTab = el.dataset.value; query = ''; render(); break;
    case 'open-playlist': playlistId = el.dataset.id; render(); break;
    case 'back-library': playlistId = ''; render(); break;
    case 'new-playlist': newPlaylist(); break;
    case 'playlist-edit': newPlaylist(true); break;
    case 'playlist-add': playlistAdd(); break;
    case 'playlist-menu': modal('Playlist', `${button('pencil', 'playlist-edit', 'Editar playlist', '', 'full')}${button('download', 'playlist-download', 'Baixar músicas', '', 'full')}${button('trash-2', 'playlist-delete', 'Excluir playlist', '', 'full danger')}`); break;
    case 'playlist-delete': confirm('Excluir playlist?', 'Os arquivos baixados serão mantidos.', 'playlist-delete-confirm'); break;
    case 'playlist-delete-confirm': model.playlists = model.playlists.filter(p => p.id !== playlistId); playlistId = ''; save(); closeSheet(); render(); await syncLibrary(); break;
    case 'playlist-play': case 'playlist-shuffle': { const p = model.playlists.find(p => p.id === playlistId); const tracks = p.offlineOnly || offline() ? p.tracks.filter(downloaded) : p.tracks; await play(tracks, name === 'playlist-shuffle' ? Math.floor(Math.random() * tracks.length) : 0, p.offlineOnly); await cmd('shuffle', name === 'playlist-shuffle' ? 1 : 0); break; }
    case 'playlist-download': await permissions(); closeSheet(); await syncLibrary(true, true); toast('Downloads da biblioteca agendados.'); break;
    case 'track-play': { const track = find(el.dataset.track); if (!track) break; await play([track], 0, tab === 'library' && !!model.playlists.find(p => p.id === playlistId)?.offlineOnly); break; }
    case 'jump': await cmd('jump', 0, index); break;
    case 'track-menu': trackMenu(find(el.dataset.track), index, el.dataset.context); break;
    case 'current-menu': trackMenu(current.queue[current.index]); break;
    case 'favorite': closeSheet(); await toggleFavorite(menuTrack); break;
    case 'favorite-current': await toggleFavorite(current.queue[current.index]); break;
    case 'save-track':
      if (savedTrack(menuTrack)) confirm('Remover da biblioteca?', 'A música será removida das favoritas e playlists. O arquivo baixado será mantido.', 'remove-saved-confirm');
      else { model.library = unique([menuTrack, ...model.library]); save(); closeSheet(); render(); await permissions(); await syncLibrary(); toast('Música salva na biblioteca.'); } break;
    case 'remove-saved-confirm': {
      const id = menuTrack.id; model.library = model.library.filter(t => t.id !== id); model.favorites = model.favorites.filter(t => t.id !== id);
      model.playlists.forEach(p => p.tracks = p.tracks.filter(t => t.id !== id)); save(); closeSheet(); render(); await syncLibrary(); break;
    }
    case 'track-radio': await startRadio(menuTrack); break;
    case 'radio-options': modal('Infinite Radio', `${current.radio ? button('square', 'radio-stop', 'Encerrar rádio', '', 'full') : button('radio', 'radio-start', 'Iniciar com esta música', '', 'full')}${button('hard-drive', 'radio-offline', 'Rádio das músicas baixadas', ready().length < 2 ? 'disabled' : '', 'full')}`); break;
    case 'radio-start': await startRadio(); break;
    case 'radio-offline': await startRadio(downloaded(current.queue[current.index]) || ready()[0], true); break;
    case 'radio-stop': await cmd('radio-stop'); closeSheet(); render(); break;
    case 'radio-retry': await cmd('radio-retry'); break;
    case 'enqueue': case 'enqueue-next': { const track = available(menuTrack); if (offline() && !downloaded(track)) throw new Error('Esta música não está baixada.'); await commands.append({ track, next: name === 'enqueue-next' }); closeSheet(); toast('Adicionada à fila.'); break; }
    case 'choose-playlist': { const eligible = model.playlists; modal('Adicionar à playlist', eligible.length ? eligible.map(p => `<button class="menu-item" data-action="add-to-playlist" data-id="${esc(p.id)}">${icon('list-plus')}${esc(p.title)}</button>`).join('') : empty('list-music', 'Nenhuma playlist disponível', '', button('plus', 'new-playlist', 'Criar playlist'), true)); break; }
    case 'add-to-playlist': { const p = model.playlists.find(p => p.id === el.dataset.id); p.tracks = unique([...p.tracks, menuTrack]); save(); closeSheet(); render(); await permissions(); await syncLibrary(); toast('Adicionada à playlist.'); break; }
    case 'playlist-remove': case 'playlist-up': case 'playlist-down': { const p = model.playlists.find(p => p.id === playlistId); const [t] = p.tracks.splice(menuIndex, 1); if (name !== 'playlist-remove') p.tracks.splice(menuIndex + (name === 'playlist-up' ? -1 : 1), 0, t); save(); closeSheet(); render(); await syncLibrary(); break; }
    case 'queue-up': case 'queue-down': await cmd('move', menuIndex + (name === 'queue-up' ? -1 : 1), menuIndex); closeSheet(); break;
    case 'queue-remove': await cmd('remove', 0, menuIndex); closeSheet(); break;
    case 'clear-queue': confirm('Limpar a fila?', 'A reprodução será interrompida.', 'clear-queue-confirm'); break;
    case 'clear-queue-confirm': await cmd('clear'); closeSheet(); break;
    case 'download': await download(menuTrack); break;
    case 'current-download': await download(current.queue[current.index]); break;
    case 'remove-download': confirm('Remover arquivo?', 'A música ficará indisponível offline. As playlists serão mantidas.', 'remove-download-confirm'); break;
    case 'remove-download-confirm': await commands.removeDownload(menuTrack.id); await refreshDownloads(); closeSheet(); break;
    case 'import': { closeSheet(); toast('Selecione seus arquivos de áudio.'); const imported = await commands.importAudio(); await refreshDownloads(); if (imported.tracks?.length) { libraryTab = 'downloads'; playlistId = ''; location.hash = 'library'; tab = 'library'; render(); toast(`${imported.tracks.length} músicas importadas.`); } break; }
    case 'toggle': await cmd(current.playing || (current.buffering && current.playWhenReady !== false) ? 'pause' : 'play'); break;
    case 'retry-play': await cmd('play'); break;
    case 'next': case 'previous': await cmd(name); break;
    case 'shuffle': await cmd('shuffle', current.shuffle ? 0 : 1); break;
    case 'repeat': await cmd('repeat', ((current.repeat || 0) + 1) % 3); break;
    case 'player-queue': $('#player').close(); stopVisualizer(); location.hash = 'queue'; break;
    case 'sleep': modal('Temporizador', [-1, 0, 15, 30, 45, 60, 90].map(n => `<button class="menu-item" data-action="set-sleep" data-value="${n}">${icon(n ? 'moon' : 'moon-star')}${n === -1 ? 'Ao fim desta música' : n ? `${n} minutos` : 'Desativado'}</button>`).join('')); break;
    case 'set-sleep': await cmd('sleep', Number(el.dataset.value)); closeSheet(); if (tab === 'settings') render(); toast(Number(el.dataset.value) ? 'Temporizador ativado.' : 'Temporizador desativado.'); break;
    case 'speed': modal('Velocidade', `<div class="slider-row"><span>0,5×</span><input id="speed-slider" type="range" min="0.5" max="2" step="0.05" value="${current.speed || 1}" aria-label="Velocidade"><span>2×</span></div><p class="player-status" id="speed-value">${current.speed || 1}×</p>${button('rotate-ccw', 'reset-speed', 'Restaurar 1×', '', 'full')}`); break;
    case 'reset-speed': await cmd('speed', 1); closeSheet(); render(); break;
    case 'equalizer': modal('Equalizador', ['Normal', 'Graves', 'Voz', 'Agudos'].map((label, i) => `<button class="menu-item" data-action="set-equalizer" data-value="${i}">${icon('audio-lines')}${label}${current.eqPreset === i ? '<small>Ativo</small>' : ''}</button>`).join('') + (!current.eqAvailable ? '<p class="footnote">O efeito será aplicado ao iniciar o áudio, se houver suporte no dispositivo.</p>' : '')); break;
    case 'set-equalizer': await cmd('equalizer', Number(el.dataset.value)); closeSheet(); render(); break;
    case 'themes': themeQuery = ''; themeFavoritesOnly = false; showThemes(); break;
    case 'theme': model.settings.theme = el.dataset.id; model.settings.customAccent = false; model.settings.customSecondary = false; model.settings.customBackground = false; applyAppearance(); document.querySelectorAll('.theme-tile').forEach(t => t.classList.toggle('active', t.dataset.id === model.settings.theme)); break;
    case 'favorite-theme': { const id = el.dataset.id; model.settings.themeFavorites = model.settings.themeFavorites.includes(id) ? model.settings.themeFavorites.filter(t => t !== id) : [...model.settings.themeFavorites, id]; save(); $('#sheet .theme-grid').innerHTML = themeTiles(); filterThemes(); icons(); break; }
    case 'all-themes': case 'favorite-themes': themeFavoritesOnly = name === 'favorite-themes'; document.querySelectorAll('.theme-filter-tabs button').forEach(b => b.classList.toggle('active', b.dataset.action === name)); filterThemes(); break;
    case 'permissions': await commands.notifications(); await backgroundSettings(); break;
    case 'background-settings': await backgroundSettings(); break;
    case 'notification-settings': await commands.openSettings('notifications'); break;
    case 'battery-settings': await commands.openSettings('battery'); break;
    case 'app-settings': await commands.openSettings('app'); break;
    case 'downloads-center': modal('Central de downloads', `<div class="download-summary"><strong>${ready().length}</strong><span>baixadas</span><strong>${downloads.filter(t => ['queued', 'downloading'].includes(t.status)).length}</strong><span>pendentes</span></div>${button('rotate-cw', 'retry-downloads', 'Retomar downloads da biblioteca', '', 'full')}${button('hard-drive', 'go-downloads', 'Ver arquivos e downloads', '', 'full')}`); break;
    case 'retry-downloads': await permissions(); closeSheet(); await syncLibrary(true, true); toast('Novas tentativas agendadas.'); break;
    case 'export': await commands.exportBackup(JSON.stringify(publicBackup(model), null, 2)); break;
    case 'restore': { const value = await commands.importBackup(); if (!value) break; const backup = validateBackup(JSON.parse(value)); model.library = unique([...model.library, ...backup.library]); model.favorites = unique([...model.favorites, ...backup.favorites]); model.playlists = [...new Map([...model.playlists, ...backup.playlists].map(p => [p.id, p])).values()]; model.history = unique([...model.history, ...backup.history]).slice(0, 100); model.settings = { ...model.settings, ...backup.settings }; applyAppearance(); await syncLibrary(); toast('Backup restaurado. Seus arquivos locais foram mantidos.'); break; }
    case 'clear-history': confirm('Limpar histórico?', 'A biblioteca e as playlists serão mantidas.', 'clear-history-confirm'); break;
    case 'clear-history-confirm': model.history = []; save(); closeSheet(); render(); break;
    case 'clear-searches': model.searches = []; save(); render(); break;
    case 'recent-search': await runSearch(model.searches[index]); break;
    case 'genre': await runSearch(el.dataset.value); break;
    case 'retry-search': await runSearch(); break;
    case 'add-link': openLink(); break;
    case 'about': modal('Fluxo Mobile 2', `<p class="footnote">Aplicativo independente para Android.<br>Media3 / ExoPlayer · NewPipeExtractor · Capacitor · Lucide.<br>O acesso a fontes online depende da disponibilidade de cada provedor. Baixe apenas conteúdo que você tem direito de armazenar.<br><br>Este app inclui componentes GPL-3.0-or-later. Licenças e código-fonte acompanham a distribuição.</p>`); break;
  }
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]'); if (!el || el.disabled) return;
  action(el.dataset.action, el).catch(e => toast(e.message || 'Não foi possível concluir.'));
});
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target; const data = new FormData(form);
  (async () => {
    if (form.id === 'search-form') { searchTerm = $('#search-input').value; await runSearch(); }
    if (form.id === 'playlist-form') {
      const title = String(data.get('title')).trim(); if (!title) throw new Error('Dê um nome à playlist.');
      const p = form.dataset.edit === 'true' ? model.playlists.find(p => p.id === playlistId) : { id: crypto.randomUUID(), tracks: [] };
      p.title = title; p.offlineOnly = data.has('offline'); Object.assign(p, playlistAppearance(Object.fromEntries(data)));
      if (form.dataset.edit !== 'true') model.playlists.push(p);
      playlistId = p.id; save(); closeSheet(); render(); await syncLibrary();
    }
    if (form.id === 'playlist-tracks') {
      const p = model.playlists.find(p => p.id === playlistId); const tracks = data.getAll('tracks').map(find).filter(Boolean);
      p.tracks = unique([...p.tracks, ...tracks]); save(); closeSheet(); render(); await permissions(); await syncLibrary();
    }
    if (form.id === 'profile-form') {
      const name = String(data.get('name') || '').trim(); if (!name) throw new Error('Dê um nome ao estilo.');
      if (model.settings.profiles.length >= 12) throw new Error('Você pode salvar até 12 estilos.');
      model.settings.profiles.push({ id: crypto.randomUUID(), name, values: normalizeAppearance(model.settings) });
      closeSheet(); applyAppearance(); toast('Estilo salvo.');
    }
    if (form.id === 'link-form') {
      const url = new URL(String(data.get('url')).trim()); if (url.protocol !== 'https:') throw new Error('Use um link HTTPS.');
      const track = { id: url.href, title: String(data.get('title')).trim() || url.pathname.split('/').pop() || 'Áudio', artist: url.hostname, url: url.href, source: 'direct' };
      closeSheet(); await play([track]);
    }
  })().catch(e => toast(e.message));
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'library-filter') { query = el.value; const tracks = libraryTab === 'downloads' ? [...downloads].reverse() : libraryTab === 'saved' ? libraryTracks(model) : model.favorites; $('#filtered-list').innerHTML = list(filterTracks(tracks, query, sort)); icons(); }
  if (el.id === 'theme-filter') { themeQuery = el.value; filterThemes(); }
  if (el.dataset.color) { model.settings[el.dataset.color] = el.value; save(); theme(); }
  if (el.closest('#playlist-form')) updatePlaylistPreview();
  if (el.id === 'speed-slider') $('#speed-value').textContent = `${el.value}×`;
  if (el.id === 'seek') $('#elapsed').textContent = duration(el.value);
});
document.addEventListener('change', event => {
  const el = event.target;
  (async () => {
    if (el.dataset.setting) {
      model.settings[el.dataset.setting] = el.checked; applyAppearance();
      if (['autoDownload', 'wifiOnly'].includes(el.dataset.setting)) { if (model.settings.autoDownload) await permissions(); await syncLibrary(); }
      if (el.dataset.setting === 'offline' && el.checked && current.radio && !current.radioOffline) await commands.command({ action: 'radio-stop' });
    }
    if (el.dataset.preference) { model.settings[el.dataset.preference] = el.dataset.preference === 'radius' ? Number(el.value) : el.value; applyAppearance(); }
    if (el.dataset.color) { model.settings[el.dataset.color] = el.value; applyAppearance(); }
    if (el.closest('#playlist-form')) updatePlaylistPreview();
    if (el.id === 'provider') { provider = el.value; if (searchTerm) await runSearch(); }
    if (el.id === 'sort') { sort = el.value; render(); }
    if (el.id === 'seek') await commands.command({ action: 'seek', value: Number(el.value) });
    if (el.id === 'speed-slider') await commands.command({ action: 'speed', value: Number(el.value) });
  })().catch(e => toast(e.message));
});
document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && !event.target.src.endsWith('/icon.ico')) event.target.src = './icon.ico'; }, true);
$('#player').addEventListener('close', stopVisualizer);
window.addEventListener('hashchange', route);
window.addEventListener('online', connection); window.addEventListener('offline', connection);
window.fluxoBack = () => { if ($('#sheet').open) closeSheet(); else if ($('#player').open) $('#player').close(); else if (appearanceOpen && tab === 'settings') { appearanceOpen = false; render(); } else if (playlistId && tab === 'library') { playlistId = ''; render(); } else if (tab !== 'library') location.hash = 'library'; else return false; return true; };
window.addEventListener('unhandledrejection', event => { toast(event.reason?.message || 'Ocorreu um erro inesperado.'); });
theme(); route();
await commands.init(data => {
  const changed = JSON.stringify(data.queue) !== JSON.stringify(current.queue) || data.index !== current.index || data.error !== current.error || data.radio !== current.radio || data.radioLoading !== current.radioLoading || data.radioError !== current.radioError;
  current = data;
  const track = current.queue[current.index];
  if (current.playing && track && historyId !== track.id) { historyId = track.id; model.history = unique([track, ...model.history]).slice(0, 100); save(); }
  if (changed && tab === 'queue') render();
  if (changed && tab === 'library' && libraryTab === 'home' && !playlistId && (data.radio || document.querySelector('.radio-strip'))) render();
  document.querySelectorAll('[data-row]').forEach(row => row.classList.toggle('playing', row.dataset.row === track?.id));
  renderPlayer();
}).catch(e => toast(e.message));
await refreshDownloads().catch(e => toast(e.message));
await syncLibrary().catch(e => toast(`Downloads pendentes: ${e.message}`));
await commands.migrateOldDownloads(title => toast(`Recuperando download: ${title}`)).then(refreshDownloads).catch(e => toast(`Seus arquivos antigos foram preservados. Migração pendente: ${e.message}`));
setInterval(() => { if (!document.hidden) refreshDownloads().catch(() => {}); }, 2500);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { refreshDownloads().catch(e => toast(e.message)); commands.command({ action: 'refresh' }).catch(() => {}); }
});
