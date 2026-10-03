import { normalizeSettings, playlistAppearance } from './appearance.js';
export const cleanTrack = value => {
  if (!value || typeof value !== 'object') return null;
  const url = typeof value.url === 'string' ? value.url : '';
  const id = String(value.originalId || value.id || url).slice(0, 500);
  if (!id) return null;
  return { id, title: String(value.title || 'Sem título').slice(0, 500), artist: String(value.artist || 'Arquivo local').slice(0, 500),
    url, thumbnail: String(value.thumbnail || ''), duration: Number.isFinite(Number(value.duration)) ? Math.max(0, Number(value.duration)) : 0,
    source: String(value.source || 'direct'), ...(value.localUri ? { localUri: String(value.localUri) } : {}) };
};
export const unique = tracks => [...new Map((Array.isArray(tracks) ? tracks : []).map(cleanTrack).filter(Boolean).map(t => [t.id, t])).values()];
export const sameTrack = (a, b) => !!a && !!b && (!!a.id && a.id === b.id || !!a.url && a.url === b.url);
export const withDownload = (track, record) => record ? { ...track, localUri: record.localUri, thumbnail: record.thumbnail || track.thumbnail, duration: track.duration || record.duration || 0 } : { ...track };
export function removeLibraryTracks(model, tracks) {
  const snapshot = { library: [], favorites: [], playlists: [] };
  const ids = new Set(tracks.map(track => track.id).filter(Boolean)), urls = new Set(tracks.map(track => track.url).filter(Boolean));
  const matches = track => ids.has(track.id) || !!track.url && urls.has(track.url);
  const remove = rows => { const removed = [], kept = []; rows.forEach((track, index) => { if (matches(track)) removed.push({ track, index }); else kept.push(track); }); return { kept, removed }; };
  for (const key of ['library', 'favorites']) { const result = remove(model[key] || []); model[key] = result.kept; snapshot[key] = result.removed; }
  for (const playlist of model.playlists || []) { const result = remove(playlist.tracks); playlist.tracks = result.kept; if (result.removed.length) snapshot.playlists.push({ id: playlist.id, removed: result.removed }); }
  return snapshot;
}
export function restoreLibraryTracks(model, snapshot) {
  const restore = (rows, removed) => { for (const { track, index } of removed) if (!rows.some(item => sameTrack(item, track))) rows.splice(Math.min(index, rows.length), 0, track); };
  for (const key of ['library', 'favorites']) restore(model[key], snapshot[key]);
  for (const { id, removed } of snapshot.playlists) { const playlist = model.playlists.find(item => item.id === id); if (playlist) restore(playlist.tracks, removed); }
}
export const libraryTracks = model => unique([...(model.library || []), ...(model.favorites || []), ...(model.playlists || []).flatMap(p => p.tracks || [])]);
export const publicTracks = tracks => unique(tracks).map(({ localUri, ...track }) => ({ ...track, url: track.url.startsWith('https://') ? track.url : '', thumbnail: track.thumbnail.startsWith('https://') ? track.thumbnail : '' }));
export const filterDownloads = (tracks, status = 'all') => tracks.filter(track => status === 'pending' ? ['queued', 'downloading'].includes(track.status) : status === 'all' || track.status === status);
export function downloadStats(tracks) {
  return { ready: filterDownloads(tracks, 'ready').length, pending: filterDownloads(tracks, 'pending').length, failed: filterDownloads(tracks, 'failed').length,
    bytes: filterDownloads(tracks, 'ready').reduce((total, track) => total + (Number.isFinite(Number(track.bytes)) ? Math.max(0, Number(track.bytes)) : 0), 0) };
}
export const duration = n => { n = Number.isFinite(Number(n)) ? Math.max(0, Math.floor(Number(n))) : 0; return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
export const size = n => {
  n = Number.isFinite(Number(n)) ? Math.max(0, Number(n)) : 0;
  const [divisor, unit] = n >= 1073741824 ? [1073741824, 'GB'] : n >= 1048576 ? [1048576, 'MB'] : n >= 1024 ? [1024, 'KB'] : [1, 'B'];
  return `${(n / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${unit}`;
};
export function filterTracks(tracks, query = '', sort = 'recent') {
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let result = tracks.filter(t => normalize(`${t.title} ${t.artist}`).includes(normalize(query.trim())));
  if (sort === 'title' || sort === 'artist') result = [...result].sort((a, b) => a[sort].localeCompare(b[sort], 'pt-BR'));
  return result;
}
export function filterPlaylists(playlists, query = '', sort = 'recent') {
  const normalize = value => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const result = playlists.filter(playlist => normalize(playlist.title).includes(normalize(query.trim())));
  return result.sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || (sort === 'title' ? a.title.localeCompare(b.title, 'pt-BR') : 0));
}
export function validateBackup(input) {
  if (!input || input.format !== 'fluxo-mobile' || input.version !== 2) throw new Error('Este arquivo não é um backup do Fluxo Mobile 2.');
  if (!Array.isArray(input.playlists) || !Array.isArray(input.favorites)) throw new Error('Backup incompleto.');
  if (input.playlists.length > 500 || input.favorites.length > 20000) throw new Error('Backup grande demais.');
  if (input.library && (!Array.isArray(input.library) || input.library.length > 20000)) throw new Error('Biblioteca inválida.');
  if (input.radioExcluded && (!Array.isArray(input.radioExcluded) || input.radioExcluded.length > 500)) throw new Error('Preferências do rádio inválidas.');
  if (input.history && !Array.isArray(input.history)) throw new Error('Histórico inválido.');
  let total = (input.library?.length || 0) + input.favorites.length + (input.history?.length || 0);
  for (const playlist of input.playlists) {
    if (!Array.isArray(playlist?.tracks)) continue;
    if (playlist.tracks.length > 20000) throw new Error('Uma playlist do backup é grande demais.');
    total += playlist.tracks.length;
  }
  if (total > 100000 || (input.history?.length || 0) > 10000) throw new Error('Backup grande demais.');
  return { ...input, library: publicTracks(input.library || []), favorites: publicTracks(input.favorites), history: publicTracks(input.history || []).slice(0, 100), radioExcluded: publicTracks(input.radioExcluded || []),
    settings: normalizeSettings(input.settings),
    playlists: input.playlists.filter(p => p && Array.isArray(p.tracks)).map(p => ({ id: String(p.id || crypto.randomUUID()).slice(0, 500), title: String(p.title || 'Playlist').slice(0, 100), offlineOnly: !!p.offlineOnly, pinned: p.pinned === true, ...playlistAppearance(p), tracks: publicTracks(p.tracks) })) };
}
export function loadModel(storage) {
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const current = read('fluxo_mobile_v2', null);
  const value = current && typeof current === 'object' && !Array.isArray(current) ? current : {
    favorites: read('fluxo_mobile_favorites', []), history: read('fluxo_mobile_history', []),
    playlists: read('fluxo_mobile_playlists', []),
    settings: { theme: storage.getItem('fluxo_mobile_theme') || 'fluxobug', wifiOnly: false, offline: false, accent: '#a5f060' }
  };
  return { ...value, library: unique(value.library), favorites: unique(value.favorites), history: unique(value.history).slice(0, 100),
    radioExcluded: unique(value.radioExcluded).slice(0, 500),
    playlists: (Array.isArray(value.playlists) ? value.playlists : []).filter(p => p && Array.isArray(p.tracks)).map(p => ({ ...p,
      id: String(p.id || crypto.randomUUID()).slice(0, 500), title: String(p.title || 'Playlist').slice(0, 100), pinned: p.pinned === true, tracks: unique(p.tracks) })),
    searches: (Array.isArray(value.searches) ? value.searches : []).filter(value => typeof value === 'string' && value.trim()).slice(0, 8),
    settings: normalizeSettings(value.settings) };
}
export function publicBackup(model) {
  return { format: 'fluxo-mobile', version: 2, exportedAt: new Date().toISOString(), library: publicTracks(model.library || []), favorites: publicTracks(model.favorites),
    history: publicTracks(model.history), radioExcluded: publicTracks(model.radioExcluded || []), playlists: model.playlists.map(p => ({ ...p, tracks: publicTracks(p.tracks) })), settings: normalizeSettings(model.settings) };
}
