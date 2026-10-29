/* SPDX-License-Identifier: MPL-2.0 */
// Focused model and offline UI fixtures; full-button playthroughs stay in their separate fresh-run test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const files = ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js'];
const normal = ' {"ordinary":"木"} \n', database = ' {"normal slots":"unchanged"} ';
const output = path.resolve('.local/rogue-tests/onboarding'); fs.mkdirSync(output, { recursive: true });
const checks = [];
/** Creates an isolated declared fixture with byte-sensitive ordinary save sentinels. */
function scenario(seed = 42) {
    const data = new Map([['gameState', normal], ['adr.saveSlots.v1', database]]);
    const context = vm.createContext({ window: {}, localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) }, Uint8Array, btoa, atob });
    for (const file of files) vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), context);
    const R = context.window.Rogue, s = R.state.create({ seed, slot: 0, createdAt: 1 }); R.state.current = s;
    R.ui = { preferences: { waterWarning: true }, render() {}, notice() {} };
    return { R, s, data };
}
/** Records one meaningful behavior group. */
function mark(text) { checks.push(text); console.log('PASS ' + text); }
const { R, s, data } = scenario();
assert.equal(data.size, 2, 'creation alone cannot create a slot');
assert.equal(s.flags.log.at(-1).key, 'log.firstSteps');
const initial = JSON.stringify(s);
R.wild.supplies(s); R.wild.homeRoute(s);
assert.equal(JSON.stringify(s), initial, 'reading guidance and routes cannot mutate the run or RNG');
s.party.water = 2.5; s.party.food = 6; R.wild.warn(s);
assert.equal(s.flags.log.filter(l => l.key === 'log.supplyLowWarning').length, 0, 'exactly 25% is not below 25%');
s.party.water = 2.25; s.party.food = 5; s.party.bag = { water: 20, food: 24 }; R.wild.warn(s);
assert.equal(s.flags.log.filter(l => l.key === 'log.supplyLowWarning').length, 2, 'active gauges need warnings even with reserves');
const lowCount = s.flags.log.length; R.wild.warn(s); assert.equal(s.flags.log.length, lowCount);
assert(R.save.write(s)); const raw = data.get('rogueSlot0'); const reloaded = R.save.load(0);
R.wild.warn(reloaded); assert.equal(reloaded.flags.log.length, lowCount); assert.equal(data.get('rogueSlot0'), raw);
s.party.water = 0; s.party.food = 0; R.wild.warn(s);
assert.equal(s.flags.log.filter(l => l.key === 'log.supplyEmptyWarning').length, 2);
R.wild.warn(s); assert.equal(s.flags.log.filter(l => l.key === 'log.supplyEmptyWarning').length, 2);
s.party.water = 10; s.party.food = 24; R.wild.warn(s);
s.party.water = 1; R.wild.warn(s); assert.equal(s.flags.log.filter(l => l.key === 'log.supplyLowWarning').length, 3);
s.flags.abyss = true; const abyss = JSON.stringify(s); R.wild.warn(s); assert.equal(JSON.stringify(s), abyss);
assert.equal(R.wild.supplies(s).water.level, ''); delete s.flags.abyss;
mark('quarter/zero warnings distinguish reserves, deduplicate across reload, rearm after refill and stay silent in the abyss');

const old = R.clone(s); delete old.flags.supplyLevels; delete old.flags.workshopGuide;
const oldRaw = JSON.stringify(old); data.set('rogueSlot0', oldRaw);
const upgraded = R.save.load(0); assert(upgraded); assert.equal(upgraded.version, 3);
assert.equal(JSON.stringify(upgraded.flags.supplyLevels), '{}'); assert.equal(upgraded.flags.workshopGuide, false);
assert.equal(data.get('rogueSlot0'), oldRaw);
old.flags.supplyLevels = { water: 'corrupt' }; const bad = JSON.stringify(old); data.set('rogueSlot0', bad);
assert.equal(R.save.load(0), null); assert.equal(data.get('rogueSlot0'), bad);
assert.equal(data.get('gameState'), normal); assert.equal(data.get('adr.saveSlots.v1'), database);
mark('existing v3 slots gain in-memory defaults only; malformed warning data and both ordinary save strings are preserved');

const guide = scenario();
assert(guide.R.state.act({ type: 'build', building: 'workshop' }));
assert.equal(guide.s.flags.log.filter(l => l.key === 'log.workshopNext').length, 1);
assert.equal(guide.R.state.act({ type: 'build', building: 'workshop' }), false);
assert.equal(guide.s.flags.log.filter(l => l.key === 'log.workshopNext').length, 1);
const skin = scenario(); skin.R.stores(skin.s).fur = skin.R.CONTENT.items.waterskin.cost.fur;
assert(skin.R.state.act({ type: 'craft', item: 'waterskin' }));
assert.equal(skin.s.camps[0].buildings.workshop, undefined);
assert.equal(skin.R.waterMax(skin.s), 40); assert.equal(skin.s.party.water, 10);
assert.equal(skin.s.flags.log.at(-1).key, 'log.waterskinNext');
mark('workshop guidance is one-time and truthful; waterskins remain craftable without a workshop and prompt actual resupply');

/** Makes a walled detour whose known return cost exceeds the straight-line distance. */
function detour() {
    const result = scenario(), { R, s } = result, region = s.regions['0,0'];
    const size = R.NUM.REGION_SIZE, tiles = Array(size * size).fill('#'), mask = R.mask.decode(R.mask.empty(size));
    for (const [x, y] of [[1, 1], [1, 2], [2, 2], [3, 2], [3, 1]]) { tiles[y * size + x] = '.'; R.mask.set(mask, y * size + x); }
    region.tiles = R.rle.encode(tiles); region.mask = R.mask.encode(mask); region.biome = 'hills';
    for (const site of region.sites) site.state = 'unknown';
    Object.assign(s.camps[0], { x: 1, y: 1 }); Object.assign(s.party, { x: 3, y: 1, water: 1.25, food: 0, bag: { water: 2 } });
    s.party.companions.push({ id: 'supply-fixture', name: R.CONTENT.names[0], quirk: R.CONTENT.quirks[0], str: 1, agi: 1, will: 1, hp: R.NUM.COMPANION_HP, maxHp: R.NUM.COMPANION_HP, weapon: 'fists', armour: null, bag: { water: 1, food: 5 } });
    return result;
}
const route = detour();
assert.equal(route.R.wild.homeRoute(route.s).cost, 5);
assert.equal(route.R.wild.supplies(route.s).water.reserve, 3); assert.equal(route.R.wild.supplies(route.s).food.reserve, 5);
route.R.ui.preferences.waterWarning = false; route.R.wild.warn(route.s);
assert.equal(route.s.flags.waterWarning, '');
assert.equal(route.s.flags.log.filter(l => l.key === 'log.supplyEmptyWarning').length, 1);
route.R.ui.preferences.waterWarning = true; route.R.wild.warn(route.s);
assert(route.s.flags.waterWarning.startsWith('short:'));
route.s.party.companions[0].bag.water = 2; route.R.wild.warn(route.s); assert.equal(route.s.flags.waterWarning, '');
route.s.regions['0,0'].mask = route.R.mask.empty(route.R.NUM.REGION_SIZE);
assert.equal(route.R.wild.homeRoute(route.s), null);
mark('return-water estimates follow revealed detours, count companion reserves and separate the optional route alarm from basic depletion alerts');

const terrainAudit = { seeds: 1000, nearestMin: Infinity, nearestMax: 0, furthestResourceSteps: 0, minimumNearestRoundTripWaterLeft: Infinity };
for (let seed = 0; seed < terrainAudit.seeds; seed++) {
    const save = R.state.create({ seed, slot: 0, createdAt: 1 }), region = save.regions['0,0'];
    const distances = R.worldgen.flood(R.rle.decode(region.tiles, region.size), region.size, save.party.x, save.party.y);
    const sites = region.sites.filter(site => R.CONTENT.sites[site.type].kind === 'resource');
    const steps = sites.map(site => distances[site.y * region.size + site.x]); assert(steps.every(Number.isFinite));
    const nearest = Math.min(...steps), remaining = save.party.water - 2 * nearest * R.wild.waterCost(save);
    terrainAudit.nearestMin = Math.min(terrainAudit.nearestMin, nearest); terrainAudit.nearestMax = Math.max(terrainAudit.nearestMax, nearest);
    terrainAudit.furthestResourceSteps = Math.max(terrainAudit.furthestResourceSteps, ...steps);
    terrainAudit.minimumNearestRoundTripWaterLeft = Math.min(terrainAudit.minimumNearestRoundTripWaterLeft, remaining);
    assert(remaining + R.NUM.TRAVEL_RESERVE_SMALL >= 3, 'terrain-only nearest-resource return is covered after basic camp resupply; encounters are outside this audit');
}
fs.writeFileSync(path.join(output, 'terrain-audit.json'), JSON.stringify(terrainAudit, null, 2));
mark('1,000-seed read-only terrain audit records actual resource distances and starting-water limits without claiming universal encounter safety');

const require = createRequire(import.meta.url); let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.resolve('../kubi/node_modules/playwright')].filter(Boolean)) { try { playwright = require(candidate); break; } catch {} }
assert(playwright, 'Provide an existing Playwright installation through PLAYWRIGHT_MODULE.');
const base = 'https://appassets.androidplatform.net/game/', assets = path.resolve('android/app/src/main/assets/game');
const errors = [], warnings = [], remote = [], missing = [];
const browser = await playwright.chromium.launch({ headless: true });
/** Loads exact offline packaged assets, optionally with an explicitly declared scenario. */
async function setup(kind, width = 360, height = 740, dark = false, font = 16) {
    const session = await browser.newContext({ viewport: { width, height }, offline: true, isMobile: width < 1100, hasTouch: width < 1100 });
    let fixture = null;
    if (kind === 'supply' || kind === 'unknown') {
        const { R, s } = detour();
        if (kind === 'unknown') s.regions['0,0'].mask = R.mask.empty(R.NUM.REGION_SIZE);
        assert(R.save.validate(s)); fixture = JSON.stringify(s);
    } else if (kind === 'skin') {
        const { R, s } = scenario(); Object.assign(R.stores(s), { fur: 4 });
        assert(R.state.act({ type: 'craft', item: 'spear' })); fixture = JSON.stringify(s);
    }
    await session.addInitScript(({ fixture, normal, database, dark, font }) => {
        if (sessionStorage.getItem('onboarding')) return;
        localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
        localStorage.setItem('roguePreferences', JSON.stringify({ dark, font, waterWarning: true }));
        if (fixture) localStorage.setItem('rogueSlot0', fixture); sessionStorage.setItem('onboarding', '1');
    }, { fixture, normal, database, dark, font });
    await session.route('**/*', async route => {
        const url = route.request().url(); if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
        const relative = decodeURIComponent(new URL(url).pathname.slice(6)), file = path.resolve(assets, relative); assert(file.startsWith(assets + path.sep));
        try { await route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream' }); }
        catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await session.newPage(); page.setDefaultTimeout(6000);
    page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
    await page.goto(base + 'index.html?mode=rogue' + (fixture ? '&slot=0' : ''));
    await page.waitForFunction(() => window.Rogue && Rogue.ui);
    if (fixture) await page.waitForFunction(() => Rogue.state.current);
    return { page, session };
}
/** Activates a visible real button after scrolling into usable space. */
async function tap(locator) {
    assert.equal(await locator.count(), 1, String(locator));
    await locator.evaluate(n => { if (!n.closest('.rogue-bottom,.rogue-dialog-footer')) n.scrollIntoView({ block: 'center' }); }); await locator.click();
}
/** Reads state while checking both original-mode storage strings byte for byte. */
async function state(page) {
    const result = await page.evaluate(() => ({ save: Rogue.state.current, normal: localStorage.gameState, database: localStorage.getItem('adr.saveSlots.v1') }));
    assert.equal(result.normal, normal); assert.equal(result.database, database); return result.save;
}
/** Checks actual themes, large text, touch targets and the unobstructed fixed title and footer. */
async function fit(page, dark, font, tag) {
    const actual = await page.evaluate(() => {
        const bad = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) bad.push('overflow');
        if (document.body.innerText.includes('!!')) bad.push('translation');
        if (document.querySelector('.rogue-header').getBoundingClientRect().top !== 0) bad.push('title');
        for (const n of document.querySelectorAll('#rogue-root button')) {
            if (!n.getClientRects().length || n.closest('[aria-hidden="true"]')) continue;
            const b = n.getBoundingClientRect(); if (b.width < 43 || b.height < 43) bad.push('touch:' + n.textContent);
            if (b.left < -1 || b.right > innerWidth + 1) bad.push('horizontal:' + n.textContent);
            if (n.closest('.rogue-bottom,.rogue-dialog-footer')) {
                const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
                if (b.top < 56 || b.bottom > innerHeight + 1 || !hit || !n.contains(hit)) bad.push('blocked:' + n.textContent);
            }
        }
        return { bad, dark: document.documentElement.classList.contains('rogue-dark'), font: parseFloat(getComputedStyle(document.getElementById('rogue-root')).fontSize) };
    });
    assert.deepEqual(actual, { bad: [], dark, font }, tag); await state(page);
}
try {
    const fresh = await setup('fresh'); const page = fresh.page;
    assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), null);
    await tap(page.locator('.rogue-slot-open').first()); await page.locator('#rogue-seed').fill('42');
    await tap(page.getByRole('button', { name: '点燃第一堆火', exact: true }));
    assert.equal((await state(page)).turn, 0);
    assert.match(await page.locator('#rogue-live-log').innerText(), /先制一支长矛/);
    await tap(page.locator('#rogue-panel-map [data-focus="next-goal"]'));
    assert.match(await page.getByRole('dialog').innerText(), /仓库 35 \/ 需要 12/);
    await tap(page.getByRole('button', { name: '查看石刃长矛配方', exact: true }));
    assert.equal(await page.locator('#rogue-root').getAttribute('data-page'), 'camp-recipes');
    assert.equal((await state(page)).turn, 0);
    await tap(page.locator('[data-focus="craft:spear"]')); assert.equal((await state(page)).party.weapon, 'spear');
    await tap(page.locator('[data-focus="camp-return"]')); await tap(page.locator('#rogue-panel-camp [data-focus="next-goal"]'));
    assert.match(await page.getByRole('dialog').innerText(), /水袋不需要工坊/);
    await tap(page.getByRole('button', { name: '查看水袋配方', exact: true }));
    assert.equal(await page.locator('[data-focus="filter:tools"]').getAttribute('aria-pressed'), 'true');
    assert(await page.locator('[data-focus="craft:waterskin"]').isDisabled());
    assert.match(await page.locator('#rogue-panel-camp').innerText(), /缺少.*皮毛/);
    assert.equal((await state(page)).turn, 1);
    await tap(page.locator('[data-focus="camp-return"]')); await tap(page.locator('[data-focus="camp-view:buildings"]'));
    await tap(page.locator('[data-focus="build:workshop"]'));
    assert((await state(page)).flags.log.some(l => l.key === 'log.workshopNext'));
    await page.reload(); await page.waitForFunction(() => Rogue.state.current);
    const resumed = JSON.stringify(await state(page)); await page.locator('#rogue-panel-map').screenshot({ path: path.join(output, 'first-goal.png') });
    await page.reload(); await page.waitForFunction(() => Rogue.state.current); assert.equal(JSON.stringify(await state(page)), resumed);
    await fresh.session.close();
    mark('a fresh real-button run exposes its goal, opens exact recipes without time cost, keeps shortfalls and reloads workshop guidance without duplicates');

    const skinUI = await setup('skin');
    await tap(skinUI.page.locator('#rogue-panel-map [data-focus="next-goal"]'));
    await tap(skinUI.page.getByRole('button', { name: '查看水袋配方', exact: true }));
    await tap(skinUI.page.locator('[data-focus="craft:waterskin"]'));
    assert.equal((await state(skinUI.page)).party.water, 10);
    assert((await state(skinUI.page)).flags.log.some(l => l.key === 'log.waterskinNext'));
    assert(await skinUI.page.locator('[data-focus="craft:waterskin"]').isDisabled());
    await tap(skinUI.page.locator('[data-focus="camp-return"]'));
    await tap(skinUI.page.locator('#rogue-panel-camp [data-focus="next-goal"]'));
    await tap(skinUI.page.getByRole('button', { name: '查看工坊配方', exact: true }));
    assert.equal(await skinUI.page.locator('#rogue-root').getAttribute('data-page'), 'camp-buildings');
    await skinUI.session.close();
    mark('a declared material fixture crafts one waterskin through its guide, keeps it locked and moves on to workshop construction');

    for (const [width, height, font] of [[320, 512, 22], [360, 740, 16], [412, 915, 20], [740, 360, 16], [1440, 900, 16]]) for (const dark of [false, true]) {
        const { page, session } = await setup('supply', width, height, dark, font); const tag = width + 'x' + height + (dark ? '-dark' : '-light');
        assert.equal(await page.locator('#rogue-panel-map [data-supply="water"]').getAttribute('data-level'), 'low');
        assert.equal(await page.locator('#rogue-panel-map [data-supply="food"]').getAttribute('data-level'), 'empty');
        assert.match(await page.locator('#rogue-panel-map .rogue-return-water').innerText(), /回营需 5 水[\s\S]*含备用 4.25/);
        const before = JSON.stringify(await state(page)); await fit(page, dark, font, tag);
        await page.screenshot({ path: path.join(output, 'supply-' + tag + '.png'), fullPage: true });
        await tap(page.locator('#rogue-tab-party')); await fit(page, dark, font, tag + '-party');
        assert.equal(await page.locator('#rogue-panel-party [data-supply="water"]').getAttribute('data-level'), 'low');
        assert.equal(JSON.stringify(await state(page)), before, 'opening supply views cannot consume turns or add logs');
        await tap(page.locator('#rogue-tab-map')); await tap(page.locator('#rogue-panel-map [data-focus="move:south"]'));
        assert.equal((await state(page)).party.water, 0);
        assert.equal(await page.locator('#rogue-panel-map [data-supply="water"]').getAttribute('data-level'), 'empty');
        const exhausted = JSON.stringify(await state(page)); assert((await state(page)).flags.log.some(l => l.key === 'log.supplyEmptyWarning'));
        await page.reload(); await page.waitForFunction(() => Rogue.state.current); assert.equal(JSON.stringify(await state(page)), exhausted);
        await tap(page.locator('#rogue-menu')); await tap(page.locator('[data-focus="waterWarning:"]'));
        assert.equal(await page.locator('#rogue-panel-map .rogue-return-water').getAttribute('data-route'), 'known');
        await page.keyboard.press('Escape'); await fit(page, dark, font, tag + '-empty');
        await session.close();
    }
    mark('ten actual day/night and large-text layouts show low/empty text, known return cost, reserves, zero-water transitions and the route-warning toggle');
    const unknown = await setup('unknown');
    assert.equal(await unknown.page.locator('#rogue-panel-map .rogue-return-water').getAttribute('data-route'), 'unknown');
    assert.match(await unknown.page.locator('#rogue-panel-map .rogue-return-water').innerText(), /尚未探明/); await unknown.session.close();
    assert.deepEqual({ errors, warnings, remote, missing }, { errors: [], warnings: [], remote: [], missing: [] });
    const report = { passed: true, checks, terrainAudit, normalSaveUnchanged: true, errors, warnings, remote, missing };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
    const pages = browser.contexts().flatMap(session => session.pages());
    if (pages.length) await pages.at(-1).screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    throw error;
} finally { await browser.close(); }
