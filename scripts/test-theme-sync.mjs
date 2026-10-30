/* SPDX-License-Identifier: MPL-2.0 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assets = path.join(root, 'android/app/src/main/assets/game');
const base = 'https://appassets.androidplatform.net/game/';
const output = path.join(root, '.local/theme-tests');
const failures = [];
const browser = await chromium.launch({ headless: true });
await fs.mkdir(output, { recursive: true });
/** Creates an isolated offline origin with synthetic storage only. */
async function setup(seed = {}) {
    const context = await browser.newContext({ viewport: { width: 360, height: 740 }, offline: true });
    await context.addInitScript(seed => {
        if (location.origin !== 'https://appassets.androidplatform.net') return;
        if (localStorage.getItem('__theme_test')) return;
        Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
        localStorage.setItem('__theme_test', 'true');
    }, seed);
    await context.route('**/*', async route => {
        const url = route.request().url();
        if (!url.startsWith(base)) { failures.push('remote:' + url); await route.abort(); return; }
        const file = path.resolve(assets, decodeURIComponent(new URL(url).pathname.slice('/game/'.length)));
        assert(file.startsWith(assets + path.sep));
        const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.flac': 'audio/flac', '.ico': 'image/x-icon' };
        try { await route.fulfill({ body: await fs.readFile(file), contentType: types[path.extname(file)] || 'application/octet-stream' }); }
        catch { failures.push('missing:' + url); await route.fulfill({ status: 404, body: '' }); }
    });
    context.on('page', page => {
        page.on('pageerror', error => failures.push(error.message));
        page.on('console', message => { if (['error', 'warning'].includes(message.type())) failures.push(message.text()); });
    });
    return context;
}
/** Confirms actual rendered colors, rather than only a preference flag. */
async function colors(page, dark, kind) {
    await page.waitForFunction(({ dark, kind }) => {
        if (kind === 'normal') return window.OfflineGame && window.State && document.body.classList.contains('offline-dark') === dark && Engine.isLightsOff() === dark;
        return kind === 'home' ? window.OfflineHome && document.documentElement.classList.contains('home-dark') === dark :
            window.Rogue && Rogue.ui && document.getElementById('rogue-root') && Rogue.ui.preferences.dark === dark && document.documentElement.classList.contains('rogue-dark') === dark;
    }, { dark, kind });
    assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), dark ? 'rgb(39, 40, 35)' : 'rgb(255, 255, 255)');
}
try {
    const context = await setup();
    const home = await context.newPage();
    await home.goto(base + 'home.html');
    await colors(home, false, 'home');
    await home.screenshot({ path: path.join(output, 'home-light.png') });
    await home.locator('#offline-home-theme').click();
    await colors(home, true, 'home');
    await home.screenshot({ path: path.join(output, 'home-dark.png') });
    assert.equal(await home.evaluate(() => localStorage.getItem('gameState')), null);
    assert.equal(await home.evaluate(() => localStorage.getItem('adr.saveSlots.v1')), null);
    await home.reload();
    await colors(home, true, 'home');
    const rogue = await context.newPage();
    await rogue.goto(base + 'index.html?mode=rogue');
    await colors(rogue, true, 'rogue');
    await rogue.locator('.rogue-slot-open').first().click();
    await rogue.locator('#rogue-seed').fill('42');
    await rogue.getByRole('button', { name: '点燃第一堆火', exact: true }).click();
    const run = await rogue.evaluate(() => JSON.stringify(Rogue.state.current));
    await rogue.locator('#rogue-menu').click();
    await rogue.getByRole('button', { name: '日间', exact: true }).click();
    await colors(rogue, false, 'rogue');
    await colors(home, false, 'home');
    assert.equal(await rogue.evaluate(() => JSON.stringify(Rogue.state.current)), run);
    const normal = await context.newPage();
    await normal.goto(base + 'index.html');
    await colors(normal, false, 'normal');
    await normal.locator('#offline-menu-button').click();
    await normal.locator('#offline-lights').click();
    await colors(normal, true, 'normal');
    await colors(home, true, 'home');
    await colors(rogue, true, 'rogue');
    await normal.evaluate(() => { OfflineGame.pause(); OfflineGame.save(); });
    await normal.close();
    const normalBytes = await home.evaluate(() => [localStorage.gameState, localStorage.getItem('adr.saveSlots.v1')]);
    await rogue.getByRole('button', { name: '日间', exact: true }).click();
    await colors(home, false, 'home');
    assert.deepEqual(await home.evaluate(() => [localStorage.gameState, localStorage.getItem('adr.saveSlots.v1')]), normalBytes);
    assert.equal(await rogue.evaluate(() => JSON.stringify(Rogue.state.current)), run);
    await rogue.reload();
    await colors(rogue, false, 'rogue');
    assert.equal(await rogue.evaluate(() => JSON.stringify(Rogue.state.current)), run);
    const resumed = await context.newPage();
    await resumed.goto(base + 'index.html');
    await colors(resumed, false, 'normal');
    await resumed.close();
    await home.locator('#offline-home-theme').click();
    await colors(rogue, true, 'rogue');
    await rogue.locator('#rogue-tab-camp').click();
    assert.equal(await rogue.locator('.rogue-camp-menu > button').count(), 4);
    assert.equal(await rogue.locator('#rogue-panel-camp .rogue-priced, #rogue-panel-camp .rogue-work-choice').count(), 0);
    await rogue.screenshot({ path: path.join(output, 'camp-dark.png'), fullPage: true });
    await home.locator('#offline-home-theme').click();
    await colors(rogue, false, 'rogue');
    await rogue.screenshot({ path: path.join(output, 'camp-light.png'), fullPage: true });
    await rogue.locator('[data-focus="camp-view:buildings"]').click();
    const details = rogue.locator('.rogue-priced details').first();
    assert.equal(await details.getAttribute('open'), null);
    const beforeDetails = await rogue.evaluate(() => JSON.stringify(Rogue.state.current));
    await details.locator('summary').click();
    assert(await details.locator('.rogue-note').isVisible());
    await rogue.locator('#rogue-menu').click();
    await rogue.getByRole('button', { name: '夜间', exact: true }).click();
    await rogue.locator('.rogue-dialog-footer button').click();
    assert.notEqual(await rogue.locator('.rogue-priced details').first().getAttribute('open'), null);
    assert.equal(await rogue.evaluate(() => JSON.stringify(Rogue.state.current)), beforeDetails);
    await context.close();
    for (const seed of [
        { gameState: '{"config":{"lightsOff":true}}' },
        { gameState: '{broken', 'adr.saveSlots.v1': '{broken-slots', roguePreferences: '{"dark":true,"font":20,"waterWarning":false,"custom":"keep"}' },
        { gameState: '{broken', roguePreferences: '{broken' }
    ]) {
        const isolated = await setup(seed);
        const page = await isolated.newPage();
        await page.goto(base + 'home.html');
        const dark = seed.roguePreferences !== '{broken';
        await colors(page, dark, 'home');
        const before = await page.evaluate(() => [localStorage.gameState, localStorage.getItem('adr.saveSlots.v1')]);
        await page.locator('#offline-home-theme').click();
        await colors(page, !dark, 'home');
        assert.deepEqual(await page.evaluate(() => [localStorage.gameState, localStorage.getItem('adr.saveSlots.v1')]), before);
        if (seed.roguePreferences?.includes('custom')) assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.roguePreferences)), { dark: false, font: 20, waterWarning: false, custom: 'keep' });
        await isolated.close();
    }
    const blocked = await setup();
    const page = await blocked.newPage();
    await page.goto(base + 'home.html');
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key === 'roguePreferences') throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
    });
    await page.locator('#offline-home-theme').click();
    await colors(page, false, 'home');
    assert(await page.locator('#offline-home-feedback').isVisible());
    await page.goto(base + 'index.html');
    await colors(page, false, 'normal');
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) { if (key === 'roguePreferences') throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
    });
    await page.locator('#offline-menu-button').click();
    await page.locator('#offline-lights').click();
    await colors(page, false, 'normal');
    assert.match(await page.locator('#saveNotify').innerText(), /设置保存失败/);
    await blocked.close();
    assert.deepEqual(failures, []);
    console.log('PASS shared colors across home, normal and survival, bidirectional changes, live pages, reload and stale saved themes');
    console.log('PASS normal save bytes, Rogue turns, corrupt-save fallback, preference fields and storage failure preserved');
    console.log('PASS four camp destinations, no duplicate quick recipes, readable details and disclosure state across renders');
} finally { await browser.close(); }
