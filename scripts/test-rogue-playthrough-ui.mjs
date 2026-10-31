import { regionSection } from './test-region-controls.mjs';
/* SPDX-License-Identifier: MPL-2.0 */
// Complete a fresh campaign with physical browser clicks only; state reads plan routes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
    try { playwright = require(candidate); break; } catch {}
}
assert(playwright, 'Use the existing Playwright installation.');
const output = path.join(root, '.local/rogue-tests/ui-playthrough');
fs.mkdirSync(output, { recursive: true });
const assets = path.join(root, 'android/app/src/main/assets/game');
const base = 'https://appassets.androidplatform.net/game/';
const normal = ' {"ordinary":"must remain byte-identical"} \n';
const database = ' {"slots":"must remain byte-identical"} ';
const context = vm.createContext({ window: {}, console, Uint8Array, btoa, atob });
for (const file of ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'script/rogue', file), 'utf8'), context, { filename: file });
}
const G = context.window.Rogue;
G.state.act = function () { throw new Error('The planner cannot advance the game.'); };
const expedition = {};
let actions = 0, clicks = 0, battles = 0, dungeons = 0;
const errors = [], warnings = [], remote = [], missing = [];
const started = Date.now();
const browser = await playwright.chromium.launch({ headless: true });
const session = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, offline: true });
await session.addInitScript(({ normal, database }) => {
    if (sessionStorage.getItem('ui-playthrough-init')) return;
    localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
    sessionStorage.setItem('ui-playthrough-init', '1');
}, { normal, database });
await session.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
    const relative = decodeURIComponent(new URL(url).pathname.slice('/game/'.length));
    const file = path.resolve(assets, relative);
    assert(file.startsWith(assets + path.sep));
    try {
        const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.flac': 'audio/flac', '.png': 'image/png', '.ico': 'image/x-icon' };
        await route.fulfill({ body: fs.readFileSync(file), contentType: mime[path.extname(file)] || 'application/octet-stream' });
    } catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
});
const page = await session.newPage();
page.setDefaultTimeout(10000);
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
/** Updates the read-only planner snapshot while preserving references used by the route strategy. */
function merge(target, data) {
    for (const key of Object.keys(target)) if (!(key in data)) delete target[key];
    for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object') {
            if (!target[key] || typeof target[key] !== 'object') target[key] = Array.isArray(value) ? [] : {};
            merge(target[key], value);
        } else target[key] = value;
    }
    if (Array.isArray(target)) target.length = data.length;
}
/** Reads progress and verifies that every real action leaves both ordinary save strings unchanged. */
async function sync() {
    const state = await page.evaluate(() => ({ save: Rogue.state.current, normal: localStorage.gameState, database: localStorage.getItem('adr.saveSlots.v1') }));
    assert.equal(state.normal, normal); assert.equal(state.database, database);
    merge(expedition, state.save);
    G.state.current = expedition;
    assert(!expedition.over || expedition.endReason === 'ship', JSON.stringify({ reason: expedition.endReason, turn: expedition.turn, party: expedition.party }));
}
/** Scrolls a real control into usable space and clicks it through normal browser hit testing. */
async function click(locator) {
    assert.equal(await locator.count(), 1, 'control must be unambiguous: ' + locator);
    await locator.evaluate(node => { if (!node.closest('.rogue-bottom, .rogue-dialog-footer')) node.scrollIntoView({ block: 'center' }); });
    await locator.click(); clicks++;
}
/** Selects a primary panel through the persistent bottom navigation. */
async function tab(name) {
    if (await page.locator('#rogue-root').getAttribute('data-tab') !== name) await click(page.locator('#rogue-tab-' + name));
}
/** Enters the chosen camp subpage through the dashboard. */
async function camp(view) {
    await tab('camp');
    if (['buildings', 'recipes', 'research', 'expansion'].includes(view)) await regionSection(page, view);
    else if (view !== 'workers') await regionSection(page, 'operations');
}
/** Finds a real recipe or management control by stepping through its explicit pagination. */
async function paged(token) {
    const locator = page.locator('[data-focus="' + token + '"]');
    if (await locator.count()) return locator;
    const previous = page.getByRole('button', { name: '上一页', exact: true });
    for (let i = 0; await previous.count() && await previous.isEnabled(); i++) { assert(i < 30); await click(previous); }
    const next = page.getByRole('button', { name: '下一页', exact: true });
    for (let i = 0; !await locator.count(); i++) { assert(i < 30 && await next.count() && await next.isEnabled(), 'unreachable control ' + token); await click(next); }
    return locator;
}
/** Returns through real inventory layers after a transfer or equipment choice. */
async function closeInventory() {
    for (let i = 0; await page.getByRole('dialog').count(); i++) { assert(i < 10); await click(page.locator('.rogue-dialog-footer [data-focus="closeModal:"]')); }
}
/** Pages a personal inventory without directly touching game state. */
async function packItem(token) {
    const locator = page.locator('.rogue-dialog-content [data-focus="' + token + '"]');
    for (let i = 0; !await locator.count(); i++) { assert(i < 15); await click(page.locator('.rogue-dialog-content [data-focus="bagPage:"]').last()); }
    return locator;
}
/** Dispatches game actions exclusively by clicking their public on-screen controls. */
async function input(action) {
    const type = action.type;
    if (type === 'restock') {
        await camp('supplies'); await click(page.locator('#rogue-panel-camp [data-focus="restock:"]'));
    } else if (['move', 'wait', 'gather', 'occupy', 'clear', 'enter', 'extract', 'descend', 'launch'].includes(type)) {
        const panel = ['move', 'wait'].includes(type) ? 'map' : 'camp';
        await tab(panel);
        const emergency = type === 'extract' && await page.locator('#rogue-panel-camp [data-focus="confirmExtract:"]').count() > 0;
        const token = type === 'launch' ? 'confirmLaunch:' : emergency ? 'confirmExtract:' : type + ':' + (action.dir || action.site || '');
        await click(page.locator('#rogue-panel-' + panel + ' [data-focus="' + token + '"]'));
        if (type === 'launch' || emergency) await click(page.getByRole('button', { name: '确认', exact: true }));
        if (type === 'enter') { dungeons++; await capture('dungeon-' + dungeons + '-entrance'); }
    } else if (type === 'forage') {
        await camp('overview'); await click(page.locator('[data-focus="forage:"]'));
    } else if (type === 'build' || type === 'fire') {
        await camp('buildings'); await click(await paged(type + ':' + (action.building || '')));
    } else if (type === 'craft') {
        await camp('recipes');
        const kind = G.CONTENT.items[action.item].kind;
        const filter = { weapon: 'weapons', armour: 'armour', tool: 'tools', consume: 'consume', resource: 'consume', module: 'modules' }[kind];
        if (await page.locator('[data-focus="filter:' + filter + '"]').getAttribute('aria-pressed') !== 'true') await click(page.locator('[data-focus="filter:' + filter + '"]'));
        await click(await paged('craft:' + action.item));
    } else if (type === 'night') {
        await camp('supplies'); await click(page.locator('[data-focus="night:"]'));
    } else if (type === 'transfer') {
        await tab('party');
        if (action.from === 'player') await click(page.locator('#rogue-panel-party [data-focus="bagView:"]'));
        else {
            await click(page.locator('[data-focus="member:' + action.from + '"]'));
            await click(page.getByRole('button', { name: '打开行囊', exact: true }));
        }
        await click(await packItem('item:' + action.item));
        await click(page.locator('[data-focus="transfer:' + action.to + '"]')); await closeInventory();
    } else if (type === 'equip') {
        await tab('party');
        await click(page.locator('[data-focus="member:' + action.member + '"]'));
        await click(page.getByRole('button', { name: G.CONTENT.items[action.item].kind === 'weapon' ? '更换或卸下武器' : '更换或卸下护甲', exact: true }));
        await click(await packItem('equip:' + action.item)); await closeInventory();
    } else if (type === 'outpost') {
        if (action.op === 'enter') { await tab('camp'); await click(page.locator('[data-focus="outpost:"]')); }
        else if (action.op === 'explore') await click(page.locator('.rogue-dialog-content [data-focus="outpost:"]'));
        else if (action.op === 'leave') await click(page.locator('.rogue-dialog-footer [data-focus="outpost:"]'));
    } else if (type === 'event') {
        await click(page.locator('.rogue-dialog-footer [data-focus="event:"]'));
    } else if (type === 'recruit' || type === 'use' || type === 'drop') {
        await tab('party');
        if (type === 'drop') {
            await click(page.locator('[data-focus="bagView:"]'));
            while (!await page.locator('[data-focus="item:' + action.item + '"]').count()) {
                await click(page.locator('[data-focus="bagPage:"]').last());
            }
            await click(page.locator('[data-focus="item:' + action.item + '"]'));
        }
        const token = type === 'use' ? 'quick:' + action.item : type === 'drop' ? 'confirmDrop:' + action.item : 'recruit:';
        await click(page.locator('[data-focus="' + token + '"]'));
        if (type === 'drop') { await click(page.getByRole('button', { name: '确认', exact: true })); await click(page.locator('.rogue-dialog-footer [data-focus="closeModal:"]')); await click(page.locator('.rogue-dialog-footer [data-focus="closeModal:"]')); }
    } else if (type === 'worker') {
        await camp(G.atCamp(expedition) ? 'workers' : 'overview');
        await click(await paged('worker:' + (action.delta > 0 ? 'plus:' : 'minus:') + action.site));
    } else if (type === 'newCamp' || type === 'dismantle') {
        await camp('expansion'); await click(page.locator('[data-focus="' + (type === 'dismantle' ? 'confirmDismantle:' : 'newCamp:') + '"]'));
        if (type === 'dismantle') await click(page.getByRole('button', { name: '确认', exact: true }));
    } else if (type === 'combat') {
        const token = action.action.type === 'item' ? 'combat:medicine' : 'combat:' + action.action.type;
        await click(page.locator('[data-focus="' + token + '"]'));
    } else throw new Error('No real control for ' + JSON.stringify(action));
    await sync(); actions++;
    if (actions % 100 === 0) console.log('UI ' + actions + ' actions / ' + clicks + ' clicks / turn ' + expedition.turn);
}
/** Resolves real battles with visible attacks and carried medicine. */
async function fight() {
    if (expedition.flags.combat) { battles++; if (battles === 1) await capture('first-battle'); }
    let rounds = 0;
    while (expedition.flags.combat) {
        assert(rounds++ < 100);
        const healing = expedition.party.hp < expedition.party.maxHp * .55 && expedition.party.bag.medicine;
        await input({ type: 'combat', action: healing ? { type: 'item', item: 'medicine' } : { type: 'attack' } });
    }
}
/** Completes one intentional UI action and any encounter that it triggers. */
async function act(action) { if (expedition.flags.wildEvent) await input({ type: 'event', op: 'leave' }); await input(action); await fight(); if (expedition.flags.wildEvent) await input({ type: 'event', op: 'leave' }); }
/** Refills supplies through the public control only when it offers a useful action. */
async function resupply() { if (G.settle.restockPlan(expedition)?.changed) await act({ type: 'restock' }); }
/** Captures actual expedition UI and checks fixed title and navigation bounds. */
async function capture(name) {
    const layout = await page.evaluate(() => {
        const h = document.querySelector('.rogue-header').getBoundingClientRect();
        const buttons = [...document.querySelectorAll('.rogue-bottom button, .rogue-dialog-footer button')].filter(n => n.getClientRects().length);
        return { top: h.top, overflow: document.documentElement.scrollWidth > innerWidth + 1, missingKey: document.body.innerText.includes('!!'), blocked: buttons.filter(n => {
            if (n.closest('[aria-hidden="true"]')) return false;
            const b = n.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return b.bottom > innerHeight + 1 || b.top < 0 || b.height < 44 || !hit || !n.contains(hit);
        }).map(n => n.getAttribute('data-focus')) };
    });
    assert.deepEqual(layout, { top: 0, overflow: false, missingKey: false, blocked: [] }, name);
    await page.screenshot({ path: path.join(output, name + '.png') });
}
try {
    await page.goto(base + 'index.html?mode=rogue');
    await click(page.locator('.rogue-slot-open').first());
    await page.locator('#rogue-seed').fill('42');
    await click(page.getByRole('button', { name: '点燃第一堆火', exact: true }));
    await sync(); await capture('new-run');
    /** Reads terrain for path planning without changing fog, resources, health or world state. */
    function pathTo(tx, ty) {
        const view = G.map.current(expedition);
        const size = view.map.size;
        const start = view.position.y * size + view.position.x;
        const target = ty * size + tx;
        const parents = new Map([[start, null]]), queue = [start];
        for (let i = 0; i < queue.length && !parents.has(target); i++) {
            const index = queue[i];
            for (const [dir, [dx, dy]] of Object.entries(G.map.directions)) {
                const x = index % size + dx, y = Math.floor(index / size) + dy, next = y * size + x;
                if (x > 0 && y > 0 && x < size - 1 && y < size - 1 && view.tiles[next] !== '#' && !parents.has(next)) { parents.set(next, { index, dir }); queue.push(next); }
            }
        }
        assert(parents.has(target), 'destination must be reachable');
        const route = []; let cursor = target;
        while (cursor !== start) { const parent = parents.get(cursor); route.unshift(parent.dir); cursor = parent.index; }
        return route;
    }
    /** Walks using normal move actions and consumes carried reserve supplies as needed. */
    async function walkTo(x, y) {
        for (const dir of pathTo(x, y)) {
            if (expedition.party.water <= 2 && expedition.party.bag.water > 0) await act({ type: 'use', item: 'water' });
            if (expedition.party.food <= 2 && expedition.party.bag.food > 0) await act({ type: 'use', item: 'food' });
            if (expedition.party.hp < expedition.party.maxHp * .6 && expedition.party.bag.medicine > 0) await act({ type: 'use', item: 'medicine' });
            await act({ type: 'move', dir });
        }
    }
    /** Returns to the local central camp when one exists. */
    async function homeAndSupply() {
        const camp = expedition.camps.find(camp => camp.region === expedition.party.region);
        assert(camp, 'local camp required'); await walkTo(camp.x, camp.y);
        await resupply();
        const here = G.atCamp(expedition);
        for (let i = 0; i < 8 && expedition.party.companions.length < 2; i++) {
            if (here.pop <= 1) { await act({ type: 'night' }); continue; }
            if (G.settle.employed(expedition, here) >= here.pop) {
                const site = expedition.regions[expedition.party.region].sites.find(site => site.ownerCamp === here.id && site.workers > 0);
                if (!site) break;
                await act({ type: 'worker', site: site.id, delta: -1 }); continue;
            }
            if (!G.affords(expedition, { food: G.NUM.RECRUIT_FOOD })) break;
            await act({ type: 'recruit' });
        }
        for (const ally of expedition.party.companions) {
            if (!expedition.party.bag.pack || !expedition.party.armour) break;
            const tier = expedition.regions[expedition.party.region].tier;
            for (const item of [tier >= 3 ? 'blade' : 'spear', tier >= 7 ? 'suit' : tier >= 2 ? 'mail' : 'coat']) {
                const definition = G.CONTENT.items[item];
                if (ally[definition.kind] === item || !G.settle.recipeAllowed(expedition, item) || !G.affords(expedition, definition.cost)) continue;
                if (definition.kind === 'weapon' && definition.dmg > G.CONTENT.items[expedition.party.weapon].dmg) continue;
                if (definition.kind === 'armour' && (!expedition.party.armour || definition.hp > G.CONTENT.items[expedition.party.armour].hp)) continue;
                if (definition.kind === 'weapon' && definition.dmg <= G.CONTENT.items[ally.weapon].dmg) continue;
                if (definition.kind === 'armour' && ally.armour && definition.hp <= G.CONTENT.items[ally.armour].hp) continue;
                await act({ type: 'craft', item });
                await act({ type: 'transfer', from: 'player', to: ally.id, item });
                await act({ type: 'equip', member: ally.id, item });
            }
        }
        for (let i = 0; i < 20 && (expedition.party.hp < expedition.party.maxHp || expedition.party.companions.some(a => a.hp < a.maxHp)); i++) await act({ type: 'wait' });
        if (here.buildings.workshop) {
            while ((expedition.party.bag.medicine || 0) < 12 && G.affords(expedition, G.CONTENT.items.medicine.cost) && G.bagWeight(expedition) < G.party.capacity(expedition, expedition.party)) await act({ type: 'craft', item: 'medicine' });
        }
    }
    /** Gathers only through valid site actions, depositing and preparing at the local camp. */
    async function gatherResource(type, count) {
        const site = expedition.regions[expedition.party.region].sites.find(site => site.type === type);
        assert(site, 'missing resource ' + type);
        await walkTo(site.x, site.y);
        for (let i = 0; i < count; i++) {
            if (G.bagWeight(expedition) > G.NUM.BAG_UPGRADED - 8 && expedition.party.bag.water > 0 && expedition.party.water < G.waterMax(expedition)) await act({ type: 'use', item: 'water' });
            if (G.bagWeight(expedition) > G.NUM.BAG_UPGRADED - 8 && expedition.party.bag.food > 0 && expedition.party.food < G.NUM.SUPPLY_FOOD) await act({ type: 'use', item: 'food' });
            if (G.bagWeight(expedition) > G.NUM.BAG_UPGRADED - 8) { await homeAndSupply(); await walkTo(site.x, site.y); }
            await act({ type: 'gather' });
        }
        if (site.state === 'cleared') await act({ type: 'occupy' });
        const owner = expedition.camps.find(camp => camp.id === site.ownerCamp);
        if (!site.workers && owner && G.settle.employed(expedition, owner) < owner.pop) await act({ type: 'worker', site: site.id, delta: 1 });
        await homeAndSupply();
    }
    /** Collects required construction materials using the repeatable camp forage action. */
    async function prepare(cost) {
        let attempts = 0;
        while (!G.affords(expedition, cost)) {
            assert(attempts++ < 500, 'cannot prepare ' + JSON.stringify(cost));
            await act({ type: 'forage' });
        }
    }
    /** Crafts one affordable item through the normal action pipeline. */
    async function craft(id) { await act({ type: 'craft', item: id }); }
    for (let i = 0; i < 35; i++) await act({ type: 'forage' });
    for (const building of ['garden', 'garden', 'garden', 'well', 'workshop']) await act({ type: 'build', building });
    await craft('spear'); await act({ type: 'fire' }); await resupply();
    await gatherResource('hunting', 5); await gatherResource('hunting', 5);
    await craft('coat'); await craft('waterskin'); await resupply();
    await gatherResource('hunting', 5); await gatherResource('hunting', 3);
    await craft('pack'); await resupply();
    await gatherResource('hunting', 4);
    await gatherResource('hunting', 2);
    for (let i = 0; i < 5 && expedition.camps[0].pop < 4; i++) await act({ type: 'night' });
    while (expedition.party.companions.length < 2) await act({ type: 'recruit' });
    await homeAndSupply();
    const fort = expedition.regions[expedition.party.region].sites.find(site => site.type === 'outpost');
    await walkTo(fort.x, fort.y); await act({ type: 'outpost', op: 'enter' });
    await capture('compound-entry');
    while (fort.assault < 5) await act({ type: 'outpost', op: 'explore' });
    assert.equal(fort.state, 'cleared'); await capture('compound-cleared');
    await act({ type: 'outpost', op: 'leave' }); await homeAndSupply();
    /** Makes room for survival supplies using the same deliberate cargo action as the UI. */
    async function clearCargo(spare) {
        const capacity = expedition.party.bag.pack ? G.NUM.BAG_UPGRADED : G.NUM.BAG_BASE;
        const resources = ['wood', 'stone', 'iron', 'coal', 'fur', 'crystal', 'steel', 'sulphur'];
        while (G.bagWeight(expedition) > capacity - spare) {
            const item = resources.find(item => expedition.party.bag[item] > 0);
            assert(item, 'survival supplies need free cargo space');
            await act({ type: 'drop', item });
        }
    }
    /** Uses regional resource sites as supply stops on long routes between two bases. */
    async function wildSupply() {
        const sites = expedition.regions[expedition.party.region].sites;
        const hunting = sites.find(site => site.type === 'hunting');
        if (hunting && expedition.party.food + (expedition.party.bag.food || 0) < 80) {
            await walkTo(hunting.x, hunting.y);
            for (let i = 0; i < 12 && (expedition.party.bag.food || 0) < 56; i++) { await clearCargo(6); await act({ type: 'gather' }); }
        }
        const spring = sites.find(site => site.type === 'spring');
        if (spring && expedition.party.water + (expedition.party.bag.water || 0) < 160) {
            await walkTo(spring.x, spring.y);
            for (let i = 0; i < 12 && (expedition.party.bag.water || 0) < 80; i++) { await clearCargo(8); await act({ type: 'gather' }); }
        }
    }
    /** Moves between regions through their real interior exits using an open graph route. */
    async function travel(target) {
        const graph = expedition.regionGraph;
        const parents = new Map([[expedition.party.region, null]]), queue = [expedition.party.region];
        for (let i = 0; i < queue.length && !parents.has(target); i++) {
            for (const edge of graph.edges) {
                if (G.worldgen.isBlocked(graph, edge[0], edge[1])) continue;
                const next = edge[0] === queue[i] ? edge[1] : edge[1] === queue[i] ? edge[0] : null;
                if (next && !parents.has(next)) { parents.set(next, queue[i]); queue.push(next); }
            }
        }
        const route = []; let cursor = target;
        while (cursor !== expedition.party.region) { route.unshift(cursor); cursor = parents.get(cursor); }
        for (const next of route) {
            const [ax, ay] = expedition.party.region.split(',').map(Number), [bx, by] = next.split(',').map(Number);
            const dir = bx < ax ? 'west' : bx > ax ? 'east' : by < ay ? 'north' : 'south';
            await walkTo(bx < ax ? 1 : bx > ax ? G.NUM.REGION_SIZE - 2 : G.NUM.REGION_CENTER, by < ay ? 1 : by > ay ? G.NUM.REGION_SIZE - 2 : G.NUM.REGION_CENTER);
            await act({ type: 'move', dir });
            if (next !== target) {
                if (expedition.camps.some(camp => camp.region === next)) await homeAndSupply();
                else await wildSupply();
            }
        }
    }
    /** Establishes a legal outpost only after clearing every local threat. */
    async function settleLocal() {
        let attempts = 0;
        while (true) {
            await walkTo(G.NUM.REGION_CENTER, G.NUM.REGION_CENTER);
            if (!expedition.regions[expedition.party.region].sites.some(site => site.type === 'threat' && site.state !== 'cleared')) break;
            assert(attempts++ < 20);
            const threat = expedition.regions[expedition.party.region].sites.find(site => site.type === 'threat' && site.state !== 'cleared');
            await walkTo(threat.x, threat.y); await act({ type: 'clear' });
        }
        if (expedition.camps.length >= G.NUM.MAX_CAMPS) {
            const disposable = expedition.camps.find(camp => camp.id && camp.region !== expedition.party.region);
            await travel(disposable.region); await walkTo(disposable.x, disposable.y); await act({ type: 'dismantle' });
            await travel(Object.keys(expedition.regions).find(key => expedition.regions[key].tier === currentTier));
            await walkTo(G.NUM.REGION_CENTER, G.NUM.REGION_CENTER);
        }
        await act({ type: 'newCamp' }); await act({ type: 'build', building: 'well' }); await act({ type: 'build', building: 'workshop' }); await homeAndSupply();
    }
    let currentTier = 1;
    for (currentTier = 2; currentTier <= 9; currentTier++) {
        await homeAndSupply();
        await prepare({ wood: 180, stone: 80 });
        if (expedition.camps.length >= G.NUM.MAX_CAMPS && G.atCamp(expedition).id !== 0) await act({ type: 'dismantle' });
        const key = expedition.regionGraph.nodes.find(key => expedition.regionGraph.tier[key] === currentTier);
        await travel(key); await wildSupply(); await settleLocal();
        if (currentTier === 2) { await gatherResource('iron', 8); await craft('sword'); await craft('mail'); }
        if (currentTier === 3) { await gatherResource('coal', 8); }
        if (currentTier >= 3 && !expedition.party.bag.blade) { for (let i = 0; i < 3; i++) await craft('steel'); await craft('blade'); }
        for (const region of [expedition.regions[expedition.party.region]]) {
            for (const site of region.sites) {
                if (site.state !== 'occupied' || !['iron', 'coal', 'sulphur'].includes(site.type)) continue;
                const owner = expedition.camps.find(camp => camp.id === site.ownerCamp);
                if (site.workers < 3 && owner && G.settle.employed(expedition, owner) < owner.pop) await walkTo(site.x, site.y);
                while (site.workers < 3 && owner && G.settle.employed(expedition, owner) < owner.pop) await act({ type: 'worker', site: site.id, delta: 1 });
            }
        }
        for (const site of expedition.regions[key].sites.filter(site => site.type === 'dungeon')) {
            if (site.dungeon === 'vault' && expedition.blueprints.includes('railgun')) continue;
            await homeAndSupply(); await walkTo(site.x, site.y); await act({ type: 'enter', site: site.id });
            const floor = expedition.dungeons[site.id].floor;
            await walkTo(floor.objective.x, floor.objective.y);
            assert(expedition.dungeons[site.id].cleared);
            await act({ type: 'extract' }); await homeAndSupply();
        }
        if (expedition.blueprints.includes('canteen') && !expedition.party.bag.canteen && (G.stores(expedition).steel || 0) < 4 && G.affords(expedition, G.CONTENT.items.steel.cost)) { await craft('steel'); }
        if (expedition.blueprints.includes('canteen') && !expedition.party.bag.canteen && G.affords(expedition, G.CONTENT.items.canteen.cost)) { await craft('canteen'); await resupply(); }
        if (currentTier === 5) await gatherResource('sulphur', 4);
        while ((expedition.party.bag.medicine || 0) < 8 && G.affords(expedition, G.CONTENT.items.medicine.cost)) await craft('medicine');
        if (currentTier === 7) {
            await gatherResource('crystal', 4);
            while ((G.stores(expedition).steel || 0) < 18) await craft('steel');
            await craft('suit'); await resupply();
        }
        if (currentTier >= 7 && expedition.blueprints.includes('railgun') && !expedition.party.bag.railgun) {
            while ((G.stores(expedition).crystal || 0) < 8) await gatherResource('crystal', 3);
            while ((G.stores(expedition).steel || 0) < 18) await craft('steel');
            await craft('railgun'); await resupply();
        }
        await capture('region-' + currentTier);
        console.log('UI PLAY tier=' + currentTier + ' turn=' + expedition.turn + ' hp=' + expedition.party.hp + ' blueprints=' + expedition.blueprints.join(','));
    }
    assert(expedition.blueprints.includes('hull')); assert(expedition.blueprints.includes('drive')); assert(expedition.blueprints.includes('core'));
    for (const module of ['hull', 'drive', 'core']) {
        const cost = G.CONTENT.items[module].cost;
        let attempts = 0;
        while (!G.affords(expedition, cost)) {
            assert(attempts++ < 200, 'cannot complete module ' + module + ' ' + JSON.stringify(G.stores(expedition)));
            if ((G.stores(expedition).steel || 0) < cost.steel && G.affords(expedition, G.CONTENT.items.steel.cost)) await craft('steel');
            else if ((G.stores(expedition).crystal || 0) < (cost.crystal || 0)) await gatherResource('crystal', 4);
            else if ((G.stores(expedition).sulphur || 0) < (cost.sulphur || 0)) await gatherResource('sulphur', 4);
            else if ((G.stores(expedition).wood || 0) < (cost.wood || 0)) await act({ type: 'forage' });
            else await act({ type: 'night' });
        }
        await craft(module);
    }
    await homeAndSupply();
    const ship = expedition.regions[expedition.party.region].sites.find(site => site.type === 'ship');
    await walkTo(ship.x, ship.y); await act({ type: 'launch' });
    assert.equal(expedition.endReason, 'ship'); assert.equal(expedition.cheat, false);

    await capture('ship-ending');
    assert.equal(expedition.cheat, false);
    fs.writeFileSync(path.join(output, 'completed-run.json'), JSON.stringify(expedition, null, 2));
    const endingTurn = expedition.turn;
    const beforeAbyssParty = JSON.stringify(expedition.party), beforeAbyssStores = JSON.stringify(G.stores(expedition));
    await click(page.getByRole('button', { name: '进入深渊', exact: true })); await sync();
    let floor = expedition.dungeons.abyss.floor;
    await walkTo(floor.objective.x, floor.objective.y);
    await act({ type: 'descend' }); assert.equal(expedition.dungeons.abyss.depth, 2);
    await capture('abyss-depth-two'); await act({ type: 'extract' });
    assert.equal(JSON.stringify(expedition.party), beforeAbyssParty);
    assert.equal(JSON.stringify(G.stores(expedition)), beforeAbyssStores);
    assert.equal(expedition.flags.abyssBest, 2);
    await page.reload(); await page.waitForFunction(() => Rogue.state.current); await sync();
    await click(page.getByRole('button', { name: '返回主页面', exact: true }));
    await click(page.getByRole('button', { name: '取消', exact: true }));
    await click(page.getByRole('button', { name: '返回主页面', exact: true }));
    await click(page.getByRole('button', { name: '确认', exact: true }));
    await page.waitForURL(base + 'home.html');
    assert.equal(await page.evaluate(() => localStorage.gameState), normal);
    assert.equal(await page.evaluate(() => localStorage.getItem('adr.saveSlots.v1')), database);
    assert.deepEqual({ errors, warnings, missing, remote }, { errors: [], warnings: [], missing: [], remote: [] });
    const report = { passed: true, seed: 42, actions, clicks, battles, dungeons, endingTurn, abyssBest: 2, regions: Object.keys(expedition.regions).length, cheat: expedition.cheat, elapsedSeconds: Math.round((Date.now() - started) / 1000), normalSaveUnchanged: true, errors, warnings, missing, remote };
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
} catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true });
    fs.writeFileSync(path.join(output, 'failure-state.json'), JSON.stringify(expedition, null, 2));
    throw error;
} finally { await browser.close(); }
