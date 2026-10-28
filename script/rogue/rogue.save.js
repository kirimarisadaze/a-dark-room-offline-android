/* SPDX-License-Identifier: MPL-2.0 */
/** Persists Rogue runs exclusively in their own keys and protects damaged data. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    /** Checks a finite scalar without coercing corrupted string fields. */
    function number(value) { return typeof value === 'number' && isFinite(value); }
    /** Validates nonnegative inventory quantities and known item ids. */
    function inventory(value) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) { return false; }
        var id;
        for (id in value) { if (!R.CONTENT.items[id] || !number(value[id]) || value[id] < 0) { return false; } }
        return true;
    }
    /** Validates an integer tile coordinate inside a sealed map border. */
    function position(value, size) { return value && number(value.x) && number(value.y) && value.x % 1 === 0 && value.y % 1 === 0 && value.x > 0 && value.y > 0 && value.x < size - 1 && value.y < size - 1; }
    /** Validates a localized log entry without evaluating its content as code. */
    function logs(values) {
        var i;
        for (i = 0; i < values.length; i++) { if (!values[i] || typeof values[i].key !== 'string' || !values[i].values || typeof values[i].values !== 'object') { return false; } }
        return true;
    }
    /** Reads JSON without changing any local storage value. */
    function read(key) { var raw = localStorage.getItem(key); return raw === null ? null : JSON.parse(raw); }
    R.save = {
        lastError: null,
        /** Returns saved cross-run blueprints without creating a storage entry. */
        blueprints: function () {
            try {
                var values = read('rogueBlueprints');
                if (!Array.isArray(values)) { return []; }
                var valid = [];
                var i;
                for (i = 0; i < values.length; i++) { if (R.CONTENT.items[values[i]] && valid.indexOf(values[i]) < 0) { valid.push(values[i]); } }
                return valid;
            } catch (error) { return []; }
        },
        /** Validates the root model, nested maps, inventories and resumable combat. */
        validate: function (save) {
            try {
                if (!save || save.version !== N.VERSION || !number(save.slot) || save.slot % 1 || save.slot < 0 || save.slot >= N.SLOTS || !number(save.seed) || save.seed < 0 || save.seed > 4294967295 || save.seed % 1) { return false; }
                if (!number(save.turn) || save.turn < 0 || save.turn % 1 || save.day !== Math.floor(save.turn / N.TURNS_PER_DAY) || [1, 2, 3].indexOf(save.speed) < 0) { return false; }
                if (typeof save.over !== 'boolean' || typeof save.cheat !== 'boolean' || !number(save.createdAt)) { return false; }
                if (!Array.isArray(save.camps) || save.camps.length < 1 || save.camps.length > N.MAX_CAMPS || !number(save.activeCamp) || save.activeCamp % 1 || save.activeCamp < 0 || save.activeCamp >= save.camps.length) { return false; }
                var p = save.party;
                if (!p || !number(p.hp) || p.hp < 0 || !number(p.maxHp) || p.maxHp < N.BASE_HP || p.hp > p.maxHp || !CWeapon(p.weapon) || (p.armour && (!R.CONTENT.items[p.armour] || R.CONTENT.items[p.armour].kind !== 'armour'))) { return false; }
                if (!number(p.water) || p.water < 0 || !number(p.food) || p.food < 0 || !inventory(p.bag) || !Array.isArray(p.companions) || p.companions.length > N.MAX_COMPANIONS) { return false; }
                if (!save.flags || !Array.isArray(save.flags.log) || !Array.isArray(save.flags.memorial) || !number(save.flags.rng) || !Array.isArray(save.blueprints) || !save.regions || !save.regionGraph || !save.dungeons) { return false; }
                if (!logs(save.flags.log) || (save.over && ['ship', 'wiped', 'died'].indexOf(save.endReason) < 0)) { return false; }
                if (!save.regions[p.region] || !number(p.x) || !number(p.y) || p.x % 1 || p.y % 1 || p.x <= 0 || p.y <= 0 || p.x >= N.REGION_SIZE - 1 || p.y >= N.REGION_SIZE - 1) { return false; }
                var i;
                var key;
                var campIds = {};
                for (i = 0; i < save.camps.length; i++) {
                    var camp = save.camps[i];
                    if (!camp || !number(camp.pop) || camp.pop < 0 || camp.pop % 1 || !N.FIRE[camp.fire] || !inventory(camp.stores) || !camp.jobs || !camp.buildings || !save.regions[camp.region]) { return false; }
                    if (!number(camp.id) || camp.id < 0 || camp.id % 1 || campIds[camp.id] || !position(camp, N.REGION_SIZE)) { return false; }
                    campIds[camp.id] = true;
                    for (key in camp.jobs) { if (!number(camp.jobs[key]) || camp.jobs[key] < 0 || camp.jobs[key] % 1) { return false; } }
                    for (key in camp.buildings) { if (!R.CONTENT.buildings[key] || !number(camp.buildings[key]) || camp.buildings[key] < 0 || camp.buildings[key] > R.CONTENT.buildings[key].max) { return false; } }
                }
                for (i = 0; i < p.companions.length; i++) {
                    var ally = p.companions[i];
                    if (!ally || R.CONTENT.names.indexOf(ally.name) < 0 || !number(ally.hp) || ally.hp <= 0 || !number(ally.maxHp) || ally.hp > ally.maxHp || !number(ally.str) || !number(ally.agi) || !number(ally.will) || R.CONTENT.quirks.indexOf(ally.quirk) < 0) { return false; }
                }
                for (i = 0; i < save.blueprints.length; i++) { if (!R.CONTENT.items[save.blueprints[i]]) { return false; } }
                var graph = save.regionGraph;
                if (!Array.isArray(graph.nodes) || graph.nodes.length !== 9 || !Array.isArray(graph.edges) || graph.edges.length !== 12 || !Array.isArray(graph.blocked) || graph.blocked.length > 3 || !graph.tier || graph.tier[graph.spawn] !== 1 || graph.tier[graph.ship] !== 9) { return false; }
                var knownNodes = {};
                var knownTiers = {};
                for (i = 0; i < graph.nodes.length; i++) {
                    var node = graph.nodes[i];
                    if (!/^-?[01],-?[01]$/.test(node) || knownNodes[node] || !number(graph.tier[node]) || graph.tier[node] < 1 || graph.tier[node] > 9 || graph.tier[node] % 1 || knownTiers[graph.tier[node]]) { return false; }
                    knownNodes[node] = true; knownTiers[graph.tier[node]] = true;
                }
                for (key in save.regions) {
                    var region = save.regions[key];
                    if (!region || region.key !== key || region.size !== N.REGION_SIZE || !R.CONTENT.themes[region.tier] || !Array.isArray(region.sites)) { return false; }
                    R.rle.decode(region.tiles, region.size);
                    if (R.mask.decode(region.mask).length !== Math.ceil(region.size * region.size / 8)) { return false; }
                    for (i = 0; i < region.sites.length; i++) {
                        var site = region.sites[i];
                        if (!R.CONTENT.sites[site.type] || !number(site.workers) || site.workers < 0 || site.workers % 1 || !position(site, region.size) || ['unknown', 'seen', 'cleared', 'occupied'].indexOf(site.state) < 0) { return false; }
                        if (site.type === 'dungeon' && !R.CONTENT.dungeons[site.dungeon]) { return false; }
                    }
                }
                if (save.flags.insideDungeon) {
                    var dungeon = save.dungeons[save.flags.insideDungeon];
                    if (!dungeon || !dungeon.floor || N.DUNGEON_SIZES.indexOf(dungeon.floor.size) < 0 || !dungeon.floor.party) { return false; }
                    if (!R.CONTENT.dungeons[dungeon.kind] || !position(dungeon.floor.party, dungeon.floor.size) || (dungeon.floor.objective && !position(dungeon.floor.objective, dungeon.floor.size))) { return false; }
                    R.rle.decode(dungeon.floor.tiles, dungeon.floor.size);
                    if (R.mask.decode(dungeon.floor.mask).length !== Math.ceil(dungeon.floor.size * dungeon.floor.size / 8)) { return false; }
                }
                if (save.flags.combat) {
                    var combat = save.flags.combat;
                    if (!Array.isArray(combat.enemies) || !combat.enemies.length || !Array.isArray(combat.log) || !logs(combat.log) || combat.result !== 'active' || !combat.ctx || !number(combat.round) || combat.round < 0) { return false; }
                    for (i = 0; i < combat.enemies.length; i++) {
                        var enemy = combat.enemies[i];
                        if (!enemy || !R.CONTENT.enemies[enemy.type] || !number(enemy.hp) || enemy.hp < 0 || !number(enemy.maxHp) || enemy.maxHp <= 0 || enemy.hp > enemy.maxHp || !number(enemy.dmg) || enemy.dmg < 0 || !number(enemy.agi)) { return false; }
                    }
                }
                return true;
            } catch (error) { return false; }
        },
        /** Serializes a valid state without changing its order or data. */
        serialize: function (save) { return JSON.stringify(save); },
        /** Parses and validates a saved run, returning null while preserving damaged input. */
        deserialize: function (raw) {
            try { var save = JSON.parse(raw); return this.validate(save) ? save : null; }
            catch (error) { return null; }
        },
        /** Reads one slot and leaves its raw data untouched on any failure. */
        load: function (slot) {
            if (slot < 0 || slot >= N.SLOTS || slot % 1) { return null; }
            try {
                var raw = localStorage.getItem('rogueSlot' + slot);
                if (raw === null) { return null; }
                var save = this.deserialize(raw);
                if (!save || save.slot !== slot) { this.lastError = 'err.corrupt'; return null; }
                this.lastError = null; return save;
            } catch (error) { this.lastError = 'err.corrupt'; return null; }
        },
        /** Builds slot summaries from authoritative slot data rather than trusting a stale index. */
        list: function () {
            var result = [];
            var i;
            for (i = 0; i < N.SLOTS; i++) {
                var raw = null;
                try { raw = localStorage.getItem('rogueSlot' + i); } catch (error) { this.lastError = 'err.savefull'; }
                var save = raw === null ? null : this.deserialize(raw);
                result.push({ slot: i, empty: raw === null, corrupt: raw !== null && (!save || save.slot !== i), save: save });
            }
            return result;
        },
        /** Atomically attempts slot, index and shared-blueprint updates with rollback on quota failure. */
        write: function (save) {
            if (!this.validate(save)) { this.lastError = 'err.corrupt'; R.fail(this.lastError); return false; }
            var keys = ['rogueSlot' + save.slot, 'rogueIndex', 'rogueBlueprints'];
            var before = [];
            var written = 0;
            try {
                var i;
                for (i = 0; i < keys.length; i++) { before.push(localStorage.getItem(keys[i])); }
                var summaries = this.list();
                var slots = [];
                for (i = 0; i < summaries.length; i++) {
                    var item = i === save.slot ? save : summaries[i].save;
                    if (item) { slots.push({ slot: i, seed: item.seed, turn: item.turn, day: item.day, over: item.over, savedAt: i === save.slot ? Date.now() : item.createdAt }); }
                }
                var blueprints = this.blueprints();
                for (i = 0; i < save.blueprints.length; i++) { if (blueprints.indexOf(save.blueprints[i]) < 0) { blueprints.push(save.blueprints[i]); } }
                var values = [this.serialize(save), JSON.stringify({ slots: slots }), JSON.stringify(blueprints)];
                for (i = 0; i < keys.length; i++) { localStorage.setItem(keys[i], values[i]); written += 1; }
                this.lastError = null; return true;
            } catch (error) {
                var j;
                for (j = written - 1; j >= 0; j--) {
                    try { if (before[j] === null) { localStorage.removeItem(keys[j]); } else { localStorage.setItem(keys[j], before[j]); } } catch (rollbackError) { /* Preserve the last successful value if storage remains unavailable. */ }
                }
                this.lastError = 'err.savefull'; R.fail(this.lastError); return false;
            }
        },
        /** Deletes only the explicitly confirmed Rogue slot and its index entry. */
        remove: function (slot) {
            if (slot < 0 || slot >= N.SLOTS || slot % 1) { return false; }
            try {
                localStorage.removeItem('rogueSlot' + slot);
                var index = read('rogueIndex');
                if (index && Array.isArray(index.slots)) {
                    var slots = [];
                    var i;
                    for (i = 0; i < index.slots.length; i++) { if (index.slots[i].slot !== slot) { slots.push(index.slots[i]); } }
                    localStorage.setItem('rogueIndex', JSON.stringify({ slots: slots }));
                }
                this.lastError = null;
                return true;
            } catch (error) { return R.fail('err.savefull'); }
        }
    };
    /** Validates the selected weapon against the content catalog. */
    function CWeapon(id) { return !!R.CONTENT.items[id] && R.CONTENT.items[id].kind === 'weapon'; }
})();
