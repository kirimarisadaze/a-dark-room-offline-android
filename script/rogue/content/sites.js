/* SPDX-License-Identifier: MPL-2.0 */
/** Registers the independent Rogue module data. */
(function () {
    'use strict';
    var C = window.Rogue.CONTENT;
    C.sites = {
        forest: { symbol: 'T', kind: 'resource', resource: 'wood', rate: 0.18, job: 'wood' },
        quarry: { symbol: 'Q', kind: 'resource', resource: 'stone', rate: 0.12, job: 'mine' },
        hunting: { symbol: 'H', kind: 'resource', resource: 'food', rate: 0.16, job: 'hunt' },
        spring: { symbol: 'W', kind: 'resource', resource: 'water', rate: 0.20, job: 'gather' },
        iron: { symbol: 'I', kind: 'resource', resource: 'iron', rate: 0.09, job: 'mine' },
        coal: { symbol: 'C', kind: 'resource', resource: 'coal', rate: 0.10, job: 'mine' },
        sulphur: { symbol: 'S', kind: 'resource', resource: 'sulphur', rate: 0.07, job: 'mine' },
        crystal: { symbol: 'X', kind: 'resource', resource: 'crystal', rate: 0.06, job: 'gather' },
        threat: { symbol: '!', kind: 'threat' },
        dungeon: { symbol: 'D', kind: 'dungeon' },
        ship: { symbol: 'A', kind: 'ending' },
        abyss: { symbol: 'V', kind: 'dungeon' }
    };
    C.dungeons = {
        clinic: { afterClear: 'resource', resource: 'spring', reward: { medicine: 3, food: 6 } },
        market: { afterClear: 'resource', resource: 'hunting', reward: { food: 20, water: 12 } },
        metro: { afterClear: 'infinite', reward: { iron: 10, coal: 12 } },
        tenement: { afterClear: 'closed', reward: { fur: 8, food: 12 } },
        archive: { afterClear: 'resource', blueprint: 'hull', resource: 'iron', reward: { iron: 12, food: 8 } },
        foundry: { afterClear: 'resource', blueprint: 'drive', resource: 'coal', reward: { steel: 8, coal: 12 } },
        reactor: { afterClear: 'resource', blueprint: 'core', resource: 'crystal', reward: { crystal: 8, sulphur: 8 } },
        shelter: { afterClear: 'closed', blueprint: 'canteen', reward: { food: 18, medicine: 2 } },
        vault: { afterClear: 'infinite', blueprint: 'railgun', reward: { crystal: 6, steel: 8 } },
        abyss: { afterClear: 'infinite', reward: {} }
    };
    C.buildings = {
        workshop: { cost: { wood: 20, stone: 8 }, max: 1 },
        well: { cost: { wood: 15, stone: 15 }, max: 1 },
        garden: { cost: { wood: 25, stone: 10 }, max: 3, rate: 0.12 },
        watchtower: { cost: { wood: 30, stone: 18 }, max: 2 },
        infirmary: { cost: { wood: 40, iron: 8 }, max: 1 },
        beacon: { cost: { wood: 50, iron: 10, crystal: 3 }, max: 1 }
    };
    C.research = [
        { id: 'tracking', cost: { wood: 15 }, effect: 'gather', amount: 0.15 },
        { id: 'survey', cost: { wood: 20, stone: 8 }, effect: 'vision', amount: 1 },
        { id: 'preserve', cost: { wood: 20, food: 10 }, effect: 'food', amount: 0.10 },
        { id: 'irrigation', cost: { wood: 25, stone: 15 }, effect: 'garden', amount: 0.20 },
        { id: 'carpentry', cost: { wood: 30, stone: 10 }, effect: 'income', amount: 0.08 },
        { id: 'masonry', cost: { wood: 20, stone: 25 }, effect: 'build', amount: 0.10 },
        { id: 'smelting', cost: { iron: 8, coal: 8 }, effect: 'income', amount: 0.08 },
        { id: 'logistics', cost: { wood: 40, iron: 8 }, effect: 'loss', amount: 0.05 },
        { id: 'herbalism', cost: { food: 20, wood: 20 }, effect: 'heal', amount: 1 },
        { id: 'drills', cost: { food: 20, iron: 10 }, effect: 'attack', amount: 1 },
        { id: 'scouting', cost: { food: 20, coal: 10 }, effect: 'vision', amount: 1 },
        { id: 'fortify', cost: { stone: 40, iron: 10 }, effect: 'guard', amount: 0.10 },
        { id: 'rations', cost: { food: 30, coal: 12 }, effect: 'food', amount: 0.10 },
        { id: 'distill', cost: { iron: 15, coal: 15 }, effect: 'water', amount: 10 },
        { id: 'steelwork', cost: { steel: 8, coal: 20 }, effect: 'income', amount: 0.10 },
        { id: 'medicine', cost: { sulphur: 8, food: 20 }, effect: 'heal', amount: 2 },
        { id: 'engineering', cost: { steel: 10, stone: 30 }, effect: 'build', amount: 0.10 },
        { id: 'leadership', cost: { food: 40, steel: 8 }, effect: 'companion', amount: 1 },
        { id: 'optics', cost: { crystal: 5, steel: 8 }, effect: 'vision', amount: 1 },
        { id: 'ballistics', cost: { sulphur: 10, steel: 12 }, effect: 'attack', amount: 2 },
        { id: 'insulation', cost: { coal: 30, crystal: 5 }, effect: 'armour', amount: 0.10 },
        { id: 'automation', cost: { steel: 18, crystal: 8 }, effect: 'income', amount: 0.15 },
        { id: 'reclamation', cost: { crystal: 10, sulphur: 15 }, effect: 'loss', amount: 0.08 },
        { id: 'navigation', cost: { crystal: 12, steel: 20 }, effect: 'vision', amount: 2 }
    ];
})();
