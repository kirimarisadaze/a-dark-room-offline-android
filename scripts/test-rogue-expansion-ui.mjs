/* SPDX-License-Identifier: MPL-2.0 */
// Verify late-game management, explored topology and deliberate cargo disposal offline.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
    try { playwright = require(candidate); break; } catch {}
}
assert(playwright, 'Use an existing Playwright installation.');
const assets = path.join(root, 'android/app/src/main/assets/game');
const output = path.join(root, '.local/rogue-tests');
const save = JSON.parse(await fs.readFile(path.join(output, 'completed-run.json'), 'utf8'));
assert.equal(save.version, 3, 'Run test-rogue.mjs --playthrough first.');
save.over = false; delete save.endReason;
const home = save.camps[save.activeCamp];
save.party.region = home.region; save.party.x = home.x; save.party.y = home.y;
save.party.bag.wood = 17;
const raw = JSON.stringify(save), normal = ' {"ordinary":"unchanged"} \n', database = ' {"slots":"unchanged"} ';
const base = 'https://appassets.androidplatform.net/game/';
const errors = [], warnings = [], remote = [], missing = [];
const browser = await playwright.chromium.launch({ headless: true });
/** Checks the horizontal bounds and touch sizes of all visible controls. */
async function fit(page) {
    const problems = await page.evaluate(() => {
        const result = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) result.push('page overflow');
        for (const node of document.querySelectorAll('#rogue-root button')) {
            if (!node.getClientRects().length || node.closest('[aria-hidden="true"]')) continue;
            const box = node.getBoundingClientRect();
            if (box.width < 43 || box.height < 43 || box.left < -1 || box.right > innerWidth + 1) result.push(node.getAttribute('data-focus'));
        }
        if (document.body.innerText.includes('!!')) result.push('missing translation');
        return result;
    });
    assert.deepEqual(problems, []);
}
try {
    for (const [width, height, font, dark] of [[320, 512, 22, true], [360, 740, 16, false], [412, 915, 16, true], [1440, 900, 16, true]]) {
        const context = await browser.newContext({ viewport: { width, height }, offline: true, isMobile: width < 1100, hasTouch: width < 1100 });
        await context.addInitScript(({ raw, normal, database, font, dark }) => {
            if (sessionStorage.getItem('expansion-seeded')) return;
            localStorage.setItem('rogueSlot0', raw); localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
            localStorage.setItem('roguePreferences', JSON.stringify({ font, dark })); sessionStorage.setItem('expansion-seeded', 'true');
        }, { raw, normal, database, font, dark });
        await context.route('**/*', async route => {
            const url = route.request().url();
            if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
            const relative = decodeURIComponent(new URL(url).pathname.slice('/game/'.length));
            const file = path.resolve(assets, relative);
            if (!file.startsWith(assets + path.sep)) { await route.abort(); return; }
            try {
                const type = path.extname(file) === '.js' ? 'application/javascript' : path.extname(file) === '.css' ? 'text/css' : 'text/html';
                await route.fulfill({ body: await fs.readFile(file), contentType: type });
            } catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
        });
        const page = await context.newPage();
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
        await page.goto(base + 'index.html?mode=rogue&slot=0');
        await page.waitForFunction(() => Rogue.state.current);
        await page.getByRole('button', { name: '区域图', exact: true }).click();
        assert.equal(await page.locator('.rogue-world-chart rect').count(), 9);
        assert(!/危险|难度/.test(await page.getByRole('dialog').innerText()));
        await fit(page);
        await page.screenshot({ path: path.join(output, 'explored-world-' + width + '.png') });
        await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
        await page.locator('#rogue-tab-camp').evaluate(node => node.click());
        assert.equal(await page.locator('.rogue-menu-tile').count(), 6);
        const turn = await page.evaluate(() => Rogue.state.current.turn);
        for (const view of ['stores', 'workers', 'buildings', 'recipes', 'research', 'expansion']) {
            await page.locator('[data-focus="camp-view:' + view + '"]').click(); await fit(page);
            if (view === 'recipes') {
                await page.locator('[data-focus="filter:modules"]').click();
                assert(await page.locator('#rogue-panel-camp .rogue-priced').count() >= 2);
                await fit(page); await page.screenshot({ path: path.join(output, 'ship-recipes-' + width + '.png') });
            }
            if (view === 'expansion') assert.equal(await page.locator('[data-focus="newCamp:"]').isDisabled(), true);
            await page.locator('[data-focus="camp-return"]').click();
        }
        assert.equal(await page.evaluate(() => Rogue.state.current.turn), turn);
        await page.locator('#rogue-tab-party').evaluate(node => node.click());
        await page.locator('[data-focus="bagView:"]').click();
        while (!await page.locator('[data-focus="item:wood"]').count()) await page.locator('[data-focus="bagPage:"]').last().click();
        await page.locator('[data-focus="item:wood"]').click();
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await page.locator('[data-focus="confirmDrop:wood"]').click();
        assert.match(await page.getByRole('dialog').innerText(), /10 份木头/);
        await page.getByRole('button', { name: '取消', exact: true }).click();
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await page.locator('[data-focus="confirmDrop:wood"]').click();
        await page.getByRole('button', { name: '确认', exact: true }).click();
        assert.equal(await page.evaluate(() => Rogue.state.current.party.bag.wood), 7);
        assert.equal(await page.evaluate(() => Rogue.state.current.turn), turn + 1);
        const after = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await page.reload(); await page.waitForFunction(() => Rogue.state.current);
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), after);
        assert.equal(await page.evaluate(() => localStorage.gameState), normal);
        assert.equal(await page.evaluate(() => localStorage.getItem('adr.saveSlots.v1')), database);
        await context.close();
    }
    assert.deepEqual({ errors, warnings, remote, missing }, { errors: [], warnings: [], remote: [], missing: [] });
    await fs.writeFile(path.join(output, 'expansion-ui-report.json'), JSON.stringify({ passed: true, layouts: 4, errors, warnings, remote, missing }, null, 2));
    console.log('PASS four late-game layouts, nine explored regions, unlocked modules, camp limit, confirmed/cancelled cargo disposal, reload and normal save isolation');
} finally { await browser.close(); }
