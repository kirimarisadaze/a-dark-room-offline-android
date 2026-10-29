/* SPDX-License-Identifier: MPL-2.0 */
// Explicit model scenarios for local storage; the independent UI playthrough starts a fresh run.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const checks = [];
const files = ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js'];
/** Creates declared scenario data and byte-sensitive ordinary storage sentinels. */
function scenario() {
    const data = new Map([['gameState', ' ordinary \n 木 '], ['adr.saveSlots.v1', ' database \t unchanged ']]);
    const context = vm.createContext({ window: {}, localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }, Uint8Array, btoa, atob });
    for (const file of files) vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), context);
    const R = context.window.Rogue, s = R.state.create({ seed: 42, slot: 0, createdAt: 1 }); R.state.current = s;
    R.ui = { preferences: { waterWarning: false }, notice() {}, render() {} };
    s.camps[0].stores.food = 1000;
    return { R, s, data };
}
/** Moves only a declared fixture to a reachable empty tile. */
function ground(R, s, skip = []) {
    const tiles = R.map.current(s).tiles;
    for (let i = 0; i < tiles.length; i++) {
        const x = i % 61, y = Math.floor(i / 61);
        if (tiles[i] !== '.' || x < 5 || y < 5 || x > 55 || y > 55 || s.regions[s.party.region].sites.some(p => p.x === x && p.y === y) || s.camps.some(p => p.x === x && p.y === y) || skip.some(p => p.x === x && p.y === y)) continue;
        Object.assign(s.party, { x, y }); R.map.reveal(s); return { x, y, region: s.party.region };
    }
    assert.fail('Fixture needs empty ground');
}
/** Records one complete behavioral assertion group. */
function mark(text) { checks.push(text); console.log('PASS ' + text); }
let { R, s, data } = scenario();
s.party.bag.stone = 78;
assert(R.state.act({ type: 'transfer', from: 'store', to: 'player', item: 'wood', quantity: 10 }));
assert.equal(s.party.bag.wood, 2); assert.equal(R.bagWeight(s), 80);
let before = JSON.stringify(s);
assert.equal(R.state.act({ type: 'transfer', from: 'store', to: 'player', item: 'wood', quantity: 'all' }), false); assert.equal(JSON.stringify(s), before);
for (const quantity of [0, -1, 1.5, NaN, Infinity, '10', null]) {
    assert.equal(R.state.act({ type: 'transfer', from: 'player', to: 'store', item: 'wood', quantity }), false); assert.equal(JSON.stringify(s), before);
}
assert(R.state.act({ type: 'transfer', from: 'player', to: 'store', item: 'wood', quantity: 1 }));
assert.equal(s.party.bag.wood, 1);
ground(R, s); before = JSON.stringify(s);
assert.equal(R.state.act({ type: 'transfer', from: 'store', to: 'player', item: 'wood' }), false); assert.equal(JSON.stringify(s), before);
mark('chosen quantities clamp to real stock and free space, invalid requests and remote warehouse access never mutate a run');
({ R, s, data } = scenario());
ground(R, s); s.party.bag = { campKit: 3, wood: 50, water: 10, food: 5, medicine: 2, spear: 1, pack: 1 }; s.party.weapon = 'spear';
assert(R.state.act({ type: 'deployTemp' }));
const permanent = JSON.stringify(R.stores(s));
assert(R.state.act({ type: 'stowMaterials', to: 'temp' }));
assert.equal(s.flags.tempCamp.stores.wood, 50); assert.equal(s.party.bag.wood, 0);
assert.equal(s.party.bag.water, 10); assert.equal(s.party.bag.food, 5); assert.equal(s.party.bag.medicine, 2); assert.equal(s.party.weapon, 'spear');
assert.equal(R.stores(s).wood, JSON.parse(permanent).wood);
assert(R.state.act({ type: 'transfer', from: 'player', to: 'temp', item: 'spear', quantity: 1 })); assert.equal(s.party.weapon, 'fists');
const total = R.party.owned(s, 'spear'); assert.equal(total, 1);
before = JSON.stringify(s); assert.equal(R.state.act({ type: 'transfer', from: 'player', to: 'temp', item: 'pack', quantity: 1 }), false); assert.equal(JSON.stringify(s), before);
s.party.bag.stone = 50;
assert(R.state.act({ type: 'transfer', from: 'player', to: 'temp', item: 'stone', quantity: 'all' }));
assert.equal(R.party.weight(s.flags.tempCamp.stores), R.NUM.TEMP_STORAGE); assert.equal(s.party.bag.stone, 21);
assert(R.save.write(s)); const raw = data.get('rogueSlot0'); const loaded = R.save.load(0); assert.equal(JSON.stringify(loaded), raw);
assert.equal(loaded.flags.tempCamp.stores.wood, 50); assert.equal(loaded.camps.length, 1);
mark('temporary storage is local, capacity-limited and resumable; materials preserve supplies, tools stay carried and the last worn weapon is safely removed');
const first = { ...s.flags.tempCamp }; const stock = JSON.stringify(first.stores);
ground(R, s, [first]);
assert(R.state.act({ type: 'deployTemp' }));
assert.equal(JSON.stringify(s.flags.caches[0].stores), stock); assert.equal(R.party.weight(s.flags.tempCamp.stores), 0);
assert.equal(R.party.owned(s, 'spear'), total);
before = JSON.stringify(s); assert.equal(R.state.act({ type: 'transfer', from: 'cache', to: 'player', item: 'spear' }), false); assert.equal(JSON.stringify(s), before);
Object.assign(s.party, first); delete s.party.expiresAt; delete s.party.stores;
assert(R.state.act({ type: 'transfer', from: 'cache', to: 'player', item: 'spear' })); assert.equal(s.party.bag.spear, 1);
assert(R.map.window(s).flat().some(c => c && c.cls === 'player'));
Object.assign(s.party, { x: first.x + 1 }); R.map.reveal(s);
assert(R.map.window(s).flat().some(c => c && c.symbol === '*'));
mark('moving a shelter leaves a visible cache at the original tile without teleporting, duplicating or deleting stored items');
({ R, s, data } = scenario());
ground(R, s); s.party.bag = { campKit: 1, wood: 10 };
assert(R.state.act({ type: 'deployTemp' })); assert(R.state.act({ type: 'transfer', from: 'player', to: 'temp', item: 'wood', quantity: 'all' }));
R.state.advance(s.flags.tempCamp.expiresAt - s.turn);
assert.equal(s.flags.tempCamp, undefined); assert.equal(R.party.cache(s).stores.wood, 10);
assert(R.state.act({ type: 'transfer', from: 'cache', to: 'player', item: 'wood', quantity: 'all' })); assert.equal(R.party.cache(s), null); assert.equal(s.party.bag.wood, 10);
assert.equal(s.flags.caches.length, 0); assert.equal(s.camps.length, 1);
s.party.bag.campKit = 1; assert(R.state.act({ type: 'deployTemp' }));
assert(R.state.act({ type: 'transfer', from: 'player', to: 'temp', item: 'wood', quantity: 10 }));
assert(R.state.act({ type: 'packTemp' })); assert.equal(R.party.cache(s).stores.wood, 10);
before = JSON.stringify(s); assert.equal(R.state.act({ type: 'transfer', from: 'player', to: 'cache', item: 'campKit' }), false); assert.equal(JSON.stringify(s), before);
assert(R.save.validate(s));
for (const change of [bad => bad.flags.caches[0].stores.wood = -1, bad => bad.flags.caches[0].x = 0, bad => bad.flags.caches[0].stores = [], bad => bad.flags.caches = {}]) {
    const bad = R.clone(s); change(bad); assert.equal(R.save.validate(bad), false);
}
assert.equal(data.get('gameState'), ' ordinary \n 木 '); assert.equal(data.get('adr.saveSlots.v1'), ' database \t unchanged ');
mark('expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged');
({ R, s, data } = scenario());
ground(R, s); s.party.bag = { campKit: 1, wood: 10 };
assert(R.state.act({ type: 'deployTemp' })); assert(R.state.act({ type: 'transfer', from: 'player', to: 'temp', item: 'wood', quantity: 'all' }));
for (const site of s.regions[s.party.region].sites) if (site.type === 'threat') site.state = 'cleared';
Object.assign(R.stores(s), { wood: 200, stone: 100 });
assert(R.state.act({ type: 'newCamp' })); assert.equal(s.flags.tempCamp, undefined); assert.equal(R.stores(s).wood, 130); assert.equal(s.camps.length, 2);
const old = R.clone(s); old.flags.tempCamp = { region: s.party.region, x: 10, y: 10, expiresAt: 100 };
const rawOld = JSON.stringify(old); data.set('rogueSlot0', rawOld);
assert(R.save.load(0)); assert.equal(data.get('rogueSlot0'), rawOld);
assert.equal(R.save.load(0).party.bag.pack, old.party.bag.pack);
mark('building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load');
fs.mkdirSync('.local/rogue-tests', { recursive: true });
fs.writeFileSync('.local/rogue-tests/storage-model-report.json', JSON.stringify({ passed: true, checks }, null, 2));
