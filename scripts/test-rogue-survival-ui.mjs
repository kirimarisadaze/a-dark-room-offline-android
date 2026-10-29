/* SPDX-License-Identifier: MPL-2.0 */
// Focused scenario-fixture UI tests; the separate playthrough starts a fresh untouched run.
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
assert(playwright, 'Use an existing Playwright installation through PLAYWRIGHT_MODULE.');
const { chromium } = playwright;
const assets = path.resolve('android/app/src/main/assets/game');
const base = 'https://appassets.androidplatform.net/game/';
const output = path.resolve('.local/rogue-tests/survival-ui'); fs.mkdirSync(output, { recursive: true });
const errors = [], warnings = [], remote = [], missing = [], checks = [];
const normal = ' {"ordinary":"木"} \n', database = ' {"normal slots":"unchanged"} ';
const context = vm.createContext({ window: {}, localStorage: { getItem() { return null; } }, Uint8Array, btoa, atob });
for (const file of ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js']) vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), context);
const R = context.window.Rogue;
/** Constructs explicit focused-test data without altering any full-playthrough run. */
function fixture(kind = 'party') {
    const s = R.state.create({ seed: 42, slot: 0, createdAt: 1 }); R.state.current = s;
    Object.assign(R.stores(s), { food: 1000, wood: 400, stone: 200, fur: 100, iron: 100 });
    Object.assign(s.party.bag, { spear: 2, coat: 1, pack: 1, water: 20, medicine: 4 }); s.party.weapon = 'spear';
    s.camps[0].buildings = { workshop: 1, well: 1 }; s.camps[0].pop = 4;
    R.settle.act(s, { type: 'recruit' });
    if (kind === 'merchant') { R.wild.start(s, 'merchant'); for (const o of s.flags.wildEvent.offers) R.add(s.party.bag, o.cost); }
    if (kind === 'combat') R.combat.encounter(s, { kind: 'wild', depth: 4 });
    if (kind === 'outpost') {
        const f = s.regions['0,0'].sites.find(x => x.type === 'outpost'); f.assault = 5; f.state = 'cleared';
        Object.assign(s.party, { x: f.x, y: f.y });
        s.camps.push({ id: 1, region: '0,0', x: 30, y: 30, pop: 1, fire: 1, stores: {}, jobs: {}, buildings: {} });
        s.flags.outpost = f.id; s.flags.campSerial = 2;
    }
    if (kind === 'ending') { s.party.hp = 0; s.over = true; s.endReason = 'died'; }
    assert(R.save.validate(s)); return s;
}
const browser = await chromium.launch({ headless: true });
/** Opens one fully offline page from a declared fixture and separately stored user preferences. */
async function setup(kind, width = 360, height = 740, dark = false, font = 16) {
    const session = await browser.newContext({ viewport: { width, height }, offline: true, isMobile: width < 1100, hasTouch: width < 1100 });
    await session.addInitScript(({ raw, normal, database, dark, font }) => {
        if (sessionStorage.getItem('survival-ui')) return;
        localStorage.setItem('rogueSlot0', raw); localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
        localStorage.setItem('roguePreferences', JSON.stringify({ dark, font })); sessionStorage.setItem('survival-ui', '1');
    }, { raw: JSON.stringify(fixture(kind)), normal, database, dark, font });
    await session.route('**/*', async route => {
        const url = route.request().url(); if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
        const relative = decodeURIComponent(new URL(url).pathname.slice(6)); const file = path.resolve(assets, relative); assert(file.startsWith(assets + path.sep));
        try { await route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream' }); }
        catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await session.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(base + 'index.html?mode=rogue&slot=0'); await page.waitForFunction(() => window.Rogue && Rogue.state.current);
    return { page, session };
}
/** Uses browser hit-testing to activate a visible control in usable space. */
async function tap(locator) {
    await locator.evaluate(n => { if (!n.closest('.rogue-bottom,.rogue-dialog-footer')) n.scrollIntoView({ block: 'center' }); });
    await locator.click();
}
/** Reads authoritative state and verifies both ordinary save strings on every checkpoint. */
async function state(page) {
    const result = await page.evaluate(() => ({ save: Rogue.state.current, normal: localStorage.gameState, database: localStorage.getItem('adr.saveSlots.v1') }));
    assert.equal(result.normal, normal); assert.equal(result.database, database); return result.save;
}
/** Checks horizontal fit, touch targets, translations and unobstructed bottom dialog actions. */
async function fit(page, tag) {
    const result = await page.evaluate(() => {
        const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('overflow'); if (document.body.innerText.includes('!!')) bad.push('translation');
        for (const n of document.querySelectorAll('#rogue-root button')) {
            if (!n.getClientRects().length || n.closest('[aria-hidden="true"]')) continue;
            const b = n.getBoundingClientRect(); if (b.width < 43 || b.height < 43) bad.push('touch:' + n.textContent);
            if (b.left < -1 || b.right > innerWidth + 1) bad.push('horizontal:' + n.textContent);
            if (n.closest('.rogue-dialog-footer')) { const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); if (b.bottom > innerHeight + 1 || !hit || !n.contains(hit)) bad.push('blocked:' + n.textContent); }
        }
        return bad;
    });
    assert.deepEqual(result, [], tag); await state(page);
}
/** Returns through actual parent dialogs until the main panel is visible. */
async function closeAll(page) { for (let i = 0; await page.getByRole('dialog').count(); i++) { assert(i < 10); await tap(page.locator('.rogue-dialog-footer [data-focus="closeModal:"]')); } }
/** Opens a personal item by paging the visible inventory. */
async function item(page, name) {
    const target = page.locator('.rogue-dialog-content [data-focus="item:' + name + '"]');
    for (let i = 0; !await target.count(); i++) { assert(i < 10); await tap(page.locator('.rogue-dialog-content [data-focus="bagPage:"]').last()); }
    await tap(target);
}
/** Records a verified focused UI behavior. */
function mark(text) { checks.push(text); console.log('PASS ' + text); }
try {
    const { page, session } = await setup('party');
    await tap(page.locator('#rogue-tab-party'));
    await tap(page.getByRole('button', { name: '我的装备', exact: true }));
    await tap(page.getByRole('button', { name: '更换或卸下武器', exact: true }));
    await tap(page.getByRole('button', { name: '卸下', exact: true })); assert.equal((await state(page)).party.weapon, 'fists');
    await tap(page.locator('[data-focus="equip:spear"]')); await closeAll(page);
    await tap(page.locator('#rogue-panel-party [data-focus="bagView:"]')); await item(page, 'spear');
    await tap(page.locator('[data-focus="transfer:store"]')); assert.equal((await state(page)).party.weapon, 'spear');
    await tap(page.locator('[data-focus="transfer:store"]')); assert.equal((await state(page)).party.weapon, 'fists');
    await tap(page.locator('.rogue-dialog-footer [data-focus="closeModal:"]'));
    await tap(page.getByRole('button', { name: '打开仓库', exact: true }));
    await tap(page.locator('[data-focus="storage-filter:gear"]'));
    await tap(page.locator('[data-focus="storage-quantity:1"]'));
    await tap(page.locator('[data-focus="store-take:spear"]')); assert.equal((await state(page)).party.bag.spear, 1); await closeAll(page);
    const ally = (await state(page)).party.companions[0];
    await tap(page.locator('#rogue-panel-party [data-focus="bagView:"]')); await item(page, 'spear'); await tap(page.locator('[data-focus="transfer:' + ally.id + '"]')); await closeAll(page);
    await tap(page.locator('[data-focus="member:' + ally.id + '"]')); await tap(page.getByRole('button', { name: '更换或卸下武器', exact: true })); await tap(page.locator('[data-focus="equip:spear"]'));
    assert.equal((await state(page)).party.companions[0].weapon, 'spear'); await closeAll(page);
    await tap(page.locator('[data-focus="member:' + ally.id + '"]')); await tap(page.getByRole('button', { name: '留在据点', exact: true }));
    const before = JSON.stringify(await state(page)); await tap(page.getByRole('button', { name: '取消', exact: true })); assert.equal(JSON.stringify(await state(page)), before);
    await tap(page.getByRole('button', { name: '留在据点', exact: true })); await tap(page.getByRole('button', { name: '确认', exact: true }));
    assert.equal((await state(page)).party.companions.length, 0); assert.equal((await state(page)).camps[0].stores.spear, 2); await closeAll(page);
    await tap(page.locator('#rogue-tab-camp')); await tap(page.locator('[data-focus="camp-view:recipes"]')); await tap(page.locator('[data-focus="filter:tools"]'));
    await tap(page.locator('[data-focus="craft:waterskin"]')); assert(await page.locator('[data-focus="craft:waterskin"]').isDisabled()); assert.match(await page.locator('#rogue-panel-camp').innerText(), /40/);
    await tap(page.locator('#rogue-menu')); const toggle = page.getByRole('button', { name: '回营缺水提醒 · 开启', exact: true }); await tap(toggle);
    await page.reload(); await page.waitForFunction(() => Rogue.state.current); assert.equal(await page.evaluate(() => Rogue.ui.preferences.waterWarning), false);
    await tap(page.locator('#rogue-menu')); assert(await page.getByRole('button', { name: '回营缺水提醒 · 关闭', exact: true }).count());
    await fit(page, 'party-warehouse-unique-tool-settings'); await session.close();
    mark('real controls conserve gear through warehouse and companion transfers, allow dismissal, lock the crafted water skin and persist the warning preference');
    for (const kind of ['merchant', 'combat', 'outpost']) {
        const { page, session } = await setup(kind);
        if (kind === 'merchant') {
            const old = await state(page); await tap(page.locator('[data-focus="event-buy:0"]')); assert(await page.locator('[data-focus="event-buy:0"]').isDisabled());
            const after = await state(page); assert.equal(after.party.bag[old.flags.wildEvent.offers[0].item], (old.party.bag[old.flags.wildEvent.offers[0].item] || 0) + old.flags.wildEvent.offers[0].quantity);
            await page.reload(); await page.waitForFunction(() => Rogue.state.current); assert(await page.locator('[data-focus="event-buy:0"]').isDisabled());
            await tap(page.locator('.rogue-dialog-footer [data-focus="event:"]')); assert.equal((await state(page)).flags.wildEvent, undefined);
        } else if (kind === 'combat') {
            const chance = await page.evaluate(() => Math.round(Rogue.combat.escapeChance(Rogue.state.current.flags.combat) * 100));
            assert.match(await page.locator('[data-focus="combat:flee"]').innerText(), new RegExp(chance + '%'));
            await tap(page.locator('[data-focus="combat:guard"]'));
            const next = await page.evaluate(() => Math.round(Rogue.combat.escapeChance(Rogue.state.current.flags.combat) * 100)); assert(next < chance);
            await page.reload(); await page.waitForFunction(() => Rogue.state.current); assert.match(await page.locator('[data-focus="combat:flee"]').innerText(), new RegExp(next + '%'));
        } else {
            await tap(page.getByRole('button', { name: '迁入这里 · 替换第二据点', exact: true }));
            const old = JSON.stringify(await state(page)); await tap(page.getByRole('button', { name: '取消', exact: true })); assert.equal(JSON.stringify(await state(page)), old);
            await tap(page.getByRole('button', { name: '迁入这里 · 替换第二据点', exact: true })); await tap(page.getByRole('button', { name: '确认', exact: true }));
            const s = await state(page); assert.equal(s.camps.length, 2); assert.equal(s.camps[0].id, 0); assert(s.camps[1].capturedFrom);
        }
        await fit(page, kind); await page.screenshot({ path: path.join(output, kind + '.png') }); await session.close();
    }
    mark('merchant purchase/reload, displayed escape odds and confirmed/cancelled replacement of the second camp work through real controls');
    for (const [width, height, font] of [[320, 512, 22], [360, 740, 16], [412, 915, 20], [740, 360, 16], [1440, 900, 16]]) {
        for (const dark of [false, true]) {
            const { page, session } = await setup('party', width, height, dark, font); const tag = width + 'x' + height + (dark ? '-dark' : '-light');
            await fit(page, tag); await page.screenshot({ path: path.join(output, 'map-' + tag + '.png') });
            const log = await page.locator('#rogue-live-log').boundingBox(); assert(log.y >= 56 && log.y + log.height <= height);
            await tap(page.locator('#rogue-tab-party')); await tap(page.getByRole('button', { name: '我的装备', exact: true })); await fit(page, tag + '-member');
            await tap(page.getByRole('button', { name: '更换或卸下武器', exact: true })); await fit(page, tag + '-gear'); await closeAll(page);
            await tap(page.locator('#rogue-panel-party [data-focus="bagView:"]')); await fit(page, tag + '-bag'); await item(page, 'spear'); await fit(page, tag + '-transfer');
            await page.screenshot({ path: path.join(output, 'inventory-' + tag + '.png') }); await session.close();
            const ending = await setup('ending', width, height, dark, font); await fit(ending.page, tag + '-ending');
            const art = await ending.page.locator('.rogue-ending-illustration').evaluate(n => ({ viewBox: n.getAttribute('viewBox'), label: n.getAttribute('aria-label'), paths: n.querySelectorAll('path').length, width: n.getBoundingClientRect().width, left: n.getBoundingClientRect().left }));
            assert.equal(art.viewBox, '0 0 240 132'); assert.match(art.label, /柴堆/); assert(art.paths >= 4); assert(art.left >= 0 && art.left + art.width <= width);
            await ending.page.screenshot({ path: path.join(output, 'ending-' + tag + '.png') }); await ending.session.close();
        }
    }
    mark('ten phone/landscape/desktop theme layouts cover live logs, member/gear/pack/transfer dialogs and the complete accessible campfire illustration');
    assert.deepEqual({ errors, warnings, remote, missing }, { errors: [], warnings: [], remote: [], missing: [] });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, layouts: 10, errors, warnings, remote, missing }, null, 2));
} finally { await browser.close(); }
