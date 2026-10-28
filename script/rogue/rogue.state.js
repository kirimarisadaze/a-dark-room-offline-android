/* SPDX-License-Identifier: MPL-2.0 */
/** Defines deterministic state, shared helpers and the action-only turn clock. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    /** Clones JSON-compatible game data without sharing mutable state. */
    R.clone = function (value) { return JSON.parse(JSON.stringify(value)); };
    /** Clamps a scalar to its permitted range. */
    R.clamp = function (value, min, max) { return Math.max(min, Math.min(max, value)); };
    /** Creates an isolated xorshift32 generator for world generation. */
    R.random = function (seed) {
        var value = (seed >>> 0) || 1831565813;
        /** Advances the generator by one reproducible draw. */
        return function () {
            value ^= value << 13;
            value ^= value >>> 17;
            value ^= value << 5;
            return (value >>> 0) / 4294967296;
        };
    };
    /** Advances the random stream stored inside the current save. */
    R.roll = function (save) {
        var value = save.flags.rng || 1831565813;
        value ^= value << 13;
        value ^= value >>> 17;
        value ^= value << 5;
        save.flags.rng = value >>> 0;
        return save.flags.rng / 4294967296;
    };
    /** Computes an inclusive deterministic integer. */
    R.integer = function (random, min, max) { return min + Math.floor(random() * (max - min + 1)); };
    /** Produces a stable independent seed for a coordinate or content id. */
    R.hash = function (seed, text) {
        var value = seed >>> 0;
        var i;
        for (i = 0; i < text.length; i++) {
            value = Math.imul(value ^ text.charCodeAt(i), 16777619) >>> 0;
            value ^= value << 13;
            value ^= value >>> 17;
            value ^= value << 5;
        }
        return value >>> 0;
    };
    /** Returns the single shared warehouse for every camp. */
    R.stores = function (save) { return save.camps[0].stores; };
    /** Returns the camp at the party's exact outdoor position. */
    R.atCamp = function (save) {
        if (save.flags.insideDungeon) { return null; }
        var i;
        for (i = 0; i < save.camps.length; i++) {
            if (save.camps[i].region === save.party.region && save.camps[i].x === save.party.x && save.camps[i].y === save.party.y) {
                return save.camps[i];
            }
        }
        return null;
    };
    /** Returns the active temporary shelter only at its outdoor position. */
    R.atTemp = function (save) {
        var camp = save.flags.tempCamp;
        return !save.flags.insideDungeon && camp && camp.expiresAt > save.turn && camp.region === save.party.region && camp.x === save.party.x && camp.y === save.party.y ? camp : null;
    };
    /** Sums the effects of completed technologies. */
    R.bonus = function (save, effect) {
        var total = 0;
        var i;
        for (i = 0; i < R.CONTENT.research.length; i++) {
            var tech = R.CONTENT.research[i];
            if (tech.effect === effect && save.flags['tech.' + tech.id]) { total += tech.amount; }
        }
        return total;
    };
    /** Tests a cost against the shared warehouse without mutation. */
    R.affords = function (save, cost) {
        var stores = R.stores(save);
        var id;
        for (id in cost) {
            if ((stores[id] || 0) + 0.000001 < cost[id]) { return false; }
        }
        return true;
    };
    /** Pays a previously validated resource cost. */
    R.pay = function (save, cost) {
        var id;
        for (id in cost) { R.stores(save)[id] = Math.max(0, (R.stores(save)[id] || 0) - cost[id]); }
    };
    /** Adds a resource bundle to a selected inventory. */
    R.add = function (inventory, bundle, multiplier) {
        var id;
        multiplier = multiplier === undefined ? 1 : multiplier;
        for (id in bundle) { inventory[id] = (inventory[id] || 0) + bundle[id] * multiplier; }
    };
    /** Records translatable log entries so saved text remains localizable. */
    R.log = function (save, key, values) {
        save.flags.log.push({ key: key, values: values || {}, turn: save.turn });
        if (save.flags.log.length > N.LOG_LIMIT) { save.flags.log.shift(); }
    };
    /** Reports a recoverable action failure to the active interface. */
    R.fail = function (key) {
        if (R.ui && R.ui.notice) { R.ui.notice(key); }
        return false;
    };
    /** Returns the current water capacity including crafted tools and research. */
    R.waterMax = function (save) {
        return (save.party.bag.canteen ? N.CANTEEN_WATER : save.party.bag.waterskin ? N.WATERSKIN_WATER : N.BASE_WATER) + R.bonus(save, 'water');
    };
    /** Counts only physical carried items, including equipment reserves. */
    R.bagWeight = function (save) {
        var weight = 0;
        var id;
        for (id in save.party.bag) { weight += save.party.bag[id]; }
        return weight;
    };
    R.state = {
        current: null,
        /** Creates a new isolated run without writing to localStorage. */
        create: function (options) {
            var seed = options.seed >>> 0;
            var save = {
                version: N.VERSION, slot: options.slot, seed: seed,
                createdAt: options.createdAt === undefined ? Date.now() : options.createdAt,
                turn: 0, day: 0, speed: 2, cheat: false, over: false,
                party: { hp: N.BASE_HP, maxHp: N.BASE_HP, weapon: 'fists', armour: null,
                    water: N.BASE_WATER, food: N.BASE_FOOD, bag: {}, companions: [],
                    x: N.REGION_CENTER, y: N.REGION_CENTER, region: '0,0' },
                camps: [{ id: 0, region: '0,0', x: N.REGION_CENTER, y: N.REGION_CENTER,
                    fire: 1, pop: N.START_POP, jobs: {}, stores: R.clone(N.START_STORES), buildings: {} }],
                activeCamp: 0, regionGraph: R.worldgen.buildRegionGraph(seed), regions: {}, dungeons: {},
                blueprints: R.save ? R.save.blueprints() : [],
                flags: { rng: seed || 1831565813, log: [], moves: 0, dungeonMoves: 0, memorial: [], abyssBest: 0 }
            };
            save.regions['0,0'] = R.worldgen.buildRegion(save, '0,0');
            var refuge = save.regions['0,0'].refuge;
            save.party.x = refuge.x; save.party.y = refuge.y;
            save.camps[0].x = refuge.x; save.camps[0].y = refuge.y;
            R.map.reveal(save);
            R.log(save, 'log.begin');
            return save;
        },
        /** Executes one validated player action, settles turns and saves exactly once. */
        act: function (action) {
            var save = this.current;
            if (!save || (save.over && !save.flags.abyss)) { return false; }
            if (save.flags.combat && action.type !== 'combat') { return false; }
            var result = false;
            if (action.type === 'move') { result = R.map.move(save, action.dir); }
            else if (action.type === 'combat') { result = R.combat.act(save.flags.combat, action.action); }
            else if (action.type === 'enter') { result = R.dungeon.enter(save, action.site); }
            else if (action.type === 'descend') { result = R.dungeon.descend(save); }
            else if (action.type === 'extract') { result = R.dungeon.extract(save); }
            else { result = R.settle.act(save, action); }
            if (!result) { return false; }
            this.advance(result.turns === undefined ? 1 : result.turns);
            R.map.reveal(save);
            if (R.save) { R.save.write(save); }
            if (R.ui) { R.ui.render(); }
            return true;
        },
        /** Advances settlement and survival in the specified order without repeating an action. */
        advance: function (count) {
            var save = this.current;
            var i;
            for (i = 0; i < count; i++) {
                if (save.over && !save.flags.abyss) { break; }
                save.turn += 1;
                if (save.flags.tempCamp && save.flags.tempCamp.expiresAt <= save.turn) { delete save.flags.tempCamp; R.log(save, 'log.tempExpired'); }
                if (!save.flags.abyss) { R.settle.settleCamps(save); }
                this.tickPartyEffects(save);
                save.day = Math.floor(save.turn / N.TURNS_PER_DAY);
                if (save.turn % N.TURNS_PER_DAY === 0 && !save.flags.abyss) { R.settle.onNewDay(save); }
                this.checkEnding(save);
            }
        },
        /** Settles survival effects while allowing safe preparation at a camp. */
        tickPartyEffects: function (save) {
            if (R.atCamp(save) && !save.flags.combat) {
                save.party.hp = Math.min(save.party.maxHp, save.party.hp + N.RECOVER_HP);
            }
            if (save.flags.exhaustion) {
                save.party.hp = Math.max(0, save.party.hp - save.flags.exhaustion);
                delete save.flags.exhaustion;
                R.log(save, 'log.thirst');
            }
        },
        /** Records death or settlement collapse without touching the normal game. */
        checkEnding: function (save) {
            if (save.flags.abyss && save.party.hp <= 0) { R.dungeon.returnAbyss(save); return; }
            if (save.over) { return; }
            if (save.party.hp <= 0) { save.over = true; save.endReason = 'died'; delete save.flags.combat; }
            var population = 0;
            var i;
            for (i = 0; i < save.camps.length; i++) { population += save.camps[i].pop; }
            if (population === 0) { save.over = true; save.endReason = 'wiped'; delete save.flags.combat; }
        }
    };
})();
