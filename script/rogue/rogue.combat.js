/* SPDX-License-Identifier: MPL-2.0 */
/** Resolves and persists turn-based battles, companions and seeded enemy actions. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var C = R.CONTENT;
    /** Appends a localized message to the five-entry combat journal. */
    function record(session, key, values) {
        session.log.push({ key: key, values: values || {} });
        if (session.log.length > N.COMBAT_LOG_LIMIT) { session.log.shift(); }
    }
    /** Returns the first living enemy or the selected living target. */
    function targetOf(session, target) {
        var i;
        if (session.enemies[target] && session.enemies[target].hp > 0) { return session.enemies[target]; }
        for (i = 0; i < session.enemies.length; i++) { if (session.enemies[i].hp > 0) { return session.enemies[i]; } }
        return null;
    }
    /** Finishes a victory and applies its world or dungeon context exactly once. */
    function victory(save, session) {
        var i;
        if (!save.flags.abyss) {
            for (i = 0; i < session.enemies.length; i++) {
                var enemy = session.enemies[i];
                R.add(save.party.bag, C.enemies[enemy.type].loot, 1 + Math.floor((session.ctx.depth || 0) * N.DUNGEON_LOOT_SCALE));
            }
        }
        if (session.ctx.site) {
            var site = R.map.site(save, session.ctx.site);
            if (site) { site.state = 'cleared'; R.log(save, 'log.clear', { name: R.t('site.' + site.type) }); }
        }
        R.log(save, 'log.win');
        session.result = 'won';
        delete save.flags.combat;
    }
    R.combat = {
        /** Starts a serializable combat session and fixes seeded initiative order. */
        start: function (enemies, ctx) {
            var save = R.state.current;
            var session = { enemies: R.clone(enemies), ctx: R.clone(ctx || {}), log: [], round: 0, result: 'active', target: 0 };
            var i;
            for (i = session.enemies.length - 1; i > 0; i--) {
                var j = Math.floor(R.roll(save) * (i + 1));
                var swap = session.enemies[i]; session.enemies[i] = session.enemies[j]; session.enemies[j] = swap;
            }
            /** Sorts already shuffled enemies by agility, keeping seeded ties stable. */
            session.enemies.sort(function (a, b) { return b.agi - a.agi; });
            record(session, 'log.encounter');
            save.flags.combat = session;
            return session;
        },
        /** Creates a themed enemy group with depth-scaled statistics. */
        encounter: function (save, ctx) {
            var tier = save.regions[save.party.region].tier;
            var type = C.themes[tier].enemy;
            var definition = C.enemies[type];
            var depth = ctx.depth || 0;
            var count = ctx.kind === 'site' && tier >= 4 ? 2 : 1;
            var enemies = [];
            var i;
            for (i = 0; i < count; i++) {
                var hp = Math.ceil(definition.hp * (1 + N.DUNGEON_HP_SCALE * depth));
                enemies.push({ id: type + ':' + i, type: type, hp: hp, maxHp: hp,
                    dmg: Math.ceil(definition.dmg * (1 + N.DUNGEON_DMG_SCALE * depth)), agi: definition.agi });
            }
            R.log(save, 'log.encounter');
            return this.start(enemies, ctx);
        },
        /** Resolves one player choice, companion attacks and surviving enemies without timers. */
        act: function (session, action) {
            var save = R.state.current;
            if (!session || session !== save.flags.combat || session.result !== 'active') { return false; }
            var permitted = ['attack', 'guard', 'dodge', 'item', 'flee'];
            if (permitted.indexOf(action.type) < 0) { return false; }
            var party = save.party;
            var enemy = targetOf(session, action.target === undefined ? session.target : action.target);
            if (!enemy) { victory(save, session); return { turns: 1, result: 'won' }; }
            session.target = session.enemies.indexOf(enemy);
            session.round += 1;
            var i;
            var dodging = action.type === 'dodge';
            var guarding = action.type === 'guard';
            if (action.type === 'item') {
                var medicine = C.items[action.item];
                if (!medicine || medicine.kind !== 'consume' || !party.bag[action.item]) { session.round -= 1; return false; }
                party.bag[action.item] -= 1;
                party.hp = Math.min(party.maxHp, party.hp + medicine.heal);
                record(session, 'log.heal', { n: medicine.heal });
            } else if (action.type === 'flee') {
                var agility = 0;
                var living = 0;
                for (i = 0; i < session.enemies.length; i++) { if (session.enemies[i].hp > 0) { agility += session.enemies[i].agi; living += 1; } }
                var chance = R.clamp(N.ESCAPE_BASE + N.ESCAPE_AGI * (N.PLAYER_AGI - agility / living), N.HIT_MIN, N.HIT_MAX);
                if (R.roll(save) < chance) {
                    var id;
                    if (!save.flags.abyss) { for (id in party.bag) { if (C.items[id] && C.items[id].kind === 'resource') { party.bag[id] = Math.floor(party.bag[id] * (1 - N.ESCAPE_LOSS)); } } }
                    R.log(save, 'log.flee'); session.result = 'fled'; delete save.flags.combat;
                    return { turns: 1, result: 'fled' };
                }
                record(session, 'log.fleeFail');
            } else {
                var hit = R.clamp(N.HIT_BASE + N.HIT_AGI * (N.PLAYER_AGI - enemy.agi) - (dodging ? N.DODGE_HIT_PENALTY : 0), N.HIT_MIN, N.HIT_MAX);
                if (R.roll(save) < hit) {
                    var damage = Math.max(1, Math.floor((C.items[party.weapon].dmg + R.bonus(save, 'attack')) * (guarding ? N.GUARD_DAMAGE : 1)));
                    enemy.hp = Math.max(0, enemy.hp - damage);
                    record(session, 'log.hit', { name: R.t('log.you'), n: damage });
                } else { record(session, 'log.miss', { name: R.t('log.you') }); }
            }
            for (i = 0; i < party.companions.length; i++) {
                enemy = targetOf(session, session.target);
                if (!enemy) { break; }
                var companion = party.companions[i];
                var companionDamage = N.COMPANION_DAMAGE + companion.str + R.bonus(save, 'companion');
                enemy.hp = Math.max(0, enemy.hp - companionDamage);
                record(session, 'log.hit', { name: R.t('ui.name.' + companion.name), n: companionDamage });
            }
            for (i = 0; i < session.enemies.length; i++) {
                enemy = session.enemies[i];
                if (enemy.hp <= 0) { continue; }
                if (dodging && R.roll(save) < N.DODGE_CHANCE) { record(session, 'log.evade'); continue; }
                var armour = party.armour ? C.items[party.armour].protection : 0;
                var incoming = Math.max(1, Math.ceil(enemy.dmg * Math.max(N.ARMOUR_MIN, 1 - armour - R.bonus(save, 'armour')) * (guarding ? N.GUARD_RECEIVE : 1)));
                if (party.companions.length > 0 && R.roll(save) < N.COMPANION_TARGET) {
                    var companionIndex = Math.floor(R.roll(save) * party.companions.length);
                    var ally = party.companions[companionIndex];
                    ally.hp = Math.max(0, ally.hp - incoming);
                    if (ally.hp === 0) {
                        if (!save.flags.abyss) { save.flags.memorial.push({ name: ally.name, turn: save.turn }); }
                        R.log(save, 'log.companionDied', { name: R.t('ui.name.' + ally.name) });
                        party.companions.splice(companionIndex, 1);
                    }
                } else { party.hp = Math.max(0, party.hp - incoming); }
                record(session, 'log.enemyHit', { name: R.t('enemy.' + enemy.type), n: incoming });
                if (party.hp <= 0) { break; }
                if (action.type === 'flee') { break; }
            }
            if (party.hp > 0 && !targetOf(session, session.target)) { victory(save, session); return { turns: 1, result: 'won' }; }
            return { turns: 1, result: party.hp <= 0 ? 'lost' : 'active' };
        }
    };
})();
