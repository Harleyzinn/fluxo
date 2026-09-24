const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadMain = require('./helpers/main-context.cjs');

test('Googlevideo receives bounded ranges, other providers keep their range', () => {
    const { run } = loadMain();
    assert.equal(run("getUpstreamRange('https://r1.googlevideo.com/a', 'bytes=0-')"), 'bytes=0-1048575');
    assert.equal(run("getUpstreamRange('https://r1.googlevideo.com/a', 'bytes=2000000-')"), 'bytes=2000000-3048575');
    assert.equal(run("getUpstreamRange('https://r1.googlevideo.com/a', 'bytes=100-150')"), 'bytes=100-150');
    assert.equal(run("getUpstreamRange('https://r1.googlevideo.com/a', undefined)"), 'bytes=0-1048575');
    assert.equal(run("getUpstreamRange('https://cdn.example.com/a', 'bytes=100-')"), 'bytes=100-');
    assert.equal(run("getUpstreamRange('https://notgooglevideo.com/a', 'bytes=0-')"), 'bytes=0-');
});

test('signed stream expiry overrides the normal cache TTL', () => {
    const { run } = loadMain();
    run("writeCachedStreamUrl('expired', 'https://example.com/audio?expire=1')");
    assert.equal(run("readCachedStreamUrl('expired')"), null);
    run("writeCachedStreamUrl('valid', 'https://example.com/audio')");
    assert.equal(run("readCachedStreamUrl('valid')"), 'https://example.com/audio');
});

test('split HLS video uses the master playlist, never a silent video rendition', () => {
    const { run } = loadMain();
    assert.equal(run(`pickPlayableUrl({formats:[{url:'https://example.com/video.m3u8',
        manifest_url:'https://example.com/master.m3u8',protocol:'m3u8_native',vcodec:'avc1',acodec:'none',height:720}]}, true, 720)`), 'https://example.com/master.m3u8');
    assert.equal(run("pickPlayableUrl({formats:[{url:'https://example.com/video.mp4',vcodec:'avc1',acodec:'none'}]}, true)"), null);
});

test('force refresh reaches the main-process cache and concurrent refreshes are shared', async () => {
    const { run, handlers } = loadMain();
    run("globalThis.calls = 0; getStreamUrlFast = async () => { calls++; await new Promise(r => setTimeout(r, 10)); return 'https://example.com/audio-' + calls; };");
    const resolve = handlers.get('resolve-track-stream');
    const track = { id: 'a7SkWyLhLbY', title: 'Track' };
    assert.equal((await resolve({}, track, 'audio')).url, 'https://example.com/audio-1');
    assert.equal((await resolve({}, track, 'audio')).url, 'https://example.com/audio-1');
    const result = await Promise.all([resolve({}, track, 'audio', { forceRefresh: true }), resolve({}, track, 'audio', { forceRefresh: true })]);
    assert.equal(result[0].url, 'https://example.com/audio-2');
    assert.equal(result[1].url, result[0].url);
    assert.equal(run('calls'), 2);
});

test('an old prefetch cannot overwrite a newer refreshed cache entry', async () => {
    const { run } = loadMain();
    run("globalThis.pending = []; getStreamUrlFast = () => new Promise(resolve => pending.push(resolve));");
    const old = run("getDirectStreamUrl('a7SkWyLhLbY')");
    const fresh = run("getDirectStreamUrl('a7SkWyLhLbY', 'audio', {forceRefresh:true})");
    run("pending[1]('https://example.com/fresh')");
    await fresh;
    run("pending[0]('https://example.com/old')");
    await old;
    assert.equal(await run("getDirectStreamUrl('a7SkWyLhLbY')"), 'https://example.com/fresh');
});

test('a failed concrete track never silently substitutes a different song', async () => {
    const { run } = loadMain();
    run("getDirectStreamUrl = async () => null; buildSearchStreamCandidates = () => { throw new Error('Must not search for replacement'); };");
    assert.equal(await run("resolveTrackStreamUrl({id:'a7SkWyLhLbY',title:'Known track'})"), null);
});

test('SoundCloud API failure still reaches the extractor for the same URL', async () => {
    const { run } = loadMain({ console: { log() {}, warn() {}, error() {} } });
    run("getSoundCloudStreamUrl = async () => { throw new Error('API failed'); }; getStreamUrlFast = async target => target + '/stream';");
    assert.equal(await run("getDirectStreamUrl('https://soundcloud.com/artist/track')"), 'https://soundcloud.com/artist/track/stream');
});

test('HTTP 403 is not reported as a healthy connection', async () => {
    const { run } = loadMain({ fetch: async () => new Response('', { status: 403 }) });
    const health = await run("timedFetch('https://example.com')");
    assert.equal(health.ok, false);
    assert.equal(health.error, 'HTTP 403');
});

test('clearing stream cache does not invalidate an active proxy token', async () => {
    const { run, handlers } = loadMain();
    run("controlServerInfo.url = 'http://127.0.0.1:12345'; createStreamProxyUrl('https://example.com/audio'); writeCachedStreamUrl('test', 'https://example.com/audio')");
    await handlers.get('stream-cache-clear')();
    assert.equal(run('streamUrlCache.size'), 0);
    assert.equal(run('streamProxyEntries.size'), 1);
});

test('provider failures are isolated and reported with successful results', async () => {
    const { run, handlers } = loadMain({ console: { log() {}, error() {} } });
    run("searchYouTubeWithYtSearch = async () => [{id:'a7SkWyLhLbY'}]; searchSoundCloudTracks = async () => { throw new Error('offline'); };");
    const result = await handlers.get('search-audio')({}, 'artist');
    assert.equal(result.tracks.length, 1);
    assert.equal(result.providers[0].ok, true);
    assert.equal(result.providers[1].ok, false);
});

test('failed providers are an error, not a misleading empty search', async () => {
    const { run, handlers } = loadMain({ console: { log() {}, error() {} } });
    run("searchYouTubeWithYtSearch = searchSoundCloudTracks = searchWithYtDlp = async () => { throw new Error('offline'); };");
    await assert.rejects(handlers.get('search-audio')({}, 'artist'));
});

test('network deadline releases a hanging provider', async () => {
    const { run } = loadMain();
    await assert.rejects(run("withDeadline(new Promise(() => {}), 20, 'Provider')"), /timeout/);
});

test('Discord being closed does not trigger a login storm; reset releases cooldown', async () => {
    const { run } = loadMain({ console: { log() {} } });
    run(`globalThis.logins = 0; DiscordRPC = { register() {}, Client: class {
        on() {} removeAllListeners() {} async destroy() {}
        async login() { logins++; throw new Error('Discord closed'); }
    }};`);
    await run('ensureDiscordReady()');
    await run('ensureDiscordReady()');
    assert.equal(run('logins'), 1);
    await run('resetDiscordPresenceClient()');
    await run('ensureDiscordReady()');
    assert.equal(run('logins'), 2);
});

test('the real HTTP proxy handles open ranges, CORS and seeking', async () => {
    const ranges = [];
    const { run } = loadMain({ fetch: async (url, options) => {
        ranges.push(options.headers.Range);
        assert.match(options.headers.Range, /^bytes=\d+-\d+$/);
        return new Response(Buffer.from('audio'), { status: 206, headers: {
            'content-type': 'audio/mp4', 'content-range': 'bytes 0-4/3000000', 'content-length': '5'
        } });
    } });
    try {
        await run('startControlServer(0)');
        const url = run("createStreamProxyUrl('https://r1.googlevideo.com/audio')");
        for (const range of ['bytes=0-', 'bytes=2000000-']) {
            const response = await fetch(url, { headers: { Range: range } });
            assert.equal(response.status, 206);
            assert.equal(response.headers.get('access-control-allow-origin'), '*');
            assert.equal(await response.text(), 'audio');
        }
        assert.deepEqual(ranges, ['bytes=0-1048575', 'bytes=2000000-3048575']);
    } finally { await run('controlServer ? new Promise(resolve => controlServer.close(resolve)) : Promise.resolve()'); }
});
