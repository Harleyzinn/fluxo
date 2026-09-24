const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
    const root = path.resolve(__dirname, '..');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-smoke-'));
    const packaged = process.env.FLUXO_EXECUTABLE;
    const app = await electron.launch({
        executablePath: packaged || require('electron'),
        args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required'],
        timeout: 30000
    });
    const errors = [];
    try {
        const page = await app.firstWindow();
        page.on('pageerror', error => {
            // Electron 30's development-only security logger cannot parse a relative script URL.
            if (error.stack?.includes('logSecurityWarnings') && error.stack?.includes('node:electron/')) return;
            errors.push(error.message); console.log('Page error:', error.stack);
        });
        page.on('response', response => { if (response.status() >= 400) console.log('HTTP:', response.status(), new URL(response.url()).hostname, response.request().headers().range || 'no-range'); });
        page.on('console', message => { if (['error', 'warning'].includes(message.type())) console.log('Renderer:', message.text().slice(0, 400)); });
        app.process().stdout.on('data', chunk => console.log('Main:', chunk.toString().slice(0, 600)));
        await page.waitForFunction(() => typeof loadAndPlayTrack === 'function', null, { timeout: 30000 });
        await page.evaluate(() => { audioPlayer.muted = true; isCrossfade = false; });
        const started = Date.now();
        const results = await page.evaluate(() => searchAudioTracks('Kamaitachi Carnaval'));
        assert.ok(results.tracks.length > 0, 'Search must return tracks');
        console.log(JSON.stringify({ test: 'renderer search', count: results.tracks.length, ms: Date.now() - started }));
        const playingAt = Date.now();
        await page.evaluate(async () => {
            queue = [{ id: 'a7SkWyLhLbY', title: 'Kamaitachi - Carnaval', artist: 'Kamaitachi' }];
            originalQueue = [...queue];
            await loadAndPlayTrack(0);
        });
        console.log('Loaded:', await page.evaluate(() => ({ title: titleEl.innerText, artist: artistEl.innerText, src: audioPlayer.src.slice(0, 100), error: audioPlayer.error?.message, paused: audioPlayer.paused })));
        await page.waitForFunction(() => audioPlayer.currentTime > 2 && !audioPlayer.paused, null, { timeout: 45000 });
        console.log(JSON.stringify({ test: 'renderer playback', ms: Date.now() - playingAt, result: await page.evaluate(() => ({
            time: audioPlayer.currentTime, duration: audioPlayer.duration, ready: audioPlayer.readyState, error: audioPlayer.error?.code || null
        })) }));
        await page.evaluate(() => { audioPlayer.currentTime = 150; });
        await page.waitForFunction(() => audioPlayer.currentTime > 152 && !audioPlayer.paused, null, { timeout: 30000 });
        console.log(JSON.stringify({ test: 'seek across chunks', time: await page.evaluate(() => audioPlayer.currentTime) }));
        await page.screenshot({ path: path.join(profile, 'player.png') });

        const race = await page.evaluate(async () => {
            const original = resolvePlayableStreamForTrack;
            const url = audioPlayer.src;
            const pending = {};
            try {
                resolvePlayableStreamForTrack = track => new Promise(resolve => { pending[track.id] = resolve; });
                queue = [{ id: 'first', title: 'First' }, { id: 'second', title: 'Second' }];
                originalQueue = [...queue];
                const old = loadAndPlayTrack(0);
                const fresh = loadAndPlayTrack(1);
                pending.second({ url, mode: 'audio' });
                await fresh;
                pending.first({ url, mode: 'audio' });
                await old;
                return { title: titleEl.innerText, id: audioPlayer.dataset.id, currentIndex };
            } finally { resolvePlayableStreamForTrack = original; }
        });
        assert.equal(race.id, 'second');
        assert.equal(race.title, 'Second');
        console.log(JSON.stringify({ test: 'rapid track changes', result: race }));

        const searchRace = await page.evaluate(async () => {
            const original = searchAudioTracks;
            const pending = {};
            try {
                searchAudioTracks = query => new Promise(resolve => { pending[query] = resolve; });
                searchInput.value = 'old';
                const old = executeSearch();
                searchInput.value = 'new';
                const fresh = executeSearch();
                pending.new({ tracks: [] });
                await fresh;
                const expected = resultsList.innerHTML;
                pending.old({ tracks: [{ id: 'old', title: 'Old result' }] });
                await old;
                searchInput.value = 'cancelled';
                const cancelled = executeSearch();
                cancelActiveSearch();
                pending.cancelled({ tracks: [] });
                await cancelled;
                return { staleIgnored: !resultsList.textContent.includes('Old result'), cancelled: resultsList.textContent.includes('cancelada'), expectedEmpty: expected.includes('Nenhum resultado') };
            } finally { searchAudioTracks = original; }
        });
        assert.ok(searchRace.staleIgnored && searchRace.cancelled && searchRace.expectedEmpty);
        console.log(JSON.stringify({ test: 'search races and cancellation', result: searchRace }));

        await page.evaluate(async () => {
            queue = [{ id: 'y7EQIJoA6B8', title: 'Acustico Kamaitachi - Carnaval', artist: 'Kamaitachi' }];
            originalQueue = [...queue];
            await loadAndPlayTrack(0);
        });
        await page.waitForFunction(() => audioPlayer.currentTime > 2 && !audioPlayer.paused, null, { timeout: 45000 });
        console.log(JSON.stringify({ test: 'second real track', title: await page.evaluate(() => titleEl.innerText) }));

        if (process.env.FLUXO_MEDIA_MODES === '1') {
            await page.evaluate(async () => { setVideoUiState(true); await loadAndPlayTrack(0); });
            await page.waitForFunction(() => audioPlayer.videoWidth > 0 && audioPlayer.currentTime > 2 && !audioPlayer.paused, null, { timeout: 45000 });
            assert.ok(await page.evaluate(() => (audioPlayer.webkitAudioDecodedByteCount || 0) > 0 || (mainHlsController?.audioTracks?.length || 0) > 0), 'Video must include audio');
            console.log(JSON.stringify({ test: 'video playback', result: await page.evaluate(() => ({ width: audioPlayer.videoWidth, height: audioPlayer.videoHeight, time: audioPlayer.currentTime })) }));
            await page.evaluate(async () => {
                setVideoUiState(false);
                const results = await searchAudioTracks('Tycho Awake');
                const track = results.tracks.find(track => track.source === 'SoundCloud');
                if (!track) throw new Error('No SoundCloud result');
                queue = [track]; originalQueue = [...queue];
                await loadAndPlayTrack(0);
            });
            await page.waitForFunction(() => audioPlayer.currentTime > 2 && !audioPlayer.paused, null, { timeout: 45000 });
            console.log(JSON.stringify({ test: 'SoundCloud playback', result: await page.evaluate(() => ({ title: titleEl.innerText, duration: audioPlayer.duration, time: audioPlayer.currentTime })) }));
        }

        await page.evaluate(() => renderNetworkDiagnosticsPanel());
        for (const [theme, width] of [['default', 1200], ['minecraft', 800], ['tensura', 1200]]) {
            await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, 750), width);
            await page.evaluate(theme => applyThemeClass(theme), theme);
            const overflow = await page.locator('.service-health').evaluate(el => el.scrollWidth > el.clientWidth + 2);
            assert.equal(overflow, false, `Health panel overflow: ${theme}/${width}`);
            await page.screenshot({ path: path.join(profile, `health-${theme}.png`) });
        }
        console.log(JSON.stringify({ test: 'health UI', themes: ['default', 'minecraft', 'tensura'], widths: [800, 1200] }));
        assert.deepEqual(errors, [], 'Renderer must not throw uncaught exceptions');
        console.log(JSON.stringify({ screenshot: path.join(profile, 'player.png'), profile, errors }));
    } finally {
        await app.close();
    }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
