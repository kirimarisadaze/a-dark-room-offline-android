/* SPDX-License-Identifier: MPL-2.0 */
/** Manages physical equipment and personal packs without duplicating items. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var C = R.CONTENT;
    /** Counts the physical contents of one inventory. */
    function weight(bag) { var total = 0; var id; for (id in bag) { total += bag[id]; } return total; }
    /** Finds the player or a living companion by stable id. */
    function member(save, id) {
        if (!id || id === 'player') { return save.party; }
        var i;
        for (i = 0; i < save.party.companions.length; i++) { if (save.party.companions[i].id === id) { return save.party.companions[i]; } }
        return null;
    }
    /** Changes armour capacity without generating health by repeatedly swapping equipment. */
    function wear(save, owner, kind, id) {
        owner[kind] = id;
        if (kind === 'armour') {
            owner.maxHp = (owner === save.party ? N.BASE_HP : N.COMPANION_HP) + (id ? C.items[id].hp : 0);
            owner.hp = Math.min(owner.hp, owner.maxHp);
        }
    }
    R.party = {
        member: member,
        weight: weight,
        /** Returns the capacity of a personal pack, including worn items. */
        capacity: function (save, owner) { return owner === save.party ? owner.bag.pack ? N.BAG_UPGRADED : N.BAG_BASE : N.COMPANION_BAG; },
        /** Counts an item throughout all personal packs and the shared warehouse. */
        owned: function (save, id) {
            var total = (save.party.bag[id] || 0) + (R.stores(save)[id] || 0); var i;
            for (i = 0; i < save.party.companions.length; i++) { total += save.party.companions[i].bag[id] || 0; }
            return total;
        },
        /** Recovers a fallen companion's pack and clearly records any resulting overload. */
        recover: function (save, ally) {
            R.add(save.party.bag, ally.bag || {});
            R.log(save, 'log.packRecovered', { name: R.t('ui.name.' + ally.name) });
        },
        /** Dispatches equipment, inventory transfers and safe dismissal at an allied camp. */
        act: function (save, action) {
            var owner = member(save, action.member);
            var item = C.items[action.item];
            if (!owner) { return false; }
            if (action.type === 'equip' || action.type === 'unequip') {
                var kind = action.kind || (item && item.kind);
                if (kind !== 'weapon' && kind !== 'armour') { return false; }
                var id = action.type === 'unequip' ? kind === 'weapon' ? 'fists' : null : action.item;
                if (action.type === 'equip' && (!item || item.kind !== kind || !owner.bag[id])) { return false; }
                if (owner[kind] === id) { return false; }
                wear(save, owner, kind, id);
                R.log(save, action.type === 'equip' ? 'log.equip' : 'log.unequip', { name: R.t(id ? 'item.' + id : 'ui.none') });
            } else if (action.type === 'transfer') {
                var from = action.from === 'store' ? null : member(save, action.from);
                var to = action.to === 'store' ? null : member(save, action.to);
                if ((!from && action.from !== 'store') || (!to && action.to !== 'store') || from === to || !item || action.item === 'fists') { return false; }
                if ((!from || !to) && !R.atCamp(save)) { return R.fail('err.camp'); }
                if (['waterskin', 'canteen', 'pack'].indexOf(action.item) >= 0) { return R.fail('err.personalTool'); }
                var source = from ? from.bag : R.stores(save);
                var destination = to ? to.bag : R.stores(save);
                var amount = Math.min(item.kind === 'resource' ? N.DROP_BUNDLE : 1, source[action.item] || 0);
                if (amount <= 0) { return false; }
                if (to && weight(destination) + amount > this.capacity(save, to)) { return R.fail('err.bag'); }
                source[action.item] -= amount;
                if (from && source[action.item] < 1) {
                    if (from.weapon === action.item) { wear(save, from, 'weapon', 'fists'); }
                    if (from.armour === action.item) { wear(save, from, 'armour', null); }
                }
                destination[action.item] = (destination[action.item] || 0) + amount;
                R.log(save, 'log.transfer', { name: R.t('item.' + action.item), n: amount });
            } else if (action.type === 'drop') {
                if (!item || item.kind !== 'resource' || !owner.bag[action.item]) { return false; }
                var discarded = Math.min(N.DROP_BUNDLE, owner.bag[action.item]); owner.bag[action.item] -= discarded;
                R.log(save, 'log.dropped', { name: R.t('item.' + action.item), n: discarded });
            } else if (action.type === 'allyUse') {
                if (owner === save.party || action.item !== 'medicine' || !owner.bag.medicine || owner.hp >= owner.maxHp) { return false; }
                owner.bag.medicine -= 1; owner.hp = Math.min(owner.maxHp, owner.hp + C.items.medicine.heal);
                R.log(save, 'log.allyHeal', { name: R.t('ui.name.' + owner.name) });
            } else if (action.type === 'dismiss') {
                var camp = R.atCamp(save);
                if (!camp || owner === save.party) { return R.fail('err.dismissCamp'); }
                R.add(R.stores(save), owner.bag); camp.pop += 1;
                save.party.companions.splice(save.party.companions.indexOf(owner), 1);
                R.log(save, 'log.dismiss', { name: R.t('ui.name.' + owner.name) });
            } else { return false; }
            return { turns: 1 };
        }
    };
})();
