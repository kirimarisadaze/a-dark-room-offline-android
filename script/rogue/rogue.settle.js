/* SPDX-License-Identifier: MPL-2.0 */
/** Implements shared camp economies, preparation, crafting and daily events. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var C = R.CONTENT;
    /** Returns global Manhattan distance between two region-local positions. */
    function distance(a, b) {
        var ar = a.region.split(',');
        var br = b.region.split(',');
        return Math.abs((Number(ar[0]) - Number(br[0])) * N.REGION_SIZE + a.x - b.x) + Math.abs((Number(ar[1]) - Number(br[1])) * N.REGION_SIZE + a.y - b.y);
    }
    /** Counts site workers and guards attached to one camp. */
    function employed(save, camp) {
        var total = camp.jobs.guard || 0;
        var key;
        var i;
        for (key in save.regions) {
            for (i = 0; i < save.regions[key].sites.length; i++) {
                var site = save.regions[key].sites[i];
                if (site.ownerCamp === camp.id) { total += site.workers; }
            }
        }
        return total;
    }
    /** Rebuilds job summaries and recalls excess workers after population loss. */
    function rebalance(save, camp) {
        var remaining = camp.pop;
        var guards = Math.min(camp.jobs.guard || 0, remaining);
        camp.jobs = { guard: guards };
        remaining -= guards;
        var key;
        var i;
        for (key in save.regions) {
            for (i = 0; i < save.regions[key].sites.length; i++) {
                var site = save.regions[key].sites[i];
                if (site.ownerCamp !== camp.id) { continue; }
                site.workers = Math.min(site.workers, remaining);
                remaining -= site.workers;
                var job = C.sites[site.type].job;
                if (job) { camp.jobs[job] = (camp.jobs[job] || 0) + site.workers; }
            }
        }
    }
    /** Moves gathered resources into the shared warehouse, preserving crafted equipment. */
    function deposit(save) {
        var bag = save.party.bag;
        var id;
        for (id in bag) {
            if (C.items[id] && C.items[id].kind === 'resource') {
                R.stores(save)[id] = (R.stores(save)[id] || 0) + bag[id];
                delete bag[id];
            }
        }
    }
    R.settle = {
        employed: employed,
        /** Finds the nearest camp in global tile coordinates for transport and road length. */
        distance: function (save, region, site) {
            var nearest = Infinity;
            var i;
            for (i = 0; i < save.camps.length; i++) { nearest = Math.min(nearest, distance({ region: region, x: site.x, y: site.y }, save.camps[i])); }
            return nearest;
        },
        /** Computes the one authoritative distance loss formula and road reduction. */
        loss: function (save, region, site) {
            var nearest = this.distance(save, region, site);
            var loss = R.clamp(N.LOSS_RATE * (nearest - N.LOSS_START), 0, N.LOSS_MAX);
            if (site.road) { loss = Math.max(0, loss - N.ROAD_RATE * site.roadLength); }
            return Math.max(0, loss - R.bonus(save, 'loss'));
        },
        /** Settles every occupied site's income before population food consumption. */
        settleCamps: function (save) {
            var stores = R.stores(save);
            var key;
            var i;
            for (key in save.regions) {
                var sites = save.regions[key].sites;
                for (i = 0; i < sites.length; i++) {
                    var site = sites[i];
                    var definition = C.sites[site.type];
                    if (site.state === 'occupied' && definition.resource && site.workers > 0) {
                        var amount = definition.rate * site.workers * (1 - this.loss(save, key, site)) * (1 + R.bonus(save, 'income'));
                        stores[definition.resource] = (stores[definition.resource] || 0) + amount;
                    }
                }
            }
            for (i = 0; i < save.camps.length; i++) {
                var camp = save.camps[i];
                var gardens = camp.buildings.garden || 0;
                stores.food = (stores.food || 0) + gardens * C.buildings.garden.rate * (1 + R.bonus(save, 'garden'));
                var consumption = camp.pop * N.FOOD_PER_POP / N.TURNS_PER_DAY * (1 - R.bonus(save, 'food'));
                if ((stores.food || 0) + 0.000001 < consumption) {
                    stores.food = 0;
                    if (camp.pop > 0) { camp.pop -= 1; R.log(save, 'log.starve'); }
                    save.flags.starving = true;
                } else { stores.food = Math.max(0, (stores.food || 0) - consumption); }
                rebalance(save, camp);
            }
        },
        /** Runs wolf spread, raids, caravans and story rolls in their specified order. */
        onNewDay: function (save) {
            var key;
            var i;
            for (key in save.regions) {
                if (R.roll(save) < N.WOLF_SPREAD) {
                    var region = save.regions[key];
                    var threats = 0;
                    for (i = 0; i < region.sites.length; i++) { if (region.sites[i].type === 'threat' && region.sites[i].state !== 'cleared') { threats += 1; } }
                    if (threats < N.SITE_QUOTAS[region.tier <= 3 ? 0 : region.tier <= 6 ? 1 : 2][1]) {
                        var tiles = R.rle.decode(region.tiles, region.size);
                        var x = N.REGION_CENTER + N.VIEW_RADIUS + 1;
                        var y = N.REGION_CENTER;
                        var occupied = false;
                        for (i = 0; i < region.sites.length; i++) { if (region.sites[i].x === x && region.sites[i].y === y) { occupied = true; } }
                        if (!occupied && tiles[y * region.size + x] === '.') {
                            region.sites.push({ id: key + ':wolf:' + save.day, type: 'threat', x: x, y: y, state: 'unknown', workers: 0, ownerCamp: null });
                            R.log(save, 'log.wolves');
                        }
                    }
                }
            }
            for (i = 0; i < save.camps.length; i++) {
                var camp = save.camps[i];
                if (R.roll(save) < N.FIRE[camp.fire].raid) {
                    var defence = Math.floor((camp.jobs.guard || 0) / N.GUARDS_PER_REDUCTION) * N.GUARD_REDUCTION + (camp.buildings.watchtower || 0) * N.GUARD_REDUCTION + R.bonus(save, 'guard');
                    var loss = Math.max(0, N.RAID_LOSS - defence);
                    R.stores(save).wood = Math.max(0, (R.stores(save).wood || 0) * (1 - loss));
                    R.stores(save).food = Math.max(0, (R.stores(save).food || 0) * (1 - loss));
                    R.log(save, 'log.raid');
                }
            }
            if (R.roll(save) < N.CARAVAN_CHANCE) { save.flags.trader = true; R.log(save, 'log.trader'); }
            if (R.roll(save) < N.EVENT_CHANCE) {
                var event = Math.floor(R.roll(save) * N.EVENT_BUNDLES.length);
                R.add(R.stores(save), N.EVENT_BUNDLES[event]);
                R.log(save, 'log.event' + event);
            }
            for (i = 0; i < save.camps.length; i++) {
                var shelter = save.camps[i];
                if (shelter.pop < N.FIRE[shelter.fire].pop && (R.stores(save).food || 0) >= N.RECRUIT_FOOD && R.roll(save) < N.JOIN_CHANCE) {
                    shelter.pop += 1; R.log(save, 'log.join');
                }
            }
        },
        /** Returns a reduced building cost using completed engineering research. */
        cost: function (save, original) {
            var cost = {};
            var id;
            for (id in original) { cost[id] = Math.ceil(original[id] * (1 - R.bonus(save, 'build'))); }
            return cost;
        },
        /** Checks whether a recipe is unlocked independently of current material quantities. */
        recipeAllowed: function (save, id) {
            var item = C.items[id];
            if (!item || !item.cost) { return false; }
            if (item.blueprint && save.blueprints.indexOf(item.blueprint) < 0) { return false; }
            var camp = R.atCamp(save);
            return !!camp && (!item.workshop || !!camp.buildings.workshop);
        },
        /** Dispatches settlement, inventory and crafting actions with precondition validation. */
        act: function (save, action) {
            var camp = R.atCamp(save);
            var stores = R.stores(save);
            var party = save.party;
            var site = R.map.here(save);
            var item;
            var definition;
            var cost;
            var i;
            if (action.type === 'wait') {
                if (camp) {
                    party.hp = Math.min(party.maxHp, party.hp + N.REST_HP + R.bonus(save, 'heal') + (camp.buildings.infirmary ? N.REST_HP : 0));
                    for (i = 0; i < party.companions.length; i++) { party.companions[i].hp = Math.min(party.companions[i].maxHp, party.companions[i].hp + N.REST_HP); }
                }
            } else if (action.type === 'gather') {
                if (!site || C.sites[site.type].kind !== 'resource') { return false; }
                if (R.bagWeight(save) >= (party.bag.pack ? N.BAG_UPGRADED : N.BAG_BASE)) { return R.fail('err.bag'); }
                var resource = C.sites[site.type].resource;
                var amount = Math.ceil(N.GATHER[resource] * (1 + R.bonus(save, 'gather')));
                var spare = (party.bag.pack ? N.BAG_UPGRADED : N.BAG_BASE) - R.bagWeight(save);
                if (site.type === 'hunting' && spare < 2) { return R.fail('err.bag'); }
                amount = Math.min(amount, spare - (site.type === 'hunting' ? 1 : 0));
                party.bag[resource] = (party.bag[resource] || 0) + amount;
                if (site.type === 'hunting') { party.bag.fur = (party.bag.fur || 0) + 1; party.food = Math.min(N.SUPPLY_FOOD, party.food + amount); }
                if (site.type === 'spring') { party.water = R.waterMax(save); }
                if (site.state === 'seen') { site.state = 'cleared'; }
                R.log(save, 'log.gather', { name: R.t('item.' + resource), n: amount });
            } else if (action.type === 'occupy') {
                if (!site || C.sites[site.type].kind !== 'resource' || site.state !== 'cleared') { return false; }
                site.state = 'occupied'; site.ownerCamp = save.camps[save.activeCamp].id;
                R.log(save, 'log.occupy', { name: R.t('site.' + site.type) });
            } else if (action.type === 'clear') {
                if (!site || site.type !== 'threat' || site.state === 'cleared') { return false; }
                R.combat.encounter(save, { kind: 'site', site: site.id });
            } else if (action.type === 'worker') {
                site = R.map.site(save, action.site);
                if (!site || site.state !== 'occupied') { return false; }
                var owner = null;
                for (i = 0; i < save.camps.length; i++) { if (save.camps[i].id === site.ownerCamp) { owner = save.camps[i]; } }
                if (!owner) { return false; }
                if (action.delta > 0 && employed(save, owner) >= owner.pop) { return R.fail('err.workers'); }
                if (action.delta < 0 && site.workers <= 0) { return false; }
                site.workers = Math.max(0, site.workers + (action.delta > 0 ? 1 : -1)); rebalance(save, owner);
            } else if (action.type === 'guard') {
                camp = save.camps[save.activeCamp];
                if (action.delta > 0 && employed(save, camp) >= camp.pop) { return R.fail('err.workers'); }
                if (action.delta < 0 && !(camp.jobs.guard > 0)) { return false; }
                camp.jobs.guard = Math.max(0, (camp.jobs.guard || 0) + (action.delta > 0 ? 1 : -1));
            } else if (action.type === 'road') {
                site = R.map.site(save, action.site);
                if (!site || site.state !== 'occupied' || site.road) { return false; }
                if (!R.affords(save, N.ROAD_COST)) { return R.fail('err.resources'); }
                var roadRegion;
                for (roadRegion in save.regions) { if (save.regions[roadRegion].sites.indexOf(site) >= 0) { break; } }
                R.pay(save, N.ROAD_COST); site.road = true; site.roadLength = this.distance(save, roadRegion, site);
                R.log(save, 'log.road');
            } else if (action.type === 'newCamp') {
                if (camp || save.flags.insideDungeon) { return false; }
                if (save.camps.length >= N.MAX_CAMPS) { return R.fail('err.campLimit'); }
                var sites = save.regions[party.region].sites;
                for (i = 0; i < sites.length; i++) { if (sites[i].type === 'threat' && sites[i].state !== 'cleared') { return R.fail('err.campThreat'); } }
                if (!R.affords(save, N.CAMP_UNLOCK)) { return R.fail('err.resources'); }
                if (save.camps[0].pop <= 1) { return R.fail('err.workers'); }
                R.pay(save, N.CAMP_UNLOCK);
                var nextId = 0;
                for (i = 0; i < save.camps.length; i++) { nextId = Math.max(nextId, save.camps[i].id + 1); }
                save.camps[0].pop -= 1; rebalance(save, save.camps[0]);
                save.camps.push({ id: nextId, region: party.region, x: party.x, y: party.y, fire: 1, pop: 1, jobs: {}, stores: {}, buildings: {} });
                save.activeCamp = save.camps.length - 1; R.log(save, 'log.camp');
            } else if (action.type === 'dismantle') {
                if (!camp || camp.id === 0) { return R.fail('err.mainCamp'); }
                R.add(stores, N.CAMP_UNLOCK, N.CAMP_REFUND); save.camps[0].pop += camp.pop;
                var regionKey;
                for (regionKey in save.regions) {
                    var regionSites = save.regions[regionKey].sites;
                    for (i = 0; i < regionSites.length; i++) { if (regionSites[i].ownerCamp === camp.id) { regionSites[i].ownerCamp = 0; } }
                }
                save.camps.splice(save.camps.indexOf(camp), 1); save.activeCamp = 0;
                rebalance(save, save.camps[0]); R.log(save, 'log.moveCamp');
            } else if (action.type === 'equip') {
                item = C.items[action.item];
                if (!item || !party.bag[action.item] || (item.kind !== 'weapon' && item.kind !== 'armour')) { return false; }
                if (item.kind === 'weapon') { party.weapon = action.item; }
                else {
                    var previousMax = party.maxHp;
                    party.armour = action.item; party.maxHp = N.BASE_HP + item.hp;
                    party.hp = R.clamp(party.hp + party.maxHp - previousMax, 1, party.maxHp);
                }
                R.log(save, 'log.equip', { name: R.t('item.' + action.item) });
            } else if (action.type === 'use') {
                if (action.item === 'water' && party.bag.water > 0) {
                    var water = Math.min(party.bag.water, R.waterMax(save) - party.water);
                    if (water <= 0) { return false; }
                    party.water += water; party.bag.water -= water;
                } else if (action.item === 'food' && party.bag.food > 0) {
                    var food = Math.min(party.bag.food, N.SUPPLY_FOOD - party.food);
                    if (food <= 0) { return false; }
                    party.food += food; party.bag.food -= food;
                } else if (action.item === 'medicine' && party.bag.medicine > 0 && party.hp < party.maxHp) {
                    party.bag.medicine -= 1; party.hp = Math.min(party.maxHp, party.hp + C.items.medicine.heal);
                    R.log(save, 'log.heal', { n: C.items.medicine.heal });
                } else { return false; }
            } else if (action.type === 'cheat') {
                save.cheat = true; R.add(stores, N.CHEAT_BUNDLE); R.log(save, 'log.cheat');
            } else if (action.type === 'launch') {
                if (!site || site.type !== 'ship' || !party.bag.hull || !party.bag.drive || !party.bag.core) { return R.fail('err.resources'); }
                party.bag.hull -= 1; party.bag.drive -= 1; party.bag.core -= 1;
                save.over = true; save.endReason = 'ship'; save.flags.abyssUnlocked = true;
            } else {
                if (!camp) { return R.fail('err.camp'); }
                if (action.type === 'forage') { R.add(stores, N.FORAGE); R.log(save, 'log.forage'); }
                else if (action.type === 'deposit') { deposit(save); R.log(save, 'log.deposit'); }
                else if (action.type === 'restock') {
                    deposit(save);
                    var neededWater = R.waterMax(save) - party.water;
                    var refillWater = camp.buildings.well ? neededWater : Math.min(neededWater, Math.floor(stores.water || 0));
                    party.water += refillWater;
                    if (!camp.buildings.well) { stores.water = Math.max(0, (stores.water || 0) - refillWater); }
                    var refillFood = Math.min(N.SUPPLY_FOOD - party.food, Math.floor(stores.food || 0));
                    party.food += refillFood; stores.food = Math.max(0, (stores.food || 0) - refillFood);
                    var capacity = (party.bag.pack ? N.BAG_UPGRADED : N.BAG_BASE) - R.bagWeight(save);
                    var foodReserve = Math.min(N.FOOD_RESERVE, Math.floor(stores.food || 0), capacity);
                    if (foodReserve > 0) { party.bag.food = foodReserve; stores.food -= foodReserve; }
                    var maximumReserve = party.bag.pack ? N.TRAVEL_RESERVE : N.TRAVEL_RESERVE_SMALL;
                    var reserve = Math.min(maximumReserve, capacity - foodReserve, camp.buildings.well ? maximumReserve : Math.floor(stores.water || 0));
                    if (reserve > 0) { party.bag.water = reserve; if (!camp.buildings.well) { stores.water -= reserve; } }
                    R.log(save, 'log.restock');
                } else if (action.type === 'night') {
                    party.hp = party.maxHp;
                    for (i = 0; i < party.companions.length; i++) { party.companions[i].hp = party.companions[i].maxHp; }
                    R.log(save, 'log.night'); return { turns: N.NIGHT_TURNS[save.speed] };
                } else if (action.type === 'fire') {
                    if (camp.fire >= N.FIRE.length - 1) { return false; }
                    cost = { wood: N.FIRE[camp.fire + 1].wood };
                    if (!R.affords(save, cost)) { return R.fail('err.resources'); }
                    R.pay(save, cost); camp.fire += 1; R.log(save, 'log.fire');
                } else if (action.type === 'build') {
                    definition = C.buildings[action.building];
                    if (!definition || (camp.buildings[action.building] || 0) >= definition.max) { return false; }
                    cost = this.cost(save, definition.cost);
                    if (!R.affords(save, cost)) { return R.fail('err.resources'); }
                    R.pay(save, cost); camp.buildings[action.building] = (camp.buildings[action.building] || 0) + 1;
                    R.log(save, 'log.build', { name: R.t('ui.building.' + action.building) });
                } else if (action.type === 'craft') {
                    item = C.items[action.item];
                    if (!item || !item.cost) { return false; }
                    if (item.blueprint && save.blueprints.indexOf(item.blueprint) < 0) { return R.fail('err.blueprint'); }
                    if (item.workshop && !camp.buildings.workshop) { return R.fail('err.workshop'); }
                    if (!R.affords(save, item.cost)) { return R.fail('err.resources'); }
                    R.pay(save, item.cost); party.bag[action.item] = (party.bag[action.item] || 0) + (item.quantity || 1);
                    if (item.kind === 'resource') { stores[action.item] = (stores[action.item] || 0) + (item.quantity || 1); party.bag[action.item] -= item.quantity || 1; }
                    if (item.kind === 'weapon' && item.dmg > C.items[party.weapon].dmg) { party.weapon = action.item; }
                    if (item.kind === 'armour' && (!party.armour || item.hp > C.items[party.armour].hp)) {
                        var oldMax = party.maxHp; party.armour = action.item; party.maxHp = N.BASE_HP + item.hp; party.hp += party.maxHp - oldMax;
                    }
                    R.log(save, 'log.craft', { name: R.t('item.' + action.item) });
                } else if (action.type === 'research') {
                    definition = null;
                    for (i = 0; i < C.research.length; i++) { if (C.research[i].id === action.research) { definition = C.research[i]; } }
                    if (!definition || save.flags['tech.' + action.research] || !camp.buildings.workshop) { return false; }
                    if (!R.affords(save, definition.cost)) { return R.fail('err.resources'); }
                    R.pay(save, definition.cost); save.flags['tech.' + action.research] = true;
                    R.log(save, 'log.research', { name: R.t('ui.research.' + action.research) });
                } else if (action.type === 'recruit') {
                    if (party.companions.length >= N.MAX_COMPANIONS || camp.pop <= 1 || employed(save, camp) >= camp.pop) { return R.fail('err.companions'); }
                    if (!R.affords(save, { food: N.RECRUIT_FOOD })) { return R.fail('err.resources'); }
                    R.pay(save, { food: N.RECRUIT_FOOD }); camp.pop -= 1;
                    var name = C.names[Math.floor(R.roll(save) * C.names.length)];
                    var companion = { id: 'companion:' + save.turn + ':' + save.flags.rng, name: name,
                        str: 1 + Math.floor(R.roll(save) * N.COMPANION_STAT), agi: 1 + Math.floor(R.roll(save) * N.COMPANION_STAT),
                        will: 1 + Math.floor(R.roll(save) * N.COMPANION_STAT), hp: N.COMPANION_HP, maxHp: N.COMPANION_HP,
                        quirk: C.quirks[Math.floor(R.roll(save) * C.quirks.length)] };
                    party.companions.push(companion); R.log(save, 'log.recruit', { name: R.t('ui.name.' + name) });
                } else if (action.type === 'trade') {
                    if (!save.flags.trader || !R.affords(save, N.TRADE_COST)) { return R.fail('err.resources'); }
                    R.pay(save, N.TRADE_COST); R.add(stores, N.TRADE_REWARD); save.flags.trader = false; R.log(save, 'log.trade');
                } else { return false; }
            }
            return { turns: 1 };
        }
    };
})();
