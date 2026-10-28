/* SPDX-License-Identifier: MPL-2.0 */
/** Registers the independent Rogue module data. */
(function () {
    'use strict';
    window.Rogue.CONTENT.enemies = {
        wolf: { hp: 5, dmg: 1, agi: 2, symbol: 'w', loot: { food: 4, fur: 2 } },
        raider: { hp: 9, dmg: 2, agi: 3, symbol: 'r', loot: { iron: 3, food: 4 } },
        leech: { hp: 8, dmg: 2, agi: 2, symbol: 'l', loot: { food: 4, medicine: 1 } },
        sentinel: { hp: 14, dmg: 3, agi: 2, symbol: 's', loot: { iron: 5, coal: 3 } },
        stalker: { hp: 16, dmg: 3, agi: 4, symbol: 'h', loot: { sulphur: 4, fur: 3 } },
        drone: { hp: 21, dmg: 4, agi: 3, symbol: 'd', loot: { steel: 4, coal: 4 } },
        mutant: { hp: 24, dmg: 5, agi: 3, symbol: 'm', loot: { crystal: 3, food: 5 } },
        warden: { hp: 30, dmg: 6, agi: 2, symbol: 'g', loot: { crystal: 4, steel: 4 } },
        machine: { hp: 38, dmg: 7, agi: 3, symbol: 'M', loot: { crystal: 5, steel: 6 } }
    };
})();
