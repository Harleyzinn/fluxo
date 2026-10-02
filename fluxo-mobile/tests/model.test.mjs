import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanTrack, unique, libraryTracks, filterDownloads, downloadStats, size, duration, filterTracks, validateBackup, loadModel, publicBackup } from '../www/model.js';
import { normalizeSettings, normalizeAppearance, playlistAppearance, contrastText, surfacePalette } from '../www/appearance.js';
const track = { id: 'one', title: 'Canção', artist: 'Álvaro', duration: 65, url: 'https://example.com/a.mp3' };
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
