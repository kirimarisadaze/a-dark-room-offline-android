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
        /** Grows nine connected regions in random directions rather than a fixed square. */
        buildRegionGraph: function (seed) {
            var random = R.random(R.hash(seed, 'world-layout'));
            var graph = { layout: 2, nodes: ['0,0'], edges: [], blocked: [], tier: {}, spawn: '0,0', ship: '', scaffold: [] };
            var occupied = { '0,0': true };
            var i;
            var j;
            while (graph.nodes.length < N.WORLD_REGIONS) {
                var frontier = [];
                for (i = 0; i < graph.nodes.length; i++) {
                    var origin = graph.nodes[i].split(',');
                    for (j = 0; j < directions.length; j++) {
                        var target = (Number(origin[0]) + directions[j][0]) + ',' + (Number(origin[1]) + directions[j][1]);
                        if (!occupied[target]) { frontier.push([graph.nodes[i], target]); }
                    }
                }
                var edge = frontier[R.integer(random, 0, frontier.length - 1)];
                graph.nodes.push(edge[1]); occupied[edge[1]] = true; graph.edges.push(edge);
            }
            for (i = 0; i < graph.nodes.length; i++) {
                var a = graph.nodes[i].split(',');
                for (j = i + 1; j < graph.nodes.length; j++) {
                    var b = graph.nodes[j].split(',');
                    if (Math.abs(Number(a[0]) - Number(b[0])) + Math.abs(Number(a[1]) - Number(b[1])) === 1 && !this.linked(graph, graph.nodes[i], graph.nodes[j])) {
                        var extra = [graph.nodes[i], graph.nodes[j]];
                        graph.edges.push(extra);
                        if (random() < 0.65) { graph.blocked.push(extra); graph.scaffold.push(extra.join('|')); }
                    }
                }
            }
            var queue = [graph.spawn];
            var seen = { '0,0': true };
            for (i = 0; i < queue.length; i++) {
                graph.tier[queue[i]] = i + 1;
                for (j = 0; j < graph.edges.length; j++) {
                    var road = graph.edges[j];
                    if (this.isBlocked(graph, road[0], road[1])) { continue; }
                    var next = road[0] === queue[i] ? road[1] : road[1] === queue[i] ? road[0] : null;
                    if (next && !seen[next]) { seen[next] = true; queue.push(next); }
                }
            }
            graph.ship = queue[queue.length - 1];
            this.assertGraph(graph); return graph;
        },
        /** Validates coordinate adjacency, unique tiers and connectivity for new and legacy worlds. */
        assertGraph: function (graph) {
            if (!graph || !Array.isArray(graph.nodes) || graph.nodes.length !== N.WORLD_REGIONS || !Array.isArray(graph.edges) || !Array.isArray(graph.blocked) || !Array.isArray(graph.scaffold) || !graph.tier || graph.tier[graph.spawn] !== 1 || graph.tier[graph.ship] !== N.WORLD_REGIONS) { throw new Error('Invalid region graph'); }
            var seen = {};
            var nodes = {};
            var tiers = {};
            var roads = {};
            var i;
            var j;
            for (i = 0; i < graph.nodes.length; i++) {
                var node = graph.nodes[i]; var tier = graph.tier[node];
                if (!/^-?[0-9]+,-?[0-9]+$/.test(node) || nodes[node] || tier < 1 || tier > N.WORLD_REGIONS || tier % 1 || tiers[tier]) { throw new Error('Invalid region tier'); }
                var pos = node.split(',');
                if (Math.abs(Number(pos[0])) >= N.WORLD_REGIONS || Math.abs(Number(pos[1])) >= N.WORLD_REGIONS) { throw new Error('Invalid coordinate'); }
                nodes[node] = true; tiers[tier] = true;
            }
            for (i = 0; i < graph.edges.length; i++) {
                var edge = graph.edges[i];
                if (!Array.isArray(edge) || edge.length !== 2 || !nodes[edge[0]] || !nodes[edge[1]]) { throw new Error('Invalid edge'); }
                var a = edge[0].split(','); var b = edge[1].split(','); var token = edge.slice().sort().join('|');
                if (Math.abs(Number(a[0]) - Number(b[0])) + Math.abs(Number(a[1]) - Number(b[1])) !== 1 || roads[token]) { throw new Error('Invalid edge'); }
                roads[token] = true;
            }
            for (i = 0; i < graph.blocked.length; i++) {
                var block = graph.blocked[i];
                if (!Array.isArray(block) || block.length !== 2 || !roads[block.slice().sort().join('|')]) { throw new Error('Invalid blocked road'); }
            }
            var queue = [graph.spawn]; seen[graph.spawn] = true;
            for (i = 0; i < queue.length; i++) {
                for (j = 0; j < graph.edges.length; j++) {
                    var road = graph.edges[j];
                    if (this.isBlocked(graph, road[0], road[1])) { continue; }
                    var next = road[0] === queue[i] ? road[1] : road[1] === queue[i] ? road[0] : null;
                    if (next && !seen[next]) { seen[next] = true; queue.push(next); }
                }
            }
            if (queue.length !== graph.nodes.length) { throw new Error('Disconnected region graph'); }
            return true;
        },
        /** Checks whether two regions share a physical road, including a blocked one. */
        linked: function (graph, a, b) {
            var i;
            for (i = 0; i < graph.edges.length; i++) { if (graph.edges[i].indexOf(a) >= 0 && graph.edges[i].indexOf(b) >= 0) { return true; } }
            return false;
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
                if (!this.linked(save.regionGraph, key, target)) { continue; }
                var ex = directions[d][0] < 0 ? 1 : directions[d][0] > 0 ? size - 2 : middle;
                var ey = directions[d][1] < 0 ? 1 : directions[d][1] > 0 ? size - 2 : middle;
                corridor(tiles, size, middle, middle, ex, ey);
                tiles[ey * size + ex] = '+';
            }
            connect(tiles, size, middle, middle);
            var region = { key: key, generated: true, theme: theme.id, tier: tier,
                tiles: '', size: size, mask: R.mask.empty(size), sites: [] };
            var refuge = { x: middle, y: middle };
            if (tier === 1) {
                var refugeRandom = R.random(R.hash(save.seed, 'refuge:' + key));
                var candidates = [];
                var rx;
                var ry;
                for (ry = 12; ry < size - 12; ry++) { for (rx = 12; rx < size - 12; rx++) { if (tiles[ry * size + rx] === '.') { candidates.push({ x: rx, y: ry }); } } }
                refuge = candidates[R.integer(refugeRandom, 0, candidates.length - 1)];
                corridor(tiles, size, middle, middle, refuge.x, refuge.y);
                region.refuge = refuge;
            }
            var quota = N.SITE_QUOTAS[tier <= 3 ? 0 : tier <= 6 ? 1 : 2];
            var used = {};
            used[refuge.x + ',' + refuge.y] = true; used[middle + ',' + middle] = true;
            var i;
            for (i = 0; i < quota[0] + quota[1] + quota[2] + (tier === 9 ? 1 : 0); i++) {
                var type = i < quota[0] ? theme.resources[i % theme.resources.length] : i < quota[0] + quota[1] ? 'threat' : i < quota[0] + quota[1] + quota[2] ? 'dungeon' : 'ship';
                var sx = 0;
                var sy = 0;
                var attempt;
                for (attempt = 0; attempt < size * size; attempt++) {
                    if (tier === 1 && i < quota[0] && attempt === 0) {
                        sx = refuge.x + [-3, 4, 0, 0][i]; sy = refuge.y + [0, 0, -5, 5][i];
                        corridor(tiles, size, refuge.x, refuge.y, sx, sy);
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
                    var origin = tier === 1 && i < quota[0] ? refuge : { x: middle, y: middle };
                    if (!near && Math.abs(sx - origin.x) + Math.abs(sy - origin.y) >= 3) { break; }
                }
                used[sx + ',' + sy] = true;
                if (type === 'threat' || type === 'dungeon' || type === 'ship') { corridor(tiles, size, middle, middle, sx, sy); }
                var site = { id: key + ':' + i, type: type, x: sx, y: sy, state: 'unknown', workers: 0, ownerCamp: null };
                if (type === 'dungeon') {
                    var pool = [null, ['clinic'], ['market'], ['tenement'], ['archive', 'clinic'], ['metro', 'shelter'], ['foundry', 'market'], ['tenement', 'vault'], ['reactor', 'shelter'], ['vault', 'metro']];
                    site.dungeon = pool[tier][(i - quota[0] - quota[1]) % pool[tier].length];
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
