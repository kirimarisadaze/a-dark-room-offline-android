/* SPDX-License-Identifier: MPL-2.0 */
/** Generates connected seeded regions and compact map encodings. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    R.rle = {
        /** Encodes repeated terrain characters without separators. */
        encode: function (tiles) {
            var result = '';
            var count = 0;
            var last = '';
            var i;
            for (i = 0; i <= tiles.length; i++) {
                if (i < tiles.length && tiles[i] === last) { count += 1; }
                else {
                    if (count) { result += count + last; }
                    last = tiles[i]; count = 1;
                }
            }
            return result;
        },
        /** Decodes and validates a square RLE terrain map. */
        decode: function (text, size) {
            var result = [];
            var pattern = /([1-9][0-9]*)([.#~+><%])/g;
            var match;
            var consumed = '';
            var i;
            while ((match = pattern.exec(text)) !== null) {
                var count = Number(match[1]);
                if (count > size * size || result.length + count > size * size) { throw new Error('Invalid RLE'); }
                for (i = 0; i < count; i++) { result.push(match[2]); }
                consumed += match[0];
            }
            if (result.length !== size * size || consumed !== text) { throw new Error('Invalid RLE'); }
            return result;
        }
    };
    R.mask = {
        /** Returns a zeroed fog bitmap for a square map. */
        empty: function (size) {
            return R.mask.encode(new Uint8Array(Math.ceil(size * size / 8)));
        },
        /** Decodes the persistent explored bitmap. */
        decode: function (text) {
            var raw = atob(text);
            var bytes = new Uint8Array(raw.length);
            var i;
            for (i = 0; i < raw.length; i++) { bytes[i] = raw.charCodeAt(i); }
            return bytes;
        },
        /** Encodes the explored bitmap as portable base64. */
        encode: function (bytes) {
            var raw = '';
            var i;
            for (i = 0; i < bytes.length; i++) { raw += String.fromCharCode(bytes[i]); }
            return btoa(raw);
        },
        /** Checks whether one tile has ever been explored. */
        has: function (bytes, index) { return !!(bytes[index >> 3] & (1 << (index & 7))); },
        /** Records exploration of a single tile. */
        set: function (bytes, index) { bytes[index >> 3] |= 1 << (index & 7); }
    };
    /** Flood-fills traversable terrain and returns distances from an origin. */
    function flood(tiles, size, x, y) {
        var distances = {};
        var queue = [y * size + x];
        distances[queue[0]] = 0;
        var cursor;
        var d;
        for (cursor = 0; cursor < queue.length; cursor++) {
            var index = queue[cursor];
            for (d = 0; d < directions.length; d++) {
                var nx = index % size + directions[d][0];
                var ny = Math.floor(index / size) + directions[d][1];
                var next = ny * size + nx;
                if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1 && tiles[next] !== '#' && tiles[next] !== '~' && distances[next] === undefined) {
                    distances[next] = distances[index] + 1;
                    queue.push(next);
                }
            }
        }
        return distances;
    }
    /** Carves a connected rectangular passage without opening boundary walls. */
    function corridor(tiles, size, x, y, tx, ty) {
        while (x !== tx || y !== ty) {
            tiles[y * size + x] = '.';
            if (x !== tx) { x += tx > x ? 1 : -1; }
            else { y += ty > y ? 1 : -1; }
        }
        tiles[y * size + x] = '.';
    }
    /** Builds room corridors or organic cave terrain, preserving a connected central refuge. */
    function terrain(size, built, random) {
        var tiles = [];
        var middle = Math.floor(size / 2);
        var x;
        var y;
        var i;
        for (i = 0; i < size * size; i++) { tiles.push('#'); }
        if (built) {
            var previous = { x: middle, y: middle };
            for (i = 0; i < N.ROOM_COUNT; i++) {
                var width = R.integer(random, N.ROOM_MIN, N.ROOM_MAX);
                var height = R.integer(random, N.ROOM_MIN, N.ROOM_MAX);
                var left = R.integer(random, 1, size - width - 2);
                var top = R.integer(random, 1, size - height - 2);
                for (y = top; y < top + height; y++) {
                    for (x = left; x < left + width; x++) { tiles[y * size + x] = '.'; }
                }
                var center = { x: left + Math.floor(width / 2), y: top + Math.floor(height / 2) };
                corridor(tiles, size, previous.x, previous.y, center.x, center.y);
                previous = center;
            }
        } else {
            for (y = 1; y < size - 1; y++) {
                for (x = 1; x < size - 1; x++) { tiles[y * size + x] = random() < N.CAVE_FILL ? '#' : '.'; }
            }
            for (i = 0; i < N.CAVE_PASSES; i++) {
                var nextTiles = tiles.slice();
                for (y = 1; y < size - 1; y++) {
                    for (x = 1; x < size - 1; x++) {
                        var walls = 0;
                        var dx;
                        var dy;
                        for (dy = -1; dy <= 1; dy++) {
                            for (dx = -1; dx <= 1; dx++) { if (tiles[(y + dy) * size + x + dx] === '#') { walls += 1; } }
                        }
                        nextTiles[y * size + x] = walls >= 5 ? '#' : '.';
                    }
                }
                tiles = nextTiles;
            }
            x = middle; y = middle;
            for (i = 0; i < N.CAVE_WALK; i++) {
                tiles[y * size + x] = '.';
                var direction = directions[R.integer(random, 0, directions.length - 1)];
                x = R.clamp(x + direction[0], 2, size - 3);
                y = R.clamp(y + direction[1], 2, size - 3);
            }
        }
        for (y = middle - 3; y <= middle + 3; y++) {
            for (x = middle - 3; x <= middle + 3; x++) { tiles[y * size + x] = '.'; }
        }
        return tiles;
    }
    /** Removes unreachable floor tiles after every passage and exit has been carved. */
    function connect(tiles, size, x, y) {
        var reachable = flood(tiles, size, x, y);
        var i;
        for (i = 0; i < tiles.length; i++) {
            if (tiles[i] !== '#' && reachable[i] === undefined) { tiles[i] = '#'; }
        }
        return reachable;
    }
    R.worldgen = {
        flood: flood,
        /** Creates a seeded connected nine-region graph with gentle traversable difficulty steps. */
        buildRegionGraph: function (seed) {
            var random = R.random(seed);
            var layout = N.GRAPH_LAYOUTS[R.integer(random, 0, N.GRAPH_LAYOUTS.length - 1)];
            var graph = { nodes: [], edges: [], blocked: [], tier: {}, spawn: '0,0', ship: '', scaffold: [] };
            var x;
            var y;
            var i;
            var j;
            for (y = -1; y <= 1; y++) { for (x = -1; x <= 1; x++) { graph.nodes.push(x + ',' + y); } }
            for (i = 0; i < graph.nodes.length; i++) {
                var a = graph.nodes[i].split(',');
                for (j = i + 1; j < graph.nodes.length; j++) {
                    var b = graph.nodes[j].split(',');
                    if (Math.abs(Number(a[0]) - Number(b[0])) + Math.abs(Number(a[1]) - Number(b[1])) === 1) {
                        graph.edges.push([graph.nodes[i], graph.nodes[j]]);
                    }
                }
            }
            for (i = 0; i < layout.blocked.length; i++) {
                var edge = graph.edges[layout.blocked[i]].slice();
                graph.blocked.push(edge);
                if (random() < 0.5) { graph.scaffold.push(edge.join('|')); }
            }
            for (i = 0; i < layout.order.length; i++) { graph.tier[graph.nodes[layout.order[i]]] = i + 1; }
            graph.ship = graph.nodes[layout.order[layout.order.length - 1]];
            this.assertGraph(graph);
            return graph;
        },
        /** Asserts connectivity, tier uniqueness and the difficulty bound on open roads. */
        assertGraph: function (graph) {
            var seen = {};
            var tiers = {};
            var queue = [graph.spawn];
            var i;
            var j;
            seen[graph.spawn] = true;
            if (graph.nodes.length !== 9 || graph.blocked.length < 2 || graph.blocked.length > 3 || graph.tier[graph.spawn] !== 1) { throw new Error('Invalid region graph'); }
            for (i = 0; i < graph.nodes.length; i++) {
                var tier = graph.tier[graph.nodes[i]];
                if (tier < 1 || tier > 9 || tiers[tier]) { throw new Error('Invalid region tier'); }
                tiers[tier] = true;
            }
            for (i = 0; i < queue.length; i++) {
                for (j = 0; j < graph.edges.length; j++) {
                    var edge = graph.edges[j];
                    if (this.isBlocked(graph, edge[0], edge[1])) { continue; }
                    if (Math.abs(graph.tier[edge[0]] - graph.tier[edge[1]]) > 2) { throw new Error('Invalid difficulty step'); }
                    var target = edge[0] === queue[i] ? edge[1] : edge[1] === queue[i] ? edge[0] : null;
                    if (target && !seen[target]) { seen[target] = true; queue.push(target); }
                }
            }
            if (queue.length !== graph.nodes.length) { throw new Error('Disconnected region graph'); }
            return true;
        },
        /** Checks whether a region edge is currently impassable. */
        isBlocked: function (graph, a, b) {
            var i;
            for (i = 0; i < graph.blocked.length; i++) {
                if ((graph.blocked[i][0] === a && graph.blocked[i][1] === b) || (graph.blocked[i][0] === b && graph.blocked[i][1] === a)) { return true; }
            }
            return false;
        },
        /** Lazily generates a deterministic connected region and its site quota. */
        buildRegion: function (save, key) {
            var random = R.random(R.hash(save.seed, key));
            var tier = save.regionGraph.tier[key];
            var theme = R.CONTENT.themes[tier];
            var size = N.REGION_SIZE;
            var middle = N.REGION_CENTER;
            var tiles = terrain(size, theme.built, random);
            var coordinate = key.split(',');
            var d;
            for (d = 0; d < directions.length; d++) {
                var target = (Number(coordinate[0]) + directions[d][0]) + ',' + (Number(coordinate[1]) + directions[d][1]);
                if (save.regionGraph.nodes.indexOf(target) < 0) { continue; }
                var ex = directions[d][0] < 0 ? 1 : directions[d][0] > 0 ? size - 2 : middle;
                var ey = directions[d][1] < 0 ? 1 : directions[d][1] > 0 ? size - 2 : middle;
                corridor(tiles, size, middle, middle, ex, ey);
                tiles[ey * size + ex] = '+';
            }
            connect(tiles, size, middle, middle);
            var region = { key: key, generated: true, theme: theme.id, tier: tier,
                tiles: '', size: size, mask: R.mask.empty(size), sites: [] };
            var quota = N.SITE_QUOTAS[tier <= 3 ? 0 : tier <= 6 ? 1 : 2];
            var used = {};
            used[middle + ',' + middle] = true;
            var i;
            for (i = 0; i < quota[0] + quota[1] + quota[2] + (tier === 9 ? 1 : 0); i++) {
                var type = i < quota[0] ? theme.resources[i % theme.resources.length] : i < quota[0] + quota[1] ? 'threat' : i < quota[0] + quota[1] + quota[2] ? 'dungeon' : 'ship';
                var sx = 0;
                var sy = 0;
                var attempt;
                for (attempt = 0; attempt < size * size; attempt++) {
                    if (tier === 1 && i < quota[0] && attempt === 0) {
                        sx = middle + [-3, 4, 0, 0][i]; sy = middle + [0, 0, -5, 5][i];
                        corridor(tiles, size, middle, middle, sx, sy);
                    } else {
                        var radius = type === 'threat' ? N.THREAT_RADIUS : type === 'dungeon' || type === 'ship' ? N.DUNGEON_RADIUS : N.SITE_RADIUS;
                        sx = R.integer(random, middle - radius, middle + radius); sy = R.integer(random, middle - radius, middle + radius);
                    }
                    if (tiles[sy * size + sx] !== '.' || used[sx + ',' + sy]) { continue; }
                    var near = false;
                    var s;
                    for (s = 0; s < region.sites.length; s++) {
                        if (Math.abs(region.sites[s].x - sx) + Math.abs(region.sites[s].y - sy) < N.SITE_SEPARATION) { near = true; }
                    }
                    if (!near && Math.abs(sx - middle) + Math.abs(sy - middle) >= 3) { break; }
                }
                used[sx + ',' + sy] = true;
                if (type === 'threat' || type === 'dungeon' || type === 'ship') { corridor(tiles, size, middle, middle, sx, sy); }
                var site = { id: key + ':' + i, type: type, x: sx, y: sy, state: 'unknown', workers: 0, ownerCamp: null };
                if (type === 'dungeon') {
                    site.dungeon = tier === 4 ? 'archive' : tier === 6 ? 'foundry' : tier === 8 ? 'reactor' : tier === 9 ? 'vault' : 'shelter';
                    if (i > quota[0] + quota[1]) { site.dungeon = 'vault'; }
                }
                region.sites.push(site);
            }
            region.tiles = R.rle.encode(tiles);
            return region;
        },
        /** Builds a dungeon floor with a reachable farthest objective and a sealed border. */
        buildFloor: function (save, id, depth, infinite) {
            var dungeon = save.dungeons[id];
            var size = N.DUNGEON_SIZES[Math.min(N.DUNGEON_SIZES.length - 1, Math.floor(depth / 3))];
            var nonce = infinite ? save.flags.rng : 0;
            var random = R.random(R.hash(save.seed, id + ':' + depth + ':' + nonce));
            var tiles = terrain(size, dungeon.kind !== 'abyss', random);
            var middle = Math.floor(size / 2);
            var distances = connect(tiles, size, middle, middle);
            var farthest = middle * size + middle;
            var index;
            for (index in distances) { if (distances[index] > distances[farthest]) { farthest = Number(index); } }
            tiles[middle * size + middle] = '<';
            tiles[farthest] = '>';
            return { depth: depth, size: size, tiles: R.rle.encode(tiles), mask: R.mask.empty(size),
                party: { x: middle, y: middle }, objective: { x: farthest % size, y: Math.floor(farthest / size) }, cleared: false };
        }
    };
})();
