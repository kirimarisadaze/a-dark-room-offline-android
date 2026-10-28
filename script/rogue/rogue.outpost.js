/* SPDX-License-Identifier: MPL-2.0 */
/** Provides persistent multi-stage hostile compounds and limited allied settlement claims. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    /** Adds one reachable compound without touching existing terrain, fog or the run's random stream. */
    function ensure(save, region) {
        var i; var used = {}; var tiles = R.rle.decode(region.tiles, region.size);
        for (i = 0; i < region.sites.length; i++) {
            if (region.sites[i].type === 'outpost') { return; }
            used[region.sites[i].y * region.size + region.sites[i].x] = true;
        }
        var camps = save.camps || [];
        for (i = 0; i < camps.length; i++) { if (camps[i].region === region.key) { used[camps[i].y * region.size + camps[i].x] = true; } }
        if (region.refuge) { used[region.refuge.y * region.size + region.refuge.x] = true; }
        if (save.party && save.party.region === region.key) { used[save.party.y * region.size + save.party.x] = true; }
        var temp = save.flags && save.flags.tempCamp;
        if (temp && temp.region === region.key) { used[temp.y * region.size + temp.x] = true; }
        var reachable = R.worldgen.flood(tiles, region.size, N.REGION_CENTER, N.REGION_CENTER);
        var candidates = [];
        for (i = 0; i < tiles.length; i++) {
            var x = i % region.size; var y = Math.floor(i / region.size);
            if (tiles[i] === '.' && !used[i] && reachable[i] !== undefined && x > 5 && y > 5 && x < region.size - 6 && y < region.size - 6 && Math.abs(x - N.REGION_CENTER) + Math.abs(y - N.REGION_CENTER) >= 10) { candidates.push(i); }
        }
        var index = candidates[R.hash(save.seed, 'outpost:' + region.key) % candidates.length];
        region.sites.push({ id: region.key + ':outpost', type: 'outpost', x: index % region.size, y: Math.floor(index / region.size), state: 'unknown', workers: 0, ownerCamp: null, assault: 0 });
    }
    R.outpost = {
        ensure: ensure,
        /** Returns the compound currently being explored indoors. */
        current: function (save) { return save.flags.outpost ? R.map.site(save, save.flags.outpost) : null; },
        /** Completes only the current battle stage, leaving the compound uncleared until its final defence. */
        won: function (save, session) {
            var site = R.map.site(save, session.ctx.outpost);
            if (!site || site.assault !== session.ctx.stage) { return; }
            site.assault += 1;
            if (site.assault === N.OUTPOST_STAGES) { site.state = 'cleared'; R.log(save, 'log.outpostCleared'); }
            else { R.log(save, 'log.outpostAdvance', { n: site.assault, max: N.OUTPOST_STAGES }); }
        },
        /** Recalls a secondary settlement while retaining residents, jobs and paid building materials. */
        release: function (save, camp) {
            var key; var i;
            save.camps[0].pop += camp.pop;
            for (key in camp.buildings) { R.add(R.stores(save), R.CONTENT.buildings[key].cost, Math.max(0, camp.buildings[key] - ((camp.inheritedBuildings || {})[key] || 0)) * N.CAMP_REFUND); }
            if (!camp.capturedFrom) { R.add(R.stores(save), N.CAMP_UNLOCK, N.CAMP_REFUND); }
            for (key in save.regions) {
                var sites = save.regions[key].sites;
                for (i = 0; i < sites.length; i++) {
                    if (sites[i].id === camp.capturedFrom) { sites[i].state = 'cleared'; sites[i].ownerCamp = null; }
                    else if (sites[i].ownerCamp === camp.id) { sites[i].ownerCamp = 0; }
                }
            }
            save.camps.splice(save.camps.indexOf(camp), 1); save.activeCamp = 0;
        },
        /** Enters, explores, withdraws from or claims the compound using explicit actions. */
        act: function (save, action) {
            var site = this.current(save);
            if (action.op === 'enter') {
                site = R.map.here(save);
                if (!site || site.type !== 'outpost' || site.state === 'occupied') { return false; }
                save.flags.outpost = site.id; R.log(save, 'log.outpostEnter'); return { turns: 0 };
            }
            if (!site || R.map.here(save) !== site) { return false; }
            if (action.op === 'leave') { delete save.flags.outpost; R.log(save, 'log.outpostLeave'); return { turns: 0 }; }
            if (action.op === 'explore') {
                if (site.assault >= N.OUTPOST_STAGES) { return false; }
                if (site.assault % 2 === 0) {
                    R.combat.encounter(save, { kind: 'outpost', outpost: site.id, stage: site.assault, depth: site.assault + 2 });
                } else {
                    var reward = site.assault === 1 ? { medicine: 2, fur: 3 } : { water: 12, food: 10, iron: 4 };
                    R.add(save.party.bag, reward); site.assault += 1;
                    R.log(save, site.assault === 2 ? 'log.outpostInfirmary' : 'log.outpostDepot');
                }
            } else if (action.op === 'claim') {
                if (site.assault !== N.OUTPOST_STAGES || site.state !== 'cleared') { return false; }
                if (save.camps.length >= N.MAX_CAMPS && !action.replace) { return R.fail('err.campLimit'); }
                if (!R.affords(save, N.OUTPOST_REPAIR)) { return R.fail('err.resources'); }
                if (save.camps[0].pop + (action.replace && save.camps[1] ? save.camps[1].pop : 0) <= 1) { return R.fail('err.workers'); }
                if (save.camps.length >= N.MAX_CAMPS) { this.release(save, save.camps[1]); }
                R.pay(save, N.OUTPOST_REPAIR); save.camps[0].pop -= 1;
                var camp = { id: Math.max(save.flags.campSerial || 1, save.camps[0].id + 1), region: save.party.region, x: site.x, y: site.y, fire: 2, pop: 1, jobs: {}, stores: {}, buildings: { well: 1, watchtower: 1 }, inheritedBuildings: { well: 1, watchtower: 1 }, capturedFrom: site.id };
                save.flags.campSerial = camp.id + 1;
                save.camps.push(camp); save.activeCamp = save.camps.length - 1;
                site.state = 'occupied'; site.ownerCamp = camp.id; delete save.flags.outpost;
                R.log(save, 'log.outpostClaimed');
            } else { return false; }
            return { turns: 1 };
        }
    };
})();
