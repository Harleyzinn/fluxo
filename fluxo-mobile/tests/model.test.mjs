import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrack, unique, sameTrack, withDownload, removeLibraryTracks, restoreLibraryTracks, libraryTracks, filterDownloads, downloadStats, size, duration, filterTracks, filterPlaylists, validateBackup, loadModel, publicBackup } from '../www/model.js';
import { normalizeSettings, normalizeAppearance, playlistAppearance, contrastText, surfacePalette } from '../www/appearance.js';
import { mergeTracks, groupArtists, collectionDuration, SearchCache, ActionGate, filterSearchResults, sameOccurrence } from '../www/discovery.js';
import { metadataFields, updateModelMetadata, syncTargets, restoreTrackOrder, playlistFile, validatePlaylistFile } from '../www/collection-tools.js';
const track = { id: 'one', title: 'Canção', artist: 'Álvaro', duration: 65, url: 'https://example.com/a.mp3' };

test('metadata edits update every matching collection without changing audio identity', () => {
  const alias = { ...track, id: 'alias', localUri: 'private', bytes: 123 };
  const model = { library: [{ ...track }], favorites: [{ ...alias }], history: [{ ...track }], radioExcluded: [{ ...track }], playlists: [{ tracks: [{ ...alias }, { ...track, id: 'other', url: '' }] }] };
  updateModelMetadata(model, track, { title: ' Novo ', artist: ' Banda ' });
  for (const key of ['library', 'favorites', 'history', 'radioExcluded']) { assert.equal(model[key][0].title, 'Novo'); assert.equal(model[key][0].artist, 'Banda'); }
  assert.equal(model.playlists[0].tracks[0].id, 'alias'); assert.equal(model.playlists[0].tracks[0].localUri, 'private'); assert.equal(model.playlists[0].tracks[1].title, track.title);
});
test('metadata fields reject blank, oversize and nontext values', () => {
  for (const fields of [{ title: '', artist: 'a' }, { title: 'x', artist: ' ' }, { title: 'a'.repeat(501), artist: 'a' }, { title: 42, artist: 'a' }]) assert.throws(() => metadataFields(fields));
  assert.deepEqual(metadataFields({ title: ' ok ', artist: ' band ', id: 'danger' }), { title: 'ok', artist: 'band' });
});
test('per-playlist sync propagates to URL aliases but not unrelated local tracks', () => {
  const model = { library: [{ ...track, id: 'alias' }, { ...track, id: 'local', url: '', _autoDownload: true }], favorites: [], playlists: [{ autoDownload: true, tracks: [track] }] };
  const targets = syncTargets(model);
  assert.equal(targets.find(t => t.id === 'alias')._autoDownload, true); assert.equal(targets.find(t => t.id === 'local')._autoDownload, false);
  assert.equal(model.library[0]._autoDownload, undefined);
});
test('playlist order undo preserves later additions and does not resurrect removals', () => {
  const tracks = ['b', 'new', 'a'].map(id => ({ id }));
  assert.deepEqual(restoreTrackOrder(tracks, ['a', 'removed', 'b']).map(t => t.id), ['a', 'b', 'new']);
});
test('playlist exports omit device paths and round-trip description and download preference', () => {
  const p = { id: 'p', title: 'Meus sons', description: ' Texto ', autoDownload: true, offlineOnly: true, tracks: [{ ...track, localUri: 'file://private', _autoDownload: true, downloadId: 52 }] };
  const file = playlistFile(p), restored = validatePlaylistFile(file);
  assert.equal(file.playlist.tracks[0].localUri, undefined); assert.equal(file.playlist.tracks[0]._autoDownload, undefined);
  assert.equal(restored.description, 'Texto'); assert.equal(restored.autoDownload, true); assert.equal(restored.tracks[0].url, track.url);
  assert.throws(() => validatePlaylistFile({ ...file, version: 2 })); assert.throws(() => validatePlaylistFile({ ...file, format: 'other' }));
});
test('numeric sorts place unknown values last and keep the input order intact', () => {
  const rows = [{ id: 'unknown' }, { id: 'long', duration: 180, bytes: 100 }, { id: 'short', duration: 30, bytes: 200 }, { id: 'bad', duration: -1, bytes: Infinity }];
  assert.deepEqual(filterTracks(rows, '', 'duration').map(t => t.id), ['short', 'long', 'unknown', 'bad']);
  assert.deepEqual(filterTracks(rows, '', 'size').map(t => t.id), ['short', 'long', 'unknown', 'bad']); assert.equal(rows[0].id, 'unknown');
});

test('artist collections collapse cache aliases and normalize artist accents and spaces', () => {
  const rows = groupArtists([track, { ...track, id: 'alias' }, { ...track, id: 'two', url: '', artist: ' alvaro ' }, { ...track, id: 'three', url: '', artist: 'Outro' }]);
  assert.equal(rows.length, 2); assert.equal(rows[0].tracks.length, 2);
  assert.equal(groupArtists([track], 'ALVARO')[0].name, 'Álvaro');
  assert.equal(mergeTracks([{ ...track, url: '' }, { ...track, id: 'two', url: '' }]).length, 2);
});
test('collection durations are readable and resist nonfinite or negative data', () => {
  assert.equal(collectionDuration([{ duration: 3660 }]), '1 h 1 min');
  assert.equal(collectionDuration([{ duration: 3600 }]), '1 h');
  assert.equal(collectionDuration([{ duration: 30 }]), '< 1 min');
  assert.equal(collectionDuration([{ duration: Infinity }, { duration: -50 }]), '0 min');
});
test('search cache is bounded, isolated by provider, cloned and expires', () => {
  let now = 0; const cache = new SearchCache({ limit: 2, ttl: 100, now: () => now });
  cache.put('Canção', 'youtube', [track]);
  const first = cache.get(' canCAO ', 'youtube'); first[0].title = 'Mutated';
  assert.equal(cache.get('Canção', 'youtube')[0].title, track.title);
  assert.equal(cache.get('Canção', 'other'), null);
  cache.put('b', 'youtube', []); cache.get('Canção', 'youtube'); cache.put('c', 'youtube', []);
  assert.equal(cache.get('b', 'youtube'), null); assert.deepEqual(cache.get('c', 'youtube'), []);
  now = 100; assert.equal(cache.get('Canção', 'youtube'), null);
});
test('search refinement excludes unknown durations without losing the original results', () => {
  const rows = [track, { ...track, id: 'long', duration: 240 }, { ...track, id: 'unknown', duration: 0 }];
  assert.equal(filterSearchResults(rows, 'short', () => false, () => false).length, 1);
  assert.equal(filterSearchResults(rows, 'long', () => false, () => false)[0].id, 'long');
  assert.equal(filterSearchResults(rows, 'downloaded', t => t.id === 'one', () => false).length, 1);
  assert.equal(filterSearchResults(rows, 'favorites', () => false, t => t.id === 'long').length, 1);
  assert.equal(rows.length, 3);
});
test('action gates prevent overlapping writes and release after failures', async () => {
  const gate = new ActionGate(); let finish, calls = 0;
  const pending = gate.run('save', () => new Promise(resolve => { calls++; finish = resolve; }));
  assert.equal(await gate.run('save', () => calls++), false); assert.equal(calls, 1);
  finish(); assert.equal(await pending, true);
  await assert.rejects(gate.run('save', () => { throw new Error('fail'); }));
  assert.equal(await gate.run('save', () => calls++), true);
});
test('stale occurrence checks detect reorder, insertion and repeated-track changes', () => {
  const other = { ...track, id: 'two', url: '' }, rows = [track, other, track];
  assert.equal(sameOccurrence(rows, rows.map(t => ({ ...t })), 2), true);
  assert.equal(sameOccurrence([other, track, track], rows, 2), false);
  assert.equal(sameOccurrence([...rows, other], rows, 2), false);
  assert.equal(sameOccurrence(rows, rows, -1), false);
});
test('oversized nested backup lists are rejected before restoration', () => {
  const backup = { format: 'fluxo-mobile', version: 2, favorites: [], playlists: [{ tracks: Array(20001).fill(track) }] };
  assert.throws(() => validateBackup(backup), /grande demais/);
  backup.playlists = Array.from({ length: 6 }, () => ({ tracks: Array(20000).fill(track) }));
  assert.throws(() => validateBackup(backup), /grande demais/);
});

test('offline records never replace the identity or source URL of playlist tracks', () => {
  const record = { ...track, id: 'cached-other-id', title: 'Old title', localUri: 'file:///private/track', thumbnail: 'file:///private/cover', duration: 75 };
  const playable = withDownload(track, record);
  assert.equal(playable.id, 'one'); assert.equal(playable.url, track.url); assert.equal(playable.title, track.title);
  assert.equal(playable.localUri, record.localUri); assert.equal(playable.thumbnail, record.thumbnail); assert.equal(playable.duration, 65);
  assert.equal(withDownload({ ...track, duration: 0 }, record).duration, 75);
});
test('track matching handles cached aliases without matching missing identifiers', () => {
  assert.equal(sameTrack(track, { ...track, id: 'alias' }), true);
  assert.equal(sameTrack({ id: 'a', url: '' }, { id: 'b', url: '' }), false);
  assert.equal(sameTrack({}, {}), false); assert.equal(sameTrack(null, track), false);
});
test('bulk removal and undo preserve positions and later unrelated additions', () => {
  const second = { ...track, id: 'two', url: 'https://example.com/b.mp3' };
  const later = { ...track, id: 'later', url: 'https://example.com/c.mp3' };
  const model = { library: [track, second], favorites: [track], playlists: [{ id: 'p', tracks: [second, track] }] };
  const snapshot = removeLibraryTracks(model, [{ ...track, id: 'download-alias' }]);
  assert.deepEqual(model.library, [second]); assert.deepEqual(model.favorites, []); assert.deepEqual(model.playlists[0].tracks, [second]);
  model.library.push(later); restoreLibraryTracks(model, snapshot); restoreLibraryTracks(model, snapshot);
  assert.deepEqual(model.library.map(t => t.id), ['one', 'two', 'later']);
  assert.deepEqual(model.playlists[0].tracks.map(t => t.id), ['two', 'one']);
  assert.equal(model.favorites.length, 1);
});
test('undo does not recreate a playlist deleted after the removal', () => {
  const model = { library: [], favorites: [], playlists: [{ id: 'p', tracks: [track] }] };
  const snapshot = removeLibraryTracks(model, [track]); model.playlists = []; restoreLibraryTracks(model, snapshot);
  assert.deepEqual(model.playlists, []);
});
test('pinned playlists lead both saved and alphabetical order', () => {
  const rows = [{ title: 'Alfa' }, { title: 'Zebra', pinned: true }, { title: 'Beta', pinned: true }];
  assert.deepEqual(filterPlaylists(rows).map(p => p.title), ['Zebra', 'Beta', 'Alfa']);
  assert.deepEqual(filterPlaylists(rows, '', 'title').map(p => p.title), ['Beta', 'Zebra', 'Alfa']);
  assert.equal(rows[0].title, 'Alfa');
});
test('pinned playlists round trip with backups and old ones default to unpinned', () => {
  const backup = publicBackup({ library: [], favorites: [], history: [], playlists: [{ id: 'p', title: 'Pinned', pinned: true, tracks: [track] }], settings: {} });
  assert.equal(validateBackup(backup).playlists[0].pinned, true);
  const storage = { getItem: key => key === 'fluxo_mobile_v2' ? JSON.stringify({ playlists: [{ id: 'p', tracks: [] }] }) : null };
  assert.equal(loadModel(storage).playlists[0].pinned, false);
});

test('partial or malformed stored models retain valid collections without breaking startup', () => {
  const value = { library: [track], favorites: 'invalid', history: null, playlists: [{ id: 'keep', title: 'Keep', tracks: [track] }, null], searches: [null, 'MPB', 42], settings: null };
  const storage = { getItem: key => key === 'fluxo_mobile_v2' ? JSON.stringify(value) : null };
  const model = loadModel(storage);
  assert.equal(model.library[0].id, track.id); assert.deepEqual(model.favorites, []); assert.deepEqual(model.history, []);
  assert.equal(model.playlists[0].tracks[0].id, track.id); assert.deepEqual(model.searches, ['MPB']);
  assert.equal(model.settings.autoDownload, true); assert.deepEqual(unique({ bad: true }), []);
});

test('nonfinite durations and file sizes cannot poison progress or totals', () => {
  assert.equal(cleanTrack({ ...track, duration: Infinity }).duration, 0);
  assert.equal(duration(Infinity), '0:00'); assert.equal(duration(NaN), '0:00');
  assert.equal(downloadStats([{ status: 'ready', bytes: Infinity }, { status: 'ready', bytes: 100 }]).bytes, 100);
});

test('playlists search accents without mutating the saved order', () => {
  const rows = [{ title: 'Zebra' }, { title: 'Canção' }, { title: 'Amanhecer' }];
  assert.equal(filterPlaylists(rows, 'cancao')[0].title, 'Canção');
  assert.deepEqual(filterPlaylists(rows, '', 'title').map(row => row.title), ['Amanhecer', 'Canção', 'Zebra']);
  assert.equal(rows[0].title, 'Zebra');
});
test('storage sizes remain meaningful for small files and invalid values', () => {
  assert.equal(size(1024), '1 KB'); assert.equal(size(1048576), '1 MB'); assert.equal(size(-1), '0 B'); assert.equal(size(Infinity), '0 B');
});

test('download filters separate ready, pending and failed files', () => {
  const rows = ['ready', 'queued', 'downloading', 'failed'].map((status, i) => ({ ...track, id: String(i), status, bytes: 1024 }));
  assert.equal(filterDownloads(rows, 'pending').length, 2);
  assert.equal(filterDownloads(rows, 'all').length, 4);
  assert.deepEqual(downloadStats(rows), { ready: 1, pending: 2, failed: 1, bytes: 1024 });
  assert.equal(downloadStats([{ status: 'ready', bytes: -1 }]).bytes, 0);
});

test('radio exclusions round trip and imported backups cannot inject private paths', () => {
  const data = publicBackup({ radioExcluded: [track], library: [], favorites: [], history: [], playlists: [], settings: {} });
  data.favorites.push({ ...track, localUri: 'file:///private/audio', thumbnail: 'file:///private/photo', url: 'file:///private/source' });
  const copy = validateBackup(data);
  assert.equal(copy.radioExcluded[0].id, track.id);
  assert.equal(copy.favorites[0].localUri, undefined);
  assert.equal(copy.favorites[0].url, ''); assert.equal(copy.favorites[0].thumbnail, '');
  assert.throws(() => validateBackup({ ...data, radioExcluded: 'bad' }));
});
test('library downloads include saved, favorites and playlists but never history', () => {
  const history = { ...track, id: 'history' };
  assert.deepEqual(libraryTracks({ library: [track], favorites: [track], playlists: [{ tracks: [track] }], history: [history] }).map(t => t.id), ['one']);
});
test('automatic downloads default on and survive normalization and backup', () => {
  assert.equal(normalizeSettings({}).autoDownload, true);
  const data = publicBackup({ library: [track], favorites: [], history: [], playlists: [], settings: { autoDownload: false, wifiOnly: true } });
  const copy = validateBackup(data);
  assert.equal(copy.library[0].id, track.id); assert.equal(copy.settings.autoDownload, false); assert.equal(copy.settings.wifiOnly, true);
});
test('public backup removes artwork private paths and rejects invalid library', () => {
  const data = publicBackup({ library: [{ ...track, thumbnail: 'file:///private/cover.jpg' }], favorites: [], history: [], playlists: [], settings: {} });
  assert.equal(data.library[0].thumbnail, ''); assert.throws(() => validateBackup({ ...data, library: 'invalid' }));
});
test('normalizes tracks and rejects invalid entries', () => { assert.equal(cleanTrack(null), null); assert.equal(cleanTrack({}), null); assert.equal(cleanTrack({ ...track, duration: -2 }).duration, 0); });
test('deduplicates playlists and favorites', () => assert.equal(unique([track, track, null]).length, 1));
test('migrates original IDs from old offline tracks', () => assert.equal(cleanTrack({ ...track, id: 'offline-one', originalId: 'one' }).id, 'one'));
test('filters accents and sorts tracks', () => { assert.equal(filterTracks([track], 'cancao').length, 1); assert.equal(filterTracks([track], 'alvaro').length, 1); assert.equal(filterTracks([track], 'other').length, 0); });
test('formats durations safely', () => { assert.equal(duration(65), '1:05'); assert.equal(duration(NaN), '0:00'); assert.equal(duration(-10), '0:00'); });
test('preserves old user data on migration', () => { const storage = { getItem: k => k === 'fluxo_mobile_favorites' ? JSON.stringify([track]) : null }; assert.equal(loadModel(storage).favorites[0].id, 'one'); });
test('backup contains no device private paths', () => { const data = publicBackup({ favorites: [{ ...track, localUri: 'file:///private/file' }], history: [], playlists: [], settings: {} }); assert.equal(data.favorites[0].localUri, undefined); assert.equal(validateBackup(data).favorites.length, 1); });
test('rejects invalid backup before overwriting data', () => { assert.throws(() => validateBackup({})); assert.throws(() => validateBackup({ format: 'fluxo-mobile', version: 2, playlists: null, favorites: [] })); });
test('appearance defaults preserve old settings', () => { const settings = normalizeSettings({ theme: 'manga', offline: true, customAccent: true, accent: '#123abc' }); assert.equal(settings.theme, 'manga'); assert.equal(settings.offline, true); assert.equal(settings.density, 'comfortable'); assert.equal(settings.accent, '#123abc'); });
test('rejects unsafe and unsupported appearance values', () => { const settings = normalizeSettings({ accent: 'red; background:url(x)', radius: 100, font: 'bad', themeFavorites: ['fluxobug', 'fluxobug', 'bad;style'], profiles: [{ id: 'a', name: 'My style', values: { density: 'compact', offline: true } }] }); assert.equal(settings.accent, '#a5f060'); assert.equal(settings.radius, 8); assert.deepEqual(settings.themeFavorites, ['fluxobug']); assert.equal(settings.profiles[0].values.density, 'compact'); assert.equal(settings.profiles[0].values.offline, undefined); });
test('saved styles only include appearance preferences', () => { const look = normalizeAppearance({ offline: true, wifiOnly: true, density: 'compact', playerLayout: 'compact' }); assert.equal(look.offline, undefined); assert.equal(look.wifiOnly, undefined); assert.equal(look.playerLayout, 'compact'); });
test('custom playlists and profiles round trip through backup', () => { const model = { favorites: [], history: [], playlists: [{ id: 'p', title: 'Playlist', tracks: [track], coverStyle: 'symbol', coverIcon: 'heart', coverColor: '#54c7e8' }], settings: { profiles: [{ id: 'look', name: 'Night', values: { visualizer: 'wave' } }], themeFavorites: ['manga'] } }; const copy = validateBackup(publicBackup(model)); assert.equal(copy.playlists[0].coverIcon, 'heart'); assert.equal(copy.settings.profiles[0].values.visualizer, 'wave'); assert.deepEqual(copy.settings.themeFavorites, ['manga']); });
test('playlist artwork rejects injected style and icon values', () => { assert.equal(playlistAppearance({ coverColor: 'red;position:fixed', coverIcon: '<script>' }).coverColor, 'auto'); assert.equal(playlistAppearance({ coverStyle: 'bad' }).coverStyle, 'mosaic'); });
test('custom surfaces and buttons have readable foregrounds', () => { assert.equal(contrastText('#ffffff'), '#101411'); assert.equal(contrastText('#000000'), '#ffffff'); assert.equal(surfacePalette('#f9f9f9')['--text'], '#101411'); assert.equal(surfacePalette('#000000')['--text'], '#ffffff'); });
