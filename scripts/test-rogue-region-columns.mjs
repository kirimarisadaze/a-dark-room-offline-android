import { regionSection, warehouseFromPack, closeInventory } from './test-region-controls.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve('.local/rogue-tests/region-columns');
const assets = path.resolve('android/app/src/main/assets/game');
const base = 'https://appassets.androidplatform.net/game/';
const normal = ' {"ordinary":"unchanged"} \n';
const database = ' {"slots":"unchanged"} \t';
const model = vm.createContext({ window: {}, Uint8Array, btoa, atob });
for (const file of ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js']) {
    vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), model, { filename: file });
}
const game = model.window.Rogue;
fs.mkdirSync(output, { recursive: true });
const hashes = {};
for (const file of ['script/rogue/rogue.ui.js', 'script/rogue/rogue.settle.js', 'script/rogue/rogue.num.js', 'script/rogue/lang/zh.js', 'css/rogue.css']) {
    const source = fs.readFileSync(file);
    assert.equal(fs.readFileSync(path.join(assets, file), 'utf8').replace(/\r\n/g, '\n'), source.toString().replace(/\r\n/g, '\n'));
    hashes[file] = createHash('sha256').update(source).digest('hex');
}
/** Creates declared boundary fixtures; this suite is separate from the fresh button playthrough. */
function fixture(kind = 'camp') {
    const save = game.state.create({ seed: 42, slot: 0, createdAt: 1 });
    Object.assign(game.stores(save), { wood: 300, stone: 100, food: 300, water: 300 });
    const region = save.regions[save.party.region];
    const local = region.sites.find(site => site.type === 'forest');
    if (['resource', 'occupied'].includes(kind)) {
        Object.assign(save.party, { x: local.x, y: local.y }); local.state = kind === 'occupied' ? 'occupied' : 'seen';
        if (kind === 'occupied') { local.ownerCamp = save.camps[0].id; local.workers = 0; }
    } else if (kind === 'second') {
        const tiles = game.rle.decode(region.tiles, region.size);
        const tile = tiles.findIndex((value, index) => value === '.' && index % region.size > 1 && Math.floor(index / region.size) > 1 && !region.sites.some(site => site.x === index % region.size && site.y === Math.floor(index / region.size)));
        const camp = game.clone(save.camps[0]);
        Object.assign(camp, { id: 1, x: tile % region.size, y: Math.floor(tile / region.size), stores: {} });
        save.camps.push(camp); save.activeCamp = 0;
        Object.assign(save.party, { x: camp.x, y: camp.y });
    } else if (kind === 'dungeon') {
        const site = region.sites.find(entry => entry.type === 'dungeon');
        Object.assign(save.party, { x: site.x, y: site.y }); site.state = 'seen';
        assert(game.dungeon.enter(save, site.id));
    } else if (['wild', 'temp', 'cache'].includes(kind)) {
        const tiles = game.rle.decode(region.tiles, region.size);
        const tile = tiles.findIndex((value, index) => value === '.' && index % region.size > 1 && Math.floor(index / region.size) > 1 && !region.sites.some(site => site.x === index % region.size && site.y === Math.floor(index / region.size)) && !save.camps.some(camp => camp.x === index % region.size && camp.y === Math.floor(index / region.size)));
        Object.assign(save.party, { x: tile % region.size, y: Math.floor(tile / region.size) });
    }
    if (kind === 'temp') { save.flags.tempCamp = { region: save.party.region, x: save.party.x, y: save.party.y, expiresAt: save.turn + 100, stores: { wood: 9, medicine: 2 } }; }
    if (kind === 'cache') { save.flags.caches = [{ region: save.party.region, x: save.party.x, y: save.party.y, stores: { wood: 7 } }]; }
    if (kind === 'rich') {
        for (const id of Object.keys(game.CONTENT.items)) if (id !== 'fists') game.stores(save)[id] = 123456789;
        local.state = 'occupied'; local.ownerCamp = save.camps[0].id; local.workers = 0;
        save.camps[0].buildings.workshop = 1;
    }
    if (kind === 'empty') { save.camps[0].stores = {}; }
    if (kind === 'journal') {
        for (let index = 0; index < 160; index++) { save.turn++; game.log(save, 'log.move', { direction: game.t(index % 2 ? 'ui.east' : 'ui.north'), n: 1 }); }
        save.day = Math.floor(save.turn / game.NUM.TURNS_PER_DAY);
    }
    if (kind === 'combat') { game.state.current = save; game.combat.encounter(save, { kind: 'wild' }); }
    game.map.reset(); game.map.reveal(save);
    assert(game.save.validate(save), kind);
    return save;
}
const permissionSave = fixture('occupied');
const localSite = game.map.here(permissionSave);
const otherRegion = game.clone(permissionSave.regions[permissionSave.party.region]);
const remoteSite = game.clone(localSite); remoteSite.id = 'remote:production';
otherRegion.sites = [remoteSite]; permissionSave.regions['9,9'] = otherRegion;
for (const action of [{ type: 'worker', site: remoteSite.id, delta: 1 }, { type: 'road', site: remoteSite.id }, { type: 'guard', delta: 1 }, { type: 'build', building: 'well' }]) {
    const before = JSON.stringify(permissionSave);
    assert.equal(game.settle.act(permissionSave, action), false);
    assert.equal(JSON.stringify(permissionSave), before, 'remote action must preserve the entire save');
}
assert(game.settle.act(permissionSave, { type: 'worker', site: localSite.id, delta: 1 }));
assert(game.settle.act(permissionSave, { type: 'road', site: localSite.id }));
const otherCamp = fixture('second');
assert(game.settle.act(otherCamp, { type: 'guard', delta: 1 }));
assert.equal(otherCamp.camps[0].jobs.guard || 0, 0);
assert.equal(otherCamp.camps[1].jobs.guard, 1);
const errors = [], warnings = [], missing = [], remote = [], checks = [];
const browser = await chromium.launch({ headless: true });
/** Opens the generated bundle offline with one declared scenario and byte-sensitive ordinary saves. */
async function setup(kind, width = 412, height = 915, dark = true, font = 16) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 1100, hasTouch: true, offline: true });
    const raw = JSON.stringify(fixture(kind));
    await context.addInitScript(({ raw, normal, database, dark, font }) => {
        if (sessionStorage.getItem('region-test')) return;
        sessionStorage.setItem('region-test', '1');
        localStorage.setItem('rogueSlot0', raw); localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
        localStorage.setItem('roguePreferences', JSON.stringify({ dark, font }));
    }, { raw, normal, database, dark, font });
    await context.route('**/*', async route => {
        const url = route.request().url();
        if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
        const file = path.resolve(assets, decodeURIComponent(new URL(url).pathname.slice(6)));
        assert(file.startsWith(assets + path.sep));
        try { await route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream' }); }
        catch { missing.push(file); await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage(); page.setDefaultTimeout(8000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
    await page.goto(base + 'index.html?mode=rogue&slot=0'); await page.waitForFunction(() => window.Rogue?.state.current);
    return { page, context, raw, cdp: await context.newCDPSession(page) };
}
/** Waits for actual page animations before inspecting final layout geometry. */
async function settled(page) {
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
}
/** Clicks a visible control using browser hit testing. */
async function tap(locator) {
    await locator.evaluate(node => { if (!node.closest('.rogue-bottom,.rogue-header,.rogue-dialog-footer')) node.scrollIntoView({ block: 'center' }); });
    await locator.tap();
}
/** Finds a visible touch origin and verifies the browser actually hits the intended surface. */
async function touchPoint(page, selector) {
    await settled(page);
    const locator = page.locator(selector).first();
    await locator.evaluate(node => { if (!node.closest('.rogue-bottom,.rogue-header')) node.scrollIntoView({ block: 'center' }); });
    return locator.evaluate(node => {
        const box = node.getBoundingClientRect();
        const fixed = node.closest('.rogue-bottom,.rogue-header');
        const top = fixed ? 0 : document.querySelector('.rogue-header').getBoundingClientRect().bottom;
        const bottom = fixed ? innerHeight : document.querySelector('.rogue-bottom').getBoundingClientRect().top;
        const point = { x: box.left + box.width / 2, y: (Math.max(box.top, top) + Math.min(box.bottom, bottom)) / 2 };
        if (!node.contains(document.elementFromPoint(point.x, point.y))) throw new Error('Touch surface is obscured: ' + node.outerHTML.slice(0, 160));
        return point;
    });
}
/** Sends native touch input through Chromium, including cancellation and short drags. */
async function drag(session, delta, vertical = 0, cancel = false, target = null) {
    const { page, cdp } = session;
    await settled(page);
    const point = target || await page.evaluate(() => ({ x: innerWidth / 2, y: document.querySelector('.rogue-header').getBoundingClientRect().bottom + 8 }));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ ...point, id: 1 }] });
    for (let step = 1; step <= 5; step++) {
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: point.x + delta * step / 5, y: point.y + vertical * step / 5, id: 1 }] });
    }
    const moving = await page.evaluate(() => getComputedStyle(document.querySelector('#rogue-panel-' + document.querySelector('#rogue-root').dataset.tab)).transform);
    await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    return moving;
}
/** Checks final viewport fit, visible focus targets, translations and both ordinary save strings. */
async function inspect(page, tag) {
    await settled(page);
    const result = await page.evaluate(() => {
        const failures = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal overflow');
        if (document.body.innerText.includes('!!')) failures.push('missing translation');
        for (const node of document.querySelectorAll('#rogue-root button')) {
            if (!node.getClientRects().length || node.closest('[aria-hidden="true"]')) continue;
            const box = node.getBoundingClientRect();
            if (box.width < 43.9 || box.height < 43.9 || box.left < -1 || box.right > innerWidth + 1) failures.push(node.dataset.focus);
        }
        return { failures, normal: localStorage.gameState, database: localStorage.getItem('adr.saveSlots.v1') };
    });
    assert.deepEqual(result.failures, [], tag); assert.equal(result.normal, normal); assert.equal(result.database, database);
}
/** Records a completed assertion group. */
function mark(text) { checks.push(text); console.log('PASS ' + text); }

let layouts = 0;
try {
    if (!process.argv.includes('--notice-only')) {
    for (const [width, height] of [[320, 512], [360, 740], [412, 915], [740, 360], [1440, 900]]) {
        for (const dark of [false, true]) for (const font of [16, 22]) {
            const session = await setup('rich', width, height, dark, font); const { page } = session;
            const tag = width + 'x' + height + '-' + (dark ? 'dark' : 'light') + '-' + font;
            await page.locator('#rogue-tab-camp').click();
            const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
            assert.equal(await page.locator('.rogue-region-toggle').count(), 4);
            assert.equal(await page.locator('.rogue-region-toggle[aria-expanded="true"]').count(), 1);
            const bounds = await page.locator('[data-region-scroll]').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().toJSON()));
            assert.equal(bounds.length, 2);
            assert(Math.abs(bounds[0].width - bounds[1].width) <= 1, tag);
            assert(bounds[0].right < bounds[1].left && Math.abs(bounds[0].top - bounds[1].top) <= 1, tag);
            assert(bounds[0].height >= 44, tag + ' usable column');
            const footer = await page.locator('#rogue-bottom').boundingBox();
            assert(bounds.every(box => box.bottom <= footer.y), tag + ' footer must not cover columns');
            for (const section of ['buildings', 'recipes', 'research']) await regionSection(page, section);
            assert.equal(await page.locator('.rogue-region-toggle[aria-expanded="true"]').count(), 4);
            assert.equal(await page.locator('#rogue-panel-camp .rogue-pagination').count(), 0);
            assert.equal(await page.locator('#rogue-panel-camp [data-focus="storageView:"],#rogue-panel-camp [data-focus="camp-view:stores"]').count(), 0);
            await inspect(page, tag);
            const columns = page.locator('[data-region-scroll]');
            await columns.nth(0).evaluate(node => { node.scrollTop = 300; });
            await columns.nth(1).evaluate(node => { node.scrollTop = 150; });
            const reading = await columns.evaluateAll(nodes => nodes.map(node => node.scrollTop));
            assert(reading.every(top => top > 0), tag);
            await page.locator('#rogue-menu').click(); await page.keyboard.press('Escape');
            assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(node => node.scrollTop)), reading);
            await page.locator('#rogue-tab-party').click(); await page.locator('#rogue-tab-camp').click();
            assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(node => node.scrollTop)), reading);
            assert.equal(await page.locator('.rogue-region-toggle[aria-expanded="true"]').count(), 4);
            assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
            assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), session.raw);
            await page.locator('[data-focus="guard:plus"]').evaluate(node => node.scrollIntoView({ block: 'center' }));
            const leftBefore = await columns.nth(0).evaluate(node => node.scrollTop);
            await page.locator('[data-focus="guard:plus"]').click();
            assert.equal(await columns.nth(0).evaluate(node => node.scrollTop), leftBefore);
            assert.equal(await page.evaluate(() => Rogue.state.current.camps[0].jobs.guard), 1);
            for (const section of ['operations', 'buildings', 'recipes', 'research']) {
                const content = page.locator('#rogue-region-' + section);
                await content.locator('button:visible').last().evaluate(node => node.scrollIntoView({ block: 'center' }));
                const reachable = await content.locator('button:visible').last().evaluate(node => {
                    const box = node.getBoundingClientRect();
                    return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
                });
                assert(reachable, tag + '-' + section + ' last action reachable');
            }
            await columns.evaluateAll(nodes => nodes.forEach(node => { node.scrollTop = 0; }));
            await page.screenshot({ path: path.join(output, tag + '.png') });
            await page.reload(); await page.waitForFunction(() => window.Rogue?.state.current);
            await page.locator('#rogue-tab-camp').click();
            assert.equal(await page.locator('.rogue-region-toggle[aria-expanded="true"]').count(), 1);
            assert.deepEqual(await columns.evaluateAll(nodes => nodes.map(node => node.scrollTop)), [0, 0]);
            layouts++; await session.context.close();
        }
    }
    mark('20 layouts preserve equal columns, independent scroll, four simultaneous sections, 44px controls, fixed footer and state across redraws and navigation');
    for (const [kind, scope] of [['camp', 'store'], ['second', 'store'], ['occupied', 'store'], ['resource', 'none'], ['temp', 'temp'], ['cache', 'cache'], ['wild', 'none'], ['dungeon', 'none'], ['empty', 'store']]) {
        const session = await setup(kind); const { page } = session;
        await page.locator('#rogue-tab-camp').click();
        assert.equal(await page.locator('[data-stock-scope]').getAttribute('data-stock-scope'), scope, kind);
        assert.equal(await page.locator('.rogue-region-toggle').count(), 4);
        if (!['camp', 'second', 'empty'].includes(kind)) {
            await regionSection(page, 'buildings');
            assert.equal(await page.locator('#rogue-region-buildings button').count(), 0);
            assert.match(await page.locator('#rogue-region-buildings').innerText(), /永久据点/);
        }
        if (kind === 'empty' || scope === 'none') assert.equal(await page.locator('[data-stock-item]').count(), 0);
        if (kind === 'occupied') {
            assert.equal(await page.locator('[data-focus="guard:plus"]').count(), 0);
            await page.locator('[data-focus^="worker:plus:"]').click();
            assert.equal(await page.evaluate(() => Rogue.map.here(Rogue.state.current).workers), 1);
            await page.locator('[data-focus^="road:"]').click();
            assert.equal(await page.evaluate(() => Rogue.map.here(Rogue.state.current).road), true);
        }
        if (kind === 'second') {
            await page.locator('[data-focus="guard:plus"]').click();
            assert.deepEqual(await page.evaluate(() => Rogue.state.current.camps.map(camp => camp.jobs.guard || 0)), [0, 1]);
        }
        if (kind === 'temp' || kind === 'cache') {
            await warehouseFromPack(page);
            await page.locator('[data-focus="storage-filter:materials"]').click();
            await page.locator('[data-focus="storage-quantity:1"]').click();
            await page.locator('[data-focus="store-take:wood"]').click();
            await closeInventory(page); await page.locator('#rogue-tab-camp').click();
            assert.equal(await page.locator('[data-stock-item="wood"] strong').innerText(), kind === 'temp' ? '8' : '6');
        }
        await inspect(page, kind); await page.screenshot({ path: path.join(output, kind + '.png') }); await session.context.close();
    }
    mark('all local contexts choose actual stock, protect remote construction, allow local worker/road/guard controls and preserve backpack transfers');
    {
        const session = await setup('rich'); const { page } = session;
        await page.locator('#rogue-tab-camp').click(); await regionSection(page, 'research');
        const left = page.locator('[data-region-scroll="left"]');
        const right = page.locator('[data-region-scroll="right"]');
        await left.evaluate(node => { node.scrollTop = 0; }); await right.evaluate(node => { node.scrollTop = 0; });
        const box = await left.boundingBox();
        await drag(session, 0, -130, false, { x: box.x + box.width / 2, y: box.y + box.height * .7 });
        await page.waitForFunction(() => document.querySelector('[data-region-scroll="left"]').scrollTop > 0);
        assert.equal(await right.evaluate(node => node.scrollTop), 0);
        const rightBox = await right.boundingBox();
        await drag(session, 0, -130, false, { x: rightBox.x + rightBox.width / 2, y: rightBox.y + rightBox.height * .7 });
        await page.waitForFunction(() => document.querySelector('[data-region-scroll="right"]').scrollTop > 0);
        await settled(page);
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await drag(session, 100, 0, false, await touchPoint(page, '[data-focus="camp-view:operations"]'));
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await settled(page); await page.locator('#rogue-tab-camp').tap();
        assert.equal(await page.locator('[data-focus="camp-view:operations"]').getAttribute('aria-expanded'), 'true');
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await page.locator('#rogue-back').click();
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await session.context.close();
    }
    mark('native vertical drags scroll only the selected column; horizontal drags do not toggle sections or act; region Back returns directly to exploration');
    }
    {
        const session = await setup('rich', 740, 360, true, 22); const { page } = session;
        await regionSection(page, 'recipes');
        await page.locator('[data-focus="filter:tools"]').click();
        const left = page.locator('[data-region-scroll="left"]');
        await left.evaluate(node => { node.scrollTop = 150; });
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        const reading = await left.evaluate(node => node.scrollTop);
        await page.evaluate(() => Rogue.ui.notice('err.resources'));
        assert.equal(await left.evaluate(node => node.scrollTop), reading);
        const area = await left.boundingBox(), footer = await page.locator('#rogue-bottom').boundingBox();
        assert(area.height >= 44 && area.y + area.height <= footer.y, JSON.stringify({ area, footer, viewport: page.viewportSize() }));
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await page.evaluate(() => OfflineGame.back());
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        const direction = await page.evaluate(() => Object.entries(Rogue.map.directions).find(([name, delta]) => {
            const save = Rogue.state.current, view = Rogue.map.current(save);
            return view.tiles[(save.party.y + delta[1]) * view.map.size + save.party.x + delta[0]] === '.';
        })[0]);
        await page.locator('[data-focus="move:' + direction + '"]').click();
        await page.locator('#rogue-tab-camp').click(); await settled(page);
        assert.equal(await page.locator('.rogue-region-toggle[aria-expanded="true"]').count(), 1);
        assert.equal(await left.evaluate(node => node.scrollTop), 0);
        await inspect(page, 'notice-and-travel-reset'); await session.context.close();
    }
    mark('a live error resizes the columns without losing reading position or writing saves; native Back and real movement reset region controls');
    assert.deepEqual({ errors, warnings, missing, remote }, { errors: [], warnings: [], missing: [], remote: [] });
    fs.writeFileSync(path.join(output, process.argv.includes('--notice-only') ? 'notice-report.json' : 'report.json'), JSON.stringify({ passed: true, layouts, checks, hashes, errors, warnings, missing, remote }, null, 2));
} finally { await browser.close(); }

