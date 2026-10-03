import { cleanTrack, sameTrack } from './model.js';
import { sameOccurrence } from './discovery.js';
export const native = !!window.Capacitor?.isNativePlatform();
const plugin = native ? (window.Capacitor.Plugins.FluxoAudio || window.Capacitor.registerPlugin('FluxoAudio')) : null;
let callback = () => {};
let state = { queue: [], index: 0, position: 0, duration: 0, playing: false, playWhenReady: false, buffering: false, repeat: 0, shuffle: false, speed: 1, volume: 1, error: '', sleepAt: 0 };
const audio = new Audio();
let objectURL = '';
let timeout;
let generation = 0;
let radioExcluded = [];
const excluded = track => radioExcluded.some(item => item.id === track.id || (item.url && item.url === track.url));
const emit = () => callback({ ...state, queue: state.queue.map(track => ({ ...track })) });
const openDB = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('fluxo-mobile-offline', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('downloads', { keyPath: 'id' });
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function dbRequest(mode, operation) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('downloads', mode);
    const request = operation(tx.objectStore('downloads'));
    tx.oncomplete = () => { db.close(); resolve(request?.result); };
    tx.onerror = () => { db.close(); reject(tx.error); }; tx.onabort = tx.onerror;
  });
}
async function browserPlay(play = true) {
  const token = ++generation;
  clearTimeout(timeout); audio.pause(); audio.removeAttribute('src'); audio.load(); state.error = ''; state.position = 0; state.duration = 0; state.buffered = 0; state.playWhenReady = play; state.buffering = play; emit();
  const track = state.queue[state.index];
  if (!track) { state.buffering = false; emit(); return; }
  try {
    let record = await dbRequest('readonly', store => store.get(track.id));
    if (!record && track.url) record = (await dbRequest('readonly', store => store.getAll())).find(record => sameTrack(cleanTrack(record.meta || record), track));
    if (token !== generation) return;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = record?.blob ? URL.createObjectURL(record.blob) : '';
    if (!objectURL && !/^https:\/\//.test(track.url)) throw new Error('Importe o arquivo novamente.');
    if (!objectURL && /(?:youtube\.com|youtu\.be|soundcloud\.com)\//.test(track.url)) throw new Error('Esta fonte precisa do aplicativo Android.');
    audio.src = objectURL || track.url; audio.playbackRate = state.speed; audio.volume = state.volume;
    if (!play) { audio.load(); emit(); return; }
    timeout = setTimeout(() => { if (token === generation) { audio.pause(); state.playWhenReady = false; state.buffering = false; state.error = 'O áudio demorou demais. Tente novamente.'; emit(); } }, 20000);
    await audio.play();
  } catch (error) { if (token !== generation) return; clearTimeout(timeout); state.buffering = false; state.playWhenReady = false; state.error = error.message; emit(); }
}
audio.addEventListener('playing', () => { clearTimeout(timeout); state.playing = true; state.buffering = false; emit(); });
audio.addEventListener('pause', () => { state.playing = false; emit(); });
audio.addEventListener('waiting', () => { state.buffering = true; emit(); });
audio.addEventListener('error', () => { clearTimeout(timeout); state.playWhenReady = false; state.buffering = false; state.error = 'Não foi possível abrir este áudio.'; emit(); });
audio.addEventListener('timeupdate', () => { state.position = audio.currentTime; state.duration = Number.isFinite(audio.duration) ? audio.duration : 0; state.buffered = audio.buffered.length ? audio.buffered.end(audio.buffered.length - 1) : 0; emit(); });
audio.addEventListener('loadedmetadata', () => { state.duration = Number.isFinite(audio.duration) ? audio.duration : 0; emit(); });
audio.addEventListener('ended', () => {
  state.playing = false;
  if (state.sleepEnd) { state.sleepEnd = false; state.playWhenReady = false; emit(); return; }
  if (state.repeat === 1) return browserPlay();
  if (state.index + 1 < state.queue.length || state.repeat === 2 || state.radio) commands.command({ action: 'next' });
  else { state.playWhenReady = false; emit(); }
});
setInterval(() => { if (state.sleepAt && Date.now() >= state.sleepAt) { audio.pause(); state.playWhenReady = false; state.sleepAt = 0; emit(); } }, 1000);
export const commands = {
  async migrateOldDownloads(onProgress) {
    if (!native || localStorage.fluxo_audio_migration_version === '2') return;
    const migratedBefore = localStorage.fluxo_audio_migrated === 'yes';
    const records = await dbRequest('readonly', store => store.getAll());
    const existing = (await plugin.downloads()).tracks;
    for (const record of records) {
      const track = cleanTrack(record.meta || record);
      const stored = existing.find(t => t.id === track?.id);
      const repair = stored && Number(stored.downloadId ?? -1) < 0 && (stored.status !== 'ready' || Number(stored.bytes) !== record.blob?.size);
      if (!track || !(record.blob instanceof Blob) || !record.blob.size || stored && !repair || migratedBefore && !stored) continue;
      onProgress?.(track.title);
      for (let offset = 0; offset < record.blob.size; offset += 262144) {
        const blob = record.blob.slice(offset, offset + 262144);
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
        await plugin.migrateAudio({ track, offset, data, complete: offset + blob.size >= record.blob.size, repair: !!repair });
      }
    }
    // Keep the old database as a recovery copy; never delete a user's previous audio.
    localStorage.fluxo_audio_migrated = 'yes';
    localStorage.fluxo_audio_migration_version = '2';
  },
  async init(listener) {
    callback = listener;
    if (native) {
      await plugin.addListener('state', data => { state = data; emit(); });
      for (let i = 0; i < 8; i++) { try { state = await plugin.getState(); emit(); break; } catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 250)); } }
    } else emit();
  },
  async setQueue(options) { if (native) return plugin.setQueue(options); state.radio = false; state.queue = options.tracks; state.index = options.index || 0; await browserPlay(); },
  async radio(track, offline, tracks) {
    if (native) return plugin.radio({ track, offline });
    if (!offline) throw new Error('O rádio online está disponível no aplicativo Android.');
    const same = state.queue[state.index]?.id === track.id && !state.error && !!audio.src;
    if (same) state.queue = state.queue.filter((item, i) => i <= state.index || !item.radioGenerated);
    else { state.queue = [track]; state.index = 0; }
    const candidates = tracks.filter(t => t.id !== track.id && !excluded(t) && !state.queue.slice(state.index).some(item => item.id === t.id));
    if (!candidates.length && state.queue.length <= state.index + 1) throw new Error('Adicione outra música baixada e permitida no rádio.');
    state.queue.push(...candidates.sort(() => Math.random() - .5).map(t => ({ ...t, radioGenerated: true })));
    state.radio = true; state.radioOffline = true; state.radioSeed = track; state.repeat = 0; state.shuffle = false;
    state.playWhenReady = true;
    if (same) await audio.play(); else await browserPlay();
    emit();
  },
  async radioExclusions(tracks) {
    if (native) return plugin.radioExclusions({ tracks });
    radioExcluded = tracks;
    if (state.radio) state.queue = state.queue.filter((track, i) => i <= state.index || !track.radioGenerated || !excluded(track));
    emit();
  },
  async syncLibrary(tracks, enabled, wifiOnly, retry = false) { if (native) await plugin.syncLibrary({ tracks, enabled, wifiOnly, retry }); },
  async append(options) { if (native) return plugin.append(options); state.queue.splice(options.next ? state.index + 1 : state.queue.length, 0, options.track); emit(); },
  async command(options) {
    if (native) return plugin.command(options);
    const { action, value = 0, index = 0 } = options;
    if (options.expectedQueue && !sameOccurrence(state.queue, options.expectedQueue, index)) throw new Error('A fila mudou. Abra as opções novamente.');
    switch (action) {
      case 'play': state.playWhenReady = true; if (!audio.src || state.error) await browserPlay(); else await audio.play(); break;
      case 'pause': generation++; audio.pause(); state.playWhenReady = false; state.buffering = false; clearTimeout(timeout); break;
      case 'next': {
        if (!state.queue.length) break;
        if (state.radio) {
          const candidates = state.queue.map((track, i) => ({ track, i })).filter(({ track, i }) => i !== state.index && !excluded(track));
          if (!candidates.length) { state.radio = false; audio.pause(); break; }
          state.index = candidates.find(({ i }) => i > state.index)?.i ?? candidates[0].i;
        } else if (state.shuffle && state.queue.length > 1) state.index = (state.index + 1 + Math.floor(Math.random() * (state.queue.length - 1))) % state.queue.length;
        else if (state.index + 1 < state.queue.length) state.index++;
        else if (state.repeat === 2) state.index = 0;
        else break;
        await browserPlay(state.playWhenReady); break;
      }
      case 'previous': if (audio.currentTime > 3) audio.currentTime = 0; else { state.index = Math.max(0, state.index - 1); await browserPlay(state.playWhenReady); } break;
      case 'jump': if (index >= 0 && index < state.queue.length) { state.index = index; await browserPlay(); } break;
      case 'seek': if (Number.isFinite(value) && Number.isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration, value)); break;
      case 'clear': generation++; clearTimeout(timeout); audio.pause(); audio.removeAttribute('src'); audio.load(); if (objectURL) URL.revokeObjectURL(objectURL); objectURL = ''; state.radio = false; state.queue = []; state.index = 0; state.position = 0; state.duration = 0; state.buffered = 0; state.playWhenReady = false; state.buffering = false; state.error = ''; state.sleepAt = 0; state.sleepEnd = false; break;
      case 'radio-stop': state.radio = false; state.queue = state.queue.filter((track, i) => i <= state.index || !track.radioGenerated); break;
      case 'remove': if (index >= 0 && index < state.queue.length) { state.queue.splice(index, 1); if (!state.queue.length) return commands.command({ action: 'clear' }); if (index < state.index) state.index--; else if (index === state.index) { state.index = Math.min(state.index, state.queue.length - 1); await browserPlay(state.playWhenReady); } } break;
      case 'move': { if (index < 0 || index >= state.queue.length || value < 0 || value >= state.queue.length) break; const current = state.queue[state.index]; const [item] = state.queue.splice(index, 1); state.queue.splice(value, 0, item); state.index = state.queue.indexOf(current); break; }
      case 'remove-played': state.queue.splice(0, state.index); state.index = 0; break;
      case 'clear-upcoming': state.radio = false; state.queue.splice(state.index + 1); break;
      case 'deduplicate-upcoming': { const seen = [state.queue[state.index]]; state.queue = state.queue.filter((track, i) => { if (i <= state.index) return true; if (seen.some(item => sameTrack(item, track))) return false; seen.push(track); return true; }); break; }
      case 'repeat': state.repeat = value; break;
      case 'shuffle': state.shuffle = !!value; break;
      case 'speed': if (Number.isFinite(value)) { state.speed = Math.max(.5, Math.min(2, value)); audio.playbackRate = state.speed; } break;
      case 'volume': state.volume = Math.max(0, Math.min(1, Number(value) || 0)); audio.volume = state.volume; break;
      case 'sleep': state.sleepEnd = value === -1; state.sleepAt = value > 0 ? Date.now() + value * 60000 : 0; break;
    } emit();
  },
  async search(query, provider) { if (!native) throw new Error('A busca online está disponível no aplicativo Android.'); return (await plugin.search({ query, provider })).tracks; },
  async downloads() {
    if (native) return (await plugin.downloads()).tracks;
    return (await dbRequest('readonly', store => store.getAll())).map(r => ({ ...cleanTrack(r.meta || r), id: r.id, status: 'ready', bytes: r.blob?.size || r.size, savedAt: r.savedAt }));
  },
  async download(track, wifiOnly) {
    if (native) return plugin.download({ track, wifiOnly });
    const response = await fetch(track.url, { signal: AbortSignal.timeout(45000) });
    if (!response.ok) throw new Error('Falha no download.');
    const blob = await response.blob(); await dbRequest('readwrite', store => store.put({ id: track.id, meta: track, blob, savedAt: Date.now() }));
  },
  async downloadBatch(tracks, wifiOnly) {
    if (native) return plugin.downloadBatch({ tracks, wifiOnly });
    for (const track of tracks) if (track.url && !(await commands.downloads()).some(item => item.id === track.id)) await commands.download(track, wifiOnly);
  },
  async removeDownload(id) { return native ? plugin.removeDownload({ id }) : dbRequest('readwrite', store => store.delete(id)); },
  async cancelDownload(id) { return native ? plugin.removeDownload({ id, pendingOnly: true }) : { cancelled: false }; },
  async importAudio() {
    if (native) return plugin.importAudio();
    const files = await chooseFiles('audio/*', true);
    for (const file of files) { const track = { id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, ''), artist: 'Arquivo local', source: 'local', url: '' }; await dbRequest('readwrite', store => store.put({ id: track.id, meta: track, blob: file, savedAt: Date.now() })); }
    return { tracks: files };
  },
  async notifications() { if (native) return plugin.notifications(); },
  async copyText(text) { if (native) return plugin.copyText({ text }); if (!navigator.clipboard) throw new Error('Não foi possível acessar a área de transferência.'); await navigator.clipboard.writeText(text); },
  async diagnostics() { return native ? plugin.diagnostics() : { notifications: false, batteryUnrestricted: false, manufacturer: 'Prévia', model: '', android: '', foreground: false }; },
  async openSettings(page) { if (native) return plugin.openSettings({ page }); },
  async exportBackup(data) {
    if (native) return plugin.exportBackup({ data });
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    Object.assign(document.createElement('a'), { href: url, download: 'fluxo-backup.json' }).click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
  async importBackup() {
    if (native) { const result = await plugin.importBackup(); return result.cancelled ? null : result.data; }
    const [file] = await chooseFiles('application/json'); return file ? file.text() : null;
  }
};
function chooseFiles(accept, multiple = false) {
  return new Promise(resolve => { const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple }); input.addEventListener('change', () => resolve([...input.files]), { once: true }); input.addEventListener('cancel', () => resolve([]), { once: true }); input.click(); });
}
export const artURL = value => {
  if (!value) return './icon.ico';
  if (value.startsWith('file://')) return window.Capacitor?.convertFileSrc(value) || './icon.ico';
  return /^https:\/\//.test(value) ? value : './icon.ico';
};
