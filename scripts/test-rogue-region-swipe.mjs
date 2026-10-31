import { regionSection } from './test-region-controls.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve('.local/rogue-tests/region-swipe');
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
    } else if (kind === 'wild') {
        const tiles = game.rle.decode(region.tiles, region.size);
        const tile = tiles.findIndex((value, index) => value === '.' && index % region.size > 1 && Math.floor(index / region.size) > 1 && !region.sites.some(site => site.x === index % region.size && site.y === Math.floor(index / region.size)) && !save.camps.some(camp => camp.x === index % region.size && camp.y === Math.floor(index / region.size)));
        Object.assign(save.party, { x: tile % region.size, y: Math.floor(tile / region.size) });
    }
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
    for (const [width, height] of [[320, 512], [360, 740], [412, 915], [740, 360], [1440, 900]]) {
        for (const dark of [false, true]) for (const font of [16, 22]) {
            const session = await setup('camp', width, height, dark, font); const { page } = session;
            const tag = `${width}x${height}-${dark ? 'dark' : 'light'}-${font}`;
            const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
            assert.equal(await page.locator('#rogue-tab-camp').innerText(), '区域');
            assert.equal(await page.locator('#rogue-panel-map .rogue-context').count(), 0);
            assert.equal(await page.locator('#rogue-panel-map [data-focus="forage:"],#rogue-panel-map [data-focus="gather:"]').count(), 0);
            await inspect(page, tag + '-map');
            const movement = await drag(session, -100, 0, false, await touchPoint(page, '.rogue-dpad-center')); assert.notEqual(movement, 'none', tag + ': swiping from the wait button must drag the page without waiting');
            assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'camp');
            assert(await page.evaluate(() => document.getAnimations().length > 0), 'tab changes have a real animation');
            await inspect(page, tag + '-region');
            assert.equal(await page.locator('[data-focus="camp-view:buildings"]').count(), 1);
            if (width === 412 && dark && font === 16) { await page.screenshot({ path: path.join(output, 'region-camp.png'), fullPage: true }); }
            await drag(session, -100, 0, false, await touchPoint(page, '#rogue-live-log')); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'party'); await inspect(page, tag + '-party');
            await drag(session, -100); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'party');
            await drag(session, 100); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'camp');
            await drag(session, 100); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
            await drag(session, 100); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
            assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
            assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), session.raw);
            if (width === 412 && dark && font === 16) { await settled(page); await page.screenshot({ path: path.join(output, 'explore.png'), fullPage: true }); }
            layouts++; await session.context.close();
        }
    }
    mark('20 viewport/theme/font combinations: native swipes visit all three tabs, animate, stop at edges, fit 44px controls and preserve saves/turns');
    {
        const session = await setup('camp'); const { page } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        for (const [selector, delta, tab] of [
            ['.rogue-map-viewport', -100, 'camp'],
            ['[data-focus="forage:"]', 100, 'map'],
            ['.rogue-dpad-center', -100, 'camp'],
            ['[data-focus="camp-view:buildings"]', 100, 'map'],
            ['.rogue-brand', -100, 'camp'],
            ['#rogue-menu', -100, 'party'],
            ['[data-focus="quick:water"]', 100, 'camp'],
            ['#rogue-back', 100, 'map'],
            ['.rogue-time-info', -100, 'camp'],
            ['#rogue-tab-map', 100, 'map']
        ]) {
            const movement = await drag(session, delta, 0, false, await touchPoint(page, selector));
            assert.notEqual(movement, 'none', selector + ' must follow the finger');
            await settled(page);
            assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), tab, selector);
            assert(await page.locator('.rogue-overlay').isHidden(), selector + ' must not open a dialog');
            assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before, selector + ' must not act');
            assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), session.raw);
        }
        await tap(page.locator('#rogue-tab-camp')); await regionSection(page, 'buildings');
        for (const selector of ['#rogue-panel-camp button:disabled:visible', '#rogue-panel-camp summary:visible']) {
            const expanded = await page.locator('#rogue-panel-camp details[open]').count();
            await drag(session, 100, 0, false, await touchPoint(page, selector));
            assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map', selector);
            await tap(page.locator('#rogue-tab-camp'));
            assert.equal(await page.locator('#rogue-root').getAttribute('data-page'), 'camp-overview');
            assert.equal(await page.locator('#rogue-panel-camp details[open]').count(), expanded);
        }
        await tap(page.locator('#rogue-tab-map'));
        for (const [distance, cancel] of [[-30, false], [-100, true]]) {
            await drag(session, distance, 0, cancel, await touchPoint(page, '.rogue-dpad-center'));
            await settled(page);
            assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
            assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        }
        await page.locator('.rogue-dpad-center').tap();
        assert.equal(await page.evaluate(() => Rogue.state.current.turn), JSON.parse(before).turn + 1, 'a fresh tap immediately after a cancelled swipe still acts exactly once');
        await inspect(page, 'all-touch-surfaces'); await session.context.close();
    }
    mark('map, action buttons, disabled controls, disclosures, title, navigation, time and footer all accept swipes without accidental clicks; fresh taps still act once');
    {
        const session = await setup('wild', 1440, 1200); const { page } = session;
        await tap(page.locator('#rogue-tab-camp')); await settled(page);
        const point = await page.evaluate(() => {
            const layout = document.querySelector('#rogue-layout').getBoundingClientRect();
            const footer = document.querySelector('#rogue-bottom').getBoundingClientRect();
            const column = document.querySelector('[data-region-scroll="right"]').getBoundingClientRect();
            const point = { x: column.x + column.width / 2, y: column.bottom - 16 };
            if (!document.querySelector('#rogue-root').contains(document.elementFromPoint(point.x, point.y))) throw new Error('Region blank space must belong to the gesture surface');
            return point;
        });
        await drag(session, -100, 0, false, point);
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'party');
        assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), session.raw);
        await session.context.close();
    }
    mark('blank space below a short region page accepts swipes');
    {
        const session = await setup('journal'); const { page } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        const journal = page.locator('#rogue-live-log .rogue-action-journal');
        const reading = await journal.evaluate(node => node.scrollTop);
        await drag(session, 0, 60, false, await touchPoint(page, '#rogue-live-log .rogue-action-journal'));
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await page.waitForFunction(top => document.querySelector('#rogue-live-log .rogue-action-journal').scrollTop < top, reading);
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await inspect(page, 'native-journal-scrolling'); await session.context.close();
    }
    {
        const session = await setup('camp'); const { page } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await tap(page.locator('#rogue-tab-camp')); await regionSection(page, 'buildings');
        await page.evaluate(() => window.scrollTo(0, 0));
        const column = await page.locator('[data-region-scroll="left"]').boundingBox();
        await drag(session, 0, -100, false, { x: column.x + column.width / 2, y: column.y + column.height * .7 });
        await page.waitForFunction(() => document.querySelector('[data-region-scroll="left"]').scrollTop > 0);
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'camp');
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await inspect(page, 'native-page-scrolling'); await session.context.close();
    }
    mark('vertical journal and page drags still scroll natively without switching tabs or acting');
    {
        const session = await setup('combat'); const { page } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        const attack = await page.locator('[data-focus="combat:attack"]').boundingBox();
        await drag(session, 100, 0, false, { x: attack.x + attack.width / 2, y: attack.y + attack.height / 2 });
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        assert(await page.locator('.rogue-combat-dialog').isVisible());
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await session.context.close();
    }
    mark('swiping across a combat action cannot change tabs or trigger an attack');
    {
        const session = await setup('camp'); const { page, cdp } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await drag(session, -30); await settled(page); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await drag(session, -100, 0, true); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await drag(session, -10, 100); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        const log = await page.locator('#rogue-live-log').boundingBox();
        await drag(session, -100, 0, false, { x: log.x + log.width / 2, y: log.y + 40 }); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'camp');
        await drag(session, 100); assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await tap(page.locator('#rogue-menu'));
        const dialog = await page.locator('.rogue-dialog-content').boundingBox();
        await drag(session, -100, 0, false, { x: dialog.x + dialog.width / 2, y: dialog.y + Math.min(40, dialog.height / 2) });
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        assert(await page.locator('.rogue-overlay').isVisible());
        await page.keyboard.press('Escape');
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 180, y: 108, id: 1 }, { x: 220, y: 108, id: 2 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await page.emulateMedia({ reducedMotion: 'reduce' }); await drag(session, -100);
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'camp');
        assert.equal(await page.locator('#rogue-panel-camp').evaluate(node => node.getAnimations().length), 0);
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await inspect(page, 'gesture-exclusions'); await session.context.close();
    }
    mark('short/cancelled/vertical/multitouch/modal gestures cannot switch or act; horizontal log swipes switch tabs and reduced-motion preference is respected');
    {
        const session = await setup('camp', 360, 740); const { page } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await tap(page.locator('#rogue-tab-camp')); await regionSection(page, 'buildings');
        await page.locator('[data-region-scroll="left"]').evaluate(node => { node.scrollTop = 180; }); const reading = await page.locator('[data-region-scroll="left"]').evaluate(node => node.scrollTop);
        assert(reading > 0);
        await tap(page.locator('#rogue-tab-party')); await drag(session, 100); await settled(page);
        assert.equal(await page.locator('#rogue-root').getAttribute('data-page'), 'camp-overview');
        assert(Math.abs(await page.locator('[data-region-scroll="left"]').evaluate(node => node.scrollTop) - reading) <= 1, 'swiping back restores the region subpage reading position');
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        await page.locator('#rogue-tab-map').tap(); await settled(page);
        await page.locator('.rogue-dpad-center').scrollIntoViewIfNeeded();
        await page.locator('.rogue-dpad-center').tap();
        assert.equal(await page.evaluate(() => Rogue.state.current.turn), JSON.parse(before).turn + 1, 'a real touch on a button acts exactly once');
        assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
        await inspect(page, 'reading-position-and-touch'); await session.context.close();
    }
    mark('swiping preserves the region subpage and reading offset; native button taps perform exactly one action');
    for (const kind of ['wild', 'resource', 'occupied', 'second', 'dungeon']) {
        const session = await setup(kind); const { page } = session;
        const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
        await tap(page.locator('#rogue-tab-camp')); await inspect(page, kind);
        assert.equal(await page.locator('[data-focus^="selectCamp:"]').count(), 0);
        if (kind !== 'second') assert.equal(await page.locator('#rogue-region-buildings button').count(), 0);
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
        if (kind === 'resource') {
            const turn = await page.evaluate(() => Rogue.state.current.turn);
            await tap(page.locator('#rogue-region-actions [data-focus="gather:"]'));
            assert.equal(await page.evaluate(() => Rogue.state.current.turn), turn + 1);
            assert(await page.evaluate(() => Rogue.state.current.party.bag.wood > 0));
            await page.screenshot({ path: path.join(output, 'region-resource.png'), fullPage: true });
            await tap(page.locator('#rogue-tab-map'));
            const move = await page.evaluate(() => Object.entries(Rogue.map.directions).find(([name, delta]) => { const save = Rogue.state.current; const view = Rogue.map.current(save); return view.tiles[(save.party.y + delta[1]) * view.map.size + save.party.x + delta[0]] === '.'; })[0]);
            await tap(page.locator('[data-focus="move:' + move + '"]')); await tap(page.locator('#rogue-tab-camp'));
            assert.equal(await page.locator('[data-focus="gather:"]').count(), 0, 'local actions update after real movement');
        } else if (kind === 'occupied') {
            const button = page.locator('[data-focus^="worker:plus:"]'); assert.equal(await button.count(), 1);
            await tap(button); assert.equal(await page.evaluate(() => Rogue.map.here(Rogue.state.current).workers), 1);
        } else if (kind === 'second') {
            assert.match(await page.locator('#rogue-panel-camp h2').innerText(), /2/);
            await regionSection(page, 'buildings'); await tap(page.locator('[data-focus="fire:"]'));
            assert.equal(await page.evaluate(() => Rogue.state.current.camps[0].fire), 1);
            assert.equal(await page.evaluate(() => Rogue.state.current.camps[1].fire), 2);
        } else if (kind === 'dungeon') {
            assert.equal(await page.locator('#rogue-panel-map [data-focus="extract:"]').count(), 0);
            assert(await page.locator('#rogue-region-actions [data-focus="extract:"]').isVisible());
        }
        await inspect(page, kind + '-after'); await session.context.close();
    }
    mark('local camp, second camp, resource, occupied site, wilderness and dungeon expose matching actions; remote management rejects without mutation');
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(missing, []); assert.deepEqual(remote, []);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, layouts, checks, hashes, errors, warnings, missing, remote }, null, 2) + '\n');
} finally { await browser.close(); }
