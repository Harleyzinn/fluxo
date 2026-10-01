export const cleanTrack = value => {
  if (!value || typeof value !== 'object') return null;
  const url = typeof value.url === 'string' ? value.url : '';
  const id = String(value.originalId || value.id || url).slice(0, 500);
  if (!id) return null;
  return { id, title: String(value.title || 'Sem título').slice(0, 500), artist: String(value.artist || 'Arquivo local').slice(0, 500),
    url, thumbnail: String(value.thumbnail || ''), duration: Math.max(0, Number(value.duration) || 0),
    source: String(value.source || 'direct'), ...(value.localUri ? { localUri: String(value.localUri) } : {}) };
};
export const unique = tracks => [...new Map(tracks.map(cleanTrack).filter(Boolean).map(t => [t.id, t])).values()];
export const duration = n => { n = Math.max(0, Math.floor(Number(n) || 0)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; };
export const size = n => n > 1073741824 ? `${(n / 1073741824).toFixed(1)} GB` : `${Math.round((n || 0) / 1048576)} MB`;
export function filterTracks(tracks, query = '', sort = 'recent') {
  const normalize = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  let result = tracks.filter(t => normalize(`${t.title} ${t.artist}`).includes(normalize(query.trim())));
  if (sort === 'title' || sort === 'artist') result = [...result].sort((a, b) => a[sort].localeCompare(b[sort], 'pt-BR'));
  return result;
}
export function validateBackup(input) {
  if (!input || input.format !== 'fluxo-mobile' || input.version !== 2) throw new Error('Este arquivo não é um backup do Fluxo Mobile 2.');
  if (!Array.isArray(input.playlists) || !Array.isArray(input.favorites)) throw new Error('Backup incompleto.');
  if (input.playlists.length > 500 || input.favorites.length > 20000) throw new Error('Backup grande demais.');
  return { ...input, favorites: unique(input.favorites), history: unique(input.history || []).slice(0, 100),
    playlists: input.playlists.filter(p => p && Array.isArray(p.tracks)).map(p => ({ id: String(p.id || crypto.randomUUID()), title: String(p.title || 'Playlist').slice(0, 100), offlineOnly: !!p.offlineOnly, tracks: unique(p.tracks) })) };
}
export function loadModel(storage) {
  const read = (key, fallback) => { try { return JSON.parse(storage.getItem(key)) ?? fallback; } catch { return fallback; } };
  const current = read('fluxo_mobile_v2', null);
  return current || { favorites: unique(read('fluxo_mobile_favorites', [])), history: unique(read('fluxo_mobile_history', [])),
    playlists: read('fluxo_mobile_playlists', []).filter(p => p && Array.isArray(p.tracks)).map(p => ({ ...p, tracks: unique(p.tracks) })),
    searches: [], settings: { theme: storage.getItem('fluxo_mobile_theme') || 'fluxobug', wifiOnly: false, offline: false, accent: '#a5f060' } };
}
export function publicBackup(model) {
  const strip = tracks => unique(tracks).map(({ localUri, ...t }) => t);
  return { format: 'fluxo-mobile', version: 2, exportedAt: new Date().toISOString(), favorites: strip(model.favorites),
    history: strip(model.history), playlists: model.playlists.map(p => ({ ...p, tracks: strip(p.tracks) })), settings: model.settings };
}
