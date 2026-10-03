import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || 'msedge' });
try {
  const page = await browser.newPage();
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5174'}/platform.js`);
  const result = await page.evaluate(async () => {
    const bytes = new Uint8Array(600100); bytes[0] = 82; bytes[599999] = 123;
    const rows = ['correct', 'partial', 'missing', 'deleted', 'manager', 'empty'].map(id => ({ id, meta: { id, title: id, url: '', source: 'local' }, blob: new Blob([id === 'empty' ? [] : bytes]) }));
    await new Promise((resolve, reject) => {
      const open = indexedDB.open('fluxo-mobile-offline', 1); open.onupgradeneeded = () => open.result.createObjectStore('downloads', { keyPath: 'id' }); open.onerror = () => reject(open.error);
      open.onsuccess = () => { const db = open.result, tx = db.transaction('downloads', 'readwrite'), store = tx.objectStore('downloads'); rows.forEach(row => store.put(row)); tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => { db.close(); reject(tx.error); }; };
    });
    const calls = [];
    window.Capacitor = { isNativePlatform: () => true, Plugins: { FluxoAudio: {
      downloads: async () => ({ tracks: [{ id: 'correct', status: 'ready', bytes: bytes.length }, { id: 'partial', status: 'ready', bytes: 51200 }, { id: 'missing', status: 'failed', bytes: bytes.length }, { id: 'manager', status: 'failed', bytes: 100, downloadId: 3 }] }),
      migrateAudio: async call => calls.push({ ...call, data: atob(call.data).length })
    } } };
    localStorage.fluxo_audio_migrated = 'yes'; localStorage.removeItem('fluxo_audio_migration_version');
    const { commands } = await import('./platform.js?migration-test');
    await commands.migrateOldDownloads(); const count = calls.length; await commands.migrateOldDownloads();
    return { calls, count, secondCount: calls.length, version: localStorage.fluxo_audio_migration_version };
  });
  assert.equal(result.version, '2'); assert.equal(result.count, 6); assert.equal(result.secondCount, 6);
  assert.deepEqual([...new Set(result.calls.map(call => call.track.id))].sort(), ['missing', 'partial']);
  for (const id of ['partial', 'missing']) {
    const calls = result.calls.filter(call => call.track.id === id);
    assert.deepEqual(calls.map(call => call.offset), [0, 262144, 524288]);
    assert.equal(calls.reduce((n, call) => n + call.data, 0), 600100);
    assert.equal(calls.every(call => call.repair), true); assert.equal(calls.at(-1).complete, true);
  }
  console.log('Migration passed: repair truncated/missing legacy files, exact offsets and sizes, preserve removed files and DownloadManager records, skip valid copies and repeat runs.');
} finally { await browser.close(); }
