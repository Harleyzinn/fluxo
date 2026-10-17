const loadMain = require('../tests/helpers/main-context.cjs');
async function main() {
    const ids = [['track', '4cOdK2wGLETKBW3PvgPWqT'], ['album', '4aawyAB9vmqN3uQ7FjRGTy'], ['playlist', '37i9dQZF1DXcBWIGoYBM5M']];
    for (const [type, id] of ids) {
        const { handlers } = loadMain();
        const result = await handlers.get('get-spotify-info')(null, `https://open.spotify.com/intl-pt/${type}/${id}?si=test`);
        if (result.error || !result.tracks?.length) throw new Error(JSON.stringify(result));
        console.log(JSON.stringify({ type, count: result.tracks.length, title: result.title, first: result.tracks[0], warning: result.warning }));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
