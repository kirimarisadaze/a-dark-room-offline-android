/* SPDX-License-Identifier: MPL-2.0 */
// Run with node scripts/test-rogue-survival.mjs; no dependencies or game-state shortcuts in UI playthroughs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const files = ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js'];
const checks = [];
/** Creates a deterministic isolated scenario and byte-sensitive ordinary storage sentinels. */
function scenario(seed = 42) {
    const data = new Map([['gameState', '  {"old":"木"} \n'], ['adr.saveSlots.v1', ' {"normal":true} ']]);
    const localStorage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k) };
    const context = vm.createContext({ window: {}, localStorage, console, Uint8Array, btoa, atob });
    for (const file of files) vm.runInContext(fs.readFileSync(new URL('../script/rogue/' + file, import.meta.url), 'utf8'), context);
    const R = context.window.Rogue, save = R.state.create({ seed, slot: 0, createdAt: 1 });
    R.state.current = save; R.ui = { preferences: { waterWarning: true }, render() {}, notice() {} };
    return { R, save, data };
}
/** Records a complete behavioral check. */
function mark(name) { checks.push(name); console.log('PASS ' + name); }
const { R, save, data } = scenario();
Object.assign(R.stores(save), { wood: 500, stone: 500, fur: 100, iron: 100, food: 1000 });
assert(R.state.act({ type: 'craft', item: 'waterskin' }));
assert.equal(R.waterMax(save), 40);
const paid = JSON.stringify(save);
assert.equal(R.state.act({ type: 'craft', item: 'waterskin' }), false);
assert.equal(JSON.stringify(save), paid);
assert.equal(R.settle.recipeAllowed(save, 'waterskin'), false);
mark('water skin is crafted once, stays at 40 water and a rejected repeat charges neither resources nor turns');
assert(R.state.act({ type: 'craft', item: 'spear' }));
assert(R.state.act({ type: 'craft', item: 'spear' }));
assert.equal(save.party.bag.spear, 2);
assert.equal(R.CONTENT.items[save.party.weapon].dmg, 4);
assert(R.state.act({ type: 'unequip', kind: 'weapon' }));
assert.equal(save.party.weapon, 'fists');
assert(R.state.act({ type: 'transfer', from: 'player', to: 'store', item: 'spear' }));
assert(R.state.act({ type: 'transfer', from: 'player', to: 'store', item: 'spear' }));
assert.equal(save.party.bag.spear, 0); assert.equal(R.stores(save).spear, 2);
assert(R.state.act({ type: 'transfer', from: 'store', to: 'player', item: 'spear' }));
assert(R.state.act({ type: 'equip', item: 'spear' }));
assert(R.state.act({ type: 'transfer', from: 'player', to: 'store', item: 'spear' }));
assert.equal(save.party.weapon, 'fists'); assert.equal(R.stores(save).spear, 2);
mark('duplicate weapons count physically; unequip, warehouse deposit/withdrawal and removal of the last equipped copy conserve items');
assert(R.state.act({ type: 'recruit' }));
const ally = save.party.companions[0], id = ally.id;
assert(R.state.act({ type: 'transfer', from: 'store', to: id, item: 'spear' }));
assert(R.state.act({ type: 'equip', member: id, item: 'spear' }));
assert.equal(ally.weapon, 'spear'); assert.equal(ally.bag.spear, 1);
assert(R.state.act({ type: 'craft', item: 'coat' }));
assert(R.state.act({ type: 'transfer', from: 'player', to: id, item: 'coat' }));
assert(R.state.act({ type: 'equip', member: id, item: 'coat' }));
assert.equal(ally.maxHp, 22); assert.equal(ally.hp, 14);
assert(R.state.act({ type: 'unequip', member: id, kind: 'armour' }));
assert(R.state.act({ type: 'equip', member: id, item: 'coat' }));
assert.equal(ally.hp, 14, 'armour swaps cannot manufacture healing');
save.party.bag.water = 30;
assert(R.state.act({ type: 'transfer', from: 'player', to: id, item: 'water' }));
assert(R.state.act({ type: 'transfer', from: 'player', to: id, item: 'water' }));
assert(R.state.act({ type: 'transfer', from: 'player', to: id, item: 'water' }));
assert.equal(R.party.weight(ally.bag), R.NUM.COMPANION_BAG, 'a partial transfer fills only the actual free space');
const full = JSON.stringify(save);
assert.equal(R.state.act({ type: 'transfer', from: 'player', to: id, item: 'water' }), false);
assert.equal(JSON.stringify(save), full);
assert(R.save.validate(save));
const restored = R.save.deserialize(R.save.serialize(save));
assert.equal(restored.party.companions[0].weapon, 'spear'); assert.equal(restored.party.companions[0].bag.water, 22);
const returnPop = R.atCamp(save).pop, spearTotal = R.party.owned(save, 'spear');
assert(R.state.act({ type: 'dismiss', member: id }));
assert.equal(save.party.companions.length, 0); assert.equal(R.atCamp(save).pop, returnPop + 1);
assert.equal(R.party.owned(save, 'spear'), spearTotal); assert.equal(R.stores(save).coat, 1);
mark('companion gear, pack capacity, reload, no healing exploit and dismissal return all items and the resident');

/** Resolves one controlled combat round to measure a companion's real equipment contribution. */
function measure(weapon, armour) {
    const { R, save } = scenario();
    const ally = { id: 'test', name: R.CONTENT.names[0], str: 2, agi: 3, will: 3, hp: 30, maxHp: 46, quirk: R.CONTENT.quirks[0], weapon, armour, bag: { blade: 1, suit: 1 } };
    save.party.companions.push(ally);
    R.roll = () => 0;
    const session = R.combat.start([{ id: 'wolf', type: 'wolf', hp: 100, maxHp: 100, dmg: 10, agi: 1 }], {});
    R.combat.act(session, { type: 'attack' });
    return { enemy: session.enemies[0].hp, ally: ally.hp };
}
const bare = measure('fists', null), armed = measure('blade', 'suit');
assert.equal(bare.enemy - armed.enemy, 9); assert(armed.ally > bare.ally);
const weak = { enemies: [{ hp: 10, maxHp: 10, dmg: 1, agi: 2 }], round: 1 };
const strong = { enemies: [{ hp: 100, maxHp: 100, dmg: 10, agi: 2 }], round: 1 };
assert(R.combat.escapeChance(strong) < R.combat.escapeChance(weak));
strong.round = 100; assert.equal(R.combat.escapeChance(strong), .08);
const fight = scenario(); fight.R.roll = () => .079;
const session = fight.R.combat.start([{ id: 'wolf', type: 'wolf', hp: 100, maxHp: 100, dmg: 10, agi: 2 }], {});
session.round = 100; assert.equal(fight.R.combat.act(session, { type: 'flee' }).result, 'fled');
mark('companion weapons and armour affect actual damage; escape decays faster against stronger enemies and rolls exactly at the 8% floor');
const group = new Set();
for (const key of save.regionGraph.nodes) {
    const region = R.worldgen.buildRegion(save, key); group.add(region.biome);
    assert.equal(region.sites.filter(s => s.type === 'outpost').length, 1);
}
assert.equal(group.size, 6);
const route = scenario(), region = route.save.regions['0,0'];
const tiles = Array(61 * 61).fill('#');
for (const [x, y] of [[1, 1], [1, 2], [2, 2], [3, 2], [3, 1]]) tiles[y * 61 + x] = '.';
region.tiles = route.R.rle.encode(tiles); region.biome = 'hills'; region.mask = route.R.mask.empty(61);
const mask = route.R.mask.decode(region.mask); for (let i = 0; i < tiles.length; i++) if (tiles[i] === '.') route.R.mask.set(mask, i); region.mask = route.R.mask.encode(mask);
Object.assign(route.save.camps[0], { x: 1, y: 1 }); Object.assign(route.save.party, { x: 3, y: 1, water: 4 });
assert.equal(route.R.wild.homeRoute(route.save).cost, 5, 'detour must cost more than Manhattan distance');
route.R.wild.warn(route.save); const logLength = route.save.flags.log.length;
assert(route.save.flags.log.some(l => l.key === 'log.waterWarning'));
route.R.wild.warn(route.save); assert.equal(route.save.flags.log.length, logLength);
route.R.ui.preferences.waterWarning = false; route.R.wild.warn(route.save);
assert.equal(route.save.flags.waterWarning, '');
route.R.ui.preferences.waterWarning = true; route.save.party.bag.water = 1; route.R.wild.warn(route.save);
assert.equal(route.save.flags.waterWarning, '');
route.save.party.water = 10; assert(route.R.map.move(route.save, 'south')); assert.equal(route.save.party.water, 8.75);
mark('all six biomes occur; hills charge 1.25 water and route warnings use revealed detours, reserves, toggle and deduplication');
const trader = scenario(); trader.R.wild.start(trader.save, 'merchant');
const offers = JSON.stringify(trader.save.flags.wildEvent.offers);
assert.equal(JSON.stringify(trader.R.save.deserialize(trader.R.save.serialize(trader.save)).flags.wildEvent.offers), offers);
const item = trader.save.flags.wildEvent.offers[0]; Object.assign(trader.save.party.bag, item.cost);
assert(trader.R.state.act({ type: 'event', op: 'buy', index: 0 }));
const once = JSON.stringify(trader.save); assert.equal(trader.R.state.act({ type: 'event', op: 'buy', index: 0 }), false); assert.equal(JSON.stringify(trader.save), once);
assert.equal(trader.R.state.act({ type: 'move', dir: 'east' }), false);
assert(trader.R.state.act({ type: 'event', op: 'leave' }));
const latest = trader.save.regionGraph.nodes.find(k => trader.save.regionGraph.tier[k] === 9); trader.save.regions[latest] = trader.R.worldgen.buildRegion(trader.save, latest);
for (let i = 0; i < 50; i++) assert(trader.R.wild.goods(trader.save).some(o => ['sulphur', 'steel', 'crystal', 'blade', 'suit'].includes(o.item)));
trader.R.wild.start(trader.save, 'cache'); assert(trader.R.state.act({ type: 'event', op: 'collect' })); assert.equal(trader.R.state.act({ type: 'event', op: 'collect' }), false);
mark('merchant prices and goods persist, high progress guarantees scarce offers, events block movement and rewards cannot be claimed twice');
const fort = scenario(); const compound = fort.save.regions['0,0'].sites.find(s => s.type === 'outpost');
Object.assign(fort.save.party, { x: compound.x, y: compound.y, hp: 1000, maxHp: 1000 });
Object.assign(fort.R.stores(fort.save), { wood: 500, stone: 500, food: 10000 });
assert(fort.R.state.act({ type: 'outpost', op: 'enter' }));
let battles = 0;
while (compound.assault < 5) {
    assert(fort.R.state.act({ type: 'outpost', op: 'explore' }));
    if (fort.save.flags.combat) {
        battles++;
        while (fort.save.flags.combat) assert(fort.R.state.act({ type: 'combat', action: { type: 'attack' } }));
    }
    assert(fort.R.save.deserialize(fort.R.save.serialize(fort.save)));
}
assert.equal(battles, 3); assert.equal(compound.state, 'cleared');
assert(fort.R.state.act({ type: 'outpost', op: 'leave' }));
assert(fort.R.state.act({ type: 'outpost', op: 'enter' })); assert.equal(compound.assault, 5);
assert(fort.R.state.act({ type: 'outpost', op: 'claim' })); assert.equal(fort.save.camps.length, 2); assert(fort.R.atCamp(fort.save).buildings.well);
const nextKey = fort.save.regionGraph.nodes[1]; fort.save.regions[nextKey] = fort.R.worldgen.buildRegion(fort.save, nextKey);
const nextFort = fort.save.regions[nextKey].sites.find(s => s.type === 'outpost'); nextFort.assault = 5; nextFort.state = 'cleared';
Object.assign(fort.save.party, { region: nextKey, x: nextFort.x, y: nextFort.y });
assert(fort.R.state.act({ type: 'outpost', op: 'enter' }));
const beforeLimit = JSON.stringify(fort.save); assert.equal(fort.R.state.act({ type: 'outpost', op: 'claim' }), false); assert.equal(JSON.stringify(fort.save), beforeLimit);
const beforeWood = fort.R.stores(fort.save).wood;
assert(fort.R.state.act({ type: 'outpost', op: 'claim', replace: true })); assert.equal(fort.save.camps.length, 2);
assert.equal(fort.save.camps[0].id, 0); assert.equal(compound.state, 'cleared'); assert.equal(fort.R.stores(fort.save).wood, beforeWood - 20);
assert(fort.R.save.validate(fort.save));
mark('each compound requires three battles and two search stages; reload/withdraw retain progress, claims respect two global camps and inherited buildings cannot yield refund exploits');
const legacyRaw = fs.readFileSync(new URL('./fixtures/rogue-v2.json', import.meta.url), 'utf8'); const legacy = JSON.parse(legacyRaw);
const migrated = R.save.deserialize(legacyRaw); assert(migrated); assert.equal(migrated.version, 3); assert.equal(migrated.flags.rng, legacy.flags.rng);
for (const [key, old] of Object.entries(legacy.regions)) {
    assert.equal(migrated.regions[key].tiles, old.tiles); assert.equal(migrated.regions[key].mask, old.mask);
    assert.equal(JSON.stringify(migrated.regions[key].sites.filter(s => s.type !== 'outpost')), JSON.stringify(old.sites));
}
assert(R.save.validate(migrated));
assert.equal(data.get('gameState'), '  {"old":"木"} \n'); assert.equal(data.get('adr.saveSlots.v1'), ' {"normal":true} ');
mark('authentic v2 migration preserves all old terrain, fog, sites and RNG; ordinary save bytes remain unchanged');
fs.mkdirSync('.local/rogue-tests', { recursive: true });
fs.writeFileSync('.local/rogue-tests/survival-model-report.json', JSON.stringify({ passed: true, checks }, null, 2));
