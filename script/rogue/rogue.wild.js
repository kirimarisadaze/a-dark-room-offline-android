/* SPDX-License-Identifier: MPL-2.0 */
/** Adds seeded biomes, wilderness encounters, travelling trade and known-route supply warnings. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var routeCache = null;
    var biomes = {
        woodland: { water: 1, weights: [22, 8, 12, 10, 20, 8, 4, 10, 6] },
        plains: { water: 0.75, weights: [12, 20, 10, 10, 20, 8, 4, 8, 8] },
        hills: { water: 1.25, weights: [20, 10, 14, 6, 8, 22, 6, 8, 6] },
        wasteland: { water: 1.5, weights: [26, 14, 12, 3, 4, 16, 14, 6, 5] },
        wetland: { water: 1.25, weights: [20, 6, 8, 20, 12, 6, 12, 8, 8] },
        ruins: { water: 1, weights: [22, 20, 18, 4, 4, 16, 4, 6, 6] }
    };
    var events = ['ambush', 'merchant', 'cache', 'water', 'food', 'salvage', 'storm', 'tracks', 'survivor'];
    /** Returns deterministic biome diversity independently of terrain and encounter random streams. */
    function biome(save, region) {
        var ids = Object.keys(biomes);
        return region.biome || ids[(region.tier - 1 + R.hash(save.seed, 'biomes') % ids.length) % ids.length];
    }
    /** Builds a progress-aware, expensive and reproducible assortment with a rare-material bias. */
    function goods(save) {
        var tier = 1; var key; var i;
        for (key in save.regions) { tier = Math.max(tier, save.regions[key].tier); }
        var pool = [
            { item: 'food', quantity: 10, cost: { fur: 5 } },
            { item: 'water', quantity: 14, cost: { fur: 5 } },
            { item: 'medicine', quantity: 2, cost: { iron: 8 } },
            { item: 'fur', quantity: 6, cost: { iron: 10 } },
            { item: 'iron', quantity: 10, cost: { fur: 8 } }
        ];
        if (tier >= 3) { pool.push({ item: 'sulphur', quantity: 6, cost: { iron: 16 } }, { item: 'steel', quantity: 5, cost: { iron: 18 } }); }
        if (tier >= 5) { pool.push({ item: 'crystal', quantity: 5, cost: { steel: 12 } }, { item: 'blade', quantity: 1, cost: { steel: 25 } }); }
        if (tier >= 7) { pool.push({ item: 'suit', quantity: 1, cost: { crystal: 18, steel: 22 } }); }
        var rare = pool.slice(tier >= 3 ? 5 : 2);
        var offers = [R.clone(rare[Math.floor(R.roll(save) * rare.length)])];
        var choices = pool.filter(/** Keeps the guaranteed scarce item out of the remaining draw. */ function (entry) { return entry.item !== offers[0].item; });
        for (i = 0; i < 2; i++) { var pick = Math.floor(R.roll(save) * choices.length); offers.push(R.clone(choices.splice(pick, 1)[0])); }
        return offers;
    }
    /** Pushes a node into a binary minimum heap. */
    function push(heap, entry) {
        var index = heap.length; heap.push(entry);
        while (index > 0) { var parent = Math.floor((index - 1) / 2); if (heap[parent].cost <= entry.cost) { break; } heap[index] = heap[parent]; index = parent; }
        heap[index] = entry;
    }
    /** Removes the cheapest node from a binary minimum heap. */
    function pop(heap) {
        var first = heap[0]; var last = heap.pop();
        if (!heap.length) { return first; }
        var index = 0;
        while (index * 2 + 1 < heap.length) {
            var next = index * 2 + 1;
            if (next + 1 < heap.length && heap[next + 1].cost < heap[next].cost) { next += 1; }
            if (last.cost <= heap[next].cost) { break; }
            heap[index] = heap[next]; index = next;
        }
        heap[index] = last; return first;
    }
    /** Computes least-water routes across revealed terrain and opened gateways to every allied camp. */
    function routes(save) {
        var regions = {}; var stamp = ''; var key; var i; var dir; var size = N.REGION_SIZE;
        for (key in save.regions) { var region = save.regions[key]; stamp += key + region.mask + region.tiles + biome(save, region); }
        stamp += JSON.stringify(save.camps.map(/** Includes relocated settlements in cache invalidation. */ function (camp) { return [camp.id, camp.region, camp.x, camp.y]; })) + JSON.stringify(save.regionGraph.blocked);
        if (routeCache && routeCache.stamp === stamp) { return routeCache.table; }
        for (key in save.regions) { regions[key] = { tiles: R.rle.decode(save.regions[key].tiles, size), bytes: R.mask.decode(save.regions[key].mask), water: biomes[biome(save, save.regions[key])].water }; }
        var table = {}; var heap = [];
        /** Adds a cheaper known route to the search frontier. */
        function offer(regionKey, index, cost, camp) {
            var id = regionKey + ':' + index;
            if (table[id] && table[id].cost <= cost) { return; }
            table[id] = { cost: cost, camp: camp }; push(heap, { region: regionKey, index: index, cost: cost, camp: camp });
        }
        for (i = 0; i < save.camps.length; i++) { var camp = save.camps[i]; offer(camp.region, camp.y * size + camp.x, 0, camp.id); }
        while (heap.length) {
            var node = pop(heap);
            if (table[node.region + ':' + node.index].cost !== node.cost) { continue; }
            var source = regions[node.region]; var x = node.index % size; var y = Math.floor(node.index / size);
            for (dir in R.map.directions) {
                var delta = R.map.directions[dir]; var nx = x + delta[0]; var ny = y + delta[1]; var next = ny * size + nx;
                if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && source.tiles[next] !== '#' && source.tiles[next] !== '~' && R.mask.has(source.bytes, next)) { offer(node.region, next, node.cost + source.water, node.camp); }
            }
            if (source.tiles[node.index] !== '+') { continue; }
            var coordinate = node.region.split(',');
            var dx = x === 1 ? -1 : x === size - 2 ? 1 : 0; var dy = y === 1 ? -1 : y === size - 2 ? 1 : 0;
            var target = (Number(coordinate[0]) + dx) + ',' + (Number(coordinate[1]) + dy);
            if (!regions[target] || !R.worldgen.linked(save.regionGraph, node.region, target) || R.worldgen.isBlocked(save.regionGraph, node.region, target)) { continue; }
            var targetIndex = (dy < 0 ? size - 2 : dy > 0 ? 1 : y) * size + (dx < 0 ? size - 2 : dx > 0 ? 1 : x);
            if (R.mask.has(regions[target].bytes, targetIndex)) { offer(target, targetIndex, node.cost + 1, node.camp); }
        }
        routeCache = { stamp: stamp, table: table }; return table;
    }
    R.wild = {
        biomes: biomes,
        biome: biome,
        goods: goods,
        /** Returns the outdoor movement cost without changing the current model. */
        waterCost: function (save) { return save.flags.insideDungeon ? 1 : biomes[biome(save, save.regions[save.party.region])].water; },
        /** Reports the cheapest currently known camp route, including an immediate dungeon extraction. */
        homeRoute: function (save) {
            var route = routes(save)[save.party.region + ':' + (save.party.y * N.REGION_SIZE + save.party.x)];
            if (!route) { return null; }
            var extraction = save.flags.insideDungeon ? save.dungeons[save.flags.insideDungeon].depth : 0;
            return { cost: route.cost + extraction, camp: route.camp };
        },
        /** Logs supply transitions once, including carried reserve water in all personal packs. */
        warn: function (save) {
            if (save.flags.abyss || save.over) { return; }
            var enabled = !R.ui || !R.ui.preferences || R.ui.preferences.waterWarning !== false;
            var route = enabled ? this.homeRoute(save) : null;
            var available = save.party.water + (save.party.bag.water || 0); var i;
            for (i = 0; i < save.party.companions.length; i++) { available += save.party.companions[i].bag.water || 0; }
            var state = !enabled || R.atCamp(save) ? '' : !route ? 'unknown' : available < route.cost ? 'short:' + route.camp : '';
            if (state && state !== save.flags.waterWarning) { R.log(save, state === 'unknown' ? 'log.waterUnknown' : 'log.waterWarning', { n: route ? route.cost : 0, water: available }); }
            save.flags.waterWarning = state;
            var low = save.party.food + (save.party.bag.food || 0) <= N.LOW_FOOD;
            if (low && !save.flags.lowFood) { R.log(save, 'log.foodWarning'); }
            save.flags.lowFood = low;
            var campLow = (R.stores(save).food || 0) < save.camps.reduce(/** Counts settlement mouths without changing workers. */ function (total, camp) { return total + camp.pop; }, 0);
            if (campLow && !save.flags.campLowFood) { R.log(save, 'log.campFoodWarning'); }
            save.flags.campLowFood = campLow;
        },
        /** Draws one biome-weighted event on a valid wilderness encounter check. */
        encounter: function (save) {
            if (R.roll(save) >= N.WILD_EVENT_CHANCE) { return; }
            var definition = biomes[biome(save, save.regions[save.party.region])];
            var total = 0; var i;
            for (i = 0; i < definition.weights.length; i++) { total += definition.weights[i]; }
            var pick = R.roll(save) * total; var index = 0;
            while (index < definition.weights.length - 1 && pick >= definition.weights[index]) { pick -= definition.weights[index]; index += 1; }
            this.start(save, events[index]);
        },
        /** Instantiates a serializable event once, fixing its wares or rewards before any choices. */
        start: function (save, kind) {
            var tier = save.regions[save.party.region].tier;
            R.log(save, 'event.' + kind);
            if (kind === 'ambush') { R.combat.encounter(save, { kind: 'wild' }); }
            else if (kind === 'merchant') { save.flags.wildEvent = { kind: kind, offers: goods(save) }; }
            else if (kind === 'cache') { save.flags.wildEvent = { kind: kind, reward: tier >= 5 ? { steel: 4, sulphur: 3 } : { iron: 4, fur: 3 } }; }
            else if (kind === 'survivor') { save.flags.wildEvent = { kind: kind, reward: tier >= 5 ? { crystal: 2, medicine: 1 } : { medicine: 1, fur: 2 } }; }
            else if (kind === 'water') { var water = 6 + tier; save.party.water = Math.min(R.waterMax(save), save.party.water + water); }
            else if (kind === 'food') { R.add(save.party.bag, { food: 5 + tier, fur: 1 }); }
            else if (kind === 'salvage') { R.add(save.party.bag, tier >= 6 ? { steel: 3, coal: 4 } : { iron: 3, wood: 4 }); }
            else if (kind === 'storm') { save.party.water = Math.max(0, save.party.water - 2); }
            else if (kind === 'tracks') { R.add(save.party.bag, { food: 3, fur: 2 }); }
        },
        /** Resolves a pending encounter, with one-time rewards and atomic carried-resource trades. */
        act: function (save, action) {
            var event = save.flags.wildEvent;
            if (!event) { return false; }
            if (action.op === 'leave') { delete save.flags.wildEvent; R.log(save, 'log.eventLeave'); return { turns: 0 }; }
            if (event.kind === 'merchant' && action.op === 'buy') {
                var offer = event.offers[action.index];
                if (!offer || offer.sold) { return false; }
                var bag = save.party.bag; var id;
                for (id in offer.cost) { if ((bag[id] || 0) < offer.cost[id]) { return R.fail('err.carriedCost'); } }
                var freed = 0; for (id in offer.cost) { freed += offer.cost[id]; }
                if (R.bagWeight(save) - freed + offer.quantity > R.party.capacity(save, save.party)) { return R.fail('err.bag'); }
                for (id in offer.cost) { bag[id] -= offer.cost[id]; }
                bag[offer.item] = (bag[offer.item] || 0) + offer.quantity; offer.sold = true;
                R.log(save, 'log.bought', { name: R.t('item.' + offer.item), n: offer.quantity });
            } else if ((event.kind === 'cache' || event.kind === 'survivor') && action.op === 'collect') {
                var extra = R.party.weight(event.reward);
                if (R.bagWeight(save) + extra > R.party.capacity(save, save.party)) { return R.fail('err.bag'); }
                if (event.kind === 'survivor') { if (save.party.food < 3) { return R.fail('err.supplies'); } save.party.food -= 3; }
                R.add(save.party.bag, event.reward); delete save.flags.wildEvent;
                R.log(save, 'log.eventReward', { cost: R.ui && R.ui.costText ? R.ui.costText(event.reward) : Object.keys(event.reward).map(/** Formats localized rewards in model-only runs. */ function (id) { return R.t('item.' + id) + ' ' + event.reward[id]; }).join(' · ') });
            } else { return false; }
            return { turns: 1 };
        }
    };
})();
