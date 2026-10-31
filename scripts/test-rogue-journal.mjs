import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const stored = new Map([['gameState', ' {"ordinary":true} '], ['adr.saveSlots.v1', ' {"slots":[]} ']]);
const normal = [...stored.entries()];
const context = vm.createContext({ window: {}, Uint8Array, btoa, atob, localStorage: {
    getItem: key => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
    removeItem: key => stored.delete(key)
} });
for (const file of ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js']) {
    vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), context, { filename: file });
}
const game = context.window.Rogue;
function scenario(turn = 10) {
    const save = game.state.create({ seed: 42, slot: 0, createdAt: 1 });
    const region = save.regions[save.party.region];
    const size = region.size;
    const tiles = Array.from({ length: size * size }, (_, index) => {
        const column = index % size, row = Math.floor(index / size);
        return column === 0 || row === 0 || column === size - 1 || row === size - 1 ? '#' : '.';
    });
    region.tiles = game.rle.encode(tiles); region.sites = [];
    const mask = game.mask.decode(game.mask.empty(size));
    for (let index = 0; index < tiles.length; index++) game.mask.set(mask, index);
    region.mask = game.mask.encode(mask);
    save.party.bag.canteen = 1;
    Object.assign(save.party, { x: 30, y: 30, water: game.NUM.CANTEEN_WATER, food: game.NUM.SUPPLY_FOOD });
    Object.assign(save.camps[0], { x: 30, y: 30 });
    Object.assign(game.stores(save), { food: 500, water: 500 });
    save.turn = turn; save.day = Math.floor(turn / game.NUM.TURNS_PER_DAY); save.flags.log = [];
    game.state.current = save; game.map.reset();
    return save;
}
function move(direction) { assert(game.state.act({ type: 'move', dir: direction })); }
function entries(save) { return JSON.parse(JSON.stringify(game.journalEntries(save))); }
function steps(save) { return save.flags.log.filter(entry => entry.key === 'log.move').reduce((total, entry) => total + entry.values.n, 0); }

let save = scenario();
move('north'); move('north'); move('north');
assert.equal(save.flags.log.length, 1);
assert.equal(save.flags.log[0].values.n, 3);
assert.equal(save.flags.log[0].turn, 13);
assert.equal(game.t(save.flags.log[0].key, save.flags.log[0].values), '向北行进3步');
assert.equal(save.flags.moves, 3);
assert(!save.flags.log.some(entry => entry.key === 'log.action.move'));
const oldLogs = JSON.stringify(save.flags.log);
assert(game.save.write(save));
save = game.save.load(0); game.state.current = save; game.map.reset();
assert.equal(JSON.stringify(save.flags.log), oldLogs);
const originalEntry = JSON.stringify(save.flags.log[0]);
move('north'); move('north');
assert.equal(save.flags.log.length, 2);
assert.equal(JSON.stringify(save.flags.log[0]), originalEntry);
assert.equal(save.flags.log[1].values.n, 2);
assert.equal(entries(save).length, 1); assert.equal(entries(save)[0].values.n, 5);
assert.equal(entries(save)[0].turn, 15);
assert.equal(steps(save), 5);
console.log('PASS successful moves accumulate after settlement; reload preserves historical entries and starts a new saved segment');

save = scenario();
move('north'); move('north');
game.log(save, 'log.discover', { name: game.t('site.hunting') });
move('north'); move('east');
assert.deepEqual(entries(save).map(entry => game.t(entry.key, entry.values)), ['向北行进2步', game.t('log.discover', { name: game.t('site.hunting') }), '向北行进1步', '向东行进1步']);
assert(game.state.act({ type: 'wait' })); move('east');
assert.equal(save.flags.log.at(-2).key, 'log.action.wait');
assert.equal(save.flags.log.at(-1).values.n, 1);
const beforeInvalid = JSON.stringify(save);
assert.equal(game.state.act({ type: 'move', dir: 'invalid' }), false);
assert.equal(JSON.stringify(save), beforeInvalid);
move('east'); assert.equal(save.flags.log.at(-1).values.n, 2);
game.log(save, 'log.waterWarning', { n: 10, water: 2 }); move('west');
game.log(save, 'log.hit', { name: game.t('log.you'), n: 1 }); move('west');
assert.equal(save.flags.log.at(-1).values.n, 1);
assert.equal(steps(save), save.flags.moves);
console.log('PASS turns, waits, discoveries, warnings and combat records split groups; invalid movement adds neither steps nor turns');

save = scenario(48); move('north'); move('north'); move('north');
assert.equal(save.turn, 51); assert.equal(save.day, 1);
assert.equal(steps(save), 3);
assert(save.flags.log.every((entry, index, logs) => !index || entry.turn >= logs[index - 1].turn));
assert(game.save.validate(save));
save = scenario(); assert(game.state.act({ type: 'night' }));
assert(save.flags.log.find(entry => entry.key === 'log.night').duration > 1);
console.log('PASS cross-day settlement retains chronological events and multi-turn metadata');

const legacy = { flags: { log: [] } };
for (let index = 0; index < 120; index++) legacy.flags.log.push({ key: 'log.move', values: { direction: '北', n: index === 0 ? 3 : 1 }, turn: index });
legacy.flags.log.push({ key: 'log.discover', values: { name: '猎场' } });
legacy.flags.log.push({ key: 'log.move', values: { direction: '北', n: 2 }, turn: 121 });
legacy.flags.log.push({ key: 'log.move', values: { direction: '北', n: 0 }, turn: 122 });
const rawHistory = JSON.stringify(legacy);
const grouped = entries(legacy);
assert.equal(grouped.length, 4); assert.equal(grouped[0].values.n, 122); assert.equal(grouped[2].values.n, 2);
assert.equal(JSON.stringify(legacy), rawHistory);
grouped[0].values.n = 999;
assert.equal(JSON.stringify(legacy), rawHistory);
for (const [key, value] of normal) assert.equal(stored.get(key), value);
console.log('PASS old single-step and aggregated logs project without mutation or truncation; ordinary save bytes remain unchanged');
