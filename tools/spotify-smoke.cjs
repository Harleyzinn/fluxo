const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
async function main() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-spotify-'));
    const executablePath = process.env.FLUXO_EXECUTABLE || require('electron');
    const app = await electron.launch({ executablePath, args: [...(process.env.FLUXO_EXECUTABLE ? [] : [path.resolve(__dirname, '..')]), `--user-data-dir=${profile}`, '--autoplay-policy=no-user-gesture-required'] });
    try {
        const page = await app.firstWindow();
        await page.waitForFunction(() => typeof executeSearch === 'function');
        await page.evaluate(() => { audioPlayer.muted = true; });
        await page.locator('#searchInput').fill('spotify:track:4cOdK2wGLETKBW3PvgPWqT');
        await page.locator('#btnSearch').click();
        await page.locator('#btnYtImportAll').waitFor({ timeout: 30000 });
        assert.equal(await page.locator('.yt-import-row').count(), 1);
        assert.match(await page.locator('.yt-import-info').innerText(), /Rick Astley/);
        await page.locator('#btnYtSaveSelected').click();
        const saved = await page.evaluate(() => savedPlaylists.at(-1));
        assert.equal(saved.tracks[0].isGhost, true);
        await page.locator('#btnYtImportAll').click();
        await page.locator('#btnPlayPreview').click();
        await page.waitForFunction(() => !audioPlayer.paused && audioPlayer.currentTime > 2, null, { timeout: 90000 });
        console.log(JSON.stringify({ profile, spotifyImportAndPlayback: await page.evaluate(() => ({ title: titleEl.innerText, artist: artistEl.innerText, time: audioPlayer.currentTime, duration: audioPlayer.duration, id: audioPlayer.dataset.id, error: audioPlayer.error?.message })) }));
        await page.screenshot({ path: path.join(profile, 'spotify-playback.png') });
    } finally { await app.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
