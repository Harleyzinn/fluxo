import { cleanTrack } from './model.js';

export const normalizeName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim().replace(/\s+/g, ' ');
export function mergeTracks(tracks) {
  const ids = new Set(), urls = new Set(), result = [];
  for (const value of tracks) {
    const track = cleanTrack(value);
    if (!track) continue;
    const duplicate = ids.has(track.id) || !!track.url && urls.has(track.url);
    ids.add(track.id); if (track.url) urls.add(track.url);
    if (!duplicate) result.push(track);
  }
  return result;
}
export function groupArtists(tracks, query = '') {
  const groups = new Map();
  for (const track of mergeTracks(tracks)) {
    const key = normalizeName(track.artist);
    if (!groups.has(key)) groups.set(key, { id: key, name: track.artist.trim(), tracks: [] });
    groups.get(key).tracks.push(track);
  }
  return [...groups.values()].filter(group => group.id.includes(normalizeName(query))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
export function collectionDuration(tracks) {
  const seconds = tracks.reduce((total, track) => total + (Number.isFinite(Number(track.duration)) ? Math.max(0, Number(track.duration)) : 0), 0);
  const minutes = Math.floor(seconds / 60);
  if (seconds && !minutes) return '< 1 min';
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}` : `${minutes} min`;
}
export const filterSearchResults = (tracks, filter, downloaded, favorite) => tracks.filter(track => filter === 'downloaded' ? downloaded(track) : filter === 'favorites' ? favorite(track) : filter === 'short' ? track.duration > 0 && track.duration < 240 : filter === 'long' ? track.duration >= 240 : true);

export class SearchCache {
  constructor({ limit = 8, ttl = 300000, now = Date.now } = {}) { this.entries = new Map(); this.limit = limit; this.ttl = ttl; this.now = now; }
  key(query, provider) { return `${provider}:${normalizeName(query)}`; }
  get(query, provider) {
    const key = this.key(query, provider), entry = this.entries.get(key);
    if (!entry) return null;
    this.entries.delete(key);
    if (this.now() - entry.created >= this.ttl) return null;
    this.entries.set(key, entry);
    return entry.tracks.map(track => ({ ...track }));
  }
  put(query, provider, tracks) {
    const key = this.key(query, provider);
    this.entries.delete(key);
    this.entries.set(key, { created: this.now(), tracks: mergeTracks(tracks).slice(0, 200) });
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value);
  }
}

export class ActionGate {
  constructor() { this.pending = new Set(); }
  async run(key, task) {
    if (this.pending.has(key)) return false;
    this.pending.add(key);
    try { await task(); return true; } finally { this.pending.delete(key); }
  }
}

// An open menu must never act on a different occurrence after the list changes.
export const sameOccurrence = (tracks, snapshot, index) => tracks.length === snapshot.length && tracks.every((track, i) => track.id === snapshot[i]?.id && track.url === snapshot[i]?.url) && index >= 0 && index < tracks.length;
