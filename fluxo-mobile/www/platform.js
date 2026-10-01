import { cleanTrack } from './model.js';
export const native = !!window.Capacitor?.isNativePlatform();
const plugin = native ? (window.Capacitor.Plugins.FluxoAudio || window.Capacitor.registerPlugin('FluxoAudio')) : null;
let callback = () => {};
let state = { queue: [], index: 0, position: 0, duration: 0, playing: false, buffering: false, repeat: 0, shuffle: false, speed: 1, error: '', sleepAt: 0 };
const audio = new Audio();
let objectURL = '';
let timeout;
let generation = 0;
const emit = () => callback({ ...state });
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
async function browserPlay() {
  const token = ++generation;
  clearTimeout(timeout); audio.pause(); state.error = ''; state.buffering = true; emit();
  const track = state.queue[state.index];
  if (!track) { state.buffering = false; emit(); return; }
  try {
    const record = await dbRequest('readonly', store => store.get(track.id));
    if (token !== generation) return;
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = record?.blob ? URL.createObjectURL(record.blob) : '';
    if (!objectURL && !/^https:\/\//.test(track.url)) throw new Error('Importe o arquivo novamente.');
    if (!objectURL && /(?:youtube\.com|youtu\.be|soundcloud\.com)\//.test(track.url)) throw new Error('Esta fonte precisa do aplicativo Android.');
    audio.src = objectURL || track.url; audio.playbackRate = state.speed;
    timeout = setTimeout(() => { if (token === generation) { audio.pause(); state.buffering = false; state.error = 'O áudio demorou demais. Tente novamente.'; emit(); } }, 20000);
    await audio.play();
  } catch (error) { clearTimeout(timeout); state.buffering = false; state.error = error.message; emit(); }
}
audio.addEventListener('playing', () => { clearTimeout(timeout); state.playing = true; state.buffering = false; emit(); });
audio.addEventListener('pause', () => { state.playing = false; emit(); });
audio.addEventListener('waiting', () => { state.buffering = true; emit(); });
audio.addEventListener('error', () => { clearTimeout(timeout); state.buffering = false; state.error = 'Não foi possível abrir este áudio.'; emit(); });
audio.addEventListener('timeupdate', () => { state.position = audio.currentTime; state.duration = Number.isFinite(audio.duration) ? audio.duration : 0; emit(); });
audio.addEventListener('loadedmetadata', () => { state.duration = Number.isFinite(audio.duration) ? audio.duration : 0; emit(); });
audio.addEventListener('ended', () => { if (state.repeat === 1) return browserPlay(); if (state.index + 1 < state.queue.length || state.repeat === 2) commands.command({ action: 'next' }); });
setInterval(() => { if (state.sleepAt && Date.now() >= state.sleepAt) { audio.pause(); state.sleepAt = 0; emit(); } }, 1000);
export const commands = {
  async migrateOldDownloads(onProgress) {
    if (!native || localStorage.fluxo_audio_migrated === 'yes') return;
    const records = await dbRequest('readonly', store => store.getAll());
    const existing = (await plugin.downloads()).tracks;
    for (const record of records) {
      const track = cleanTrack(record.meta || record);
      if (!track || !record.blob || existing.some(t => t.id === track.id)) continue;
      onProgress?.(track.title);
      for (let offset = 0; offset < record.blob.size; offset += 262144) {
        const blob = record.blob.slice(offset, offset + 262144);
        const data = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(blob); });
        await plugin.migrateAudio({ track, offset, data, complete: offset + blob.size >= record.blob.size });
      }
    }
    // Keep the old database as a recovery copy; never delete a user's previous audio.
    localStorage.fluxo_audio_migrated = 'yes';
  },
  async init(listener) {
    callback = listener;
    if (native) {
      await plugin.addListener('state', data => { state = data; emit(); });
      for (let i = 0; i < 8; i++) { try { state = await plugin.getState(); emit(); break; } catch (e) { if (i === 7) throw e; await new Promise(r => setTimeout(r, 250)); } }
    } else emit();
  },
  async setQueue(options) { if (native) return plugin.setQueue(options); state.queue = options.tracks; state.index = options.index || 0; await browserPlay(); },
  async append(options) { if (native) return plugin.append(options); state.queue.splice(options.next ? state.index + 1 : state.queue.length, 0, options.track); emit(); },
  async command(options) {
    if (native) return plugin.command(options);
    const { action, value = 0, index = 0 } = options;
    switch (action) {
      case 'play': if (!audio.src || state.error) await browserPlay(); else await audio.play(); break;
      case 'pause': audio.pause(); state.buffering = false; clearTimeout(timeout); break;
      case 'next': state.index = state.shuffle ? Math.floor(Math.random() * state.queue.length) : (state.index + 1) % state.queue.length; await browserPlay(); break;
      case 'previous': if (audio.currentTime > 3) audio.currentTime = 0; else { state.index = Math.max(0, state.index - 1); await browserPlay(); } break;
      case 'jump': state.index = index; await browserPlay(); break;
      case 'seek': audio.currentTime = value; break;
      case 'clear': audio.pause(); state.queue = []; state.index = 0; break;
      case 'remove': state.queue.splice(index, 1); if (index < state.index) state.index--; else if (index === state.index) { state.index = Math.min(state.index, state.queue.length - 1); await browserPlay(); } break;
      case 'move': { const current = state.queue[state.index]; const [item] = state.queue.splice(index, 1); state.queue.splice(value, 0, item); state.index = state.queue.indexOf(current); break; }
      case 'repeat': state.repeat = value; break;
      case 'shuffle': state.shuffle = !!value; break;
      case 'speed': state.speed = value; audio.playbackRate = value; break;
      case 'sleep': state.sleepAt = value ? Date.now() + value * 60000 : 0; break;
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
  async removeDownload(id) { return native ? plugin.removeDownload({ id }) : dbRequest('readwrite', store => store.delete(id)); },
  async importAudio() {
    if (native) return plugin.importAudio();
    const files = await chooseFiles('audio/*', true);
    for (const file of files) { const track = { id: crypto.randomUUID(), title: file.name.replace(/\.[^.]+$/, ''), artist: 'Arquivo local', source: 'local', url: '' }; await dbRequest('readwrite', store => store.put({ id: track.id, meta: track, blob: file, savedAt: Date.now() })); }
    return { tracks: files };
  },
  async notifications() { if (native) return plugin.notifications(); },
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
