/* SPDX-License-Identifier: MPL-2.0 */
// Run with node scripts/test-rogue.mjs. No installed dependencies are required.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js',
    'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js',
    'rogue.map.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js'];
const checks = [];
/** Creates a headless game realm with observable in-memory local storage. */
function realm() {
    const data = new Map();
    const storage = {
        getItem(key) { return data.has(key) ? data.get(key) : null; },
        setItem(key, value) { data.set(key, String(value)); },
        removeItem(key) { data.delete(key); }
    };
    const context = vm.createContext({ window: {}, localStorage: storage, btoa, atob, console, Uint8Array });
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(root, 'script/rogue', file), 'utf8'), context, { filename: file });
    return { R: context.window.Rogue, storage, data, context };
}
/** Creates a reproducible run in the selected realm. */
function run(env, seed = 42, slot = 0) {
    const save = env.R.state.create({ seed, slot, createdAt: 1700000000000 });
    env.R.state.current = save;
    return save;
}
/** Returns a canonical hash of the complete saved model. */
function hash(save) { return createHash('sha256').update(JSON.stringify(save)).digest('hex'); }
/** Records one completed acceptance check. */
function mark(name) { checks.push(name); console.log('PASS ' + name); }
const env = realm();
const { R } = env;
for (let seed = 0; seed < 10000; seed++) {
    const graph = R.worldgen.buildRegionGraph(seed);
    assert.equal(R.worldgen.assertGraph(graph), true);
}
mark('T5: 10,000 seeds preserve all nine reachable regions, unique tiers and open-road difficulty bounds');
const maps = [];
for (let repeat = 0; repeat < 3; repeat++) {
    const save = run(env);
    const tiles = [];
    for (const key of save.regionGraph.nodes) {
        const region = R.worldgen.buildRegion(save, key);
        const decoded = R.rle.decode(region.tiles, region.size);
        const reachable = R.worldgen.flood(decoded, region.size, R.NUM.REGION_CENTER, R.NUM.REGION_CENTER);
        for (let y = 0; y < region.size; y++) {
            for (let x = 0; x < region.size; x++) {
                const tile = decoded[y * region.size + x];
                if (!x || !y || x === region.size - 1 || y === region.size - 1) assert.equal(tile, '#');
                if (tile !== '#') assert.notEqual(reachable[y * region.size + x], undefined);
            }
        }
        assert.equal(region.sites.length, R.NUM.SITE_QUOTAS[region.tier <= 3 ? 0 : region.tier <= 6 ? 1 : 2].reduce((a, b) => a + b, 0) + (region.tier === 9 ? 1 : 0));
        for (const site of region.sites) assert.notEqual(reachable[site.y * region.size + site.x], undefined);
        tiles.push(region.tiles);
    }
    maps.push(JSON.stringify(tiles));
}
assert.equal(maps[0], maps[1]); assert.equal(maps[1], maps[2]);
mark('T1/T6: seed 42 generates identical maps in three runs; all floors/sites connect and every boundary stays sealed');
for (let seed = 0; seed < 100; seed++) {
    const graph = R.worldgen.buildRegionGraph(seed);
    for (const key of graph.nodes) {
        const region = R.worldgen.buildRegion({ seed, regionGraph: graph }, key);
        const tiles = R.rle.decode(region.tiles, region.size);
        const reachable = R.worldgen.flood(tiles, region.size, R.NUM.REGION_CENTER, R.NUM.REGION_CENTER);
        const occupied = new Set();
        for (const site of region.sites) {
            assert.notEqual(reachable[site.y * region.size + site.x], undefined);
            assert(!occupied.has(site.x + ',' + site.y)); occupied.add(site.x + ',' + site.y);
        }
        for (let i = 0; i < tiles.length; i++) if (tiles[i] !== '#') assert.notEqual(reachable[i], undefined);
    }
}
mark('900 additional regional maps have reachable unique sites and no isolated walkable terrain');
const replay = [];
for (let repeat = 0; repeat < 2; repeat++) {
    const isolated = realm();
    const save = run(isolated);
    for (let turn = 0; turn < 100; turn++) assert.equal(isolated.R.state.act({ type: turn % 3 ? 'wait' : 'forage' }), true);
    assert.equal(save.turn, 100);
    replay.push(hash(save));
}
assert.equal(replay[0], replay[1]);
mark('T2: identical seeds and 100-action replays produce identical complete save hashes');
const save = run(env);
assert.equal(R.save.validate(save), true);
assert.equal(R.save.write(save), true);
const serialized = env.storage.getItem('rogueSlot0');
assert.equal(R.save.serialize(R.save.load(0)), serialized);
assert.equal(R.save.write(R.save.load(0)), true);
assert.equal(env.storage.getItem('rogueSlot0'), serialized);
mark('T3: save/load/save preserves the exact slot JSON bytes');
env.storage.setItem('gameState', ' {"untouched" : "ordinary save", "unicode": "木"} \n');
const normalBefore = env.storage.getItem('gameState');
for (let i = 0; i < 600; i++) R.state.act({ type: 'forage' });
assert.equal(env.storage.getItem('gameState'), normalBefore);
mark('T4 model: 600 player actions never change the normal gameState bytes');
const sharing = run(env);
sharing.camps.push({ id: 1, region: '0,0', x: 31, y: 30, fire: 1, pop: 1, jobs: {}, stores: {}, buildings: {} });
sharing.camps.push({ id: 2, region: '0,0', x: 32, y: 30, fire: 1, pop: 1, jobs: {}, stores: {}, buildings: {} });
R.stores(sharing).wood = 123;
sharing.party.bag.wood = 7;
assert.equal(R.state.act({ type: 'deposit' }), true);
assert.equal(R.stores(sharing).wood, 130);
sharing.activeCamp = 1;
sharing.party.x = 31;
assert.equal(R.state.act({ type: 'craft', item: 'spear' }), true);
assert.equal(R.stores(sharing).wood, 118);
sharing.activeCamp = 2;
sharing.party.x = 32;
assert.equal(R.stores(sharing).wood, 118);
assert.equal(Object.keys(sharing.camps[1].stores).length, 0);
assert.equal(Object.keys(sharing.camps[2].stores).length, 0);
mark('T7: deposit at camp A funds crafting at B and the remaining warehouse is immediately available at C');
const starving = run(env);
starving.camps[0].pop = 2; starving.camps[0].stores.food = 0;
R.state.advance(1); assert.equal(starving.camps[0].pop, 1);
R.state.advance(1); assert.equal(starving.camps[0].pop, 0);
R.state.advance(5); assert.equal(starving.camps[0].pop, 0); assert.equal(starving.endReason, 'wiped');
mark('T8: starvation loses one population per turn, stops at zero and records settlement collapse');
const battling = run(env);
R.combat.encounter(battling, { kind: 'wild' });
R.state.act({ type: 'combat', action: { type: 'guard' } });
assert(battling.flags.combat);
const combatJSON = JSON.stringify(battling.flags.combat);
const loadedBattle = R.save.load(0);
assert.equal(JSON.stringify(loadedBattle.flags.combat), combatJSON);
assert.equal(loadedBattle.party.hp, battling.party.hp);
mark('T9: an interrupted battle reloads the identical round, enemy HP, party HP and RNG');
env.storage.setItem('rogueSlot1', '{"version":1,');
assert.equal(R.save.load(1), null);
assert.equal(R.save.lastError, 'err.corrupt');
assert.equal(env.storage.getItem('rogueSlot1'), '{"version":1,');
assert.equal(R.save.list()[1].corrupt, true);
mark('T10: truncated saves are reported and preserved byte for byte');
assert.equal(R.t('not.a.real.key'), '!!not.a.real.key!!');
mark('missing translations use the explicit !!key!! marker');
const rollback = realm();
const rollbackSave = run(rollback);
assert.equal(rollback.R.save.write(rollbackSave), true);
const oldSlot = rollback.storage.getItem('rogueSlot0');
rollbackSave.turn += 1;
const set = rollback.storage.setItem;
rollback.storage.setItem = function (key, value) { if (key === 'rogueIndex') throw new Error('quota'); set(key, value); };
assert.equal(rollback.R.save.write(rollbackSave), false);
assert.equal(rollback.storage.getItem('rogueSlot0'), oldSlot);
assert.equal(rollback.R.save.lastError, 'err.savefull');
mark('storage quota failure rolls back an already-written slot without throwing');
if (process.argv.includes('--playthrough')) {
    const full = realm();
    const G = full.R;
    const expedition = run(full);
    const diagnostics = [];
    G.ui = { render() {}, notice(key) { diagnostics.push(key); } };
    /** Executes only a real public game action, failing with useful expedition diagnostics. */
    function act(action) {
        const ok = G.state.act(action);
        assert(ok, JSON.stringify({ action, diagnostics: diagnostics.slice(-2), turn: expedition.turn, party: expedition.party, stores: G.stores(expedition) }));
        assert(!expedition.over || expedition.endReason === 'ship', JSON.stringify({ reason: expedition.endReason, turn: expedition.turn, party: expedition.party }));
        fight();
    }
    /** Plays a battle using legal attacks, guards and carried medicine. */
    function fight() {
        let rounds = 0;
        while (expedition.flags.combat) {
            assert(rounds++ < 100);
            const healing = expedition.party.hp < expedition.party.maxHp * .55 && expedition.party.bag.medicine;
            const result = G.state.act({ type: 'combat', action: healing ? { type: 'item', item: 'medicine' } : { type: 'attack' } });
            assert(result);
            assert(!expedition.over || expedition.flags.abyss, JSON.stringify({ reason: expedition.endReason, turn: expedition.turn, party: expedition.party, combat: expedition.flags.combat }));
        }
    }
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
    function walkTo(x, y) {
        for (const dir of pathTo(x, y)) {
            if (expedition.party.water <= 2 && expedition.party.bag.water > 0) act({ type: 'use', item: 'water' });
            if (expedition.party.food <= 2 && expedition.party.bag.food > 0) act({ type: 'use', item: 'food' });
            if (expedition.party.hp < expedition.party.maxHp * .6 && expedition.party.bag.medicine > 0) act({ type: 'use', item: 'medicine' });
            act({ type: 'move', dir });
        }
    }
    /** Returns to the local central camp when one exists. */
    function homeAndSupply() {
        const camp = expedition.camps.find(camp => camp.region === expedition.party.region);
        assert(camp, 'local camp required'); walkTo(camp.x, camp.y);
        act({ type: 'restock' });
        for (let i = 0; i < 8 && expedition.party.hp < expedition.party.maxHp; i++) act({ type: 'wait' });
        const here = G.atCamp(expedition);
        while (expedition.party.companions.length < 2 && here.pop > 1 && G.settle.employed(expedition, here) < here.pop && G.affords(expedition, { food: G.NUM.RECRUIT_FOOD })) act({ type: 'recruit' });
    }
    /** Gathers only through valid site actions, depositing and preparing at the local camp. */
    function gatherResource(type, count) {
        const site = expedition.regions[expedition.party.region].sites.find(site => site.type === type);
        assert(site, 'missing resource ' + type);
        walkTo(site.x, site.y);
        for (let i = 0; i < count; i++) {
            if (G.bagWeight(expedition) > G.NUM.BAG_UPGRADED - 8 && expedition.party.bag.water > 0 && expedition.party.water < G.waterMax(expedition)) act({ type: 'use', item: 'water' });
            if (G.bagWeight(expedition) > G.NUM.BAG_UPGRADED - 8 && expedition.party.bag.food > 0 && expedition.party.food < G.NUM.SUPPLY_FOOD) act({ type: 'use', item: 'food' });
            if (G.bagWeight(expedition) > G.NUM.BAG_UPGRADED - 8) { homeAndSupply(); walkTo(site.x, site.y); }
            act({ type: 'gather' });
        }
        if (site.state === 'cleared') act({ type: 'occupy' });
        const owner = expedition.camps.find(camp => camp.id === site.ownerCamp);
        if (!site.workers && owner && G.settle.employed(expedition, owner) < owner.pop) act({ type: 'worker', site: site.id, delta: 1 });
        homeAndSupply();
    }
    /** Collects required construction materials using the repeatable camp forage action. */
    function prepare(cost) {
        let attempts = 0;
        while (!G.affords(expedition, cost)) {
            assert(attempts++ < 500, 'cannot prepare ' + JSON.stringify(cost));
            act({ type: 'forage' });
        }
    }
    /** Crafts one affordable item through the normal action pipeline. */
    function craft(id) { act({ type: 'craft', item: id }); }
    for (let i = 0; i < 35; i++) act({ type: 'forage' });
    for (const building of ['garden', 'garden', 'garden', 'well', 'workshop']) act({ type: 'build', building });
    craft('spear'); act({ type: 'fire' }); act({ type: 'restock' });
    gatherResource('hunting', 5); gatherResource('hunting', 5);
    craft('coat'); craft('waterskin'); act({ type: 'restock' });
    gatherResource('hunting', 5); gatherResource('hunting', 3);
    craft('pack'); act({ type: 'restock' });
    gatherResource('hunting', 4);
    gatherResource('hunting', 2);
    for (let i = 0; i < 5 && expedition.camps[0].pop < 4; i++) act({ type: 'night' });
    while (expedition.party.companions.length < 2) act({ type: 'recruit' });
    /** Moves between regions through their real interior exits using an open graph route. */
    function travel(target) {
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
            walkTo(bx < ax ? 1 : bx > ax ? G.NUM.REGION_SIZE - 2 : G.NUM.REGION_CENTER, by < ay ? 1 : by > ay ? G.NUM.REGION_SIZE - 2 : G.NUM.REGION_CENTER);
            act({ type: 'move', dir });
            if (next !== target && expedition.camps.some(camp => camp.region === next)) homeAndSupply();
        }
    }
    /** Establishes a legal outpost only after clearing every local threat. */
    function settleLocal() {
        let attempts = 0;
        while (expedition.regions[expedition.party.region].sites.some(site => site.type === 'threat' && site.state !== 'cleared')) {
            assert(attempts++ < 20);
            const threat = expedition.regions[expedition.party.region].sites.find(site => site.type === 'threat' && site.state !== 'cleared');
            walkTo(threat.x, threat.y); act({ type: 'clear' });
        }
        walkTo(G.NUM.REGION_CENTER, G.NUM.REGION_CENTER);
        if (expedition.camps.length >= 3) {
            const disposable = expedition.camps.find(camp => camp.id && camp.region !== expedition.party.region);
            travel(disposable.region); walkTo(disposable.x, disposable.y); act({ type: 'dismantle' });
            travel(Object.keys(expedition.regions).find(key => expedition.regions[key].tier === currentTier));
            walkTo(G.NUM.REGION_CENTER, G.NUM.REGION_CENTER);
        }
        act({ type: 'newCamp' }); act({ type: 'build', building: 'well' }); act({ type: 'build', building: 'workshop' }); homeAndSupply();
    }
    let currentTier = 1;
    for (currentTier = 2; currentTier <= 9; currentTier++) {
        homeAndSupply();
        prepare({ wood: 180, stone: 80 });
        if (expedition.camps.length >= 3 && G.atCamp(expedition).id !== 0) act({ type: 'dismantle' });
        const key = expedition.regionGraph.nodes.find(key => expedition.regionGraph.tier[key] === currentTier);
        travel(key); settleLocal();
        if (currentTier === 2) { gatherResource('iron', 8); craft('sword'); craft('mail'); }
        if (currentTier === 3) { gatherResource('coal', 8); }
        if (currentTier >= 3 && !expedition.party.bag.blade) { for (let i = 0; i < 3; i++) craft('steel'); craft('blade'); }
        for (const region of Object.values(expedition.regions)) {
            for (const site of region.sites) {
                if (site.state !== 'occupied' || !['iron', 'coal', 'sulphur'].includes(site.type)) continue;
                const owner = expedition.camps.find(camp => camp.id === site.ownerCamp);
                while (site.workers < 3 && owner && G.settle.employed(expedition, owner) < owner.pop) act({ type: 'worker', site: site.id, delta: 1 });
            }
        }
        for (const site of expedition.regions[key].sites.filter(site => site.type === 'dungeon')) {
            if (site.dungeon === 'vault' && expedition.blueprints.includes('railgun')) continue;
            homeAndSupply(); walkTo(site.x, site.y); act({ type: 'enter', site: site.id });
            const floor = expedition.dungeons[site.id].floor;
            walkTo(floor.objective.x, floor.objective.y);
            assert(expedition.dungeons[site.id].cleared);
            act({ type: 'extract' }); homeAndSupply();
        }
        if (expedition.blueprints.includes('canteen') && !expedition.party.bag.canteen && G.affords(expedition, G.CONTENT.items.canteen.cost)) { craft('canteen'); act({ type: 'restock' }); }
        if (currentTier === 5) gatherResource('sulphur', 4);
        while ((expedition.party.bag.medicine || 0) < 8 && G.affords(expedition, G.CONTENT.items.medicine.cost)) craft('medicine');
        if (currentTier === 7) {
            gatherResource('crystal', 4);
            while ((G.stores(expedition).steel || 0) < 18) craft('steel');
            craft('suit'); act({ type: 'restock' });
        }
        if (currentTier >= 7 && expedition.blueprints.includes('railgun') && !expedition.party.bag.railgun) {
            while ((G.stores(expedition).crystal || 0) < 8) gatherResource('crystal', 3);
            while ((G.stores(expedition).steel || 0) < 18) craft('steel');
            craft('railgun'); act({ type: 'restock' });
        }
        console.log('PLAY tier=' + currentTier + ' turn=' + expedition.turn + ' hp=' + expedition.party.hp + ' blueprints=' + expedition.blueprints.join(','));
    }
    assert(expedition.blueprints.includes('hull')); assert(expedition.blueprints.includes('drive')); assert(expedition.blueprints.includes('core'));
    for (const module of ['hull', 'drive', 'core']) {
        const cost = G.CONTENT.items[module].cost;
        let attempts = 0;
        while (!G.affords(expedition, cost)) {
            assert(attempts++ < 200, 'cannot complete module ' + module + ' ' + JSON.stringify(G.stores(expedition)));
            if ((G.stores(expedition).steel || 0) < cost.steel && G.affords(expedition, G.CONTENT.items.steel.cost)) craft('steel');
            else if ((G.stores(expedition).crystal || 0) < (cost.crystal || 0)) gatherResource('crystal', 4);
            else if ((G.stores(expedition).sulphur || 0) < (cost.sulphur || 0)) gatherResource('sulphur', 4);
            else if ((G.stores(expedition).wood || 0) < (cost.wood || 0)) act({ type: 'forage' });
            else act({ type: 'night' });
        }
        craft(module);
    }
    homeAndSupply();
    const ship = expedition.regions[expedition.party.region].sites.find(site => site.type === 'ship');
    walkTo(ship.x, ship.y); act({ type: 'launch' });
    assert.equal(expedition.endReason, 'ship'); assert.equal(expedition.cheat, false);
    assert.equal(G.save.write(expedition), true);
    fs.mkdirSync(path.join(root, '.local/rogue-tests'), { recursive: true });
    fs.writeFileSync(path.join(root, '.local/rogue-tests/completed-run.json'), JSON.stringify(expedition, null, 2));
    const beforeAbyssParty = JSON.stringify(expedition.party);
    const beforeAbyssStores = JSON.stringify(G.stores(expedition));
    assert.equal(G.dungeon.enterAbyss(expedition), true);
    let floor = expedition.dungeons.abyss.floor;
    walkTo(floor.objective.x, floor.objective.y);
    act({ type: 'descend' });
    assert.equal(expedition.dungeons.abyss.depth, 2);
    act({ type: 'extract' });
    assert.equal(JSON.stringify(expedition.party), beforeAbyssParty);
    assert.equal(JSON.stringify(G.stores(expedition)), beforeAbyssStores);
    assert.equal(expedition.flags.abyssBest, 2);
    mark('full playthrough: nine regions, finite objectives, legal production/crafting, ship ending and resource-free abyss; no assistance or state editing');
    console.log('PLAY completed without assistance at turn ' + expedition.turn);
}
const report = { passed: true, count: checks.length, checks };
fs.mkdirSync(path.join(root, '.local/rogue-tests'), { recursive: true });
fs.writeFileSync(path.join(root, '.local/rogue-tests/core-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
