import { themes } from './themes.js';
import { loadModel, unique, cleanTrack, sameTrack, withDownload, removeLibraryTracks, restoreLibraryTracks, libraryTracks, filterTracks, filterPlaylists, filterDownloads, downloadStats, duration, size, publicBackup, validateBackup } from './model.js';
import { commands, native, artURL } from './platform.js';
import { startVisualizer, stopVisualizer } from './visualizer.js';
import { appearanceDefaults, normalizeSettings, normalizeAppearance, playlistAppearance, playlistIcons, playlistColors, surfacePalette, contrastText } from './appearance.js';
import { groupArtists, mergeTracks, collectionDuration, filterSearchResults, SearchCache, ActionGate, sameOccurrence } from './discovery.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = (name, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const ib = (name, action, label, attrs = '', cls = '') => `<button class="icon-button ${cls}" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${attrs}>${icon(name)}</button>`;
const button = (name, action, label, attrs = '', cls = '') => `<button class="text-button ${cls}" data-action="${action}" ${attrs}>${icon(name)}${esc(label)}</button>`;
const model = loadModel(localStorage);
model.settings = normalizeSettings(model.settings);
model.searches ||= [];
model.library = unique(model.library || []);
model.radioExcluded = unique(model.radioExcluded || []).slice(0, 500);
let syncChain = Promise.resolve();
let downloads = [];
let readyTracks = [];
const readyIds = new Map(), readyUrls = new Map(), downloadIds = new Map(), downloadUrls = new Map();
let savedIds = new Set(), savedUrls = new Set(), favoriteIds = new Set(), favoriteUrls = new Set();
function collectionIndexes() {
  const saved = libraryTracks(model);
  savedIds = new Set(saved.map(t => t.id)); savedUrls = new Set(saved.map(t => t.url).filter(Boolean));
  favoriteIds = new Set(model.favorites.map(t => t.id)); favoriteUrls = new Set(model.favorites.map(t => t.url).filter(Boolean));
}
collectionIndexes();
let current = { queue: [], index: 0, duration: 0, position: 0, playing: false, buffering: false, repeat: 0, shuffle: false, speed: 1 };
let tab = 'library';
let libraryTab = 'home';
let playlistId = '';
let artistId = '';
let artistQuery = '';
let playlistQuery = '';
let playlistSort = 'recent';
let settingsTab = 'audio';
let searchMode = 'online';
let localSearch = '';
let query = '';
let sort = 'recent';
let downloadFilter = 'all';
let draftPlaylistTracks = [];
let results = [];
let searchTerm = '';
let provider = 'youtube';
let searching = false;
let searchError = '';
let searchToken = 0;
let searchDraft = '';
let searchFilter = 'all';
let searchCached = false;
const searchCache = new SearchCache();
const actionGate = new ActionGate();
const formGate = new ActionGate();
let listLimit = 80;
let menuTrack;
let menuIndex = -1;
let menuContext = '';
let menuSnapshot = [];
let sheetOpener;
let playerKey = '';
let historyId = '';
let toastTimer;
let undoAction;
let undoTimer;
let volumeTimer;
let permissionAsked = localStorage.getItem('fluxo_v2_permissions') === 'yes';
let appearanceOpen = false;
let appearanceTab = 'visual';
let themeFavoritesOnly = false;
let themeQuery = '';
let selectionMode = false;
const selectedIds = new Set();
let bulkTracks = [];
let bulkContext = '';
const scrollPositions = new Map();
let renderedViewKey = '';
const offline = () => model.settings.offline || !navigator.onLine;
const ready = () => readyTracks;
const downloaded = track => track && (readyIds.get(track.id) || (track.url ? readyUrls.get(track.url) : null));
const downloadRecord = track => track && (downloadIds.get(track.id) || (track.url ? downloadUrls.get(track.url) : null));
const available = track => withDownload(track, downloaded(track));
const find = id => unique([...results, ...current.queue, ...downloads, ...libraryTracks(model), ...model.history]).find(t => t.id === id);
const favorite = track => !!track && (favoriteIds.has(track.id) || !!track.url && favoriteUrls.has(track.url));
const radioExcluded = track => model.radioExcluded.some(t => t.id === track?.id || (t.url && t.url === track?.url));
const artists = () => groupArtists([...libraryTracks(model), ...ready()]);
const artist = () => artists().find(group => group.id === artistId);
const librarySelection = () => playlistId ? model.playlists.find(p => p.id === playlistId)?.tracks || [] : libraryTab === 'artists' ? artist()?.tracks || [] : libraryTab === 'downloads' ? filterDownloads([...downloads].reverse(), downloadFilter) : libraryTab === 'saved' ? libraryTracks(model) : libraryTab === 'history' ? model.history : model.favorites;
const selectedTracks = () => librarySelection().filter(track => selectedIds.has(track.id));
const resetSelection = () => { selectionMode = false; selectedIds.clear(); };
const viewKey = () => tab === 'library' ? `library:${playlistId || (artistId ? `artist:${artistId}` : libraryTab)}` : tab === 'settings' ? `settings:${appearanceOpen ? 'appearance' : settingsTab}` : tab;
function navigate(change, reset = false) {
  if (renderedViewKey) scrollPositions.set(renderedViewKey, { y: window.scrollY, limit: listLimit, query, sort });
  change(); resetSelection();
  const previous = reset ? null : scrollPositions.get(viewKey());
  listLimit = previous?.limit || 80;
  if (previous && tab === 'library') { query = previous.query; sort = previous.sort; }
  render(); window.scrollTo(0, previous?.y || 0); $('#view').focus({ preventScroll: true });
}
function save() { collectionIndexes(); localStorage.setItem('fluxo_mobile_v2', JSON.stringify(model)); }
async function syncLibrary(retry = false) {
  const tracks = libraryTracks(model);
  const enabled = model.settings.autoDownload;
  const wifiOnly = model.settings.wifiOnly;
  syncChain = syncChain.catch(() => {}).then(() => commands.syncLibrary(tracks, enabled, wifiOnly, retry));
  await syncChain; await refreshDownloads();
}
const savedTrack = track => !!track && (savedIds.has(track.id) || !!track.url && savedUrls.has(track.url));
function icons() { window.lucide?.createIcons(); }
function toast(message, undo) {
  clearTimeout(toastTimer); clearTimeout(undoTimer); undoAction = undo;
  $('#toast').innerHTML = `<span>${esc(message)}</span>${undo ? `<button data-action="undo" aria-label="Desfazer">${icon('undo-2')}Desfazer</button>` : ''}`;
  $('#toast').hidden = false; icons();
  toastTimer = setTimeout(() => $('#toast').hidden = true, undo ? 10000 : 4200);
  if (undo) undoTimer = setTimeout(() => undoAction = null, 10000);
}
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
function trackCopy(track) { const record = downloadRecord(track); return `<span class="track-copy"><strong>${esc(track.title)}</strong><small>${downloaded(track) ? icon('circle-check') : ''}${esc(record?.statusDetail || track.artist)}</small></span>`; }
function list(tracks, context = 'list', offset = 0) {
  return `<div class="track-list">${tracks.slice(0, listLimit).map((track, i) => {
    const dl = downloadRecord(track);
    const rowIndex = context === 'playlist' ? model.playlists.find(p => p.id === playlistId).tracks.findIndex(t => t.id === track.id) : i + offset;
    const selecting = selectionMode && tab === 'library' && context !== 'queue';
    const playing = context === 'queue' ? rowIndex === current.index : sameTrack(current.queue[current.index], track);
    return `<div class="track ${playing ? 'playing' : ''} ${selecting && selectedIds.has(track.id) ? 'selected' : ''}" data-row="${esc(track.id)}" data-row-url="${esc(track.url)}" ${context === 'queue' ? `data-queue-index="${rowIndex}"` : ''}>
      ${selecting ? `<label class="track-select"><input type="checkbox" data-select-track="${esc(track.id)}" aria-label="Selecionar ${esc(track.title)}" ${selectedIds.has(track.id) ? 'checked' : ''}></label>` : ''}
      ${context === 'queue' ? `<span class="queue-number">${rowIndex === current.index ? icon('audio-lines') : rowIndex + 1}</span>` : ''}
      <button class="track-main" data-action="${selecting ? 'select-track' : context === 'queue' ? 'jump' : 'track-play'}" data-index="${rowIndex}" data-track="${esc(track.id)}" aria-label="${selecting ? 'Selecionar' : 'Tocar'} ${esc(track.title)}">${art(track)}${trackCopy(track)}</button>
      ${dl?.status === 'downloading' ? `<progress class="download-progress" value="${dl.progress || 0}" max="100" aria-label="Download"></progress>` : `<span class="track-time">${dl?.status === 'failed' ? 'Falhou' : track.duration ? duration(track.duration) : ''}</span>`}
      ${!selecting && context === 'downloads' && dl?.status === 'failed' ? ib('rotate-cw', 'retry-download', `Tentar baixar ${track.title}`, `data-track="${esc(track.id)}"`) : ''}
      ${selecting ? '' : context === 'downloads' && ['queued', 'downloading'].includes(dl?.status) ? ib('x', 'cancel-download', `Cancelar download de ${track.title}`, `data-track="${esc(track.id)}"`) : ib('ellipsis-vertical', 'track-menu', `Opções de ${track.title}`, `data-track="${esc(track.id)}" data-index="${rowIndex}" data-context="${context}"`)}
    </div>`;
  }).join('')}${tracks.length > listLimit ? `<div class="list-more">${button('chevrons-down', 'load-more-tracks', 'Carregar mais músicas')}<small>${listLimit} de ${tracks.length}</small></div>` : ''}</div>`;
}
function playlistGrid() {
  const playlists = filterPlaylists(model.playlists, playlistQuery, playlistSort);
  return playlists.length ? `<div class="playlist-grid">${playlists.map(p => `<button class="playlist-card" data-action="open-playlist" data-id="${esc(p.id)}">${playlistArt(p)}<div><strong>${p.pinned ? `<span class="playlist-pin" aria-label="Fixada">${icon('pin')}</span>` : ''}${esc(p.title)}</strong><small>${p.tracks.length} músicas${p.offlineOnly ? ' · Offline' : ''}</small><span class="playlist-availability">${icon('hard-drive')}${p.tracks.filter(downloaded).length}/${p.tracks.length}</span></div></button>`).join('')}</div>` : empty('list-music', playlistQuery ? 'Nenhuma playlist encontrada' : 'Sua primeira playlist', '', playlistQuery ? '' : button('plus', 'new-playlist', 'Criar playlist'), true);
}
function selectionTools(tracks) {
  if (!selectionMode) return `<div class="collection-toolbar"><small>${tracks.length} músicas · ${collectionDuration(tracks)}</small><div>${ib('play', 'play-collection', 'Tocar esta seleção', tracks.length ? '' : 'disabled')}${ib('list-checks', 'start-selection', 'Selecionar músicas', tracks.length ? '' : 'disabled')}</div></div>`;
  const count = selectedTracks().length;
  const all = tracks.length > 0 && tracks.every(track => selectedIds.has(track.id));
  return `<div class="bulk-toolbar"><div class="bulk-heading">${ib('x', 'end-selection', 'Sair da seleção')}<strong>${count} selecionadas</strong><label><input id="select-all-tracks" type="checkbox" aria-label="Selecionar todas as ${tracks.length} músicas filtradas" ${all ? 'checked' : ''}>Todas (${tracks.length})</label></div><div class="bulk-actions">${ib('play', 'bulk-play', 'Tocar selecionadas', count ? '' : 'disabled')}${ib('list-plus', 'bulk-playlist', 'Adicionar selecionadas a uma playlist', count ? '' : 'disabled')}${ib('heart', 'bulk-favorite', 'Favoritar selecionadas', count ? '' : 'disabled')}${ib('download', 'bulk-download', 'Baixar selecionadas', count ? '' : 'disabled')}${ib('ellipsis', 'bulk-menu', 'Mais ações da seleção', count ? '' : 'disabled')}</div></div>`;
}
function collectionTools(tracks) { return `<div id="collection-tools">${selectionTools(tracks)}</div>`; }
function updateSelection() {
  const allowed = new Set(librarySelection().map(track => track.id));
  for (const id of selectedIds) if (!allowed.has(id)) selectedIds.delete(id);
  const tracks = filterTracks(librarySelection(), query, sort);
  if ($('#collection-tools')) $('#collection-tools').innerHTML = selectionTools(tracks);
  document.querySelectorAll('[data-select-track]').forEach(input => { input.checked = selectedIds.has(input.dataset.selectTrack); input.closest('.track').classList.toggle('selected', input.checked); });
  const visibleSelected = tracks.filter(track => selectedIds.has(track.id)).length;
  if ($('#select-all-tracks')) $('#select-all-tracks').indeterminate = visibleSelected > 0 && visibleSelected < tracks.length;
  icons();
}
function chooseBulkPlaylist() {
  bulkTracks = selectedTracks();
  modal('Adicionar selecionadas', model.playlists.map(p => `<button class="menu-item" data-action="bulk-add-playlist" data-id="${esc(p.id)}">${icon('list-plus')}${esc(p.title)}</button>`).join('') + button('plus', 'bulk-new-playlist', 'Criar playlist com a seleção', '', 'full'));
}
function resumeStrip() {
  const track = current.queue[current.index];
  if (!track) return '';
  return `<div class="resume-strip">${art(track)}<div><small>${current.playing ? 'Ouvindo agora' : 'Continuar ouvindo'}</small><strong>${esc(track.title)}</strong><span>${esc(track.artist)}</span></div>${ib(current.playing ? 'audio-lines' : 'play', 'resume-session', current.playing ? 'Ver reprodução atual' : 'Continuar reprodução')}</div>`;
}
function filterBar() { return `<div class="row-tools"><label class="field">${icon('list-filter')}<input id="library-filter" type="search" value="${esc(query)}" placeholder="Filtrar músicas" aria-label="Filtrar músicas"></label><select id="sort" aria-label="Ordenar músicas"><option value="recent">Recentes</option><option value="title" ${sort === 'title' ? 'selected' : ''}>Título</option><option value="artist" ${sort === 'artist' ? 'selected' : ''}>Artista</option></select></div>`; }
function downloadsOverview() {
  const stats = downloadStats(downloads);
  return `<div class="offline-overview">${icon('hard-drive')}<div><strong>${size(stats.bytes)} no dispositivo</strong><small>${stats.ready} músicas prontas para ouvir offline</small></div><div class="section-tools">${stats.failed ? ib('rotate-cw', 'retry-failed-downloads', 'Tentar downloads com falha novamente') : ''}${stats.pending ? ib('circle-x', 'cancel-pending-downloads', 'Cancelar downloads pendentes') : ''}</div></div>`
    + `<div class="download-filters" role="group" aria-label="Estado dos downloads">${[['all', 'Todas', downloads.length], ['ready', 'Prontas', stats.ready], ['pending', 'Pendentes', stats.pending], ['failed', 'Falhas', stats.failed]].map(([id, label, count]) => `<button data-action="download-filter" data-value="${id}" aria-pressed="${downloadFilter === id}" class="${downloadFilter === id ? 'active' : ''}"><span>${label}</span><small>${count}</small></button>`).join('')}</div>`;
}
function library() {
  if (playlistId) return playlistPage();
  if (libraryTab === 'artists') return artistPage();
  if (libraryTab === 'history') return `<div class="section-heading history-heading">${ib('arrow-left', 'back-collections', 'Voltar às coleções')}<h1>Histórico</h1>${ib('trash-2', 'clear-history', 'Limpar histórico', model.history.length ? '' : 'disabled')}</div>` + filterBar() + collectionTools(filterTracks(model.history, query, sort)) + `<div id="filtered-list">${model.history.length ? list(filterTracks(model.history, query, sort), 'history') : empty('history', 'Nenhuma música no histórico')}</div>`;
  const tabs = [['home', 'Coleções'], ['saved', 'Salvas'], ['downloads', 'Baixadas'], ['favorites', 'Favoritas']];
  let html = heading('Sua biblioteca', `${ready().length} músicas no dispositivo`, ib('plus', 'new-playlist', 'Criar playlist'));
  html += `<div class="segmented" role="tablist" aria-label="Biblioteca">${tabs.map(([id, label]) => `<button role="tab" aria-selected="${libraryTab === id}" class="${libraryTab === id ? 'active' : ''}" data-action="library-tab" data-value="${id}">${label}</button>`).join('')}</div>`;
  if (libraryTab === 'home') {
    html += radioStrip();
    html += `<div id="resume-slot">${resumeStrip()}</div>`;
    html += `<div class="library-summary"><button data-action="library-tab" data-value="downloads">${icon('hard-drive-download')}<strong>${ready().length}</strong><span>Baixadas</span></button><button data-action="library-tab" data-value="favorites">${icon('heart')}<strong>${model.favorites.length}</strong><span>Favoritas</span></button><button data-action="open-history">${icon('history')}<strong>${model.history.length}</strong><span>Histórico</span></button></div>`;
    html += `<button class="collection-access" data-action="open-artists">${icon('mic-2')}<span><strong>Artistas</strong><small>${artists().length} na sua biblioteca</small></span>${icon('chevron-right')}</button>`;
    html += `<div class="section-heading"><h2>Playlists</h2><div class="section-tools"><div class="view-switch" role="group" aria-label="Visualização das playlists">${ib('layout-grid', 'playlist-view', 'Playlists em grade', 'data-value="grid"', model.settings.playlistView === 'grid' ? 'active' : '')}${ib('list', 'playlist-view', 'Playlists em lista', 'data-value="list"', model.settings.playlistView === 'list' ? 'active' : '')}</div>${ib('plus', 'new-playlist', 'Nova playlist')}</div></div>`;
    if (model.playlists.length) html += `<div class="row-tools playlist-tools"><label class="field">${icon('search')}<input id="playlist-search" type="search" aria-label="Buscar playlists" placeholder="Buscar playlists" value="${esc(playlistQuery)}"></label><select id="playlist-sort" aria-label="Ordenar playlists"><option value="recent">Sua ordem</option><option value="title" ${playlistSort === 'title' ? 'selected' : ''}>Nome</option></select></div>`;
    html += `<div id="playlist-grid-container">${playlistGrid()}</div>`;
    html += `<div class="section-heading"><h2>Ouvidas recentemente</h2>${model.history.length ? `<div class="section-tools">${ib('arrow-right', 'open-history', 'Ver histórico completo')}${ib('trash-2', 'clear-history', 'Limpar histórico')}</div>` : ''}</div>`;
    html += model.history.length ? list(model.history.slice(0, 8)) : empty('disc-3', 'Dê o primeiro play', '', button('folder-plus', 'import', 'Importar músicas'), true);
  } else {
    const tracks = librarySelection();
    if (libraryTab === 'downloads') html += downloadsOverview();
    html += filterBar() + collectionTools(filterTracks(tracks, query, sort));
    html += `<div id="filtered-list">${tracks.length ? list(filterTracks(tracks, query, sort), libraryTab === 'downloads' ? 'downloads' : 'list') : empty(libraryTab === 'downloads' ? 'download' : libraryTab === 'saved' ? 'library' : 'heart', libraryTab === 'downloads' && downloadFilter !== 'all' ? 'Nenhuma música neste estado' : libraryTab === 'downloads' ? 'Nenhuma música baixada' : libraryTab === 'saved' ? 'Nenhuma música salva' : 'Nenhuma favorita ainda', '', libraryTab === 'downloads' ? button('folder-plus', 'import', 'Importar músicas') : button('search', 'go-search', 'Buscar músicas'))}</div>`;
  }
  return html;
}
function artistRows() {
  const groups = groupArtists([...libraryTracks(model), ...ready()], artistQuery);
  return groups.length ? `<div class="artist-list">${groups.map(group => `<button class="artist-row" data-action="open-artist" data-id="${esc(group.id)}">${art(group.tracks[0], 'artist-cover')}<span><strong>${esc(group.name)}</strong><small>${group.tracks.length} músicas · ${group.tracks.filter(downloaded).length} offline</small></span>${icon('chevron-right')}</button>`).join('')}</div>` : empty('mic-2', artistQuery ? 'Nenhum artista encontrado' : 'Nenhum artista na biblioteca', '', artistQuery ? '' : button('folder-plus', 'import', 'Importar músicas'));
}
function artistPage() {
  const group = artist();
  if (artistId && !group) artistId = '';
  if (!artistId) return `<div class="section-heading collection-heading">${ib('arrow-left', 'back-collections', 'Voltar às coleções')}<h1>Artistas</h1><small>${artists().length}</small></div><label class="field artist-search">${icon('search')}<input id="artist-search" type="search" value="${esc(artistQuery)}" aria-label="Buscar artistas" placeholder="Buscar artista"></label><div id="artist-rows">${artistRows()}</div>`;
  return `<div class="section-heading">${ib('arrow-left', 'back-artists', 'Voltar aos artistas')}<span class="muted">ARTISTA</span>${ib('list-plus', 'artist-playlist', 'Criar playlist deste artista')}</div><div class="artist-heading">${playlistArt({ title: group.name, tracks: group.tracks })}<div><h1>${esc(group.name)}</h1><p>${group.tracks.length} músicas · ${collectionDuration(group.tracks)}</p><small>${group.tracks.filter(downloaded).length} disponíveis offline</small></div></div>` + filterBar() + collectionTools(filterTracks(group.tracks, query, sort)) + `<div id="filtered-list">${list(filterTracks(group.tracks, query, sort))}</div>`;
}
function playlistPage() {
  const p = model.playlists.find(p => p.id === playlistId);
  if (!p) { playlistId = ''; return library(); }
  let html = `<div class="section-heading">${ib('arrow-left', 'back-library', 'Voltar à biblioteca')}<span class="muted">PLAYLIST${p.offlineOnly ? ' OFFLINE' : ''}</span>${ib('ellipsis', 'playlist-menu', 'Opções da playlist')}</div>`;
  html += `<div class="playlist-heading">${playlistArt(p)}<div><h1>${esc(p.title)}</h1><p>${p.tracks.length} músicas · ${p.tracks.filter(downloaded).length} offline</p></div></div>`;
  html += `<div class="playlist-toolbar">${button('play', 'playlist-play', 'Reproduzir', p.tracks.length ? '' : 'disabled', 'primary')}${ib('shuffle', 'playlist-shuffle', 'Embaralhar playlist')}${ib('plus', 'playlist-add', 'Adicionar músicas')}</div>`;
  const localCount = p.tracks.filter(downloaded).length;
  if (p.tracks.length) html += `<div class="playlist-offline"><span>${icon(localCount === p.tracks.length ? 'circle-check' : 'cloud-download')}${localCount}/${p.tracks.length} offline · ${collectionDuration(p.tracks)}</span>${localCount < p.tracks.length ? ib('download', 'playlist-download', 'Baixar esta playlist') : ''}<progress value="${localCount}" max="${p.tracks.length}" aria-label="Disponibilidade offline da playlist"></progress></div>`;
  html += p.tracks.length ? filterBar() + collectionTools(filterTracks(p.tracks, query, sort)) + `<div id="filtered-list">${list(filterTracks(p.tracks, query, sort), 'playlist')}</div>` : empty('list-music', 'Playlist vazia', '', button('plus', 'playlist-add', 'Adicionar músicas'));
  return html;
}
function searchPage() {
  let html = heading('Buscar', '', ib('link', 'add-link', 'Abrir link de áudio'));
  html += `<div class="segmented search-modes" role="tablist" aria-label="Onde buscar">${[['online', 'globe', 'Online'], ['local', 'library', 'Na biblioteca']].map(([id, name, label]) => `<button role="tab" aria-selected="${searchMode === id}" class="${searchMode === id ? 'active' : ''}" data-action="search-mode" data-value="${id}">${icon(name)}${label}</button>`).join('')}</div>`;
  html += `<form id="search-form" class="search-form"><label class="field">${icon('search')}<input id="search-input" type="search" enterkeyhint="search" autocomplete="off" maxlength="200" placeholder="Música ou artista" value="${esc(searchMode === 'local' ? localSearch : searchDraft)}" aria-label="Buscar músicas" ${searchMode === 'local' ? '' : 'required'}></label><button class="icon-button primary" type="submit" aria-label="Pesquisar">${icon('arrow-right')}</button></form>`;
  if (searchMode === 'local') return html + `<div id="local-search-results">${localResults()}</div>`;
  const matches = filterSearchResults(results, searchFilter, downloaded, favorite);
  html += `<div class="search-sources"><small>YouTube${searchCached ? ' · Busca recente' : ''}</small>${searchTerm && !searching ? `<small>${matches.length} resultados</small>${ib('rotate-cw', 'refresh-search', 'Atualizar resultados')}` : ''}</div>`;
  if (offline()) return html + empty('wifi-off', 'Você está offline', '', button('library', 'go-downloads', 'Abrir músicas baixadas'));
  if (searching) return html + `<div class="loading" role="status">${icon('loader-circle', 'spin')}Buscando músicas...${ib('x', 'cancel-search', 'Cancelar busca')}</div>`;
  if (searchError) return html + `<div class="error-state"><p>${esc(searchError)}</p>${ib('rotate-cw', 'retry-search', 'Tentar busca novamente')}</div>`;
  if (searchTerm) return html + `<div class="search-refine"><label>Resultados<select id="search-filter" aria-label="Filtrar resultados"><option value="all">Todos</option>${[['short', 'Menos de 4 min'], ['long', '4 min ou mais'], ['downloaded', 'Baixadas'], ['favorites', 'Favoritas']].map(([id, text]) => `<option value="${id}" ${searchFilter === id ? 'selected' : ''}>${text}</option>`).join('')}</select></label></div>` + (matches.length ? list(matches, 'search') : empty('search', results.length ? 'Nenhuma música neste filtro' : 'Nenhum resultado', '', results.length ? button('list-filter', 'reset-search-filter', 'Ver todos os resultados') : ''));
  if (model.searches.length) html += `<div class="section-heading"><h2>Buscas recentes</h2>${ib('trash-2', 'clear-searches', 'Limpar buscas')}</div>${model.searches.map((q, i) => `<div class="recent-search"><button data-action="recent-search" data-index="${i}">${icon('history')}${esc(q)}</button>${ib('arrow-up-left', 'recent-search', `Buscar ${q}`, `data-index="${i}"`)}</div>`).join('')}`;
  html += `<div class="section-heading"><h2>Explorar</h2></div><div class="radio-grid">${['Lo-fi', 'Rock', 'Eletrônica', 'Jazz', 'MPB', 'Synthwave'].map(q => `<button class="radio-item" data-action="genre" data-value="${esc(q)}">${icon('radio')}${esc(q)}</button>`).join('')}</div>`;
  return html;
}
function localResults() {
  const tracks = mergeTracks([...libraryTracks(model), ...ready()]);
  const matches = filterTracks(offline() ? tracks.filter(downloaded) : tracks, localSearch, 'title');
  return `<div class="search-sources"><small>${matches.length} músicas${offline() ? ' offline' : ''}</small></div>${matches.length ? list(matches, 'local-search') : empty('search', 'Nenhuma música encontrada')}`;
}
function queuePage() {
  return heading('Na sequência', `${current.queue.length} músicas${current.queue.length ? ` · ${collectionDuration(current.queue)}` : ''}`, current.queue.length ? `<div class="section-tools">${ib('save', 'save-queue', 'Salvar fila como playlist')}${ib('list-filter', 'queue-tools', 'Organizar fila')}${ib('trash-2', 'clear-queue', 'Limpar fila')}</div>` : '')
    + radioStrip()
    + (current.error ? `<div class="error-state"><p>${esc(current.error)}</p>${ib('rotate-cw', 'retry-play', 'Tentar reprodução novamente')}</div>` : '')
    + (current.queue.length ? `${current.index > 0 ? `<details class="queue-history"><summary>${icon('history')}${current.index} anteriores</summary>${list(current.queue.slice(0, current.index), 'queue')}</details>` : ''}<div class="section-heading queue-heading"><h2>Tocando agora</h2><small>${current.shuffle ? 'Aleatório' : 'Sua seleção'}</small></div>${list([current.queue[current.index]], 'queue', current.index)}<div class="section-heading queue-heading"><h2>A seguir</h2><small>${Math.max(0, current.queue.length - current.index - 1)}</small></div>${current.queue.length > current.index + 1 ? list(current.queue.slice(current.index + 1), 'queue', current.index + 1) : empty('list-end', 'Fim da sua seleção', '', '', true)}` : empty('list-music', 'A fila está vazia', '', button('library', 'go-library', 'Abrir biblioteca')));
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
  if (local && !ready().some(item => item.id !== track.id && !radioExcluded(item))) throw new Error('Adicione outra música baixada e permitida no rádio.');
  await permissions(); closeSheet();
  await commands.radio(available(track), local, ready());
  toast(local ? 'Rádio offline iniciado.' : 'Infinite Radio iniciado.');
}
const setting = (name, title, description, control) => `<div class="setting">${icon(name)}<div><strong>${esc(title)}</strong>${description ? `<small>${esc(description)}</small>` : ''}</div>${control}</div>`;
const toggle = (id, label) => `<input class="toggle" type="checkbox" data-setting="${id}" aria-label="${esc(label)}" ${model.settings[id] ? 'checked' : ''}>`;
const actionSetting = (name, title, desc, action) => `<button class="setting action-row" data-action="${action}">${icon(name)}<div><strong>${esc(title)}</strong>${desc ? `<small>${esc(desc)}</small>` : ''}</div>${icon('chevron-right', 'chevron')}</button>`;
function settingsPage() {
  if (appearanceOpen) return appearancePage();
  const sections = {
    audio: `<section class="settings-group"><h2>Reprodução</h2>${setting('wifi-off', 'Modo offline', '', toggle('offline', 'Modo offline'))}${actionSetting('volume-2', 'Volume do app', `${Math.round((current.volume ?? 1) * 100)}%`, 'volume')}${actionSetting('moon', 'Temporizador', current.sleepEnd ? 'Ao fim desta música' : current.sleepAt ? `${Math.max(1, Math.ceil((current.sleepAt - Date.now()) / 60000))} min restantes` : 'Desativado', 'sleep')}${actionSetting('gauge', 'Velocidade', `${current.speed || 1}×`, 'speed')}${actionSetting('radio', 'Preferências do rádio', `${model.radioExcluded.length} músicas não recomendadas`, 'radio-preferences')}${native ? actionSetting('audio-lines', 'Equalizador', ['Normal', 'Graves', 'Voz', 'Agudos'][current.eqPreset || 0], 'equalizer') : ''}</section>`,
    visual: `<section class="settings-group"><h2>Aparência</h2>${actionSetting('palette', 'Temas do Fluxo', `${themes.length} temas · ${themes.find(t => t.id === model.settings.theme)?.name || 'Fluxo Bug'}`, 'themes')}${actionSetting('paintbrush', 'Personalizar aparência', `${model.settings.density === 'compact' ? 'Compacto' : 'Confortável'} · ${model.settings.profiles.length} estilos salvos`, 'appearance')}</section>`,
    library: `<section class="settings-group"><h2>Biblioteca e downloads</h2>${setting('cloud-download', 'Download automático', '', toggle('autoDownload', 'Download automático'))}${setting('wifi', 'Baixar só no Wi-Fi', '', toggle('wifiOnly', 'Baixar só no Wi-Fi'))}${actionSetting('download', 'Central de downloads', `${downloadStats(downloads).pending} pendentes · ${downloadStats(downloads).failed} falhas`, 'downloads-center')}${actionSetting('hard-drive', 'Músicas no dispositivo', `${ready().length} arquivos · ${size(downloadStats(downloads).bytes)}`, 'go-downloads')}${actionSetting('folder-plus', 'Importar arquivos', '', 'import')}</section>`,
    system: `<section class="settings-group"><h2>Dados e permissões</h2>${actionSetting('file-down', 'Exportar backup', 'Playlists, favoritos e preferências', 'export')}${actionSetting('file-up', 'Restaurar backup', '', 'restore')}${native ? actionSetting('shield-check', 'Tela apagada e notificações', '', 'background-settings') : ''}${actionSetting('info', 'Sobre o Fluxo Mobile', 'Versão 2.6.0', 'about')}</section>`
  };
  return heading('Ajustes') + `<div class="settings-tabs segmented" role="tablist" aria-label="Categorias de ajustes">${[['audio', 'headphones', 'Áudio'], ['library', 'hard-drive', 'Biblioteca'], ['visual', 'palette', 'Visual'], ['system', 'shield-check', 'Sistema']].map(([id, name, label]) => `<button role="tab" aria-selected="${settingsTab === id}" class="${settingsTab === id ? 'active' : ''}" data-action="settings-tab" data-value="${id}">${icon(name)}${label}</button>`).join('')}</div>` + sections[settingsTab];
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
  const focused = document.activeElement?.matches('#view input[type=search],#view input[type=text]') ? document.activeElement : null;
  const selection = focused ? { id: focused.id, start: focused.selectionStart, end: focused.selectionEnd } : null;
  $('#view').innerHTML = ({ library, search: searchPage, queue: queuePage, settings: settingsPage })[tab]();
  renderedViewKey = viewKey();
  document.querySelectorAll('[data-tab]').forEach(a => { a.classList.toggle('active', a.dataset.tab === tab); a.setAttribute('aria-current', a.dataset.tab === tab ? 'page' : 'false'); });
  connection(); icons();
  if (selection && document.getElementById(selection.id)) { const input = document.getElementById(selection.id); input.focus({ preventScroll: true }); input.setSelectionRange(selection.start, selection.end); }
}
function route() {
  const next = location.hash.slice(1);
  navigate(() => { tab = ['library', 'search', 'queue', 'settings'].includes(next) ? next : 'library'; });
}
function modal(title, html) {
  const sheet = $('#sheet');
  if (!sheet.open) sheetOpener = document.activeElement;
  sheet.innerHTML = `<div class="sheet-header"><h2 id="sheet-title">${esc(title)}</h2>${ib('x', 'close-sheet', 'Fechar')}</div><div class="sheet-body">${html}</div>`;
  if (!sheet.open) sheet.showModal();
  $('.sheet-body').scrollTop = 0; icons();
}
const closeSheet = () => $('#sheet').close();
function confirm(title, message, action) {
  modal(title, `<p class="footnote">${esc(message)}</p><div class="sheet-actions">${button('x', 'close-sheet', 'Cancelar')}${button('check', action, 'Confirmar', '', 'primary')}</div>`);
}
function newPlaylist(edit = false, tracks = [], title = '') {
  if (!edit) draftPlaylistTracks = unique(tracks);
  const p = edit ? model.playlists.find(p => p.id === playlistId) : null;
  const look = playlistAppearance(p || {});
  modal(edit ? 'Editar playlist' : 'Nova playlist', `<form id="playlist-form" data-edit="${edit}"><label class="field"><input name="title" type="text" placeholder="Nome da playlist" aria-label="Nome da playlist" maxlength="100" value="${esc(p?.title || title.slice(0, 100))}" required></label><label class="check-label"><input name="offline" type="checkbox" ${p ? p.offlineOnly ? 'checked' : '' : tracks.length ? tracks.every(downloaded) ? 'checked' : '' : 'checked'}>Somente músicas baixadas</label><div class="playlist-customize"><label class="form-label">Capa<select name="coverStyle" aria-label="Estilo da capa"><option value="mosaic" ${look.coverStyle === 'mosaic' ? 'selected' : ''}>Capas das músicas</option><option value="symbol" ${look.coverStyle === 'symbol' ? 'selected' : ''}>Ícone personalizado</option></select></label><fieldset class="icon-choices"><legend>Ícone</legend>${playlistIcons.map((name, i) => `<label title="${['Playlist', 'Fones', 'Disco', 'Favoritas', 'Rádio', 'Música', 'Brilho'][i]}"><input type="radio" name="coverIcon" value="${name}" ${look.coverIcon === name ? 'checked' : ''} aria-label="Ícone ${name}">${icon(name)}</label>`).join('')}</fieldset><fieldset class="color-choices"><legend>Cor</legend>${['auto', ...playlistColors].map(color => `<label title="${color === 'auto' ? 'Cor do tema' : color}" style="--swatch:${color === 'auto' ? 'var(--cyan)' : color}"><input type="radio" name="coverColor" value="${color}" ${look.coverColor === color ? 'checked' : ''} aria-label="Cor ${color === 'auto' ? 'do tema' : color}"><span></span></label>`).join('')}</fieldset></div><button class="text-button primary full" type="submit">${icon('check')}Salvar playlist</button></form>`);
  $('#playlist-form .playlist-customize').insertAdjacentHTML('afterbegin', '<div id="playlist-cover-preview" class="playlist-cover-preview" aria-label="Prévia da capa"></div>');
  updatePlaylistPreview();
}
function updatePlaylistPreview() {
  const form = $('#playlist-form'); if (!form) return;
  const values = Object.fromEntries(new FormData(form));
  const p = form.dataset.edit === 'true' ? model.playlists.find(p => p.id === playlistId) : null;
  $('#playlist-cover-preview').innerHTML = playlistArt({ ...p, ...playlistAppearance(values), title: String(values.title || 'Playlist'), tracks: p?.tracks || draftPlaylistTracks });
  form.querySelectorAll('fieldset').forEach(el => el.hidden = values.coverStyle !== 'symbol'); icons();
}
function playlistAdd() {
  const p = model.playlists.find(p => p.id === playlistId);
  const tracks = mergeTracks([...libraryTracks(model), ...ready(), ...model.history, ...results]).filter(t => !p.tracks.some(x => sameTrack(x, t)));
  modal('Adicionar músicas', tracks.length ? `<form id="playlist-tracks"><div class="selection-tools"><label class="field">${icon('search')}<input id="playlist-filter" type="search" aria-label="Buscar músicas para adicionar" placeholder="Música ou artista"></label><div class="selection-count"><label><input id="select-playlist-visible" type="checkbox">Selecionar visíveis</label><small id="playlist-selection-count">0 selecionadas</small></div></div>${tracks.map(t => `<label class="selection-row" data-track="${esc(t.id)}"><input type="checkbox" name="tracks" value="${esc(t.id)}">${art(t)}<span>${esc(t.title)}<small>${esc(t.artist)}</small></span></label>`).join('')}<div class="selection-submit"><button type="submit" class="text-button primary full" disabled>${icon('plus')}Adicionar selecionadas</button></div></form>` : empty('music-2', 'Nenhuma música disponível', '', button('search', 'go-search', 'Buscar músicas'), true));
}
function updatePlaylistSelection() {
  const form = $('#playlist-tracks'); if (!form) return;
  const count = form.querySelectorAll('input[name=tracks]:checked').length;
  const visible = [...form.querySelectorAll('.selection-row:not([hidden]) input')];
  const selectedVisible = visible.filter(input => input.checked).length;
  $('#playlist-selection-count').textContent = `${count} selecionadas`;
  form.querySelector('[type=submit]').disabled = count === 0;
  $('#select-playlist-visible').checked = visible.length > 0 && selectedVisible === visible.length;
  $('#select-playlist-visible').indeterminate = selectedVisible > 0 && selectedVisible < visible.length;
}
function radioPreferences() {
  modal('Preferências do rádio', model.radioExcluded.length ? model.radioExcluded.map(track => `<div class="radio-excluded-row">${art(track)}${trackCopy(track)}${ib('undo-2', 'allow-radio-track', `Voltar a recomendar ${track.title}`, `data-track="${esc(track.id)}"`)}</div>`).join('') : empty('radio', 'Todas as músicas permitidas', '', '', true));
}
function trackMenu(track, index = -1, context = '') {
  if (!track) return;
  menuTrack = track; menuIndex = index; menuContext = context;
  menuSnapshot = (context === 'queue' ? current.queue : context === 'playlist' ? model.playlists.find(p => p.id === playlistId)?.tracks || [] : []).map(t => ({ id: t.id, url: t.url }));
  const dl = downloads.find(t => sameTrack(t, track));
  const mi = (name, label, action, attrs = '') => `<button class="menu-item" data-action="${action}" ${attrs}>${icon(name)}${esc(label)}</button>`;
  const section = (title, html, open) => `<details class="menu-section" ${open ? 'open' : ''}><summary>${esc(title)}${icon('chevron-down')}</summary>${html}</details>`;
  modal('Música', `<div class="sheet-track">${art(track)}${trackCopy(track)}</div>`
    + `<div class="track-quick-actions">${ib('heart', 'favorite', favorite(track) ? 'Remover das favoritas' : 'Favoritar', `aria-pressed="${favorite(track)}"`, favorite(track) ? 'active' : '')}${ib('list-end', 'enqueue', 'Adicionar à fila')}${ib(dl?.status === 'ready' ? 'circle-check' : 'download', 'download', dl?.status === 'ready' ? 'Já baixada' : 'Baixar música', dl?.status === 'ready' ? 'disabled' : '')}${ib('info', 'track-info', 'Informações da música')}</div>`
    + section('Biblioteca', mi('library', savedTrack(track) ? 'Remover da biblioteca' : 'Salvar na biblioteca', 'save-track')
    + mi('list-plus', 'Adicionar a uma playlist', 'choose-playlist')
    + (dl ? mi(dl.status === 'ready' ? 'trash-2' : 'x', dl.status === 'ready' ? 'Remover download' : 'Cancelar download', 'remove-download') : ''), !['queue', 'playlist'].includes(context))
    + section('Reprodução', mi('list-start', 'Tocar a seguir', 'enqueue-next')
    + mi('radio', 'Iniciar Infinite Radio', 'track-radio')
    + mi(radioExcluded(track) ? 'undo-2' : 'thumbs-down', radioExcluded(track) ? 'Voltar a recomendar no rádio' : 'Não recomendar no rádio', 'exclude-radio-track'), false)
    + (context === 'queue' ? section('Organizar', `${index > 0 ? mi('arrow-up', 'Subir na fila', 'queue-up') : ''}${index < current.queue.length - 1 ? mi('arrow-down', 'Descer na fila', 'queue-down') : ''}${mi('list-minus', 'Remover da fila', 'queue-remove')}`, true) : '')
    + (context === 'playlist' ? section('Organizar', `${index > 0 ? mi('arrow-up', 'Mover para cima', 'playlist-up') : ''}${index < menuSnapshot.length - 1 ? mi('arrow-down', 'Mover para baixo', 'playlist-down') : ''}${mi('list-minus', 'Remover da playlist', 'playlist-remove')}`, true) : ''));
}
function sourceLabel(track) {
  if (downloaded(track)) return 'No dispositivo';
  if (track?.source === 'youtube' || /(?:youtube\.com|youtu\.be)\//.test(track?.url || '')) return 'YouTube';
  try { return new URL(track.url).hostname; } catch { return 'Arquivo local'; }
}
function trackInfo() {
  const track = menuTrack, record = downloads.find(t => sameTrack(t, track)), value = available(track);
  const item = (title, value) => `<div><dt>${esc(title)}</dt><dd>${esc(value)}</dd></div>`;
  let origin = 'Arquivo importado';
  if (track.url) { try { origin = /(?:youtube\.com|youtu\.be)\//.test(track.url) ? 'YouTube' : new URL(track.url).hostname; } catch { origin = 'Áudio online'; } }
  modal('Informações da música', `<div class="sheet-track">${art(track)}${trackCopy(track)}</div><dl class="track-facts">`
    + item('Artista', track.artist) + item('Duração', value.duration ? duration(value.duration) : 'Não informada') + item('Origem', origin)
    + item('Disponibilidade', record?.status === 'ready' ? 'Pronta para ouvir offline' : record?.statusDetail || (record ? { queued: 'Download agendado', downloading: 'Baixando', failed: 'Download com falha' }[record.status] || 'Não baixada' : 'Não baixada'))
    + (record?.bytes ? item('Arquivo', size(record.bytes)) : '')
    + item('Nas playlists', model.playlists.filter(p => p.tracks.some(t => sameTrack(t, track))).map(p => p.title).join(', ') || 'Nenhuma')
    + '</dl>' + (track.url.startsWith('https://') ? button('copy', 'copy-track-link', 'Copiar link da música', '', 'full') : ''));
}
function assertMenuFresh(tracks) {
  if (!sameOccurrence(tracks, menuSnapshot, menuIndex)) { closeSheet(); throw new Error('A lista mudou. Abra as opções da música novamente.'); }
}
function showPlayer() { if (!current.queue.length) return toast('Escolha uma música primeiro.'); renderPlayer(true); if (!$('#player').open) $('#player').showModal(); if (model.settings.visualizer !== 'off') startVisualizer(() => current, () => model.settings); }
function renderPlayer(force = false) {
  const t = current.queue[current.index];
  const key = JSON.stringify([t?.id, t?.title, t?.artist, t?.thumbnail, downloaded(t)?.thumbnail, current.index, current.queue.length, current.canNext, current.playing, current.playWhenReady, current.buffering, current.error, current.repeat, current.shuffle, favorite(t), current.speed, current.sleepAt, current.sleepEnd, current.radio, current.radioError, current.radioLoading, current.recovering, !!downloaded(t)]);
  if (!force && key === playerKey) return updateProgress();
  playerKey = key;
  const mini = $('#mini');
  mini.hidden = !t; document.body.classList.toggle('has-player', !!t);
  if (!t) { if ($('#player').open) $('#player').close(); return; }
  const loading = current.buffering && current.playWhenReady !== false;
  const status = current.error ? 'Falha ao reproduzir' : loading ? 'Preparando áudio...' : t.artist;
  const toggleIcon = current.error ? 'rotate-cw' : loading ? 'loader-circle' : current.playing ? 'pause' : 'play';
  const hasNext = current.canNext ?? (current.radio || current.index < current.queue.length - 1 || current.repeat === 2 || (current.shuffle && current.queue.length > 1));
  mini.innerHTML = `<button class="track-main" data-action="open-player" aria-label="Abrir player">${art(t)}<span class="track-copy"><strong>${esc(t.title)}</strong><small>${esc(status)}</small></span></button>${ib(toggleIcon, 'toggle', current.playing ? 'Pausar' : 'Reproduzir', '', loading ? 'spin' : '')}${ib('skip-forward', 'next', 'Próxima música', hasNext ? '' : 'disabled')}<div class="mini-buffer"></div><div class="mini-progress"></div>`;
  if ($('#player').open || force) {
    $('#player').innerHTML = `<div class="player-header">${ib('chevron-down', 'close-player', 'Minimizar player')}<small>Reproduzindo agora</small>${ib('ellipsis', 'current-menu', 'Opções da música')}</div>${art(t, 'player-art')}<div class="player-info"><div><h2>${esc(t.title)}</h2><p>${esc(t.artist)}</p></div>${ib('heart', 'favorite-current', favorite(t) ? 'Desfavoritar' : 'Favoritar', '', favorite(t) ? 'active' : '')}</div><input class="seek" id="seek" type="range" min="0" max="${Math.max(1, current.duration)}" step="0.1" value="${current.position || 0}" aria-label="Posição da música"><div class="time-labels"><span id="elapsed">${duration(current.position)}</span><span id="total">${duration(current.duration)}</span></div><div class="player-controls">${ib('shuffle', 'shuffle', 'Reprodução aleatória', '', current.shuffle ? 'active' : '')}${ib('skip-back', 'previous', 'Música anterior')}${ib(toggleIcon, 'toggle', current.playing ? 'Pausar' : 'Reproduzir', '', `big-play ${current.buffering ? 'spin' : ''}`)}${ib('skip-forward', 'next', 'Próxima música')}${ib(current.repeat === 1 ? 'repeat-1' : 'repeat', 'repeat', current.repeat === 0 ? 'Repetição desativada' : current.repeat === 1 ? 'Repetir uma' : 'Repetir fila', '', current.repeat ? 'active' : '')}</div><div class="player-status">${esc(current.error || (current.buffering ? 'Preparando áudio...' : downloaded(t) ? 'Reprodução offline' : ''))}</div><div class="player-footer"><button data-action="current-download">${icon(downloaded(t) ? 'circle-check' : 'download')}<span>${downloaded(t) ? 'Baixada' : 'Baixar'}</span></button><button data-action="sleep">${icon('moon')}<span>Timer</span></button><button data-action="speed">${icon('gauge')}<span>${current.speed || 1}×</span></button><button data-action="player-queue">${icon('list-music')}<span>Fila</span></button></div>`;
  }
  if ($('#player').open || force) {
    const info = $('#player .player-info');
    $('#player [data-action=current-menu]').insertAdjacentHTML('beforebegin', ib('volume-2', 'volume', 'Volume do app'));
    $('#player .player-footer').insertAdjacentHTML('afterbegin', `<button data-action="radio-options" class="${current.radio ? 'active' : ''}" aria-label="Infinite Radio">${icon('radio')}<span>Rádio</span></button>`);
    const artwork = $('#player .player-art');
    $('#player .player-header').insertAdjacentHTML('afterend', `<div class="player-context"><span>${icon(downloaded(t) ? 'hard-drive' : 'globe')}${esc(sourceLabel(t))}</span><span>${current.index + 1} de ${current.queue.length}</span></div>`);
    $('#player [data-action=sleep] span').dataset.sleepLabel = '';
    $('#player [data-action=sleep]').classList.toggle('active', !!(current.sleepAt || current.sleepEnd));
    for (const [name, active] of [['shuffle', current.shuffle], ['repeat', !!current.repeat], ['favorite-current', favorite(t)]]) $('#player [data-action=' + name + ']').setAttribute('aria-pressed', String(!!active));
    const stage = document.createElement('div'); stage.className = 'player-stage';
    artwork.before(stage); stage.append(artwork, info);
    stage.insertAdjacentHTML('afterend', '<canvas id="audio-visual" class="audio-visual" aria-hidden="true"></canvas>');
    const statusLabel = $('#player .player-status');
    if (statusLabel) statusLabel.textContent = current.error || (current.recovering ? 'Reconectando áudio...' : loading ? 'Preparando áudio...' : current.sleepEnd ? 'Parar ao fim desta música' : current.radioError || (current.radio ? `Infinite Radio${current.radioOffline ? ' offline' : ''}` : downloaded(t) ? 'Reprodução offline' : ''));
    $('#player .time-labels').insertAdjacentHTML('beforeend', `<div class="seek-steps">${ib('rotate-ccw', 'seek-back', 'Voltar 10 segundos', '', 'seek-step')}${ib('rotate-cw', 'seek-forward', 'Avançar 10 segundos', '', 'seek-step')}</div>`);
  }
  if (!loading) document.querySelectorAll('#mini .spin,#player .spin').forEach(button => button.classList.remove('spin'));
  if ($('#player [data-action=next]')) $('#player [data-action=next]').disabled = !hasNext;
  icons(); updateProgress();
}
function updateProgress() {
  const timerLabel = $('[data-sleep-label]');
  if (timerLabel) timerLabel.textContent = current.sleepEnd ? 'Fim da faixa' : current.sleepAt ? duration(Math.max(0, (current.sleepAt - Date.now()) / 1000)) : 'Timer';
  const progress = $('.mini-progress'); if (progress) progress.style.width = `${Math.min(100, (current.position || 0) / (current.duration || 1) * 100)}%`;
  const buffered = $('.mini-buffer'); if (buffered) buffered.style.width = `${Math.min(100, (current.buffered || current.position || 0) / (current.duration || 1) * 100)}%`;
  const seek = $('#seek'); if (seek && document.activeElement !== seek) { seek.max = Math.max(1, current.duration); seek.value = current.position || 0; }
  if (seek) { seek.disabled = !current.duration; seek.setAttribute('aria-valuetext', `${duration(seek.value)} de ${duration(current.duration)}`); }
  document.querySelectorAll('.seek-step').forEach(button => button.disabled = !current.duration);
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
  const structural = rows => JSON.stringify(rows.map(t => [t.id, t.url, t.status, t.thumbnail, t.title, t.artist, t.duration, t.bytes]));
  const changed = structural(fresh) !== structural(downloads);
  downloads = fresh;
  readyTracks = fresh.filter(t => t.status === 'ready');
  for (const map of [readyIds, readyUrls, downloadIds, downloadUrls]) map.clear();
  for (const record of fresh) {
    if (!downloadIds.has(record.id)) downloadIds.set(record.id, record);
    if (record.url && !downloadUrls.has(record.url)) downloadUrls.set(record.url, record);
    if (record.status === 'ready') { if (!readyIds.has(record.id)) readyIds.set(record.id, record); if (record.url && !readyUrls.has(record.url)) readyUrls.set(record.url, record); }
  }
  if (changed) {
    const focused = document.activeElement?.id === 'library-filter';
    const selection = focused ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    if (tab === 'library' || tab === 'settings' || tab === 'search') render();
    if (focused && $('#library-filter')) { $('#library-filter').focus(); $('#library-filter').setSelectionRange(...selection); }
    renderPlayer();
  } else document.querySelectorAll('[data-row]').forEach(row => {
    const record = downloadRecord({ id: row.dataset.row, url: row.dataset.rowUrl });
    if (!record || record.status === 'ready') return;
    const progress = row.querySelector('progress'); if (progress) progress.value = record.progress || 0;
    const subtitle = row.querySelector('.track-copy small'); if (subtitle) subtitle.textContent = record.statusDetail || record.artist;
  });
}
async function download(track) {
  if (downloaded(track)) return toast('Esta música já está baixada.');
  if (offline() && !native) throw new Error('Conecte-se à internet para baixar.');
  if (!track.url) throw new Error('Importe este arquivo pelo botão de pasta.');
  closeSheet(); await permissions();
  await commands.download(track, !!model.settings.wifiOnly); await refreshDownloads(); toast('Download agendado.');
}
async function runSearch(value = searchTerm, refresh = false) {
  if (searching && value.trim() === searchTerm) return;
  const token = ++searchToken;
  searchTerm = value.trim().slice(0, 200); searchDraft = searchTerm; listLimit = 80;
  if (!searchTerm) { searching = false; results = []; searchError = ''; render(); return; }
  if (/^https:\/\//i.test(searchTerm)) { searching = false; results = []; searchCached = false; const link = searchTerm; searchTerm = ''; render(); return openLink(link); }
  if (offline()) { searching = false; render(); return; }
  model.searches = [searchTerm, ...model.searches.filter(q => q !== searchTerm)].slice(0, 8); save();
  const cached = refresh ? null : searchCache.get(searchTerm, provider);
  searchCached = cached !== null; searchError = '';
  if (cached !== null) { results = cached; searching = false; render(); return; }
  searching = true; results = []; render();
  const requestedTerm = searchTerm, requestedProvider = provider;
  let timeout;
  try {
    const result = await Promise.race([commands.search(requestedTerm, requestedProvider), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('A busca demorou demais. Tente novamente.')), 30000); })]);
    if (token === searchToken) { results = mergeTracks(result); searchCache.put(requestedTerm, requestedProvider, results); }
  } catch (e) { if (token === searchToken) searchError = e.message; }
  finally { clearTimeout(timeout); if (token === searchToken) { searching = false; if (tab === 'search') render(); } }
}
function openLink(value = '') {
  modal('Abrir link', `<form id="link-form"><label class="field">${icon('link')}<input type="url" name="url" value="${esc(value)}" placeholder="https://..." aria-label="Link da música" required></label><label class="field"><input type="text" name="title" placeholder="Nome da música" aria-label="Nome da música" maxlength="200"></label><button type="submit" class="text-button primary full">${icon('play')}Reproduzir</button></form>`);
}
async function toggleFavorite(track) {
  model.favorites = favorite(track) ? model.favorites.filter(t => !sameTrack(t, track)) : [cleanTrack(track), ...model.favorites]; save(); render(); renderPlayer(true);
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
    case 'open-artists': navigate(() => { playlistId = ''; artistId = ''; libraryTab = 'artists'; }, true); break;
    case 'open-artist': navigate(() => { artistId = el.dataset.id; query = ''; }, true); break;
    case 'back-artists': navigate(() => artistId = ''); break;
    case 'artist-playlist': newPlaylist(false, artist()?.tracks || [], artist()?.name || 'Artista'); break;
    case 'track-info': trackInfo(); break;
    case 'copy-track-link': await commands.copyText(menuTrack.url); toast('Link copiado.'); break;
    case 'cancel-search': searchToken++; searching = false; searchTerm = ''; results = []; searchError = ''; searchCached = false; render(); break;
    case 'refresh-search': await runSearch(searchTerm, true); break;
    case 'reset-search-filter': searchFilter = 'all'; listLimit = 80; render(); break;
    case 'undo': { const undo = undoAction; undoAction = null; clearTimeout(undoTimer); if (undo) { undo(); save(); render(); renderPlayer(true); await syncLibrary(); toast('Alteração desfeita.'); } break; }
    case 'settings-tab': navigate(() => settingsTab = el.dataset.value); break;
    case 'open-history': navigate(() => { libraryTab = 'history'; query = ''; }, true); break;
    case 'back-collections': navigate(() => { libraryTab = 'home'; artistId = ''; }); break;
    case 'start-selection': selectionMode = true; selectedIds.clear(); render(); break;
    case 'end-selection': resetSelection(); render(); break;
    case 'select-track': selectedIds.has(el.dataset.track) ? selectedIds.delete(el.dataset.track) : selectedIds.add(el.dataset.track); updateSelection(); break;
    case 'play-collection': case 'bulk-play': {
      const tracks = name === 'bulk-play' ? selectedTracks() : filterTracks(librarySelection(), query, sort);
      const p = model.playlists.find(p => p.id === playlistId);
      const playable = offline() || p?.offlineOnly ? tracks.filter(downloaded) : tracks;
      if (!playable.length) throw new Error('Nenhuma música desta seleção está disponível para tocar.');
      await play(playable, 0, !!p?.offlineOnly); await cmd('shuffle', 0); resetSelection(); render();
      if (playable.length < tracks.length) toast(`${playable.length} músicas offline na fila.`); break;
    }
    case 'bulk-playlist': chooseBulkPlaylist(); break;
    case 'bulk-new-playlist': newPlaylist(false, bulkTracks); break;
    case 'bulk-add-playlist': { const p = model.playlists.find(p => p.id === el.dataset.id); if (!p) break; p.tracks = mergeTracks([...p.tracks, ...bulkTracks]); save(); closeSheet(); resetSelection(); render(); await permissions(); await syncLibrary(); toast('Seleção adicionada à playlist.'); break; }
    case 'bulk-favorite': { const tracks = selectedTracks(); model.favorites = unique([...tracks.filter(track => !favorite(track)), ...model.favorites]); save(); resetSelection(); render(); renderPlayer(true); await permissions(); await syncLibrary(); toast(`${tracks.length} músicas favoritas.`); break; }
    case 'bulk-download': { const tracks = selectedTracks().filter(track => !downloaded(track) && track.url.startsWith('https://')); if (!tracks.length) return toast('As músicas disponíveis já estão baixadas.'); await permissions(); await commands.downloadBatch(tracks, model.settings.wifiOnly); resetSelection(); await refreshDownloads(); render(); toast(`${tracks.length} downloads agendados.`); break; }
    case 'bulk-menu': {
      bulkTracks = selectedTracks(); bulkContext = playlistId ? `playlist:${playlistId}` : libraryTab;
      const label = playlistId ? 'Remover da playlist' : libraryTab === 'favorites' ? 'Remover das favoritas' : libraryTab === 'history' ? 'Remover do histórico' : 'Remover da biblioteca';
      modal(`${bulkTracks.length} músicas`, button('library', 'bulk-save', 'Salvar na biblioteca', '', 'full') + button('plus', 'bulk-new-playlist', 'Criar playlist com a seleção', '', 'full') + button('list-minus', 'bulk-remove', label, '', 'full danger') + (libraryTab === 'downloads' && !playlistId ? button('trash-2', 'bulk-remove-downloads', 'Remover arquivos baixados', '', 'full danger') : '')); break;
    }
    case 'bulk-save': model.library = unique([...bulkTracks, ...model.library]); save(); closeSheet(); resetSelection(); render(); await permissions(); await syncLibrary(); toast('Seleção salva na biblioteca.'); break;
    case 'bulk-remove': confirm('Remover seleção?', `${bulkTracks.length} músicas serão removidas desta coleção. Os arquivos baixados serão mantidos.`, 'bulk-remove-confirm'); break;
    case 'bulk-remove-confirm': {
      let undo;
      if (bulkContext === 'history' || bulkContext === 'favorites') {
        const key = bulkContext; const removed = model[key].map((track, index) => ({ track, index })).filter(({ track }) => bulkTracks.some(item => sameTrack(item, track)));
        model[key] = model[key].filter(track => !bulkTracks.some(item => sameTrack(item, track)));
        undo = () => { for (const { track, index } of removed) if (!model[key].some(item => sameTrack(item, track))) model[key].splice(Math.min(index, model[key].length), 0, track); if (key === 'history') model.history = model.history.slice(0, 100); };
      } else {
        const target = bulkContext.startsWith('playlist:') ? { library: [], favorites: [], playlists: model.playlists.filter(p => p.id === bulkContext.slice(9)) } : model;
        const snapshot = removeLibraryTracks(target, bulkTracks); undo = () => restoreLibraryTracks(model, snapshot);
      }
      save(); closeSheet(); resetSelection(); render(); renderPlayer(true); await syncLibrary(); toast('Seleção removida. Arquivos mantidos.', undo); break;
    }
    case 'bulk-remove-downloads': confirm('Remover arquivos?', `${bulkTracks.length} músicas ficarão indisponíveis offline. As playlists serão mantidas. Esta exclusão não pode ser desfeita.`, 'bulk-remove-downloads-confirm'); break;
    case 'bulk-remove-downloads-confirm': { for (const track of bulkTracks) { const record = downloads.find(item => sameTrack(item, track)); if (record) await commands.removeDownload(record.id); } closeSheet(); resetSelection(); await refreshDownloads(); render(); toast('Arquivos removidos. Playlists mantidas.'); break; }
    case 'search-mode': searchMode = el.dataset.value; searchToken++; searching = false; listLimit = 80; render(); break;
    case 'resume-session': if (!current.playing) await cmd('play'); showPlayer(); break;
    case 'close-sheet': closeSheet(); break;
    case 'close-player': $('#player').close(); stopVisualizer(); break;
    case 'appearance': navigate(() => { appearanceOpen = true; appearanceTab = 'visual'; }, true); break;
    case 'back-settings': navigate(() => appearanceOpen = false); break;
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
    case 'go-downloads': case 'downloads-center': closeSheet(); navigate(() => { playlistId = ''; libraryTab = 'downloads'; downloadFilter = 'all'; query = ''; tab = 'library'; }, true); location.hash = 'library'; break;
    case 'library-tab': navigate(() => { libraryTab = el.dataset.value; query = ''; }); break;
    case 'download-filter': downloadFilter = el.dataset.value; resetSelection(); listLimit = 80; render(); break;
    case 'load-more-tracks': listLimit += 80; render(); break;
    case 'open-playlist': navigate(() => { playlistId = el.dataset.id; query = ''; }, true); break;
    case 'back-library': navigate(() => { playlistId = ''; query = ''; }); break;
    case 'new-playlist': newPlaylist(); break;
    case 'playlist-edit': newPlaylist(true); break;
    case 'playlist-add': playlistAdd(); break;
    case 'playlist-menu': { const p = model.playlists.find(p => p.id === playlistId); modal('Playlist', `${button('pencil', 'playlist-edit', 'Editar playlist', '', 'full')}${button(p.pinned ? 'pin-off' : 'pin', 'playlist-pin', p.pinned ? 'Desafixar playlist' : 'Fixar playlist', '', 'full')}${button('copy', 'playlist-duplicate', 'Duplicar playlist', '', 'full')}${button('download', 'playlist-download', 'Baixar músicas', '', 'full')}${button('trash-2', 'playlist-delete', 'Excluir playlist', '', 'full danger')}`); break; }
    case 'playlist-pin': { const p = model.playlists.find(p => p.id === playlistId); p.pinned = !p.pinned; save(); closeSheet(); render(); toast(p.pinned ? 'Playlist fixada no topo.' : 'Playlist desafixada.'); break; }
    case 'playlist-duplicate': { const p = model.playlists.find(p => p.id === playlistId); const copy = { ...p, id: crypto.randomUUID(), title: `${p.title.slice(0, 91)} (cópia)`, tracks: unique(p.tracks) }; model.playlists.push(copy); playlistId = copy.id; save(); closeSheet(); render(); await syncLibrary(); toast('Playlist duplicada.'); break; }
    case 'playlist-delete': confirm('Excluir playlist?', 'Os arquivos baixados serão mantidos.', 'playlist-delete-confirm'); break;
    case 'playlist-delete-confirm': { const index = model.playlists.findIndex(p => p.id === playlistId); const removed = model.playlists[index]; model.playlists.splice(index, 1); playlistId = ''; libraryTab = 'home'; save(); closeSheet(); render(); await syncLibrary(); toast('Playlist excluída.', () => { if (!model.playlists.some(p => p.id === removed.id)) model.playlists.splice(index, 0, removed); }); break; }
    case 'playlist-play': case 'playlist-shuffle': { const p = model.playlists.find(p => p.id === playlistId); const tracks = p.offlineOnly || offline() ? p.tracks.filter(downloaded) : p.tracks; await play(tracks, name === 'playlist-shuffle' ? Math.floor(Math.random() * tracks.length) : 0, p.offlineOnly); await cmd('shuffle', name === 'playlist-shuffle' ? 1 : 0); break; }
    case 'playlist-download': { const p = model.playlists.find(p => p.id === playlistId); const tracks = p.tracks.filter(track => !downloaded(track) && track.url.startsWith('https://')); if (!tracks.length) return toast('As músicas disponíveis já estão baixadas.'); await permissions(); closeSheet(); await commands.downloadBatch(tracks, model.settings.wifiOnly); await refreshDownloads(); toast(`${tracks.length} downloads desta playlist agendados.`); break; }
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
      const snapshot = removeLibraryTracks(model, [menuTrack]); save(); closeSheet(); render(); renderPlayer(true); await syncLibrary(); toast('Música removida. Arquivo mantido.', () => restoreLibraryTracks(model, snapshot)); break;
    }
    case 'track-radio': await startRadio(menuTrack); break;
    case 'radio-options': modal('Infinite Radio', `${current.radio ? button('square', 'radio-stop', 'Encerrar rádio', '', 'full') : button('radio', 'radio-start', 'Iniciar com esta música', '', 'full')}${button('hard-drive', 'radio-offline', 'Rádio das músicas baixadas', ready().length < 2 ? 'disabled' : '', 'full')}`); break;
    case 'radio-start': await startRadio(); break;
    case 'radio-offline': await startRadio(downloaded(current.queue[current.index]) || ready()[0], true); break;
    case 'radio-stop': await cmd('radio-stop'); closeSheet(); render(); break;
    case 'radio-retry': await cmd('radio-retry'); break;
    case 'radio-preferences': radioPreferences(); break;
    case 'exclude-radio-track': {
      if (!radioExcluded(menuTrack) && model.radioExcluded.length >= 500) throw new Error('Remova uma preferência antiga do rádio antes de adicionar outra.');
      model.radioExcluded = radioExcluded(menuTrack) ? model.radioExcluded.filter(track => track.id !== menuTrack.id && (!track.url || track.url !== menuTrack.url)) : [...model.radioExcluded, cleanTrack(menuTrack)];
      save(); closeSheet(); await commands.radioExclusions(model.radioExcluded); toast(radioExcluded(menuTrack) ? 'Esta música não será recomendada pelo rádio.' : 'Música permitida no rádio.'); if (tab === 'settings') render(); break;
    }
    case 'allow-radio-track': model.radioExcluded = model.radioExcluded.filter(track => track.id !== el.dataset.track); save(); await commands.radioExclusions(model.radioExcluded); radioPreferences(); if (tab === 'settings') render(); break;
    case 'enqueue': case 'enqueue-next': { const track = available(menuTrack); if (offline() && !downloaded(track)) throw new Error('Esta música não está baixada.'); await commands.append({ track, next: name === 'enqueue-next' }); closeSheet(); toast('Adicionada à fila.'); break; }
    case 'choose-playlist': { const eligible = model.playlists; modal('Adicionar à playlist', eligible.map(p => `<button class="menu-item" data-action="add-to-playlist" data-id="${esc(p.id)}">${icon('list-plus')}${esc(p.title)}</button>`).join('') + button('plus', 'new-playlist-from-track', 'Criar playlist com esta música', '', 'full')); break; }
    case 'new-playlist-from-track': newPlaylist(false, [menuTrack]); break;
    case 'add-to-playlist': { const p = model.playlists.find(p => p.id === el.dataset.id); if (!p) break; p.tracks = mergeTracks([...p.tracks, menuTrack]); save(); closeSheet(); render(); await permissions(); await syncLibrary(); toast('Adicionada à playlist.'); break; }
    case 'playlist-remove': case 'playlist-up': case 'playlist-down': { const p = model.playlists.find(p => p.id === playlistId); assertMenuFresh(p?.tracks || []); const originalIndex = menuIndex; const [t] = p.tracks.splice(originalIndex, 1); if (name !== 'playlist-remove') p.tracks.splice(originalIndex + (name === 'playlist-up' ? -1 : 1), 0, t); save(); closeSheet(); render(); await syncLibrary(); if (name === 'playlist-remove') toast('Música removida da playlist.', () => { const target = model.playlists.find(item => item.id === p.id); if (target && !target.tracks.some(item => sameTrack(item, t))) target.tracks.splice(originalIndex, 0, t); }); break; }
    case 'queue-up': case 'queue-down': assertMenuFresh(current.queue); await commands.command({ action: 'move', value: menuIndex + (name === 'queue-up' ? -1 : 1), index: menuIndex, expectedQueue: menuSnapshot }); closeSheet(); break;
    case 'queue-remove': assertMenuFresh(current.queue); await commands.command({ action: 'remove', index: menuIndex, expectedQueue: menuSnapshot }); closeSheet(); break;
    case 'save-queue': newPlaylist(false, current.queue, 'Minha fila'); break;
    case 'queue-tools': modal('Organizar fila', button('list-start', 'queue-remove-played', 'Remover músicas anteriores', current.index ? '' : 'disabled', 'full') + button('copy-minus', 'queue-deduplicate', 'Remover repetidas a seguir', '', 'full') + button('list-minus', 'queue-clear-upcoming', 'Limpar próximas músicas', '', 'full')); break;
    case 'queue-remove-played': await cmd('remove-played'); closeSheet(); render(); toast('Anteriores removidas. Reprodução mantida.'); break;
    case 'queue-deduplicate': await cmd('deduplicate-upcoming'); closeSheet(); render(); toast('Repetidas a seguir removidas.'); break;
    case 'queue-clear-upcoming': confirm('Limpar próximas músicas?', 'A música atual continuará. O Infinite Radio será encerrado.', 'queue-clear-upcoming-confirm'); break;
    case 'queue-clear-upcoming-confirm': await cmd('clear-upcoming'); closeSheet(); render(); toast('Próximas removidas. Reprodução mantida.'); break;
    case 'clear-queue': confirm('Limpar a fila?', 'A reprodução será interrompida.', 'clear-queue-confirm'); break;
    case 'clear-queue-confirm': await cmd('clear'); closeSheet(); break;
    case 'download': await download(menuTrack); break;
    case 'retry-download': await download(find(el.dataset.track)); break;
    case 'cancel-download': { const result = await commands.cancelDownload(el.dataset.track); await refreshDownloads(); toast(result?.cancelled === false ? 'Esta música já terminou de baixar.' : 'Download cancelado.'); break; }
    case 'retry-failed-downloads': { const tracks = filterDownloads(downloads, 'failed').filter(track => track.url.startsWith('https://')); if (!tracks.length) break; await permissions(); await commands.downloadBatch(tracks, model.settings.wifiOnly); await refreshDownloads(); toast('Novas tentativas agendadas.'); break; }
    case 'cancel-pending-downloads': confirm('Cancelar downloads pendentes?', 'As músicas já baixadas serão mantidas.', 'cancel-pending-confirm'); break;
    case 'cancel-pending-confirm': { const pending = filterDownloads(downloads, 'pending'); for (const track of pending) await commands.cancelDownload(track.id); closeSheet(); await refreshDownloads(); toast('Downloads pendentes cancelados.'); break; }
    case 'current-download': await download(current.queue[current.index]); break;
    case 'remove-download': confirm('Remover arquivo?', 'A música ficará indisponível offline. As playlists serão mantidas.', 'remove-download-confirm'); break;
    case 'remove-download-confirm': { const record = downloads.find(track => sameTrack(track, menuTrack)); if (record) await commands.removeDownload(record.id); await refreshDownloads(); closeSheet(); break; }
    case 'import': { closeSheet(); toast('Selecione seus arquivos de áudio.'); const imported = await commands.importAudio(); await refreshDownloads(); if (imported.tracks?.length) { libraryTab = 'downloads'; playlistId = ''; query = ''; downloadFilter = 'all'; listLimit = 80; location.hash = 'library'; tab = 'library'; render(); toast(`${imported.tracks.length} músicas importadas.`); } break; }
    case 'toggle': await cmd(current.playing || (current.buffering && current.playWhenReady !== false) ? 'pause' : 'play'); break;
    case 'retry-play': await cmd('play'); break;
    case 'next': case 'previous': await cmd(name); break;
    case 'seek-back': case 'seek-forward': if (current.duration) await cmd('seek', Math.max(0, Math.min(current.duration, current.position + (name === 'seek-back' ? -10 : 10)))); break;
    case 'shuffle': await cmd('shuffle', current.shuffle ? 0 : 1); break;
    case 'repeat': await cmd('repeat', ((current.repeat || 0) + 1) % 3); break;
    case 'player-queue': $('#player').close(); stopVisualizer(); location.hash = 'queue'; break;
    case 'sleep': modal('Temporizador', `<form id="sleep-form" class="custom-timer"><label class="field"><input type="number" name="minutes" min="1" max="240" value="20" aria-label="Minutos do temporizador" required><span>min</span></label><button type="submit" class="icon-button primary" aria-label="Ativar temporizador personalizado">${icon('check')}</button></form>` + [-1, 0, 15, 30, 45, 60, 90].map(n => `<button class="menu-item" data-action="set-sleep" data-value="${n}">${icon(n ? 'moon' : 'moon-star')}${n === -1 ? 'Ao fim desta música' : n ? `${n} minutos` : 'Desativado'}</button>`).join('')); break;
    case 'set-sleep': await cmd('sleep', Number(el.dataset.value)); closeSheet(); if (tab === 'settings') render(); toast(Number(el.dataset.value) ? 'Temporizador ativado.' : 'Temporizador desativado.'); break;
    case 'speed': modal('Velocidade', `<div class="slider-row"><span>0,5×</span><input id="speed-slider" type="range" min="0.5" max="2" step="0.05" value="${current.speed || 1}" aria-label="Velocidade"><span>2×</span></div><p class="player-status" id="speed-value">${current.speed || 1}×</p>${button('rotate-ccw', 'reset-speed', 'Restaurar 1×', '', 'full')}`); break;
    case 'reset-speed': await cmd('speed', 1); closeSheet(); render(); break;
    case 'volume': modal('Volume do app', `<div class="slider-row">${icon('volume-x')}<input id="volume-slider" type="range" min="0" max="1" step="0.01" value="${current.volume ?? 1}" aria-label="Volume do app">${icon('volume-2')}</div><p class="player-status" id="volume-value">${Math.round((current.volume ?? 1) * 100)}%</p>${button('volume-2', 'reset-volume', 'Restaurar 100%', '', 'full')}`); break;
    case 'reset-volume': clearTimeout(volumeTimer); await cmd('volume', 1); closeSheet(); if (tab === 'settings') render(); break;
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
    case 'export': await commands.exportBackup(JSON.stringify(publicBackup(model), null, 2)); break;
    case 'restore': { const value = await commands.importBackup(); if (!value) break; const backup = validateBackup(JSON.parse(value)); model.library = unique([...model.library, ...backup.library]); model.favorites = unique([...model.favorites, ...backup.favorites]); model.playlists = [...new Map([...model.playlists, ...backup.playlists].map(p => [p.id, p])).values()]; model.history = unique([...model.history, ...backup.history]).slice(0, 100); model.radioExcluded = unique([...model.radioExcluded, ...backup.radioExcluded]).slice(0, 500); model.settings = { ...model.settings, ...backup.settings }; applyAppearance(); await commands.radioExclusions(model.radioExcluded); await syncLibrary(); toast('Backup restaurado. Seus arquivos locais foram mantidos.'); break; }
    case 'clear-history': confirm('Limpar histórico?', 'A biblioteca e as playlists serão mantidas.', 'clear-history-confirm'); break;
    case 'clear-history-confirm': { const removed = model.history; model.history = []; save(); closeSheet(); render(); toast('Histórico limpo.', () => { model.history = unique([...model.history, ...removed]).slice(0, 100); }); break; }
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
  const name = el.dataset.action;
  const key = ['favorite', 'favorite-current'].includes(name) ? 'favorite' : name;
  actionGate.run(key, async () => {
    el.setAttribute('aria-busy', 'true');
    try { await action(name, el); } finally { el.removeAttribute('aria-busy'); }
  }).catch(e => toast(e.message || 'Não foi possível concluir.'));
});
document.addEventListener('submit', event => {
  event.preventDefault();
  const form = event.target; const data = new FormData(form);
  formGate.run(form.id === 'search-form' ? Symbol('search') : form.id, async () => {
    form.setAttribute('aria-busy', 'true');
    try {
    if (form.id === 'search-form') { if (searchMode === 'local') { localSearch = $('#search-input').value; render(); } else { searchTerm = $('#search-input').value; await runSearch(); } }
    if (form.id === 'sleep-form') { const minutes = Number(data.get('minutes')); if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) throw new Error('Escolha de 1 a 240 minutos.'); await commands.command({ action: 'sleep', value: minutes }); closeSheet(); toast(`Temporizador: ${minutes} minutos.`); }
    if (form.id === 'playlist-form') {
      const title = String(data.get('title')).trim(); if (!title) throw new Error('Dê um nome à playlist.');
      const p = form.dataset.edit === 'true' ? model.playlists.find(p => p.id === playlistId) : { id: crypto.randomUUID(), tracks: unique(draftPlaylistTracks) };
      p.title = title; p.offlineOnly = data.has('offline'); Object.assign(p, playlistAppearance(Object.fromEntries(data)));
      if (form.dataset.edit !== 'true') model.playlists.push(p);
      resetSelection(); playlistId = p.id; draftPlaylistTracks = []; query = ''; tab = 'library'; location.hash = 'library'; save(); closeSheet(); render(); window.scrollTo(0, 0); await syncLibrary();
    }
    if (form.id === 'playlist-tracks') {
      const p = model.playlists.find(p => p.id === playlistId); const tracks = data.getAll('tracks').map(find).filter(Boolean);
      p.tracks = mergeTracks([...p.tracks, ...tracks]); save(); closeSheet(); render(); await permissions(); await syncLibrary();
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
    } finally { form.removeAttribute('aria-busy'); }
  }).catch(e => toast(e.message));
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.id === 'artist-search') { artistQuery = el.value; $('#artist-rows').innerHTML = artistRows(); icons(); }
  if (el.id === 'search-input' && searchMode === 'online') searchDraft = el.value;
  if (el.id === 'playlist-search') { playlistQuery = el.value; $('#playlist-grid-container').innerHTML = playlistGrid(); icons(); }
  if (el.id === 'search-input' && searchMode === 'local') { localSearch = el.value; listLimit = 80; $('#local-search-results').innerHTML = localResults(); icons(); }
  if (el.id === 'volume-slider') { $('#volume-value').textContent = `${Math.round(el.value * 100)}%`; clearTimeout(volumeTimer); volumeTimer = setTimeout(() => commands.command({ action: 'volume', value: Number(el.value) }).catch(e => toast(e.message)), 60); }
  if (el.id === 'library-filter') { query = el.value; listLimit = 80; const matches = filterTracks(librarySelection(), query, sort); $('#filtered-list').innerHTML = matches.length ? list(matches, playlistId ? 'playlist' : libraryTab === 'downloads' ? 'downloads' : 'list') : empty('search', 'Nenhuma música encontrada', '', '', true); updateSelection(); icons(); }
  if (el.id === 'playlist-filter') { const matches = new Set(filterTracks([...$('#playlist-tracks').querySelectorAll('.selection-row')].map(row => find(row.dataset.track)), el.value).map(track => track.id)); $('#playlist-tracks').querySelectorAll('.selection-row').forEach(row => row.hidden = !matches.has(row.dataset.track)); updatePlaylistSelection(); }
  if (el.id === 'theme-filter') { themeQuery = el.value; filterThemes(); }
  if (el.dataset.color) { model.settings[el.dataset.color] = el.value; save(); theme(); }
  if (el.closest('#playlist-form')) updatePlaylistPreview();
  if (el.id === 'speed-slider') $('#speed-value').textContent = `${el.value}×`;
  if (el.id === 'seek') $('#elapsed').textContent = duration(el.value);
});
document.addEventListener('change', event => {
  const el = event.target;
  (async () => {
    if (el.dataset.selectTrack) { el.checked ? selectedIds.add(el.dataset.selectTrack) : selectedIds.delete(el.dataset.selectTrack); updateSelection(); }
    if (el.id === 'select-all-tracks') { for (const track of filterTracks(librarySelection(), query, sort)) el.checked ? selectedIds.add(track.id) : selectedIds.delete(track.id); updateSelection(); }
    if (el.id === 'playlist-sort') { playlistSort = el.value; $('#playlist-grid-container').innerHTML = playlistGrid(); icons(); }
    if (el.id === 'search-filter') { searchFilter = el.value; listLimit = 80; render(); }
    if (el.id === 'volume-slider') { clearTimeout(volumeTimer); await commands.command({ action: 'volume', value: Number(el.value) }); }
    if (el.dataset.setting) {
      model.settings[el.dataset.setting] = el.checked; applyAppearance();
      if (['autoDownload', 'wifiOnly'].includes(el.dataset.setting)) { if (model.settings.autoDownload) await permissions(); await syncLibrary(); }
      if (el.dataset.setting === 'offline' && el.checked && current.radio && !current.radioOffline) await commands.command({ action: 'radio-stop' });
    }
    if (el.dataset.preference) { model.settings[el.dataset.preference] = el.dataset.preference === 'radius' ? Number(el.value) : el.value; applyAppearance(); }
    if (el.dataset.color) { model.settings[el.dataset.color] = el.value; applyAppearance(); }
    if (el.closest('#playlist-form')) updatePlaylistPreview();
    if (el.id === 'select-playlist-visible') { $('#playlist-tracks').querySelectorAll('.selection-row:not([hidden]) input').forEach(input => input.checked = el.checked); updatePlaylistSelection(); }
    if (el.closest('#playlist-tracks')) updatePlaylistSelection();
    if (el.id === 'provider') { provider = el.value; if (searchTerm) await runSearch(); }
    if (el.id === 'sort') { sort = el.value; render(); }
    if (el.id === 'seek') await commands.command({ action: 'seek', value: Number(el.value) });
    if (el.id === 'speed-slider') await commands.command({ action: 'speed', value: Number(el.value) });
  })().catch(e => toast(e.message));
});
document.addEventListener('error', event => { if (event.target instanceof HTMLImageElement && !event.target.src.endsWith('/icon.ico')) event.target.src = './icon.ico'; }, true);
$('#player').addEventListener('close', stopVisualizer);
$('#sheet').addEventListener('close', () => { if (sheetOpener?.isConnected) sheetOpener.focus({ preventScroll: true }); });
window.addEventListener('hashchange', route);
const connectionChanged = () => { render(); renderPlayer(); };
window.addEventListener('online', connectionChanged); window.addEventListener('offline', connectionChanged);
window.fluxoBack = () => { if ($('#sheet').open) closeSheet(); else if ($('#player').open) $('#player').close(); else if (selectionMode) { resetSelection(); render(); } else if (appearanceOpen && tab === 'settings') navigate(() => appearanceOpen = false); else if (playlistId && tab === 'library') navigate(() => playlistId = ''); else if (artistId && tab === 'library') navigate(() => artistId = ''); else if (['history', 'artists'].includes(libraryTab) && tab === 'library') navigate(() => libraryTab = 'home'); else if (tab !== 'library') location.hash = 'library'; else return false; return true; };
window.addEventListener('unhandledrejection', event => { toast(event.reason?.message || 'Ocorreu um erro inesperado.'); });
theme(); route();
await commands.init(data => {
  const playingChanged = data.playing !== current.playing;
  const settingsChanged = ['volume', 'speed', 'sleepAt', 'sleepEnd', 'eqPreset'].some(key => data[key] !== current[key]);
  const changed = JSON.stringify(data.queue) !== JSON.stringify(current.queue) || data.index !== current.index || data.error !== current.error || data.radio !== current.radio || data.radioLoading !== current.radioLoading || data.radioError !== current.radioError;
  current = data;
  const track = current.queue[current.index];
  if (current.playing && track && historyId !== track.id) { historyId = track.id; model.history = unique([track, ...model.history]).slice(0, 100); save(); }
  if (changed && tab === 'queue') render();
  if (changed && tab === 'library' && libraryTab === 'home' && !playlistId) render();
  else if (playingChanged && $('#resume-slot')) { $('#resume-slot').innerHTML = resumeStrip(); icons(); }
  if (settingsChanged && tab === 'settings' && settingsTab === 'audio' && !appearanceOpen) render();
  document.querySelectorAll('[data-row]').forEach(row => row.classList.toggle('playing', row.hasAttribute('data-queue-index') ? Number(row.dataset.queueIndex) === current.index : sameTrack({ id: row.dataset.row, url: row.dataset.rowUrl }, track)));
  renderPlayer();
}).catch(e => toast(e.message));
await commands.radioExclusions(model.radioExcluded).catch(e => toast(e.message));
await refreshDownloads().catch(e => toast(e.message));
await syncLibrary().catch(e => toast(`Downloads pendentes: ${e.message}`));
await commands.migrateOldDownloads(title => toast(`Recuperando download: ${title}`)).then(refreshDownloads).catch(e => toast(`Seus arquivos antigos foram preservados. Migração pendente: ${e.message}`));
setInterval(() => { if (!document.hidden) refreshDownloads().catch(() => {}); }, 2500);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) { refreshDownloads().catch(e => toast(e.message)); commands.command({ action: 'refresh' }).catch(() => {}); }
});
