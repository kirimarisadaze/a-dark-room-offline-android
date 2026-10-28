/* SPDX-License-Identifier: MPL-2.0 */
/** Implements persistent finite dungeons, repeatable vaults and a consequence-free abyss. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    /** Returns the active dungeon, or null while travelling outdoors. */
    function active(save) { return save.flags.insideDungeon ? save.dungeons[save.flags.insideDungeon] : null; }
    R.dungeon = {
        /** Enters a finite or repeatable dungeon from its outdoor site. */
        enter: function (save, siteId) {
            if (save.flags.insideDungeon || save.flags.combat) { return false; }
            var site = R.map.here(save);
            if (!site || site.id !== siteId || site.type !== 'dungeon') { return false; }
            var kind = site.dungeon;
            var definition = R.CONTENT.dungeons[kind];
            if (!save.dungeons[siteId]) {
                save.dungeons[siteId] = { id: siteId, discovered: true, cleared: false, afterClear: definition.afterClear, depth: 1, bestDepth: 1, kind: kind };
            }
            var dungeon = save.dungeons[siteId];
            if (dungeon.cleared && dungeon.afterClear === 'closed') { return false; }
            if (save.party.water < N.DUNGEON_SUPPLY || save.party.food < N.DUNGEON_SUPPLY) { return R.fail('err.supplies'); }
            save.flags.insideDungeon = siteId;
            if (!dungeon.floor) { dungeon.floor = R.worldgen.buildFloor(save, siteId, dungeon.depth, dungeon.cleared && dungeon.afterClear === 'infinite'); }
            R.log(save, 'log.dungeonEnter', { name: R.t('dungeon.' + kind) });
            return dungeon.floor;
        },
        /** Awards a finite objective once and applies its configured after-clear state. */
        checkObjective: function (save) {
            var dungeon = active(save);
            if (!dungeon || dungeon.floor.cleared || !dungeon.floor.objective) { return; }
            var floor = dungeon.floor;
            if (floor.party.x !== floor.objective.x || floor.party.y !== floor.objective.y) { return; }
            floor.cleared = true;
            dungeon.bestDepth = Math.max(dungeon.bestDepth, floor.depth);
            if (save.flags.abyss) { save.flags.abyssBest = Math.max(save.flags.abyssBest, floor.depth); return; }
            if (dungeon.cleared) { return; }
            dungeon.cleared = true;
            var definition = R.CONTENT.dungeons[dungeon.kind];
            R.add(save.party.bag, definition.reward);
            if (definition.blueprint && save.blueprints.indexOf(definition.blueprint) < 0) {
                save.blueprints.push(definition.blueprint);
                R.log(save, 'log.blueprint', { name: R.t('item.' + definition.blueprint) });
            }
            var site = R.map.site(save, dungeon.id);
            if (dungeon.afterClear === 'resource' && site) {
                site.type = definition.resource;
                site.state = 'occupied'; site.ownerCamp = save.camps[save.activeCamp].id;
            } else if (dungeon.afterClear === 'closed' && site) { site.state = 'cleared'; }
            R.log(save, 'log.dungeonClear');
        },
        /** Generates the next repeatable floor only after reaching the current stairs. */
        descend: function (save) {
            var dungeon = active(save);
            if (!dungeon || dungeon.afterClear !== 'infinite' || !dungeon.floor.cleared) { return false; }
            if (!save.flags.abyss && (save.party.water < N.DUNGEON_SUPPLY || save.party.food < N.DUNGEON_SUPPLY)) { return R.fail('err.supplies'); }
            if (!save.flags.abyss) { save.party.water -= N.DUNGEON_SUPPLY; save.party.food -= N.DUNGEON_SUPPLY; }
            dungeon.depth += 1; dungeon.bestDepth = Math.max(dungeon.bestDepth, dungeon.depth);
            R.roll(save);
            dungeon.floor = R.worldgen.buildFloor(save, dungeon.id, dungeon.depth, true);
            if (save.flags.abyss) { save.flags.abyssBest = Math.max(save.flags.abyssBest, dungeon.depth); }
            R.log(save, 'log.descend', { n: dungeon.depth });
            return dungeon.floor;
        },
        /** Pays depth-based return supplies and optionally starts a seeded pursuit battle. */
        extract: function (save) {
            var dungeon = active(save);
            if (!dungeon || save.flags.combat) { return false; }
            if (save.flags.abyss) { this.returnAbyss(save); return { turns: 1, extracted: true }; }
            var cost = dungeon.depth * N.DUNGEON_SUPPLY;
            if (save.party.water < cost || save.party.food < cost) { return R.fail('err.supplies'); }
            save.party.water -= cost; save.party.food -= cost;
            if (dungeon.cleared && dungeon.afterClear === 'infinite') { delete dungeon.floor; }
            delete save.flags.insideDungeon;
            R.log(save, 'log.extract');
            if (R.roll(save) < N.EXTRACT_CHASE) {
                R.log(save, 'log.chase'); R.combat.encounter(save, { kind: 'chase', depth: dungeon.depth });
            }
            return { turns: 1, extracted: true };
        },
        /** Starts the unlocked abyss while preserving the party's pre-entry inventory and health. */
        enterAbyss: function (save) {
            if (save.endReason !== 'ship' || save.flags.abyss) { return false; }
            save.flags.abyssParty = R.clone(save.party);
            save.flags.abyss = true;
            save.flags.insideDungeon = 'abyss';
            save.party.hp = save.party.maxHp;
            save.dungeons.abyss = { id: 'abyss', discovered: true, cleared: true, afterClear: 'infinite', depth: 1, bestDepth: save.flags.abyssBest, kind: 'abyss' };
            save.dungeons.abyss.floor = R.worldgen.buildFloor(save, 'abyss', 1, true);
            R.map.reveal(save); R.save.write(save);
            return true;
        },
        /** Restores the pre-abyss party without any economic gain or death penalty. */
        returnAbyss: function (save) {
            if (!save.flags.abyssParty) { return; }
            save.party = save.flags.abyssParty;
            delete save.flags.abyssParty; delete save.flags.abyss; delete save.flags.insideDungeon; delete save.flags.combat;
            if (save.dungeons.abyss) { delete save.dungeons.abyss.floor; }
            R.log(save, 'log.abyssReturn');
        }
    };
})();
