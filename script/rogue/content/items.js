/* SPDX-License-Identifier: MPL-2.0 */
/** Registers the independent Rogue module data. */
(function () {
    'use strict';
    window.Rogue.CONTENT.items = {
        wood: { kind: 'resource' }, stone: { kind: 'resource' }, food: { kind: 'resource' },
        water: { kind: 'resource' }, iron: { kind: 'resource' }, coal: { kind: 'resource' },
        sulphur: { kind: 'resource' }, crystal: { kind: 'resource' }, fur: { kind: 'resource' },
        fists: { kind: 'weapon', dmg: 2 },
        spear: { kind: 'weapon', dmg: 4, cost: { wood: 12, stone: 4 } },
        sword: { kind: 'weapon', dmg: 7, cost: { iron: 12, wood: 8 }, workshop: true },
        blade: { kind: 'weapon', dmg: 11, cost: { steel: 12, coal: 6 }, workshop: true },
        railgun: { kind: 'weapon', dmg: 17, cost: { steel: 18, crystal: 8, sulphur: 8 }, blueprint: 'railgun', workshop: true },
        coat: { kind: 'armour', protection: 0.15, hp: 8, cost: { fur: 6, wood: 6 } },
        mail: { kind: 'armour', protection: 0.30, hp: 18, cost: { iron: 18, fur: 6 }, workshop: true },
        suit: { kind: 'armour', protection: 0.45, hp: 32, cost: { steel: 18, crystal: 6 }, workshop: true },
        waterskin: { kind: 'tool', cost: { fur: 4, wood: 5 } },
        canteen: { kind: 'tool', cost: { iron: 10, steel: 4 }, blueprint: 'canteen', workshop: true },
        pack: { kind: 'tool', cost: { fur: 8, wood: 12 } },
        campKit: { kind: 'tool', cost: { wood: 10, fur: 2 } },
        scaffold: { kind: 'tool', cost: { wood: 30, iron: 6 }, workshop: true },
        medicine: { kind: 'consume', heal: 12, cost: { food: 8, sulphur: 2 } },
        steel: { kind: 'resource', quantity: 4, cost: { iron: 6, coal: 4 }, workshop: true },
        hull: { kind: 'module', cost: { wood: 80, steel: 30, iron: 30 }, blueprint: 'hull', workshop: true },
        drive: { kind: 'module', cost: { steel: 25, coal: 30, sulphur: 15 }, blueprint: 'drive', workshop: true },
        core: { kind: 'module', cost: { crystal: 20, steel: 20, sulphur: 20 }, blueprint: 'core', workshop: true }
    };
})();
