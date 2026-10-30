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
    'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js'];
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
const shapes = new Set();
for (let seed = 0; seed < 10000; seed++) {
    const graph = R.worldgen.buildRegionGraph(seed);
    assert.equal(R.worldgen.assertGraph(graph), true);
    shapes.add(Array.from(graph.nodes).sort().join('|'));
}
assert(shapes.size > 1000, 'worlds must grow into varied arrangements');
mark('T5: 10,000 seeds preserve nine reachable regions with unique tiers and over 1,000 distinct arrangements');
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
        assert.equal(region.sites.length, R.NUM.SITE_QUOTAS[region.tier <= 3 ? 0 : region.tier <= 6 ? 1 : 2].reduce((a, b) => a + b, 0) + (region.tier === 9 ? 1 : 0) + 1);
        assert.equal(region.sites.filter(site => site.type === 'outpost').length, 1);
        for (const site of region.sites) assert.notEqual(reachable[site.y * region.size + site.x], undefined);
        tiles.push(region.tiles);
    }
    maps.push(JSON.stringify(tiles));
}
assert.equal(maps[0], maps[1]); assert.equal(maps[1], maps[2]);
mark('T1/T6: seed 42 generates identical maps in three runs; all floors/sites connect and every boundary stays sealed');
const startingPositions = new Set();
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
        if (region.tier === 1) { assert.notEqual(reachable[region.refuge.y * region.size + region.refuge.x], undefined); startingPositions.add(region.refuge.x + ',' + region.refuge.y); }
    }
}
assert(startingPositions.size > 75, 'the starting refuge must vary within its region');
mark('900 additional regional maps have reachable unique sites and no isolated walkable terrain');
const fogged = run(env);
assert.equal(fogged.camps.length, 1);
assert.equal(fogged.party.x, fogged.regions['0,0'].refuge.x);
assert.equal(fogged.party.y, fogged.camps[0].y);
assert.equal(Object.keys(fogged.regions).length, 1);
assert.equal(R.map.exits(fogged, true).length, 0);
const fogBytes = R.mask.decode(fogged.regions['0,0'].mask);
let revealed = 0;
for (let i = 0; i < R.NUM.REGION_SIZE * R.NUM.REGION_SIZE; i++) if (R.mask.has(fogBytes, i)) revealed++;
assert(revealed <= 61);
const beforeClues = hash(fogged);
assert(R.map.clues(fogged).length >= 1);
assert.equal(hash(fogged), beforeClues);
mark('random initial refuge, lazy world exploration and read-only local clues preserve undiscovered terrain');
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
sharing.camps.push({ id: 1, region: '0,0', x: sharing.party.x + 1, y: sharing.party.y, fire: 1, pop: 1, jobs: {}, stores: {}, buildings: {} });
R.stores(sharing).wood = 123;
sharing.party.bag.wood = 7;
assert.equal(R.state.act({ type: 'deposit' }), true);
assert.equal(R.stores(sharing).wood, 130);
sharing.activeCamp = 1;
sharing.party.x += 1;
assert.equal(R.state.act({ type: 'craft', item: 'spear' }), true);
assert.equal(R.stores(sharing).wood, 118);
sharing.activeCamp = 0;
assert.equal(R.stores(sharing).wood, 118);
assert.equal(Object.keys(sharing.camps[1].stores).length, 0);
mark('T7: both permanent settlements use one shared warehouse without duplicate inventories');
/** Places a test party on reachable empty outdoor ground without invoking a game action. */
function emptyGround(save, region = save.party.region) {
    save.party.region = region;
    if (!save.regions[region]) save.regions[region] = R.worldgen.buildRegion(save, region);
    const tiles = R.rle.decode(save.regions[region].tiles, R.NUM.REGION_SIZE);
    for (let i = 0; i < tiles.length; i++) {
        if (tiles[i] !== '.') continue;
        save.party.x = i % R.NUM.REGION_SIZE; save.party.y = Math.floor(i / R.NUM.REGION_SIZE);
        if (R.settle.canPitch(save) && !R.atTemp(save)) { R.map.reveal(save); return; }
    }
    assert.fail('expected reachable empty ground');
}
const expansion = run(env);
R.stores(expansion).wood = 500; R.stores(expansion).stone = 300; R.stores(expansion).food = 500;
emptyGround(expansion);
assert.equal(R.state.act({ type: 'newCamp' }), false);
assert.equal(expansion.turn, 0);
for (const site of expansion.regions['0,0'].sites) if (site.type === 'threat') site.state = 'cleared';
assert.equal(R.state.act({ type: 'newCamp' }), true);
assert.equal(expansion.camps.length, 2);
assert.equal(R.stores(expansion).wood, 500 - R.NUM.CAMP_UNLOCK.wood);
assert.equal(R.stores(expansion).stone, 300 - R.NUM.CAMP_UNLOCK.stone);
emptyGround(expansion, expansion.regionGraph.nodes[1]);
const beforeThird = hash(expansion);
assert.equal(R.state.act({ type: 'newCamp' }), false);
assert.equal(hash(expansion), beforeThird);
assert.equal(R.save.validate(expansion), true);
expansion.party.region = expansion.camps[0].region; expansion.party.x = expansion.camps[0].x; expansion.party.y = expansion.camps[0].y;
assert.equal(R.state.act({ type: 'dismantle' }), false);
for (const protectedPlace of ['camp', 'temporary', 'party']) {
    const isolated = realm(), state = run(isolated), region = state.regions['0,0'];
    const target = { region: '0,0', x: isolated.R.NUM.REGION_CENTER + isolated.R.NUM.VIEW_RADIUS + 1, y: isolated.R.NUM.REGION_CENTER };
    const tiles = isolated.R.rle.decode(region.tiles, region.size);
    tiles[target.y * region.size + target.x] = '.'; region.tiles = isolated.R.rle.encode(tiles); region.sites = [];
    if (protectedPlace === 'camp') Object.assign(state.camps[0], target);
    if (protectedPlace === 'temporary') state.flags.tempCamp = { ...target, expiresAt: 100 };
    if (protectedPlace === 'party') Object.assign(state.party, target);
    isolated.R.roll = () => 0;
    isolated.R.settle.onNewDay(state);
    assert.equal(region.sites.length, 0, 'threats must not spawn under ' + protectedPlace);
}
mark('two camps is a world-wide limit; invalid construction charges nothing and threats never spawn underneath a refuge, temporary camp or party');
const temporary = run(env);
temporary.party.bag.campKit = 3; temporary.party.bag.wood = 3;
R.stores(temporary).food = 500;
assert.equal(R.state.act({ type: 'deployTemp' }), false);
emptyGround(temporary);
assert.equal(R.state.act({ type: 'deployTemp' }), true);
assert.equal(temporary.camps.length, 1);
assert.equal(temporary.party.bag.campKit, 2);
assert.equal(temporary.flags.tempCamp.expiresAt - temporary.turn, R.NUM.TEMP_TURNS);
assert.equal(R.save.validate(R.save.load(0)), true);
const beforeDeposit = hash(temporary);
assert.equal(R.state.act({ type: 'deposit' }), false);
assert.equal(hash(temporary), beforeDeposit);
temporary.party.hp = 2; temporary.party.water = 8; temporary.party.food = 8;
const restTurn = temporary.turn;
assert.equal(R.state.act({ type: 'restTemp' }), true);
assert.equal(temporary.turn, restTurn + R.NUM.TEMP_REST_TURNS);
assert.equal(temporary.party.water, 6); assert.equal(temporary.party.food, 6); assert.equal(temporary.party.hp, 6);
temporary.party.water = 1;
const beforeFailedRest = hash(temporary);
assert.equal(R.state.act({ type: 'restTemp' }), false); assert.equal(hash(temporary), beforeFailedRest);
const previousTemp = JSON.stringify(temporary.flags.tempCamp);
emptyGround(temporary);
assert.equal(R.state.act({ type: 'deployTemp' }), true);
assert.notEqual(JSON.stringify(temporary.flags.tempCamp), previousTemp);
assert.equal(temporary.party.bag.campKit, 1);
assert.equal(R.state.act({ type: 'packTemp' }), true);
assert.equal(temporary.flags.tempCamp, undefined); assert.equal(temporary.party.bag.campKit, 1);
assert.equal(R.state.act({ type: 'deployTemp' }), true);
R.state.advance(R.NUM.TEMP_TURNS);
assert.equal(temporary.flags.tempCamp, undefined);
assert.equal(temporary.camps.length, 1);
mark('temporary camp deployment, replacement, paid rest, save/load, dismantling and expiry never create a warehouse or permanent slot');
const legacyRaw = fs.readFileSync(path.join(root, 'scripts/fixtures/rogue-v1.json'), 'utf8');
const legacy = JSON.parse(legacyRaw);
env.storage.setItem('rogueSlot0', legacyRaw);
const upgraded = R.save.load(0);
assert(upgraded); assert.equal(upgraded.version, R.NUM.VERSION); assert.equal(upgraded.camps.length, 2);
assert.equal(env.storage.getItem('rogueSlot0'), legacyRaw, 'loading must not rewrite an existing slot');
assert.equal(JSON.stringify(upgraded.regionGraph), JSON.stringify(legacy.regionGraph));
assert.deepEqual(JSON.parse(JSON.stringify({ ...upgraded.party, companions: [] })), { ...legacy.party, companions: [] });
for (let i = 0; i < legacy.party.companions.length; i++) { assert.deepEqual(JSON.parse(JSON.stringify(upgraded.party.companions[i])), { ...legacy.party.companions[i], id: legacy.party.companions[i].id || 'legacy:' + i, weapon: 'fists', armour: null, bag: {} }); }
const originalRegions = JSON.parse(JSON.stringify(upgraded.regions));
for (const region of Object.values(originalRegions)) { delete region.biome; region.sites = region.sites.filter(site => site.type !== 'outpost'); }
assert.equal(JSON.stringify(originalRegions), JSON.stringify(legacy.regions).replaceAll('"ownerCamp":' + legacy.camps[2].id, '"ownerCamp":' + legacy.camps[0].id));
assert.equal(upgraded.camps[0].pop, legacy.camps[0].pop + legacy.camps[2].pop);
assert.equal(upgraded.flags.tempCamp.x, legacy.camps[2].x);
assert.equal(R.save.validate(upgraded), true);
assert.equal(env.storage.getItem('gameState'), normalBefore);
mark('authentic v1 completed run upgrades without rerolling terrain/RNG/progress, relocates surplus villagers and preserves the raw slot until saved');
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
        if (expedition.flags.wildEvent) { assert(G.state.act({ type: 'event', op: 'leave' })); }
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
        if (G.settle.restockPlan(expedition)?.changed) act({ type: 'restock' });
        for (let i = 0; i < 20 && (expedition.party.hp < expedition.party.maxHp || expedition.party.companions.some(ally => ally.hp < ally.maxHp)); i++) act({ type: 'wait' });
        const here = G.atCamp(expedition);
        while (expedition.party.companions.length < 2 && here.pop > 1 && G.settle.employed(expedition, here) < here.pop && G.affords(expedition, { food: G.NUM.RECRUIT_FOOD })) act({ type: 'recruit' });
        if (here.buildings.workshop) {
            while ((expedition.party.bag.medicine || 0) < 12 && G.affords(expedition, G.CONTENT.items.medicine.cost) && G.bagWeight(expedition) < G.party.capacity(expedition, expedition.party)) act({ type: 'craft', item: 'medicine' });
        }
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
    /** Uses a supply action only when stock, reserves or active gauges can actually change. */
    function resupply() { if (G.settle.restockPlan(expedition)?.changed) act({ type: 'restock' }); }
    for (let i = 0; i < 35; i++) act({ type: 'forage' });
    for (const building of ['garden', 'garden', 'garden', 'well', 'workshop']) act({ type: 'build', building });
    craft('spear'); act({ type: 'fire' }); resupply();
    gatherResource('hunting', 5); gatherResource('hunting', 5);
    craft('coat'); craft('waterskin'); resupply();
    gatherResource('hunting', 5); gatherResource('hunting', 3);
    craft('pack'); resupply();
    gatherResource('hunting', 4);
    gatherResource('hunting', 2);
    for (let i = 0; i < 5 && expedition.camps[0].pop < 4; i++) act({ type: 'night' });
    while (expedition.party.companions.length < 2) act({ type: 'recruit' });
    /** Makes room for survival supplies using the same deliberate cargo action as the UI. */
    function clearCargo(spare) {
        const capacity = expedition.party.bag.pack ? G.NUM.BAG_UPGRADED : G.NUM.BAG_BASE;
        const resources = ['wood', 'stone', 'iron', 'coal', 'fur', 'crystal', 'steel', 'sulphur'];
        while (G.bagWeight(expedition) > capacity - spare) {
            const item = resources.find(item => expedition.party.bag[item] > 0);
            assert(item, 'survival supplies need free cargo space');
            act({ type: 'drop', item });
        }
    }
    /** Uses regional resource sites as supply stops on long routes between two bases. */
    function wildSupply() {
        const sites = expedition.regions[expedition.party.region].sites;
        const hunting = sites.find(site => site.type === 'hunting');
        if (hunting && expedition.party.food + (expedition.party.bag.food || 0) < 80) {
            walkTo(hunting.x, hunting.y);
            for (let i = 0; i < 12 && (expedition.party.bag.food || 0) < 56; i++) { clearCargo(6); act({ type: 'gather' }); }
        }
        const spring = sites.find(site => site.type === 'spring');
        if (spring && expedition.party.water + (expedition.party.bag.water || 0) < 160) {
            walkTo(spring.x, spring.y);
            for (let i = 0; i < 12 && (expedition.party.bag.water || 0) < 80; i++) { clearCargo(8); act({ type: 'gather' }); }
        }
    }
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
            if (next !== target) {
                if (expedition.camps.some(camp => camp.region === next)) homeAndSupply();
                else wildSupply();
            }
        }
    }
    /** Establishes a legal outpost only after clearing every local threat. */
    function settleLocal() {
        let attempts = 0;
        while (true) {
            if (expedition.party.water + (expedition.party.bag.water || 0) < 120 || expedition.party.food + (expedition.party.bag.food || 0) < 60) wildSupply();
            walkTo(G.NUM.REGION_CENTER, G.NUM.REGION_CENTER);
            if (!expedition.regions[expedition.party.region].sites.some(site => site.type === 'threat' && site.state !== 'cleared')) break;
            assert(attempts++ < 20);
            const threat = expedition.regions[expedition.party.region].sites.find(site => site.type === 'threat' && site.state !== 'cleared');
            walkTo(threat.x, threat.y); act({ type: 'clear' });
        }
        if (expedition.camps.length >= G.NUM.MAX_CAMPS) {
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
        if (expedition.camps.length >= G.NUM.MAX_CAMPS && G.atCamp(expedition).id !== 0) act({ type: 'dismantle' });
        const key = expedition.regionGraph.nodes.find(key => expedition.regionGraph.tier[key] === currentTier);
        travel(key); wildSupply(); settleLocal();
        if (currentTier === 2) { gatherResource('iron', 8); craft('sword'); craft('mail'); }
        if (currentTier === 3) { gatherResource('coal', 8); }
        if (currentTier >= 3 && !expedition.party.bag.blade) { for (let i = 0; i < 3; i++) craft('steel'); craft('blade'); }
        for (const region of [expedition.regions[expedition.party.region]]) {
            for (const site of region.sites) {
                if (site.state !== 'occupied' || !['iron', 'coal', 'sulphur'].includes(site.type)) continue;
                const owner = expedition.camps.find(camp => camp.id === site.ownerCamp);
                if (site.workers < 3 && owner && G.settle.employed(expedition, owner) < owner.pop) walkTo(site.x, site.y);
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
        if (expedition.blueprints.includes('canteen') && !expedition.party.bag.canteen && (G.stores(expedition).steel || 0) < 4 && G.affords(expedition, G.CONTENT.items.steel.cost)) { craft('steel'); }
        if (expedition.blueprints.includes('canteen') && !expedition.party.bag.canteen && G.affords(expedition, G.CONTENT.items.canteen.cost)) { craft('canteen'); resupply(); }
        if (currentTier === 5) gatherResource('sulphur', 4);
        while ((expedition.party.bag.medicine || 0) < 8 && G.affords(expedition, G.CONTENT.items.medicine.cost)) craft('medicine');
        if (currentTier === 7) {
            gatherResource('crystal', 4);
            while ((G.stores(expedition).steel || 0) < 18) craft('steel');
            craft('suit'); resupply();
        }
        if (currentTier >= 7 && expedition.blueprints.includes('railgun') && !expedition.party.bag.railgun) {
            while ((G.stores(expedition).crystal || 0) < 8) gatherResource('crystal', 3);
            while ((G.stores(expedition).steel || 0) < 18) craft('steel');
            craft('railgun'); resupply();
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
