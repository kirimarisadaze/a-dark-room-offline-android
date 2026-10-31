import { regionSection, warehouseFromPack, closeInventory } from './test-region-controls.mjs';
/* SPDX-License-Identifier: MPL-2.0 */
// Explicit issue fixtures; the separate button playthrough always starts a real fresh run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const files = ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js'];
const normal = ' ordinary \n 木 ', database = ' database \t unchanged ';
const checks = [];
const output = path.resolve('.local/rogue-tests/issues'); fs.mkdirSync(output, { recursive: true });
/** Creates a declared isolated fixture with byte-sensitive ordinary save sentinels. */
function scenario(seed = 2024) {
    const data = new Map([['gameState', normal], ['adr.saveSlots.v1', database]]);
    const context = vm.createContext({ window: {}, localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }, Uint8Array, btoa, atob });
    for (const file of files) vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), context);
    const R = context.window.Rogue, s = R.state.create({ seed, slot: 0, createdAt: 1 }); R.state.current = s;
    R.ui = { preferences: { waterWarning: false }, notice() {}, render() {} };
    s.camps[0].stores.food = 1000;
    return { R, s, data };
}
/** Enters a declared dungeon through its real model action before setting edge conditions. */
function dungeonFixture(seed = 2024, depth = 1) {
    const fixture = scenario(seed), { R, s } = fixture;
    const site = s.regions[s.party.region].sites.find(p => p.type === 'dungeon');
    Object.assign(s.party, { x: site.x, y: site.y, water: 40, food: 24 }); site.state = 'seen';
    assert(R.state.act({ type: 'enter', site: site.id }));
    const dungeon = s.dungeons[site.id]; dungeon.depth = depth;
    dungeon.floor = R.worldgen.buildFloor(s, site.id, depth, false); R.map.reveal(s);
    return { ...fixture, dungeon, site };
}
/** Records an assertion group with its actual scope. */
function mark(text) { checks.push(text); console.log('PASS ' + text); }
let cases = 0;
for (let seed = 1; seed <= 40; seed++) for (const depth of [1, 3, 10]) for (const hp of [1, 6]) for (const supplies of [[0, 0], [0, 12], [12, 0], [.5, 1]]) {
    const { R, s, dungeon, site, data } = dungeonFixture(seed, depth);
    const floor = dungeon.floor, open = R.rle.decode(floor.tiles, floor.size).map((tile, i) => tile === '.' ? i : -1).filter(i => i >= 0);
    const tile = open[seed % open.length]; Object.assign(floor.party, { x: tile % floor.size, y: Math.floor(tile / floor.size) });
    Object.assign(s.party, { hp, water: supplies[0], food: supplies[1] }); s.turn = 2;
    const cost = R.dungeon.returnCost(s), expectedWater = Math.max(0, supplies[0] - cost.water), expectedFood = Math.max(0, supplies[1] - cost.food);
    assert(cost.shortfall > 0); assert(R.state.act({ type: 'extract' }));
    assert.equal(s.flags.insideDungeon, undefined); assert.equal(s.flags.combat, undefined); assert.equal(s.over, false);
    assert.equal(s.party.x, site.x); assert.equal(s.party.y, site.y); assert.equal(s.party.water, expectedWater); assert.equal(s.party.food, expectedFood);
    assert.equal(s.party.hp, hp - cost.damage); assert(s.party.hp >= 1); assert.equal(s.turn, 3);
    assert(R.save.write(s)); assert.equal(R.save.load(0).party.hp, s.party.hp);
    assert.equal(data.get('gameState'), normal); assert.equal(data.get('adr.saveSlots.v1'), database); cases++;
}
mark(cases + ' emergency extractions cover 40 seeds, multiple depths/positions, partial supplies, HP 1, turn-boundary dehydration and reload without ordinary-save changes');
{
    const { R, s } = dungeonFixture(); s.party.water = 0; s.party.food = 0;
    let moved = 0;
    for (let i = 0; i < 200; i++) for (const dir of ['north', 'south', 'east', 'west']) if (R.state.act({ type: 'move', dir })) moved++;
    assert(s.flags.combat || s.over, 'original reproduction must stop for a real battle or ending');
    if (s.flags.combat) {
        const before = JSON.stringify(s); assert.equal(R.state.act({ type: 'extract' }), false); assert.equal(JSON.stringify(s), before);
        for (let i = 0; i < 100 && s.flags.combat; i++) assert(R.state.act({ type: 'combat', action: { type: 'attack' } }));
        assert(!s.flags.combat);
    }
    assert(moved > 0);
}
{
    const { R, s, dungeon } = dungeonFixture(); Object.assign(dungeon.floor.party, { x: 1, y: 1 }); Object.assign(s.party, { hp: 20, maxHp: 20, water: 0, food: 0 });
    const turn = s.turn;
    for (let i = 0; i < 20; i++) assert(R.state.act({ type: 'move', dir: 'west' }));
    assert.equal(s.turn, turn + 20); assert(s.party.hp < 20); assert.equal(dungeon.floor.party.x, 1);
    while (!s.over) assert(R.state.act({ type: 'wait' }));
    assert.equal(s.endReason, 'died');
    const ordinaryWall = dungeonFixture(); Object.assign(ordinaryWall.dungeon.floor.party, { x: 1, y: 1 });
    const before = JSON.stringify(ordinaryWall.s); assert.equal(ordinaryWall.R.state.act({ type: 'move', dir: 'west' }), false); assert.equal(JSON.stringify(ordinaryWall.s), before);
    const camp = scenario(); camp.s.party.water = 0; camp.s.party.food = 0;
    for (let i = 0; i < 12; i++) assert(camp.R.state.act({ type: 'wait' })); assert.equal(camp.s.party.hp, camp.s.party.maxHp);
    const abyss = scenario(); Object.assign(abyss.s, { over: true, endReason: 'ship' }); abyss.s.party.water = 0; abyss.s.party.food = 0;
    assert(abyss.R.dungeon.enterAbyss(abyss.s)); const hp = abyss.s.party.hp;
    for (let i = 0; i < 12; i++) assert(abyss.R.state.act({ type: 'wait' })); assert.equal(abyss.s.party.hp, hp);
}
mark('combat cannot be skipped; exhausted wall attempts and waiting advance survival, ordinary walls stay free, camps and abyss remain protected');
{
    const { R, s } = scenario();
    Object.assign(s.party, { water: R.waterMax(s), food: R.NUM.SUPPLY_FOOD }); s.party.bag = { water: 20, food: 24 };
    const before = JSON.stringify(s), plan = R.settle.restockPlan(s); assert.equal(plan.changed, false); assert.equal(JSON.stringify(s), before);
    assert.equal(R.state.act({ type: 'restock' }), false); assert.equal(JSON.stringify(s), before);
    s.party.bag = {}; const turn = s.turn; assert(R.state.act({ type: 'restock' })); assert.equal(s.turn, turn + 1); assert.equal(s.party.bag.food, 24); assert.equal(s.party.bag.water, 20);
    let snapshot = JSON.stringify(s); assert.equal(R.state.act({ type: 'restock' }), false); assert.equal(JSON.stringify(s), snapshot);
    s.camps[0].buildings.well = 1; const storedWater = R.stores(s).water;
    for (let i = 0; i < 20; i++) assert.equal(R.state.act({ type: 'restock' }), false); assert.equal(R.stores(s).water, storedWater);
    s.party.bag.wood = 12; s.party.bag.medicine = 2; s.party.bag.spear = 1; s.party.weapon = 'spear';
    const wood = R.stores(s).wood; assert(R.state.act({ type: 'restock' })); assert.equal(R.stores(s).wood, wood + 12); assert.equal(s.party.bag.medicine, 2); assert.equal(s.party.weapon, 'spear'); assert.equal(s.party.bag.water, 20);
    s.party.bag = { water: 25, food: 30 }; const surplusWater = R.stores(s).water, surplusFood = R.stores(s).food;
    const upkeep = s.camps[0].pop * R.NUM.FOOD_PER_POP / R.NUM.TURNS_PER_DAY;
    assert(R.state.act({ type: 'restock' })); assert.equal(R.stores(s).water, surplusWater + 5); assert(Math.abs(R.stores(s).food - (surplusFood + 6 - upkeep)) < 1e-9); assert.equal(s.party.bag.water, 20); assert.equal(s.party.bag.food, 24);
    s.party.bag = { spear: 80 }; s.party.weapon = 'spear'; snapshot = JSON.stringify(s); assert.equal(R.state.act({ type: 'restock' }), false); assert.equal(JSON.stringify(s), snapshot);
    s.party.bag = {}; R.stores(s).food = 0; R.stores(s).water = 0; delete s.camps[0].buildings.well; s.party.water = 0; s.party.food = 0;
    snapshot = JSON.stringify(s); assert.equal(R.state.act({ type: 'restock' }), false); assert.equal(JSON.stringify(s), snapshot);
}
{
    const { R, s } = scenario(); Object.assign(s.party, { water: 0, food: 0 }); s.party.bag = { water: 4, food: 2, wood: 5 }; Object.assign(R.stores(s), { water: 3, food: 1 });
    const plan = R.settle.restockPlan(s); assert(plan.changed); assert.equal(plan.water, 7); assert.equal(plan.food, 3);
    assert(R.state.act({ type: 'restock' })); assert.equal(s.party.water, 7); assert.equal(s.party.food, 3); assert.equal(R.stores(s).water, 0); assert.equal(R.stores(s).food, 0);
    Object.assign(s.party, { x: 1, y: 1 }); assert.equal(R.settle.restockPlan(s), null); const before = JSON.stringify(s); assert.equal(R.state.act({ type: 'restock' }), false); assert.equal(JSON.stringify(s), before);
    assert.equal(R.t('ui.extractCost', { water: 2, food: 7 }), '回程需要 2 水、7 口粮');
}
mark('resupply rejects byte-identical no-ops, fills useful reserves, conserves items and scarce stocks, respects capacity and cannot farm well water; return costs have independent placeholders');

const require = createRequire(import.meta.url); let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.resolve('../kubi/node_modules/playwright')].filter(Boolean)) { try { playwright = require(candidate); break; } catch {} }
assert(playwright, 'Provide an existing Playwright installation.');
const base = 'https://appassets.androidplatform.net/game/', assets = path.resolve('android/app/src/main/assets/game');
const errors = [], warnings = [], remote = [], missing = [];
const browser = await playwright.chromium.launch({ headless: true });
/** Builds one declared browser scenario from the same model used in edge regression. */
function uiFixture(kind) {
    const fixture = kind === 'emergency' ? dungeonFixture() : scenario(), { R, s } = fixture;
    if (kind === 'emergency') { s.turn = 2; Object.assign(s.party, { hp: 5, water: 0, food: 0 }); }
    else { s.party.bag = kind === 'reserves' ? {} : { water: 20, food: 24 }; s.party.water = R.waterMax(s); s.party.food = R.NUM.SUPPLY_FOOD; }
    assert(R.save.validate(s)); return s;
}
/** Opens only local packaged assets with controlled scenario data and real native-backup visibility. */
async function setup(kind = 'ready', width = 360, height = 740, dark = false, font = 16) {
    const session = await browser.newContext({ viewport: { width, height }, offline: true, isMobile: width < 1100, hasTouch: width < 1100 });
    await session.addInitScript(({ raw, normal, database, dark, font }) => {
        window.ADRNativeLocalApp = true;
        if (sessionStorage.getItem('issue-seed')) return;
        localStorage.setItem('rogueSlot0', raw); localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
        localStorage.setItem('roguePreferences', JSON.stringify({ dark, font })); sessionStorage.setItem('issue-seed', '1');
    }, { raw: JSON.stringify(uiFixture(kind)), normal, database, dark, font });
    await session.route('**/*', async route => {
        const url = route.request().url(); if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
        const relative = decodeURIComponent(new URL(url).pathname.slice(6)), file = path.resolve(assets, relative); assert(file.startsWith(assets + path.sep));
        try { await route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream' }); }
        catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await session.newPage(); page.setDefaultTimeout(5000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(base + 'index.html?mode=rogue&slot=0'); await page.waitForFunction(() => window.Rogue && Rogue.state.current);
    assert.equal(await page.evaluate(() => Rogue.ui.preferences.dark), dark); assert.equal(await page.evaluate(() => Rogue.ui.preferences.font), font);
    return { page, session };
}
/** Activates only a visible, enabled control through browser hit testing. */
async function tap(locator) { assert.equal(await locator.count(), 1, String(locator)); await locator.evaluate(n => { if (!n.closest('.rogue-bottom,.rogue-dialog-footer')) n.scrollIntoView({ block: 'center' }); }); await locator.click(); }
/** Reads state and checks that ordinary save bytes have not changed. */
async function state(page) {
    const data = await page.evaluate(() => ({ save: window.Rogue && Rogue.state ? Rogue.state.current : null, normal: localStorage.gameState, database: localStorage.getItem('adr.saveSlots.v1') }));
    assert.equal(data.normal, normal); assert.equal(data.database, database); return data.save;
}
/** Verifies actual visible controls, translations, page metadata and fixed footer touchability. */
async function fit(page, expected, tag) {
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    assert.equal(await page.locator('#rogue-root').getAttribute('data-page'), expected);
    const issues = await page.evaluate(() => {
        const bad = []; if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('overflow'); if (document.body.innerText.includes('!!')) bad.push('translation');
        for (const n of document.querySelectorAll('#rogue-root button')) {
            if (!n.getClientRects().length || n.closest('[aria-hidden="true"]')) continue;
            const b = n.getBoundingClientRect(); if (b.width < 43 || b.height < 43) bad.push('touch:' + n.textContent);
            if (b.left < -1 || b.right > innerWidth + 1) bad.push('horizontal:' + n.textContent);
            if (n.closest('.rogue-dialog-footer,.rogue-bottom')) { const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2); if (b.top < 56 || b.bottom > innerHeight + 1 || !hit || !n.contains(hit)) bad.push('blocked:' + n.textContent); }
        }
        return bad;
    });
    assert.deepEqual(issues, [], tag); await state(page);
}
try {
    {
        const { page, session } = await setup('emergency'); const before = JSON.stringify(await state(page));
        await fit(page, 'map', 'emergency'); await tap(page.locator('#rogue-tab-camp')); assert(await page.locator('[data-focus="confirmExtract:"]').isEnabled());
        await tap(page.locator('[data-focus="confirmExtract:"]')); await fit(page, 'confirm', 'extraction-confirm'); assert.equal(await page.locator(':focus').innerText(), '取消');
        await tap(page.getByRole('button', { name: '取消', exact: true })); assert.equal(JSON.stringify(await state(page)), before);
        await tap(page.locator('[data-focus="confirmExtract:"]')); await tap(page.getByRole('button', { name: '确认', exact: true }));
        let s = await state(page); assert.equal(s.flags.insideDungeon, undefined); assert.equal(s.party.hp, 1); assert.equal(s.over, false); assert.equal(s.turn, 3);
        await page.reload(); await page.waitForFunction(() => Rogue.state.current); s = await state(page); assert.equal(s.party.hp, 1); assert.equal(s.flags.insideDungeon, undefined);
        await session.close();
    }
    mark('real emergency withdrawal shows injury, defaults to Cancel, cancels without a turn and resumes at HP 1 on the surface after refresh');
    {
        const { page, session } = await setup(); const before = JSON.stringify(await state(page));
        assert.equal(await page.locator('#rogue-panel-map [data-focus="restock:"]').count(), 0);
        await tap(page.locator('#rogue-tab-camp')); assert(await page.locator('#rogue-panel-camp [data-focus="restock:"]').isDisabled());
        await regionSection(page, 'operations'); assert(await page.locator('#rogue-panel-camp [data-focus="restock:"]').isDisabled()); await fit(page, 'camp-overview', 'ready-supplies');
        await warehouseFromPack(page); assert(await page.locator('.rogue-dialog-content [data-focus="restock:"]').isDisabled()); await fit(page, 'storage', 'ready-warehouse'); await closeInventory(page);
        await tap(page.locator('#rogue-tab-party')); const turn = (await state(page)).turn;
        for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']) await page.keyboard.press(key);
        assert.equal((await state(page)).turn, turn);
        for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); assert(await page.evaluate(() => { const n = document.activeElement; return n === document.body || !!n.getClientRects().length && !n.closest('[hidden],[aria-hidden="true"]'); })); }
        await tap(page.locator('#rogue-tab-camp')); for (const key of ['ArrowUp', 'Space']) await page.keyboard.press(key); assert.equal((await state(page)).turn, turn);
        assert.equal(JSON.stringify(await state(page)), before);
        await tap(page.locator('[data-focus="camp-view:buildings"]'));
        const names = await page.locator('#rogue-panel-camp .rogue-priced button').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label')));
        assert(names.length >= 3 && names.every(Boolean)); assert.equal(new Set(names).size, names.length); assert(names.some(n => n.startsWith('建造：')));
        await tap(page.locator('#rogue-menu')); await fit(page, 'menu', 'menu'); assert.equal(await page.getByRole('button', { name: '立即保存', exact: true }).count(), 0);
        assert(await page.getByRole('button', { name: '备份这段旅程到文件', exact: true }).isVisible()); assert(await page.getByRole('button', { name: '从文件恢复这段旅程', exact: true }).isVisible());
        await tap(page.getByRole('button', { name: '暂离旅程', exact: true })); assert.equal(await page.locator(':focus').innerText(), '取消'); await tap(page.getByRole('button', { name: '取消', exact: true })); await fit(page, 'menu', 'exit-cancel');
        assert.equal(JSON.stringify(await state(page)), before);
        await tap(page.getByRole('button', { name: '暂离旅程', exact: true })); await tap(page.getByRole('button', { name: '确认', exact: true }));
        await page.waitForURL('**/game/home.html'); await state(page); await session.close();
    }
    mark('camp restock entrances disable real no-ops; exploration has no duplicate restock; camp/party keyboard, hidden focus, backup and two-step exit work');
    {
        const { page, session } = await setup('reserves'); const before = await state(page);
        await tap(page.locator('#rogue-tab-camp')); await regionSection(page, 'operations');
        assert(await page.locator('#rogue-panel-camp [data-focus="restock:"]').isEnabled()); await tap(page.locator('#rogue-panel-camp [data-focus="restock:"]'));
        const after = await state(page); assert.equal(after.turn, before.turn + 1); assert.equal(after.party.water, before.party.water); assert.equal(after.party.bag.water, 20); assert.equal(after.party.bag.food, 24);
        assert(await page.locator('#rogue-panel-camp [data-focus="restock:"]').isDisabled());
        await tap(page.locator('#rogue-tab-map')); await tap(page.locator('[data-focus="journal-toggle"]')); await fit(page, 'journal', 'journal-expanded'); await page.keyboard.press('Escape'); await fit(page, 'map', 'map-return'); await session.close();
    }
    mark('full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back');
    for (const [width, height, font] of [[320, 512, 22], [360, 740, 16], [412, 915, 20], [740, 360, 16], [1440, 900, 16]]) for (const dark of [false, true]) {
        const { page, session } = await setup('emergency', width, height, dark, font); const tag = width + 'x' + height + (dark ? '-dark' : '-light');
        await fit(page, 'map', tag); await tap(page.locator('#rogue-tab-camp')); await tap(page.locator('[data-focus="confirmExtract:"]')); await fit(page, 'confirm', tag + '-emergency');
        await page.screenshot({ path: path.join(output, 'emergency-' + tag + '.png') }); await tap(page.getByRole('button', { name: '取消', exact: true }));
        await tap(page.locator('#rogue-menu')); await fit(page, 'menu', tag + '-menu'); await tap(page.getByRole('button', { name: '暂离旅程', exact: true })); await fit(page, 'confirm', tag + '-exit'); await session.close();
    }
    mark('emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type');
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(remote, []); assert.deepEqual(missing, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, extractionCases: cases, errors, warnings, remote, missing }, null, 2) + '\n');
} finally { await browser.close(); }
