const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Silent PCM keeps state tests deterministic without depending on a media provider.
function fixtureAudio() {
    const samples = 8000 * 30;
    const wav = Buffer.alloc(44 + samples * 2);
    wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
    wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    return `data:audio/wav;base64,${wav.toString('base64')}`;
}

async function main() {
    const root = path.resolve(__dirname, '..');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-audit-'));
    const packaged = process.env.FLUXO_EXECUTABLE;
    const app = await electron.launch({
        executablePath: packaged || require('electron'),
        args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required'],
        timeout: 30000
    });
    const failures = [], errors = [];
    try {
        const page = await app.firstWindow();
        page.on('pageerror', error => {
            if (error.stack?.includes('logSecurityWarnings') && error.stack?.includes('node:electron/')) return;
            errors.push(error.message);
        });
        page.on('dialog', dialog => dialog.dismiss());
        await page.waitForFunction(() => typeof currentHotkeys !== 'undefined');
        await page.evaluate(url => {
            window.auditUrl = url;
            window.auditResolve = () => Promise.resolve({ url, mode: 'audio' });
            resolvePlayableStreamForTrack = window.auditResolve;
            prefetchStream = () => {};
            smartPrefetchUpcoming = () => {};
            audioPlayer.muted = true;
        }, fixtureAudio());
        async function test(name, fn) {
            try { await fn(); console.log('PASS', name); }
            catch (error) { failures.push({ name, error: error.message }); console.log('FAIL', name, error.message); }
        }
        const start = () => page.evaluate(async () => {
            resolvePlayableStreamForTrack = window.auditResolve;
            queue = [{ id: 'audit-first', title: 'First', artist: 'Audit' }, { id: 'audit-second', title: 'Second', artist: 'Audit' }];
            originalQueue = [...queue];
            isCrossfade = false;
            await loadAndPlayTrack(0);
        });
        await test('all sidebar menus', async () => {
            for (const id of ['btnQueueView', 'btnDonations', 'btnMultiplayer', 'btnRadio', 'btnLibrary', 'btnInbox', 'btnFavorites', 'btnHistory', 'btnLyrics', 'btnEQ', 'btnTimer', 'btnFluxoLab', 'btnThemes', 'btnHotkeys', 'btnChangelog']) {
                await page.locator(`#${id}`).click();
                await page.waitForTimeout(100);
                assert.ok(await page.locator('#resultsList').isVisible(), id);
            }
            assert.deepEqual(errors, []);
        });
        await test('clear queue then enqueue starts playback', async () => {
            await start();
            await page.locator('#btnQueueView').click();
            await page.locator('#btnClearQueue').click();
            await page.locator('#btnConfirmOk').click();
            await page.evaluate(() => enqueueTrack({ id: 'audit-new', title: 'New', artist: 'Audit' }));
            await page.waitForFunction(() => audioPlayer.dataset.id === 'audit-new' && !audioPlayer.paused, null, { timeout: 3000 });
        });
        await test('late video switch cannot replace a newer track', async () => {
            await start();
            const result = await page.evaluate(async () => {
                let finish;
                resolvePlayableStreamForTrack = () => new Promise(resolve => { finish = resolve; });
                const switching = reloadCurrentPlaybackStream('video');
                resolvePlayableStreamForTrack = window.auditResolve;
                await loadAndPlayTrack(1);
                finish({ url: window.auditUrl, mode: 'audio' });
                await switching;
                return { title: titleEl.innerText, id: audioPlayer.dataset.id };
            });
            assert.deepEqual(result, { title: 'Second', id: 'audit-second' });
        });
        await test('clearing queue cancels pending playback', async () => {
            await start();
            await page.evaluate(() => {
                resolvePlayableStreamForTrack = () => new Promise(resolve => { window.auditPending = resolve; });
                window.auditLoading = loadAndPlayTrack(1);
            });
            await page.locator('#btnClearQueue').click();
            await page.locator('#btnConfirmOk').click();
            await page.evaluate(async () => { auditPending({ url: auditUrl, mode: 'audio' }); await auditLoading; resolvePlayableStreamForTrack = auditResolve; });
            assert.equal(await page.evaluate(() => audioPlayer.getAttribute('src')), null);
            assert.equal(await page.evaluate(() => audioPlayer.dataset.id || ''), '');
        });
        await test('preview stops when leaving its page', async () => {
            await page.evaluate(async () => { setMediaElementSource(previewPlayer, auditUrl, 'preview'); previewPlayer.muted = true; await previewPlayer.play(); });
            await page.locator('#btnLibrary').click();
            assert.equal(await page.evaluate(() => previewPlayer.paused), true);
        });
        await test('failed mode switch restores an HLS manifest, not its revoked blob', async () => {
            await start();
            const restored = await page.evaluate(async () => {
                const RealHls = window.Hls;
                const realWait = waitForMediaMetadata;
                const bytes = await (await fetch(auditUrl)).arrayBuffer();
                const manifests = [];
                window.Hls = class {
                    static Events = { ERROR: 'error' };
                    static isSupported() { return true; }
                    on() {}
                    loadSource(url) { manifests.push(url); }
                    attachMedia(media) { this.url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' })); media.src = this.url; media.load(); }
                    destroy() { URL.revokeObjectURL(this.url); }
                };
                try {
                    setMediaElementSource(audioPlayer, 'https://fixture.invalid/previous.m3u8');
                    await realWait(audioPlayer);
                    await audioPlayer.play();
                    let first = true;
                    waitForMediaMetadata = player => { if (first) { first = false; return Promise.reject(new Error('Injected mode failure')); } return realWait(player); };
                    const changed = await reloadCurrentPlaybackStream('video');
                    return { changed, manifests, playing: !audioPlayer.paused, source: audioPlayer.dataset.streamUrl };
                } finally {
                    waitForMediaMetadata = realWait;
                    clearMediaElementSource(audioPlayer);
                    window.Hls = RealHls;
                }
            });
            assert.equal(restored.changed, false);
            assert.equal(restored.playing, true);
            assert.deepEqual(restored.manifests, ['https://fixture.invalid/previous.m3u8', 'https://fixture.invalid/previous.m3u8']);
        });
        await test('a stale crossfade cannot replace a direct track selection', async () => {
            await start();
            const result = await page.evaluate(async () => {
                const oldFade = fadeMainVolume;
                const oldBeat = getBeatSyncDelay;
                let finishFade;
                getBeatSyncDelay = () => 0;
                fadeMainVolume = () => new Promise(resolve => { finishFade = resolve; });
                try {
                    const fading = transitionToTrack(1, true);
                    await loadAndPlayTrack(0);
                    finishFade(); await fading;
                    return audioPlayer.dataset.id;
                } finally { fadeMainVolume = oldFade; getBeatSyncDelay = oldBeat; }
            });
            assert.equal(result, 'audit-first');
        });
        await test('shared session follows a pause received during stream loading', async () => {
            const result = await page.evaluate(async () => {
                const realDb = db;
                db = null; currentRoom = 'AUDIT'; isHost = false;
                roomSettings = getDefaultRoomSettings(); lastAppliedSessionVideoMode = null;
                stopMainPlayback();
                let finish;
                resolvePlayableStreamForTrack = () => new Promise(resolve => { finish = resolve; });
                try {
                    const track = { id: 'shared-audit', title: 'Shared', artist: 'Audit' };
                    const loading = applyRemoteSessionPlayback({ track, state: 'playing', time: 1 });
                    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
                    await applyRemoteSessionPlayback({ track, state: 'paused', time: 8 });
                    finish({ url: auditUrl, mode: 'audio' });
                    await loading;
                    const paused = audioPlayer.paused, time = audioPlayer.currentTime;
                    queue.push({ id: 'must-not-start', title: 'Other' });
                    await audioPlayer.onended();
                    return { paused, time, id: audioPlayer.dataset.id };
                } finally {
                    currentRoom = null; latestRemotePlaybackState = null;
                    stopMainPlayback(); db = realDb; resolvePlayableStreamForTrack = auditResolve;
                }
            });
            assert.equal(result.paused, true);
            assert.equal(result.time, 8);
            assert.equal(result.id, 'shared-audit');
        });
        await test('radio ignores old recommendations after a new track or disabling radio', async () => {
            await start();
            const result = await page.evaluate(async () => {
                const originalRecommend = getSmartAutoMixTrack;
                let finish;
                getSmartAutoMixTrack = () => new Promise(resolve => { finish = resolve; });
                try {
                    queue = [queue[0]]; originalQueue = [...queue]; currentIndex = 0; isAutoMix = true;
                    const pending = ensureAutoMixNextTrack();
                    queue = [{ id: 'new-radio-seed', title: 'New seed', artist: 'Audit' }]; originalQueue = [...queue];
                    await loadAndPlayTrack(0);
                    finish({ id: 'stale-recommendation', title: 'Wrong recommendation' });
                    await pending;
                    const afterChange = queue.map(track => track.id);
                    queue = [queue[0]]; originalQueue = [...queue];
                    const disabled = ensureAutoMixNextTrack();
                    isAutoMix = false;
                    finish({ id: 'disabled-recommendation', title: 'Disabled recommendation' });
                    await disabled;
                    return { afterChange, afterDisable: queue.map(track => track.id) };
                } finally { getSmartAutoMixTrack = originalRecommend; isAutoMix = false; }
            });
            assert.deepEqual(result, { afterChange: ['new-radio-seed'], afterDisable: ['new-radio-seed'] });
        });
        await test('empty remote state cancels a pending shared track', async () => {
            const result = await page.evaluate(async () => {
                const realDb = db; db = null; currentRoom = 'AUDIT'; isHost = false;
                stopMainPlayback();
                let finish;
                resolvePlayableStreamForTrack = () => new Promise(resolve => { finish = resolve; });
                try {
                    const loading = applyRemoteSessionPlayback({ track: { id: 'removed', title: 'Removed' }, state: 'playing' });
                    while (!finish) await new Promise(resolve => setTimeout(resolve, 0));
                    await applyRemoteSessionPlayback({ track: null, state: 'paused' });
                    finish({ url: auditUrl, mode: 'audio' }); await loading;
                    return { src: audioPlayer.getAttribute('src'), id: audioPlayer.dataset.id, paused: audioPlayer.paused };
                } finally { currentRoom = null; latestRemotePlaybackState = null; db = realDb; resolvePlayableStreamForTrack = auditResolve; }
            });
            assert.deepEqual(result, { src: null, id: '', paused: true });
        });
        await test('queue insertion preserves playback and shuffle preserves every track', async () => {
            await start();
            await page.evaluate(() => { audioPlayer.currentTime = 7; enqueueTrack({ id: 'third', title: 'Third' }, 'next'); });
            assert.equal(await page.evaluate(() => audioPlayer.dataset.id), 'audit-first');
            assert.ok(await page.evaluate(() => audioPlayer.currentTime >= 7));
            await page.locator('#shuffleBtn').click();
            assert.deepEqual(await page.evaluate(() => ({ length: queue.length, index: currentIndex, id: queue[0].id })), { length: 3, index: 0, id: 'audit-first' });
            await page.locator('#shuffleBtn').click();
            assert.equal(await page.evaluate(() => queue.length), 3);
        });
        await test('selective playlist import and save above the old 200-track limit', async () => {
            await page.evaluate(() => renderYouTubePlaylistImportSelector({ title: 'Audit collection', tracks: Array.from({ length: 251 }, (_, i) => ({ id: `import-${i}`, title: `Track ${i}` })) }));
            assert.equal(await page.locator('.yt-import-check').count(), 251);
            await page.locator('#btnYtSelectNone').click();
            assert.equal(await page.locator('#btnYtImportSelected').isDisabled(), true);
            await page.locator('.yt-import-check').nth(1).check();
            await page.locator('.yt-import-check').nth(3).check();
            await page.locator('#btnYtSaveSelected').click();
            assert.deepEqual(await page.evaluate(() => savedPlaylists.at(-1).tracks.map(t => t.id)), ['import-1', 'import-3']);
            await page.locator('#btnYtSelectAll').click();
            assert.equal(await page.locator('#ytImportSelectedCount').innerText(), '251');
            await page.locator('#btnYtImportAll').click();
            assert.ok(await page.locator('#resultsList').innerText().then(text => text.includes('Track 250')));
        });
        await test('equalizer profiles update actual controls and reset to normal', async () => {
            await page.locator('#btnEQ').click();
            await page.locator('[data-profile="nightcore"]').click();
            assert.ok(Number(await page.locator('#speedRateSlider').inputValue()) > 1);
            await page.locator('#btnResetDsp').click();
            assert.equal(Number(await page.locator('#speedRateSlider').inputValue()), 1);
            assert.equal(Number(await page.locator('#reverbMixSlider').inputValue()), 0);
            assert.ok(await page.locator('.eq-slider').evaluateAll(sliders => sliders.every(slider => Number(slider.value) === 0)));
        });
        await test('library import ignores invalid rows and gives duplicate titles unique names', async () => {
            const titles = await page.evaluate(async () => {
                const input = JSON.stringify({ playlists: [null, { title: 'Duplicate', tracks: [] }, { title: 'Duplicate', tracks: [] }] });
                const count = await importPlaylistsJson({ text: async () => input });
                if (count !== 2) throw new Error('Expected two valid playlists');
                return savedPlaylists.slice(-2).map(pl => pl.title);
            });
            assert.deepEqual(titles, ['Duplicate', 'Duplicate (2)']);
        });
        await test('invalid backup leaves the existing library intact', async () => {
            const result = await page.evaluate(async () => {
                const before = localStorage.getItem('fluxo_playlists');
                let rejected = false;
                try { await restoreLibraryBackupJson({ text: async () => JSON.stringify({ localStorage: { fluxo_playlists: '{invalid' } }) }); }
                catch { rejected = true; }
                return { rejected, preserved: before === localStorage.getItem('fluxo_playlists') };
            });
            assert.deepEqual(result, { rejected: true, preserved: true });
        });
        await test('shared session menus fit both roles and narrow themed windows', async () => {
            await page.evaluate(() => {
                stopMainPlayback();
                window.auditRealDb = db; window.auditRealName = myName;
                db = {}; currentRoom = 'TEST'; myName = 'Audit';
                sessionUsers = { one: { name: 'Host', isHost: true }, two: { name: 'Guest', isHost: false } };
            });
            try {
                for (const theme of ['default', 'minecraft', 'tensura', 'adolla']) {
                    for (const host of [true, false]) {
                        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(800, 750));
                        await page.evaluate(({ theme, host }) => { isHost = host; applyThemeClass(theme); renderMultiplayerPanel(); }, { theme, host });
                        for (const tab of await page.locator('.mp-tab').all()) {
                            await tab.click();
                            assert.equal(await page.locator('.mp-shell').evaluate(el => el.scrollWidth > el.clientWidth + 3), false, `${theme}/${host} room overflow`);
                        }
                    }
                }
                await page.evaluate(() => { activeMpTab = 'mp-info'; isHost = true; applyThemeClass('default'); renderMultiplayerPanel(); });
                await page.screenshot({ path: path.join(profile, 'session-800.png') });
            } finally {
                await page.evaluate(() => { currentRoom = null; isHost = false; db = auditRealDb; myName = auditRealName; });
            }
        });
        await test('update failure never traps the app behind a modal', async () => {
            await app.evaluate(({ BrowserWindow }) => {
                const web = BrowserWindow.getAllWindows()[0].webContents;
                web.send('update-message', 'Testing update'); web.send('update-error', 'Testing failed download');
            });
            await page.locator('#btnDismissUpdate').click();
            assert.equal(await page.locator('#updateModal').isVisible(), false);
        });
        await test('all themes, scroll, equalizer and compact exit', async () => {
            await page.locator('#btnThemes').click();
            const themes = await page.locator('.theme-result-item').evaluateAll(items => items.map(item => item.dataset.themeId));
            assert.ok(themes.length >= 40);
            const layoutIssues = [];
            for (const width of [800, 1200]) {
                await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 750), width);
                for (const theme of themes) {
                    await page.evaluate(theme => { applyThemeClass(theme); document.getElementById('btnEQ').click(); }, theme);
                    const overflow = await page.locator('#resultsList').evaluate(el => ({ extra: el.scrollWidth - el.clientWidth, scroll: getComputedStyle(el).overflowY }));
                    if (overflow.extra > 3 || overflow.scroll === 'hidden') {
                        const outside = await page.locator('#resultsList').evaluate(el => {
                            const edge = el.getBoundingClientRect().right;
                            return Array.from(el.querySelectorAll('*')).filter(child => child.getBoundingClientRect().right > edge + 2).map(child => `${child.tagName}.${child.className}`).slice(0, 10);
                        });
                        layoutIssues.push({ theme, width, ...overflow, outside });
                        if (layoutIssues.length <= 2) await page.screenshot({ path: path.join(profile, `layout-${theme}-${width}.png`) });
                    }
                }
            }
            await page.evaluate(() => applyThemeClass('default'));
            await page.locator('#btnMiniPlayer').click();
            await page.locator('#btnExitMini').click();
            assert.equal(await page.evaluate(() => document.body.classList.contains('mini-mode')), false);
            await page.locator('#btnPartyMode').click();
            await page.locator('#btnExitParty').click();
            assert.equal(await page.evaluate(() => document.body.classList.contains('party-mode')), false);
            console.log('Themes checked:', themes.length);
            assert.deepEqual(layoutIssues, []);
        });
        await test('invalid saved settings cannot prevent startup', async () => {
            await page.evaluate(() => {
                localStorage.setItem('fluxo_history', '{broken');
                localStorage.setItem('fluxo_playlists', JSON.stringify([null, { title: 'Keep me', tracks: [] }]));
                localStorage.setItem('fluxo_automix_memory', '{}');
                localStorage.setItem('fluxo_hotkeys', '{broken');
                localStorage.setItem('fluxo_queue_tabs', '[null]');
                localStorage.setItem('fluxo_playlist_trash', '[null]');
            });
            await page.reload();
            await page.waitForFunction(() => typeof currentHotkeys !== 'undefined', null, { timeout: 5000 });
            assert.equal(await page.evaluate(() => savedPlaylists[0]?.title), 'Keep me');
            await page.locator('#btnLibrary').click();
        });
        await test('no uncaught renderer exceptions', () => assert.deepEqual(errors, []));
        await page.screenshot({ path: path.join(profile, 'audit.png') });
        fs.writeFileSync(path.join(profile, 'results.json'), JSON.stringify({ failures, errors }, null, 2));
        console.log(JSON.stringify({ profile, failures, errors }));
        assert.equal(failures.length, 0, 'Workflow regressions found');
    } finally { await app.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
