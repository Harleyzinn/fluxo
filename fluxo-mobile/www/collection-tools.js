import { sameTrack, libraryTracks, publicTracks, validateBackup, playlistDetails } from './model.js';
import { playlistAppearance } from './appearance.js';

export function metadataFields(fields) {
  const title = typeof fields.title === 'string' ? fields.title.trim() : '';
  const artist = typeof fields.artist === 'string' ? fields.artist.trim() : '';
  if (!title || !artist || title.length > 500 || artist.length > 500) throw new Error('Informe nome e artista com até 500 caracteres.');
  return { title, artist };
}
export function updateTrackCopies(tracks, track, fields) {
  for (const item of tracks) if (sameTrack(item, track)) Object.assign(item, fields);
}
export function updateModelMetadata(model, track, fields) {
  fields = metadataFields(fields);
  for (const key of ['library', 'favorites', 'history', 'radioExcluded']) updateTrackCopies(model[key] || [], track, fields);
  for (const playlist of model.playlists) updateTrackCopies(playlist.tracks, track, fields);
}
export function syncTargets(model) {
  const pinned = model.playlists.filter(p => p.autoDownload).flatMap(p => p.tracks);
  const ids = new Set(pinned.map(t => t.id)), urls = new Set(pinned.map(t => t.url).filter(Boolean));
  return libraryTracks(model).map(track => ({ ...track, _autoDownload: ids.has(track.id) || !!track.url && urls.has(track.url) }));
}
export function restoreTrackOrder(tracks, previousIds) {
  const current = new Map(tracks.map(track => [track.id, track])), restored = [];
  for (const id of previousIds) if (current.has(id)) { restored.push(current.get(id)); current.delete(id); }
  return [...restored, ...current.values()];
}
export function playlistFile(playlist) {
  return { format: 'fluxo-playlist', version: 1, exportedAt: new Date().toISOString(), playlist: {
    id: playlist.id, title: playlist.title, offlineOnly: !!playlist.offlineOnly, pinned: !!playlist.pinned,
    ...playlistDetails(playlist), ...playlistAppearance(playlist), tracks: publicTracks(playlist.tracks)
  } };
}
export function validatePlaylistFile(input) {
  if (input?.format !== 'fluxo-playlist' || input.version !== 1 || !input.playlist || !Array.isArray(input.playlist.tracks)) throw new Error('Este arquivo não é uma playlist do Fluxo.');
  return validateBackup({ format: 'fluxo-mobile', version: 2, playlists: [input.playlist], favorites: [] }).playlists[0];
}
