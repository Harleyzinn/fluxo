const { test } = require('node:test');
const assert = require('node:assert/strict');
const loadMain = require('./helpers/main-context.cjs');
const embed = entity => `<script type="application/json" nonce="test" id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
const track = { id: '4cOdK2wGLETKBW3PvgPWqT', uri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', title: 'Never Gonna Give You Up', artists: [{ name: 'Rick Astley' }], duration: 213573 };
test('Spotify individual tracks preserve artist, duration and real cover', () => {
    const { run, context } = loadMain();
    context.html = embed({ ...track, visualIdentity: { image: [{ url: 'small', maxWidth: 64 }, { url: 'large', maxWidth: 640 }] } });
    const result = run("parseSpotifyEmbed(html, 'track')");
    assert.equal(result.tracks.length, 1);
    assert.equal(result.tracks[0].artist, 'Rick Astley');
    assert.equal(result.tracks[0].duration, '3:34');
    assert.equal(result.tracks[0].thumbnail, 'large');
    assert.equal(result.tracks[0].isGhost, true);
    assert.equal(result.warning, '');
});
test('Spotify collection filters invalid rows but never imposes an app track limit', () => {
    const { run, context } = loadMain();
    context.html = embed({ name: 'Collection', trackList: [...Array.from({ length: 251 }, () => ({ ...track, subtitle: 'Artist' })), null, {}, { title: 'Podcast', entityType: 'episode' }] });
    const result = run("parseSpotifyEmbed(html, 'playlist')");
    assert.equal(result.tracks.length, 251);
    assert.match(result.warning, /parcial/);
});
test('Spotify URI and localized URL work while external redirect targets are rejected', async () => {
    const { run, handlers } = loadMain({ fetch: async url => url.startsWith('https://spotify.link/')
        ? { status: 302, headers: new Headers({ location: 'https://localhost/private' }) }
        : { ok: true, text: async () => embed(track) } });
    assert.match(await run(`resolveSpotifyUrl('${track.uri}')`), /open.spotify.com\/track\//);
    const result = await handlers.get('get-spotify-info')(null, `https://open.spotify.com/intl-pt/track/${track.id}?si=test`);
    assert.equal(result.tracks.length, 1);
    await assert.rejects(run("resolveSpotifyUrl('https://spotify.link/test')"), /link publico/);
    await assert.rejects(run("resolveSpotifyUrl('https://open.spotify.com.evil.test/track/test')"), /link publico/);
});
test('Spotify reports HTTP failures and changed/private metadata without success', async () => {
    const { handlers } = loadMain({ fetch: async () => ({ ok: false, status: 429 }) });
    assert.match((await handlers.get('get-spotify-info')(null, track.uri)).error, /429/);
    assert.throws(() => loadMain().run("parseSpotifyEmbed('<html></html>', 'playlist')"), /publica/);
});
