import { warehouseFromPack, closeInventory } from './test-region-controls.mjs';
/* SPDX-License-Identifier: MPL-2.0 */
// Declared inventory scenarios; test-rogue-playthrough-ui.mjs separately clicks a fresh run to completion.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.resolve('../kubi/node_modules/playwright')].filter(Boolean)) {
    try { playwright = require(candidate); break; } catch {}
}
assert(playwright, 'Provide an existing Playwright installation.');
const assets = path.resolve('android/app/src/main/assets/game');
const base = 'https://appassets.androidplatform.net/game/';
const output = path.resolve('.local/rogue-tests/storage-ui'); fs.mkdirSync(output, { recursive: true });
const errors = [], warnings = [], remote = [], missing = [], checks = [];
const normal = ' ordinary \n 木 ', database = ' database \t unchanged ';
const model = vm.createContext({ window: {}, localStorage: { getItem() { return null; } }, Uint8Array, btoa, atob });
for (const file of ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js']) vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), model);
const R = model.window.Rogue;
/** Constructs explicit local, remote, full-pack and expiring-shelter scenarios. */
function fixture(kind) {
    const s = R.state.create({ seed: 42, slot: 0, createdAt: 1 }); R.state.current = s;
    Object.assign(R.stores(s), { food: 1000, water: 100, wood: 400, stone: 100, fur: 30, iron: 30, spear: 2, coat: 1 });
    Object.assign(s.party.bag, { spear: 1, pack: 1, water: 8, food: 3, medicine: 2, wood: 5 }); s.party.weapon = 'spear';
    s.camps[0].pop = 4; R.settle.act(s, { type: 'recruit' });
    if (kind === 'partial') s.party.companions[0].bag = { water: 22 };
    if (kind !== 'camp' && kind !== 'partial') {
        const region = s.regions[s.party.region], tiles = R.rle.decode(region.tiles, region.size);
        for (let i = 0; i < tiles.length; i++) {
            const x = i % region.size, y = Math.floor(i / region.size);
            if (tiles[i] !== '.' || x < 6 || y < 6 || x > 54 || y > 54 || region.sites.some(p => p.x === x && p.y === y) || s.camps.some(p => p.x === x && p.y === y)) continue;
            Object.assign(s.party, { x, y }); R.map.reveal(s); break;
        }
        if (kind === 'temp' || kind === 'expiry') s.flags.tempCamp = { region: s.party.region, x: s.party.x, y: s.party.y, expiresAt: s.turn + (kind === 'expiry' ? 1 : 100), stores: { wood: 20 } };
    }
    assert(R.save.validate(s)); return s;
}
const browser = await playwright.chromium.launch({ headless: true });
/** Loads a declared scenario from the offline Android asset origin. */
async function setup(kind = 'camp', width = 360, height = 740, dark = false, font = 16) {
    const session = await browser.newContext({ viewport: { width, height }, offline: true, isMobile: width < 1100, hasTouch: width < 1100 });
    await session.addInitScript(({ raw, normal, database, dark, font }) => {
        if (sessionStorage.getItem('storage-ui')) return;
        localStorage.setItem('rogueSlot0', raw); localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
        localStorage.setItem('roguePreferences', JSON.stringify({ dark, font })); sessionStorage.setItem('storage-ui', '1');
    }, { raw: JSON.stringify(fixture(kind)), normal, database, dark, font });
    await session.route('**/*', async route => {
        const url = route.request().url(); if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
        const relative = decodeURIComponent(new URL(url).pathname.slice(6)), file = path.resolve(assets, relative); assert(file.startsWith(assets + path.sep));
        try { await route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream' }); }
        catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await session.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(base + 'index.html?mode=rogue&slot=0'); await page.waitForFunction(() => window.Rogue && Rogue.state.current);
    assert.equal(await page.evaluate(() => Rogue.ui.preferences.dark), dark);
    assert.equal(await page.evaluate(() => Rogue.ui.preferences.font), font);
    return { page, session };
}
/** Activates a visible control using browser hit testing. */
async function tap(locator) {
    assert.equal(await locator.count(), 1, String(locator));
    await locator.evaluate(n => { if (!n.closest('.rogue-bottom,.rogue-dialog-footer')) n.scrollIntoView({ block: 'center' }); }); await locator.click();
}
/** Reads authoritative state and protects both ordinary save strings. */
async function state(page) {
    const result = await page.evaluate(() => ({ save: Rogue.state.current, normal: localStorage.gameState, database: localStorage.getItem('adr.saveSlots.v1') }));
    assert.equal(result.normal, normal); assert.equal(result.database, database); return result.save;
}
/** Checks touch targets, translations, horizontal fit and fixed dialog return actions. */
async function fit(page, tag) {
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const bad = await page.evaluate(() => {
        const issues = []; if (document.documentElement.scrollWidth > innerWidth + 1) issues.push('overflow'); if (document.body.innerText.includes('!!')) issues.push('translation');
        for (const n of document.querySelectorAll('#rogue-root button')) {
            if (!n.getClientRects().length || n.closest('[aria-hidden="true"]')) continue;
            const b = n.getBoundingClientRect(); if (b.width < 43 || b.height < 43) issues.push('touch:' + n.textContent);
            if (b.left < -1 || b.right > innerWidth + 1) issues.push('horizontal:' + n.textContent);
            if (n.closest('.rogue-dialog-footer,.rogue-bottom')) { const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); if (b.top < 56 || b.bottom > innerHeight + 1 || !hit || !n.contains(hit)) issues.push('blocked:' + n.textContent); }
        }
        return issues;
    });
    assert.deepEqual(bad, [], tag); await state(page);
}
/** Opens the manifest directly from the main camp dashboard. */
async function warehouse(page) { await warehouseFromPack(page); }
/** Records one verified behavior group. */
function mark(text) { checks.push(text); console.log('PASS ' + text); }
try {
    {
        const { page, session } = await setup(); await warehouse(page); assert.equal(await page.getByRole('dialog').count(), 1);
        await page.screenshot({ path: path.join(output, 'warehouse-direct.png') });
        await tap(page.locator('[data-focus="storage-filter:materials"]'));
        const initial = await state(page); await tap(page.locator('[data-focus="store-put:wood"]'));
        let s = await state(page); assert.equal(s.party.bag.wood, 0); assert.equal(s.camps[0].stores.wood, initial.camps[0].stores.wood + 5);
        await tap(page.locator('[data-focus="storage-quantity:1"]')); const turn = s.turn;
        await tap(page.locator('[data-focus="store-take:wood"]')); s = await state(page); assert.equal(s.party.bag.wood, 1); assert.equal(s.turn, turn + 1);
        await tap(page.locator('[data-focus="storage-quantity:all"]')); await tap(page.locator('[data-focus="store-take:wood"]')); s = await state(page); assert.equal(R.party.weight(s.party.bag), R.NUM.BAG_UPGRADED);
        assert(await page.locator('[data-focus="store-take:wood"]').isDisabled());
        const ally = s.party.companions[0]; await tap(page.locator('[data-focus="storage-member:' + ally.id + '"]'));
        await tap(page.locator('[data-focus="store-take:wood"]')); s = await state(page); assert.equal(R.party.weight(s.party.companions[0].bag), 24);
        await tap(page.locator('[data-focus="store-put:wood"]')); s = await state(page); assert.equal(s.party.companions[0].bag.wood, 0);
        const before = JSON.stringify(s); await tap(page.locator('[data-focus="storage-filter:gear"]')); await tap(page.locator('[data-focus="storage-quantity:10"]'));
        assert.equal(JSON.stringify(await state(page)), before); await fit(page, 'direct-warehouse');
        await closeInventory(page); await tap(page.locator('#rogue-tab-camp')); assert.equal(await page.locator('#rogue-root').getAttribute('data-camp-view'), 'overview'); await session.close();
    }
    mark('warehouse uses one direct manifest, clamps requested counts to stock and remaining capacity, selects companion packs and returns to the dashboard without advancing time');
    {
        const { page, session } = await setup('partial'); const ally = (await state(page)).party.companions[0];
        await tap(page.locator('#rogue-tab-party')); await tap(page.locator('#rogue-panel-party [data-focus="bagView:"]'));
        const item = page.locator('.rogue-dialog-content [data-focus="item:wood"]');
        for (let i = 0; !await item.count(); i++) { assert(i < 10); await tap(page.locator('.rogue-dialog-content [data-focus="bagPage:"]').last()); }
        await tap(item); const transfer = page.locator('[data-focus="transfer:' + ally.id + '"]'); assert.match(await transfer.innerText(), /×2$/);
        await tap(transfer); assert.equal((await state(page)).party.companions[0].bag.wood, 2); assert(await transfer.isDisabled()); await fit(page, 'partial-companion-transfer'); await session.close();
    }
    {
        const { page, session } = await setup('remote'); await tap(page.locator('#rogue-tab-camp'));
        assert.equal(await page.locator('[data-focus="camp-view:stores"]').count(), 0);
        await tap(page.locator('#rogue-tab-party')); await tap(page.locator('#rogue-panel-party [data-focus="bagView:"]'));
        await tap(page.getByRole('button', { name: '打开仓库', exact: true }));
        assert.match(await page.getByRole('dialog').innerText(), /回到据点后才能存取/);
        for (const control of await page.locator('.rogue-dialog .rogue-storage-row-actions button').all()) assert(await control.isDisabled());
        await fit(page, 'remote-read-only'); await session.close();
    }
    {
        const { page, session } = await setup('temp'); await warehouseFromPack(page);
        await page.screenshot({ path: path.join(output, 'temp-storage.png') });
        assert.match(await page.getByRole('dialog').innerText(), /80/); await tap(page.locator('[data-focus="storage-filter:materials"]'));
        const old = await state(page); await tap(page.locator('[data-focus="store-put:wood"]')); let s = await state(page);
        assert.equal(s.flags.tempCamp.stores.wood, 25); assert.equal(s.camps[0].stores.wood, old.camps[0].stores.wood);
        await page.reload(); await page.waitForFunction(() => Rogue.state.current); await warehouseFromPack(page);
        await tap(page.locator('[data-focus="storage-filter:materials"]')); await tap(page.locator('[data-focus="storage-quantity:1"]')); await tap(page.locator('[data-focus="store-take:wood"]'));
        s = await state(page); assert.equal(s.flags.tempCamp.stores.wood, 24); assert.equal(s.party.bag.wood, 1);
        await closeInventory(page); await tap(page.locator('#rogue-tab-camp')); await tap(page.locator('[data-focus="camp-view:expansion"]'));
        await tap(page.locator('[data-focus="confirmPack:"]')); const before = JSON.stringify(await state(page)); await tap(page.getByRole('button', { name: '取消', exact: true })); assert.equal(JSON.stringify(await state(page)), before);
        await tap(page.locator('[data-focus="confirmPack:"]')); await tap(page.getByRole('button', { name: '确认', exact: true }));
        s = await state(page); assert(!s.flags.tempCamp); assert.equal(s.flags.caches[0].stores.wood, 24);
        await closeInventory(page); await warehouseFromPack(page);
        assert.equal(await page.locator('[data-focus^="store-put:"]').count(), 0); await tap(page.locator('[data-focus="storage-quantity:all"]')); await tap(page.locator('[data-focus="store-take:wood"]'));
        assert.equal((await state(page)).flags.caches.length, 0); await fit(page, 'empty-cache'); await session.close();
    }
    {
        const { page, session } = await setup('expiry'); await warehouseFromPack(page);
        await tap(page.locator('[data-focus="storage-filter:materials"]')); await tap(page.locator('[data-focus="store-put:wood"]'));
        const s = await state(page); assert(!s.flags.tempCamp); assert.equal(s.flags.caches[0].stores.wood, 25);
        assert.match(await page.getByRole('dialog').innerText(), /现场|所在位置|营地/);
        assert.equal(await page.locator('[data-focus="store-take:wood"]').count(), 0);
        await tap(page.locator('.rogue-dialog-footer [data-focus="closeModal:"]')); await warehouseFromPack(page); assert.match(await page.getByRole('dialog').innerText(), /遗留物资/); await session.close();
    }
    mark('remote stores are read-only; shelter supplies survive reload, confirmed dismantling and expiry, remain at the original tile and are picked up without duplication');
    {
        const { page, session } = await setup('camp', 360, 850, true, 22); const before = JSON.stringify(await state(page));
        assert.equal(await page.locator('#rogue-explore-preview').count(), 0);
        await tap(page.locator('[data-focus="journal-toggle"]')); assert.equal(await page.getByRole('dialog').count(), 1);
        await fit(page, 'large-font-preview-fallback'); await page.keyboard.press('Escape'); assert.equal(JSON.stringify(await state(page)), before); await session.close();
    }
    let journalLayouts = 0;
    for (const [width, height, font] of [[320, 512, 22], [360, 740, 16], [360, 900, 16], [412, 1000, 16], [412, 1200, 16], [412, 915, 20], [740, 360, 16], [1440, 900, 16]]) {
        for (const dark of [false, true]) {
            const { page, session } = await setup('camp', width, height, dark, font); const tag = width + 'x' + height + (dark ? '-dark' : '-light');
            await fit(page, tag + '-map');
            if (width < 1100 && height >= 850) {
                const before = JSON.stringify(await state(page));
                await tap(page.locator('[data-focus="journal-toggle"]'));
                assert.equal(await page.locator('.rogue-journal-fullscreen').count(), 1);
                assert.equal(await page.locator('#rogue-explore-preview').count(), 0);
                await fit(page, tag + '-journal'); await page.keyboard.press('Escape'); journalLayouts++;
                assert.equal(JSON.stringify(await state(page)), before);
                await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: path.join(output, 'map-' + tag + '.png') });
                await page.setViewportSize({ width, height: 740 }); await page.waitForFunction(() => !document.getElementById('rogue-explore-preview'));
                await tap(page.locator('[data-focus="journal-toggle"]')); assert.equal(await page.getByRole('dialog').count(), 1); await page.keyboard.press('Escape');
                await page.setViewportSize({ width, height: 1400 }); assert.equal(await page.locator('#rogue-explore-preview').count(), 0);
                await page.setViewportSize({ width, height });
            }
            await warehouse(page); await fit(page, tag + '-warehouse'); await page.screenshot({ path: path.join(output, 'warehouse-' + tag + '.png'), fullPage: true });
            const turn = (await state(page)).turn; await tap(page.locator('[data-focus="storage-filter:gear"]')); await tap(page.locator('[data-focus="storage-quantity:1"]')); await tap(page.locator('[data-focus="store-take:spear"]'));
            assert.equal((await state(page)).turn, turn + 1); await fit(page, tag + '-withdraw');
            if (width < 1100) { await closeInventory(page); await tap(page.locator('#rogue-tab-camp')); assert.equal(await page.locator('#rogue-root').getAttribute('data-camp-view'), 'overview'); }
            await session.close();
        }
    }
    assert(journalLayouts > 0, 'exercise fullscreen journal without the removed exploration shortcuts');
    mark('sixteen day/night layouts cover direct storage, narrow-screen actions, fixed returns and expandable journals across resizing');
    assert.deepEqual({ errors, warnings, remote, missing }, { errors: [], warnings: [], remote: [], missing: [] });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, layouts: 14, errors, warnings, remote, missing }, null, 2));
} finally { await browser.close(); }
