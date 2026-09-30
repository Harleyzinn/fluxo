const { _electron: electron } = require('playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
    const root = path.resolve(__dirname, '..');
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fluxo-themes-'));
    const packaged = process.env.FLUXO_EXECUTABLE;
    const app = await electron.launch({ executablePath: packaged || require('electron'), args: [...(packaged ? [] : [root]), `--user-data-dir=${profile}`] });
    const failures = [], errors = [];
    try {
        const page = await app.firstWindow();
        page.on('pageerror', error => { if (!error.stack?.includes('logSecurityWarnings')) errors.push(error.message); });
        await page.waitForFunction(() => typeof currentHotkeys !== 'undefined');
        await page.evaluate(() => {
            prefetchStream = () => {}; smartPrefetchUpcoming = () => {};
            const titles = ['Carnaval', 'Botas Verdes de Neon', 'Morgana', 'Lana', 'Fantasia Sombria', 'Acustico', 'Chuva', 'Noite'];
            queue = titles.map((title, i) => ({ id: `fixture-${i}`, title, artist: 'Kamaitachi', thumbnail: 'https://i.ytimg.com/vi/a7SkWyLhLbY/hqdefault.jpg' }));
            originalQueue = [...queue];
            titleEl.innerText = 'Carnaval'; artistEl.innerText = 'Kamaitachi';
            coverEl.style.backgroundImage = `url('${queue[0].thumbnail}')`; coverIcon.style.display = 'none';
        });
        const themes = await page.evaluate(() => COLLECTION_THEMES.map(theme => theme.id));
        async function checkButton(id, context) {
            const state = await page.locator(`#${id}`).evaluate(el => {
                const r = el.getBoundingClientRect();
                const visible = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight + 1 && r.right <= innerWidth + 1;
                const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
                return { visible, reachable: !!target && (el === target || el.contains(target)), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
            });
            if (!state.visible || !state.reachable) failures.push({ context, id, ...state });
        }
        for (const [width, height] of [[1200, 800], [800, 600]]) {
            await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setSize(...size), [width, height]);
            for (const theme of themes) {
                await page.locator('#btnThemes').click();
                await page.locator('#themeSearchInput').fill(theme);
                await page.locator(`[data-theme-id="${theme}"]`).click();
                await page.locator('#btnQueueView').click();
                await page.waitForTimeout(350);
                for (const id of ['playPauseBtn', 'prevBtn', 'nextBtn', 'shuffleBtn', 'loopBtn', 'autoMixBtn', 'crossfadeBtn', 'btnSpeedFx', 'btnToggleVideo', 'btnPiP', 'btnFullscreen', 'volumeSlider', 'btnSearch', 'searchInput']) await checkButton(id, `${theme}/${width}/queue`);
                await page.screenshot({ path: path.join(profile, `${theme}-${width}-queue.png`) });
                await page.locator('#btnEQ').click();
                await page.waitForTimeout(100);
                const overflow = await page.locator('#resultsList').evaluate(el => el.scrollWidth > el.clientWidth + 3);
                if (overflow) failures.push({ context: `${theme}/${width}/equalizer`, overflow });
                await page.locator('.eq-band').last().scrollIntoViewIfNeeded();
                await page.screenshot({ path: path.join(profile, `${theme}-${width}-eq.png`) });
                await page.locator('#btnPartyMode').click();
                await page.waitForTimeout(300);
                for (const id of ['playPauseBtn', 'prevBtn', 'nextBtn', 'btnExitParty']) await checkButton(id, `${theme}/${width}/party`);
                await page.screenshot({ path: path.join(profile, `${theme}-${width}-party.png`) });
                await page.locator('#btnExitParty').click();
                await page.locator('#btnMiniPlayer').click();
                await page.waitForTimeout(300);
                for (const id of ['playPauseBtn', 'btnExitMini', 'btnPinMini']) await checkButton(id, `${theme}/${width}/mini`);
                await page.locator('#btnExitMini').click();
                await page.waitForTimeout(300);
                console.log('Checked', theme, width);
            }
        }
        fs.writeFileSync(path.join(profile, 'results.json'), JSON.stringify({ failures, errors }, null, 2));
        console.log(JSON.stringify({ profile, failures, errors }));
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
    } finally { await app.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
