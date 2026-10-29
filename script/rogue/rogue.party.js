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
    /** Resolves a carried pack or a local store without allowing remote inventory access. */
    function inventory(save, id) {
        var owner = member(save, id);
        if (id === 'store') { return R.atCamp(save) ? { bag: R.stores(save), capacity: Infinity } : null; }
        if (id === 'temp') {
            var temp = R.atTemp(save);
            return temp ? { bag: temp.stores || {}, capacity: N.TEMP_STORAGE, temp: temp } : null;
        }
        if (id === 'cache') {
            var cache = R.party.cache(save);
            return cache ? { bag: cache.stores, capacity: Infinity, readOnly: true } : null;
        }
        return owner ? { bag: owner.bag, capacity: R.party.capacity(save, owner), owner: owner } : null;
    }
    R.party = {
        member: member,
        weight: weight,
        inventory: inventory,
        /** Finds abandoned supplies at the party's exact outdoor position. */
        cache: function (save) {
            if (save.flags.insideDungeon) { return null; }
            var caches = save.flags.caches || []; var i;
            for (i = 0; i < caches.length; i++) {
                if (caches[i].region === save.party.region && caches[i].x === save.party.x && caches[i].y === save.party.y && weight(caches[i].stores) > 0) { return caches[i]; }
            }
            return null;
        },
        /** Leaves stored supplies at their original location when a shelter is removed or expires. */
        leaveTemp: function (save) {
            var temp = save.flags.tempCamp;
            if (!temp) { return; }
            if (weight(temp.stores || {}) > 0) {
                var caches = save.flags.caches || []; var existing = null; var i;
                for (i = 0; i < caches.length; i++) { if (caches[i].region === temp.region && caches[i].x === temp.x && caches[i].y === temp.y) { existing = caches[i]; break; } }
                if (existing) { R.add(existing.stores, temp.stores); }
                else { caches.push({ region: temp.region, x: temp.x, y: temp.y, stores: temp.stores }); }
                save.flags.caches = caches;
                R.log(save, 'log.cacheLeft');
            }
            delete save.flags.tempCamp;
        },
        /** Computes the transferable integer quantity, limited by actual stock and free capacity. */
        transferAmount: function (save, from, to, id, quantity) {
            var source = inventory(save, from); var target = inventory(save, to); var item = C.items[id];
            if (!source || !target || from === to || !item || target.readOnly || ['fists', 'waterskin', 'canteen', 'pack'].indexOf(id) >= 0 || (!source.owner && !target.owner)) { return 0; }
            var requested = quantity === 'all' ? Infinity : quantity === undefined ? item.kind === 'resource' ? N.DROP_BUNDLE : 1 : quantity;
            if (typeof requested !== 'number' || requested <= 0 || (quantity !== 'all' && (!isFinite(requested) || requested % 1))) { return 0; }
            return Math.max(0, Math.min(requested, Math.floor(source.bag[id] || 0), Math.floor(target.capacity - weight(target.bag))));
        },
        /** Returns the capacity of a personal pack, including worn items. */
        capacity: function (save, owner) { return owner === save.party ? owner.bag.pack ? N.BAG_UPGRADED : N.BAG_BASE : N.COMPANION_BAG; },
        /** Counts an item throughout all personal packs and the shared warehouse. */
        owned: function (save, id) {
            var total = (save.party.bag[id] || 0) + (R.stores(save)[id] || 0); var i;
            for (i = 0; i < save.party.companions.length; i++) { total += save.party.companions[i].bag[id] || 0; }
            if (save.flags.tempCamp) { total += (save.flags.tempCamp.stores || {})[id] || 0; }
            var caches = save.flags.caches || [];
            for (i = 0; i < caches.length; i++) { total += caches[i].stores[id] || 0; }
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
                var from = inventory(save, action.from); var to = inventory(save, action.to);
                if (!from || !to) { return R.fail('err.storageAway'); }
                var amount = this.transferAmount(save, action.from, action.to, action.item, action.quantity);
                if (!amount) { return R.fail(to.capacity <= weight(to.bag) ? 'err.storageFull' : 'err.unavailable'); }
                var source = from.bag; var destination = to.bag;
                if (to.temp && !to.temp.stores) { to.temp.stores = destination; }
                source[action.item] -= amount;
                if (from.owner && source[action.item] < 1) {
                    if (from.owner.weapon === action.item) { wear(save, from.owner, 'weapon', 'fists'); }
                    if (from.owner.armour === action.item) { wear(save, from.owner, 'armour', null); }
                }
                destination[action.item] = (destination[action.item] || 0) + amount;
                if (save.flags.caches) { for (var c = save.flags.caches.length - 1; c >= 0; c--) { if (!weight(save.flags.caches[c].stores)) { save.flags.caches.splice(c, 1); } } }
                R.log(save, !from.owner ? 'log.withdraw' : !to.owner ? 'log.stored' : 'log.transfer', { name: R.t('item.' + action.item), n: amount });
            } else if (action.type === 'stowMaterials') {
                var target = inventory(save, action.to); var moved = 0; var key;
                if (!target || target.owner || target.readOnly) { return R.fail('err.storageAway'); }
                for (key in owner.bag) {
                    if (C.items[key].kind !== 'resource' || key === 'food' || key === 'water') { continue; }
                    var count = this.transferAmount(save, action.member || 'player', action.to, key, 'all');
                    if (count > 0) { if (target.temp && !target.temp.stores) { target.temp.stores = target.bag; } owner.bag[key] -= count; target.bag[key] = (target.bag[key] || 0) + count; moved += count; }
                }
                if (!moved) { return false; }
                R.log(save, 'log.materialsStored', { n: moved });
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
