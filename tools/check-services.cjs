const loadMain = require('../tests/helpers/main-context.cjs');
const assert = require('node:assert/strict');

// Public endpoints only. No user account, playlists or Firebase writes.
async function main() {
    const { handlers, run } = loadMain();
    const timeout = setTimeout(() => { console.error('Service checks exceeded 90s'); process.exit(2); }, 90000);
    const checks = [
        ['YouTube search', () => run("searchYouTubeWithYtSearch('Kamaitachi Carnaval', 3)").then(t => ({ count: t.length, title: t[0]?.title }))],
        ['SoundCloud search', () => run("searchSoundCloudTracks('Tycho Awake', 3)").then(t => ({ count: t.length, title: t[0]?.title }))],
        ['Firebase availability', async () => {
            const response = await fetch('https://fluxo-music-default-rtdb.firebaseio.com/rooms/ZZZZ/createdAt.json', { signal: AbortSignal.timeout(10000) });
            await response.body?.cancel();
            assert.equal(response.status, 200);
            return { status: response.status };
        }],
        ['YouTube audio + local proxy', async () => {
            await run('startControlServer()');
            const stream = await handlers.get('resolve-track-stream')({}, { id: 'a7SkWyLhLbY', title: 'Kamaitachi - Carnaval' }, 'audio');
            if (!stream?.url) throw new Error('No stream');
            for (const range of ['bytes=0-', 'bytes=2097152-']) {
                const sample = await fetch(stream.url, { headers: { Range: range }, signal: AbortSignal.timeout(12000) });
                assert.equal(sample.status, 206);
                console.log(JSON.stringify({ test: 'range support', range, status: sample.status, length: sample.headers.get('content-length'), contentRange: sample.headers.get('content-range') }));
                await sample.body?.cancel();
            }
            const response = await fetch(stream.url, { headers: { Range: 'bytes=0-4095' }, signal: AbortSignal.timeout(12000) });
            const bytes = new Uint8Array(await response.arrayBuffer()).length;
            assert.equal(response.status, 206);
            assert.equal(bytes, 4096);
            assert.match(response.headers.get('content-type'), /^audio\//);
            return { status: response.status, type: response.headers.get('content-type'), bytes };
        }]
    ];
    try {
        for (const [name, check] of checks) {
            const started = Date.now();
            try {
                const result = await check();
                if ('count' in result) assert.ok(result.count > 0, 'No search results');
                console.log(JSON.stringify({ name, ms: Date.now() - started, result }));
            }
            catch (error) { console.error(JSON.stringify({ name, error: error.message.slice(0, 250) })); process.exitCode = 1; }
        }
    } finally {
        await run('controlServer ? new Promise(resolve => controlServer.close(resolve)) : Promise.resolve()');
        clearTimeout(timeout);
    }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
