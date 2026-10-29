/* SPDX-License-Identifier: MPL-2.0 */
/** Handles fog, character-map windows and discrete movement without timers. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var directions = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] };
    var terrainCache = {};
    /** Returns terrain cached by its immutable encoding. */
    function decode(map) {
        if (!terrainCache[map.tiles]) { terrainCache[map.tiles] = R.rle.decode(map.tiles, map.size); }
        return terrainCache[map.tiles];
    }
    R.map = {
        directions: directions,
        /** Releases map caches when switching to a different run. */
        reset: function () { terrainCache = {}; },
        /** Returns only real gateways, optionally restricted to tiles the player has explored. */
        exits: function (save, knownOnly) {
            var region = save.regions[save.party.region];
            var bytes = R.mask.decode(region.mask);
            var origin = save.party.region.split(',');
            var result = [];
            var dir;
            for (dir in directions) {
                var delta = directions[dir];
                var target = (Number(origin[0]) + delta[0]) + ',' + (Number(origin[1]) + delta[1]);
                if (!R.worldgen.linked(save.regionGraph, save.party.region, target)) { continue; }
                var x = delta[0] < 0 ? 1 : delta[0] > 0 ? N.REGION_SIZE - 2 : N.REGION_CENTER;
                var y = delta[1] < 0 ? 1 : delta[1] > 0 ? N.REGION_SIZE - 2 : N.REGION_CENTER;
                if (!knownOnly || R.mask.has(bytes, y * region.size + x)) { result.push({ dir: dir, target: target, x: x, y: y, blocked: R.worldgen.isBlocked(save.regionGraph, save.party.region, target) }); }
            }
            return result;
        },
        /** Describes nearby traces inside the current region without revealing a future map. */
        clues: function (save) {
            var region = save.regions[save.party.region];
            var result = [{ key: 'clue.' + region.theme, values: {} }, { key: 'biome.' + R.wild.biome(save, region) + '.clue', values: {} }];
            var nearest = null;
            var distance = N.CLUE_RADIUS + 1;
            var i;
            for (i = 0; i < region.sites.length; i++) {
                var site = region.sites[i];
                var steps = Math.abs(site.x - save.party.x) + Math.abs(site.y - save.party.y);
                if (site.state === 'unknown' && steps < distance) { nearest = site; distance = steps; }
            }
            if (nearest) {
                var dx = nearest.x - save.party.x; var dy = nearest.y - save.party.y;
                var dir = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'west' : 'east' : dy < 0 ? 'north' : 'south';
                result.push({ key: nearest.type === 'dungeon' || nearest.type === 'ship' || nearest.type === 'outpost' ? 'clue.building' : nearest.type === 'threat' ? 'clue.tracks' : 'clue.resources', values: { direction: R.t('ui.' + dir) } });
            } else { result.push({ key: 'clue.keepExploring', values: {} }); }
            return result;
        },
        /** Returns the current map and mutable local position. */
        current: function (save) {
            if (save.flags.insideDungeon) {
                var floor = save.dungeons[save.flags.insideDungeon].floor;
                return { map: floor, position: floor.party, tiles: decode(floor), dungeon: true };
            }
            var region = save.regions[save.party.region];
            return { map: region, position: save.party, tiles: decode(region), dungeon: false };
        },
        /** Finds a world site by its stable id. */
        site: function (save, id) {
            var key;
            var i;
            for (key in save.regions) {
                for (i = 0; i < save.regions[key].sites.length; i++) {
                    if (save.regions[key].sites[i].id === id) { return save.regions[key].sites[i]; }
                }
            }
            return null;
        },
        /** Returns the site currently under the party outdoors. */
        here: function (save) {
            if (save.flags.insideDungeon) { return null; }
            var sites = save.regions[save.party.region].sites;
            var i;
            for (i = 0; i < sites.length; i++) { if (sites[i].x === save.party.x && sites[i].y === save.party.y) { return sites[i]; } }
            return null;
        },
        /** Reveals the current radius while preserving previously explored fog. */
        reveal: function (save) {
            var view = this.current(save);
            var radius = N.VIEW_RADIUS + R.bonus(save, 'vision');
            var camp = R.atCamp(save);
            if (camp) { radius = Math.max(radius, N.FIRE[camp.fire].radius + (camp.buildings.beacon ? N.SCOUT_RADIUS : 0)); }
            var bytes = R.mask.decode(view.map.mask);
            var x;
            var y;
            for (y = Math.max(0, view.position.y - radius); y <= Math.min(view.map.size - 1, view.position.y + radius); y++) {
                for (x = Math.max(0, view.position.x - radius); x <= Math.min(view.map.size - 1, view.position.x + radius); x++) {
                    if (Math.abs(x - view.position.x) + Math.abs(y - view.position.y) <= radius) { R.mask.set(bytes, y * view.map.size + x); }
                }
            }
            view.map.mask = R.mask.encode(bytes);
            if (!view.dungeon) {
                var i;
                for (i = 0; i < view.map.sites.length; i++) {
                    var site = view.map.sites[i];
                    if (site.state === 'unknown' && R.mask.has(bytes, site.y * view.map.size + site.x)) {
                        site.state = 'seen';
                        R.log(save, 'log.discover', { name: R.t('site.' + site.type) });
                    }
                }
            }
        },
        /** Moves one tile, charges supplies and starts seeded encounters. */
        move: function (save, dir) {
            var delta = directions[dir];
            if (!delta) { return false; }
            var view = this.current(save);
            var x = view.position.x + delta[0];
            var y = view.position.y + delta[1];
            if (!view.dungeon && (x === 0 || y === 0 || x === view.map.size - 1 || y === view.map.size - 1)) {
                var crossed = this.tryCross(dir, save);
                return crossed === 'crossed' ? { turns: 1 } : R.fail('err.blocked');
            }
            var tile = view.tiles[y * view.map.size + x];
            if (x <= 0 || y <= 0 || x >= view.map.size - 1 || y >= view.map.size - 1 || tile === '#' || tile === '~') {
                R.fail('err.wall');
                if (view.dungeon && !save.flags.abyss && (save.party.water <= 0 || save.party.food <= 0)) { R.log(save, 'log.stranded'); return { turns: 1 }; }
                return false;
            }
            view.position.x = x; view.position.y = y;
            var arrivedCamp = R.atCamp(save);
            if (arrivedCamp) { save.activeCamp = save.camps.indexOf(arrivedCamp); }
            save.flags.moves += 1;
            R.log(save, 'log.move', { direction: R.t('ui.' + dir), n: 1 });
            if (!save.flags.abyss) {
                save.party.water = Math.max(0, save.party.water - R.wild.waterCost(save));
                if (save.flags.moves % N.MOVES_PER_FOOD === 0) { save.party.food = Math.max(0, save.party.food - 1); }
            }
            if (view.dungeon) {
                save.flags.dungeonMoves += 1;
                R.dungeon.checkObjective(save);
                if (!view.map.cleared && save.flags.dungeonMoves % N.DUNGEON_CHECK === 0 && R.roll(save) < N.DUNGEON_FIGHT_CHANCE) {
                    R.combat.encounter(save, { kind: 'dungeon', depth: view.map.depth });
                }
            } else {
                var distance = Infinity;
                var c;
                for (c = 0; c < save.camps.length; c++) { if (save.camps[c].region === save.party.region) { distance = Math.min(distance, Math.abs(x - save.camps[c].x) + Math.abs(y - save.camps[c].y)); } }
                var site = this.here(save);
                if (!site && distance > N.VIEW_RADIUS && save.flags.moves % N.ENCOUNTER_CHECK === 0) { R.wild.encounter(save); }
            }
            return { turns: 1 };
        },
        /** Crosses a marked interior gateway while keeping every outer boundary tile a wall. */
        tryCross: function (dir, save) {
            save = save || R.state.current;
            if (!save || save.flags.insideDungeon || save.flags.combat) { return 'none'; }
            var delta = directions[dir];
            if (!delta) { return 'none'; }
            var p = save.party;
            var size = N.REGION_SIZE;
            var gateway = delta[0] ? p.y === N.REGION_CENTER && p.x === (delta[0] < 0 ? 1 : size - 2) : p.x === N.REGION_CENTER && p.y === (delta[1] < 0 ? 1 : size - 2);
            if (!gateway) { return 'none'; }
            var coordinate = p.region.split(',');
            var target = (Number(coordinate[0]) + delta[0]) + ',' + (Number(coordinate[1]) + delta[1]);
            if (!R.worldgen.linked(save.regionGraph, p.region, target)) { return 'none'; }
            if (p.water < 1 || p.food < 1) { R.fail('err.supplies'); return 'blocked'; }
            if (R.worldgen.isBlocked(save.regionGraph, p.region, target)) {
                if (!p.bag.scaffold) { return 'blocked'; }
                var scaffold = false;
                var i;
                for (i = 0; i < save.regionGraph.scaffold.length; i++) {
                    var edge = save.regionGraph.scaffold[i].split('|');
                    if (edge.indexOf(p.region) >= 0 && edge.indexOf(target) >= 0) { scaffold = true; }
                }
                if (!scaffold) { return 'blocked'; }
                for (i = save.regionGraph.blocked.length - 1; i >= 0; i--) {
                    var blocked = save.regionGraph.blocked[i];
                    if (blocked.indexOf(p.region) >= 0 && blocked.indexOf(target) >= 0) { save.regionGraph.blocked.splice(i, 1); }
                }
                p.bag.scaffold -= 1;
            }
            if (p.water < 1 || p.food < 1) { R.fail('err.supplies'); return 'blocked'; }
            p.water -= 1; p.food -= 1;
            p.region = target;
            p.x = delta[0] < 0 ? size - 2 : delta[0] > 0 ? 1 : N.REGION_CENTER;
            p.y = delta[1] < 0 ? size - 2 : delta[1] > 0 ? 1 : N.REGION_CENTER;
            if (!save.regions[target]) { save.regions[target] = R.worldgen.buildRegion(save, target); }
            R.log(save, 'log.cross', { region: R.t('room.' + save.regions[target].theme) });
            if (R.roll(save) < N.CROSS_CHANCE) { R.combat.encounter(save, { kind: 'cross' }); }
            return 'crossed';
        },
        /** Finds a shortest route over explored walkable tiles only. */
        path: function (save, tx, ty) {
            var view = this.current(save);
            var size = view.map.size;
            var bytes = R.mask.decode(view.map.mask);
            var start = view.position.y * size + view.position.x;
            var target = ty * size + tx;
            var queue = [start];
            var parents = {};
            parents[start] = null;
            var cursor;
            var dir;
            for (cursor = 0; cursor < queue.length && parents[target] === undefined; cursor++) {
                var index = queue[cursor];
                for (dir in directions) {
                    var x = index % size + directions[dir][0];
                    var y = Math.floor(index / size) + directions[dir][1];
                    var next = y * size + x;
                    if (x > 0 && y > 0 && x < size - 1 && y < size - 1 && view.tiles[next] !== '#' && view.tiles[next] !== '~' && R.mask.has(bytes, next) && parents[next] === undefined) {
                        parents[next] = { index: index, dir: dir }; queue.push(next);
                    }
                }
            }
            if (parents[target] === undefined) { return null; }
            var route = [];
            while (target !== start) { route.unshift(parents[target].dir); target = parents[target].index; }
            return route;
        },
        /** Returns only the visible character window with three-state fog and site overlays. */
        window: function (save) {
            var view = this.current(save);
            var radius = N.VIEW_RADIUS + R.bonus(save, 'vision');
            var bytes = R.mask.decode(view.map.mask);
            var half = Math.floor(N.MAP_WINDOW / 2);
            var cells = [];
            var overlays = {};
            var i;
            var x;
            var y;
            if (!view.dungeon) {
                var caches = save.flags.caches || [];
                for (i = 0; i < caches.length; i++) { if (caches[i].region === save.party.region && R.party.weight(caches[i].stores) > 0) { overlays[caches[i].x + ',' + caches[i].y] = { symbol: '*', cls: 'camp' }; } }
                for (i = 0; i < view.map.sites.length; i++) {
                    var site = view.map.sites[i];
                    if (site.state !== 'unknown') { overlays[site.x + ',' + site.y] = { symbol: R.CONTENT.sites[site.type].symbol, cls: 'site', site: site.id }; }
                }
                for (i = 0; i < save.camps.length; i++) {
                    var camp = save.camps[i];
                    if (camp.region === save.party.region) { overlays[camp.x + ',' + camp.y] = { symbol: 'B', cls: 'camp' }; }
                }
                var shelter = save.flags.tempCamp;
                if (shelter && shelter.region === save.party.region) { overlays[shelter.x + ',' + shelter.y] = { symbol: '^', cls: 'camp' }; }
            }
            for (y = view.position.y - half; y <= view.position.y + half; y++) {
                var row = [];
                for (x = view.position.x - half; x <= view.position.x + half; x++) {
                    var valid = x >= 0 && y >= 0 && x < view.map.size && y < view.map.size;
                    if (!valid || !R.mask.has(bytes, y * view.map.size + x)) { row.push(null); continue; }
                    var tile = view.tiles[y * view.map.size + x];
                    var overlay = overlays[x + ',' + y];
                    var cell = { x: x, y: y, symbol: overlay ? overlay.symbol : tile, cls: overlay ? overlay.cls : tile === '#' ? 'wall' : tile === '+' ? 'exit' : tile === '>' ? 'objective' : 'floor',
                        dim: Math.abs(x - view.position.x) + Math.abs(y - view.position.y) > radius, site: overlay ? overlay.site : null };
                    if (x === view.position.x && y === view.position.y) { cell.symbol = '@'; cell.cls = 'player'; cell.dim = false; }
                    row.push(cell);
                }
                cells.push(row);
            }
            return cells;
        }
    };
})();
