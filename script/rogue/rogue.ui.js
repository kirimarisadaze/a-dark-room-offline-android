/* SPDX-License-Identifier: MPL-2.0 */
/** Builds the responsive Rogue interface using the edition's quiet typography and controls. */
(function () {
    'use strict';
    var R = window.Rogue;
    var N = R.NUM;
    var C = R.CONTENT;
    var root;
    var frame;
    var overlay;
    var panels = {};
    var activeTab = 'map';
    var campView = 'overview';
    var campFilter = 'weapons';
    var menuPage = 0;
    var storageOptions = { member: 'player', quantity: 10, filter: 'all', page: 0 };
    var peekView = 'nearby';
    var modal = null;
    var modalOptions = null;
    var modalStack = [];
    var modalScroll = null;
    var tabScroll = { map: 0, camp: 0, party: 0 };
    var selected = null;
    var returnFocus = null;
    var sections = {};
    var noticeKey = null;
    /** Creates an element using textContent for all supplied text. */
    function el(tag, className, text) {
        var node = document.createElement(tag);
        if (className) { node.className = className; }
        if (text !== undefined && text !== null) { node.textContent = text; }
        return node;
    }
    /** Creates a stable, delegated action button with a localized accessible name. */
    function button(key, action, values, disabled, stable) {
        var node = el('button', 'rogue-button', R.t(key, values));
        node.type = 'button';
        node.setAttribute('data-rogue-action', 'true');
        node._rogueAction = action;
        node.disabled = !!disabled;
        node.setAttribute('data-focus', stable || action.type + ':' + (action.item || action.site || action.building || action.research || action.dir || action.kind || action.view || action.filter || (action.action && (action.action.item || action.action.type)) || action.slot || action.tab || ''));
        return node;
    }
    /** Formats resource quantities without noisy floating-point tails. */
    function format(value) { return value >= 10 ? String(Math.floor(value)) : String(Math.floor(value * 10) / 10); }
    /** Keeps quarter-unit biome water costs visible without rounding down the remaining supply. */
    function waterText(value) { return String(Math.round(value * 100) / 100); }
    /** Builds a localized resource-cost sentence. */
    function costText(cost) {
        var values = [];
        var id;
        for (id in cost) { values.push(R.t('item.' + id) + ' ' + format(cost[id])); }
        return values.join(' · ');
    }
    /** Appends a section heading and returns its container. */
    function section(parent, key) {
        var box = el('section', 'rogue-section');
        box.appendChild(el('h3', 'rogue-section-title', R.t(key)));
        parent.appendChild(box); return box;
    }
    /** Builds a disclosure that keeps its state between action renders. */
    function disclosure(parent, id, key) {
        var details = el('details', 'rogue-disclosure');
        details.setAttribute('data-section', id);
        details.open = !!sections[id];
        details.appendChild(el('summary', '', R.t(key)));
        var content = el('div', 'rogue-disclosure-content');
        details.appendChild(content); parent.appendChild(details);
        return content;
    }
    /** Appends a label and tabular value on one clear row. */
    function stat(parent, key, value) {
        var row = el('div', 'rogue-stat');
        row.appendChild(el('span', 'rogue-muted', R.t(key)));
        row.appendChild(el('span', 'rogue-stat-value', value));
        parent.appendChild(row); return row;
    }
    /** Creates an accessible health meter without canvas or images. */
    function health(parent, hp, max, label) {
        var meter = el('div', 'rogue-health');
        meter.setAttribute('role', 'meter'); meter.setAttribute('aria-label', label || R.t('ui.hp'));
        meter.setAttribute('aria-valuemin', '0'); meter.setAttribute('aria-valuemax', String(max)); meter.setAttribute('aria-valuenow', String(hp));
        var fill = el('span', 'rogue-health-fill');
        fill.style.width = R.clamp(hp / max * 100, 0, 100) + '%';
        meter.appendChild(fill); parent.appendChild(meter);
    }
    /** Returns a localized title for a revealed site. */
    function siteName(site) { return R.t(site.type === 'dungeon' ? 'dungeon.' + site.dungeon : 'site.' + site.type); }
    /** Builds a priced action row with a useful material shortfall. */
    function priced(parent, key, descriptionKey, cost, action, disabled, values) {
        var save = R.state.current;
        var row = el('div', 'rogue-priced');
        var copy = el('div', 'rogue-priced-copy');
        copy.appendChild(el('div', 'rogue-row-title', R.t(key, values)));
        if (descriptionKey) { copy.appendChild(el('p', 'rogue-note', R.t(descriptionKey))); }
        var shortfall = {};
        var id;
        for (id in cost) { var lacking = Math.ceil(cost[id] - (R.stores(save)[id] || 0)); if (lacking > 0) { shortfall[id] = lacking; } }
        var available = Object.keys(shortfall).length === 0;
        copy.appendChild(el('p', 'rogue-cost' + (available ? '' : ' rogue-shortfall'), R.t(available ? 'ui.cost' : 'ui.need', { cost: costText(available ? cost : shortfall) })));
        row.appendChild(copy);
        row.appendChild(button(action.type === 'craft' ? 'ui.craftOne' : action.type === 'research' ? 'ui.researchAction' : action.type === 'fire' ? 'ui.fireUpgrade' : 'ui.build', action, null, disabled || !available));
        parent.appendChild(row);
    }
    /** Returns the next concrete goal for the current run. */
    function quest(save) {
        if (save.party.weapon === 'fists') { return 'start'; }
        var occupied = false;
        var key;
        var i;
        for (key in save.regions) { for (i = 0; i < save.regions[key].sites.length; i++) { if (save.regions[key].sites[i].workers > 0) { occupied = true; } } }
        if (!occupied) { return 'work'; }
        if (Object.keys(save.regions).length === 1) { return 'travel'; }
        if (save.blueprints.indexOf('hull') < 0 || save.blueprints.indexOf('drive') < 0 || save.blueprints.indexOf('core') < 0) { return 'blueprint'; }
        return 'ship';
    }
    /** Renders the local character window and the controls directly beneath it. */
    function renderMap(save) {
        var panel = panels.map;
        panel.textContent = '';
        var view = R.map.current(save);
        var title = el('div', 'rogue-panel-heading');
        var titleText = save.flags.insideDungeon ? R.t('dungeon.' + save.dungeons[save.flags.insideDungeon].kind) : R.t('room.' + view.map.theme);
        var heading = el('div');
        heading.appendChild(el('h2', '', titleText));
        if (save.flags.insideDungeon) { heading.appendChild(el('p', 'rogue-eyebrow', R.t('ui.depth') + ' ' + view.map.depth)); }
        else { heading.appendChild(el('p', 'rogue-eyebrow', R.t('ui.biomeWater', { name: R.t('biome.' + R.wild.biome(save, view.map)), n: R.wild.waterCost(save) }))); }
        title.appendChild(heading);
        title.appendChild(button('ui.regionMap', { type: 'modal', kind: 'world' })); panel.appendChild(title);
        var status = el('div', 'rogue-status-grid');
        stat(status, 'ui.hp', save.party.hp + '/' + save.party.maxHp);
        stat(status, 'ui.water', waterText(save.party.water) + '/' + R.waterMax(save));
        stat(status, 'ui.food', save.party.food);

        var viewport = el('div', 'rogue-map-viewport');
        viewport.setAttribute('role', 'img'); viewport.setAttribute('aria-label', R.t('ui.mapLabel'));
        var grid = el('div', 'rogue-grid'); grid.setAttribute('aria-hidden', 'true');
        var rows = R.map.window(save);
        var y;
        var x;
        for (y = 0; y < rows.length; y++) {
            var line = el('div', 'rogue-map-row');
            for (x = 0; x < rows[y].length; x++) {
                var cell = rows[y][x];
                if (!cell) { line.appendChild(document.createTextNode('\u00a0')); continue; }
                var glyph = el('span', 't-' + cell.cls + (cell.dim ? ' dim' : ''), cell.symbol);
                glyph.setAttribute('data-x', String(cell.x)); glyph.setAttribute('data-y', String(cell.y));
                if (cell.site) { glyph.setAttribute('data-site', cell.site); }
                if (selected && selected.x === cell.x && selected.y === cell.y) { glyph.className += ' rogue-map-selected'; }
                line.appendChild(glyph);
            }
            grid.appendChild(line);
        }
        viewport.appendChild(grid);
        var coordinates = el('div', 'rogue-map-coordinate', view.position.x + ' / ' + view.position.y);
        viewport.appendChild(coordinates); panel.appendChild(viewport); panel.appendChild(status);
        var tools = el('div', 'rogue-map-tools');
        tools.appendChild(el('span', 'rogue-note', R.t(save.flags.insideDungeon ? view.map.cleared ? 'ui.dungeonCleared' : 'ui.objective' : 'ui.legendFog')));
        tools.appendChild(button('ui.legend', { type: 'modal', kind: 'guide' }));
        var controlRow = el('div', 'rogue-control-row');
        var dpad = el('div', 'rogue-dpad');
        var directionIds = ['north', 'west', 'east', 'south'];
        var symbols = ['↑', '←', '→', '↓'];
        var i;
        for (i = 0; i < directionIds.length; i++) {
            var direction = button('ui.' + directionIds[i], { type: 'move', dir: directionIds[i] });
            direction.setAttribute('aria-label', R.t('ui.' + directionIds[i])); direction.textContent = symbols[i];
            direction.className += ' rogue-direction rogue-' + directionIds[i]; dpad.appendChild(direction);
        }
        var rest = button('ui.wait', { type: 'wait' }); rest.className += ' rogue-dpad-center'; rest.textContent = '·'; rest.setAttribute('aria-label', R.t('ui.wait')); dpad.appendChild(rest);
        controlRow.appendChild(dpad);
        var context = el('div', 'rogue-context'); renderContext(save, context); controlRow.appendChild(context);
        panel.appendChild(controlRow); if (save.flags.insideDungeon) { panel.appendChild(tools); }
        if (save.flags.insideDungeon) {
            var dungeonActions = el('div', 'rogue-action-grid');
            var dungeon = save.dungeons[save.flags.insideDungeon];
            dungeonActions.appendChild(button('ui.extract', { type: 'extract' }, null, !save.flags.abyss && (save.party.water < dungeon.depth || save.party.food < dungeon.depth)));
            if (dungeon.afterClear === 'infinite') { dungeonActions.appendChild(button('ui.descend', { type: 'descend' }, null, !dungeon.floor.cleared)); }
            panel.appendChild(dungeonActions);
            panel.appendChild(el('p', 'rogue-note', R.t(save.flags.abyss ? 'ui.abyssHint' : 'ui.extractCost', { n: dungeon.depth })));
        } else {
            var shortcuts = el('nav', 'rogue-explore-shortcuts');
            shortcuts.setAttribute('aria-label', R.t('ui.exploreNotes'));
            var views = ['nearby', 'clues', 'goals']; var labels = ['ui.around', 'ui.clues', 'ui.goals'];
            for (i = 0; i < views.length; i++) { var shortcut = button(labels[i], { type: 'peek', view: views[i] }); shortcut.setAttribute('aria-pressed', views[i] === peekView ? 'true' : 'false'); shortcuts.appendChild(shortcut); }
            panel.appendChild(shortcuts); renderPeek(panel, save);
        }
    }
    /** Uses spare height for one short exploration preview while preserving full secondary pages. */
    function renderPeek(panel, save) {
        if (window.innerHeight < 850 || window.innerWidth >= 1100) { return; }
        var preview = el('section', 'rogue-explore-preview' + (peekView === 'goals' ? ' rogue-preview-goals' : '')); preview.id = 'rogue-explore-preview';
        preview.setAttribute('aria-label', R.t(peekView === 'nearby' ? 'ui.around' : 'ui.' + peekView));
        if (peekView === 'nearby') {
            renderNearby(preview, save, 1);
        } else if (peekView === 'clues') {
            var traces = R.map.clues(save);
            if (traces.length) { preview.appendChild(el('p', 'rogue-note', R.t(traces[0].key, traces[0].values))); }
        } else {
            var goal = quest(save);
            preview.appendChild(el('h3', 'rogue-section-title', R.t('ui.quest.' + goal)));
            preview.appendChild(el('p', 'rogue-note', R.t('ui.quest.' + goal + '.desc')));
        }
        preview.appendChild(button('ui.peekAll', { type: 'modal', kind: peekView }, { page: R.t(peekView === 'nearby' ? 'ui.around' : 'ui.' + peekView) })); panel.appendChild(preview);
    }
    /** Enlarges the map only into measured spare space above the persistent navigation. */
    function fitMap() {
        if (activeTab !== 'map' || window.innerHeight < 850 || window.innerWidth >= 1100 || !R.state.current || R.state.current.flags.insideDungeon) { return; }
        var panel = panels.map; var grid = panel.querySelector('.rogue-grid');
        if (!grid) { return; }
        var spare = window.innerHeight - document.getElementById('rogue-bottom').offsetHeight - panel.getBoundingClientRect().top - window.pageYOffset - panel.offsetHeight - 12;
        var preview = panel.querySelector('.rogue-explore-preview');
        if (spare < -12 && preview) {
            var height = preview.offsetHeight + 8; preview.parentNode.removeChild(preview); spare += height;
            var shortcuts = panel.querySelectorAll('.rogue-explore-shortcuts button'); var i;
            for (i = 0; i < shortcuts.length; i++) { shortcuts[i].setAttribute('aria-pressed', 'false'); }
        }
        var width = panel.querySelector('.rogue-map-viewport').clientWidth - 16;
        grid.style.fontSize = Math.max(12, Math.min(22, width / (N.MAP_WINDOW * 1.16), 12 + spare / (N.MAP_WINDOW * 1.1))) + 'px';
    }
    /** Lists discovered local destinations without extending the exploration screen. */
    function renderNearby(content, save, limit) {
        var sites = save.regions[save.party.region].sites.slice();
        /** Orders revealed sites by their current walking distance. */
        sites.sort(function (a, b) { return Math.abs(a.x - save.party.x) + Math.abs(a.y - save.party.y) - Math.abs(b.x - save.party.x) - Math.abs(b.y - save.party.y); });
        var known = 0; var i;
        for (i = 0; i < sites.length; i++) {
            var site = sites[i]; if (site.state === 'unknown') { continue; } known += 1;
            if (limit && known > limit) { break; }
            var node = button('ui.here', { type: 'selectSite', site: site.id }, null, false, 'nearby:' + site.id);
            node.className += ' rogue-nearby'; node.textContent = '';
            node.appendChild(el('span', 'rogue-symbol', C.sites[site.type].symbol)); node.appendChild(el('span', '', siteName(site)));
            node.appendChild(el('span', 'rogue-note', R.t('ui.distance', { n: Math.abs(site.x - save.party.x) + Math.abs(site.y - save.party.y) }))); content.appendChild(node);
        }
        if (!known) { content.appendChild(el('p', 'rogue-note', R.t('ui.noSites'))); }
    }
    /** Renders the contextual action next to the direction pad. */
    function renderContext(save, box) {
        if (save.flags.insideDungeon) {
            box.appendChild(el('p', 'rogue-context-title', R.t('ui.depth') + ' ' + save.dungeons[save.flags.insideDungeon].depth));
            box.appendChild(el('p', 'rogue-note', R.t('ui.objective'))); return;
        }
        var camp = R.atCamp(save);
        var here = R.map.here(save);
        if (selected && selected.region !== save.party.region) { selected = null; }
        if (selected && (selected.x !== save.party.x || selected.y !== save.party.y)) {
            var destination = selected.site ? R.map.site(save, selected.site) : null;
            box.appendChild(el('p', 'rogue-context-title', destination ? siteName(destination) : R.t('ui.selected')));
            var path = R.map.path(save, selected.x, selected.y);
            box.appendChild(el('p', 'rogue-note', path ? R.t('ui.distance', { n: path.length }) : R.t('err.route')));
            box.appendChild(button('ui.route', { type: 'route', x: selected.x, y: selected.y }, null, !path)); return;
        }
        if (camp) {
            box.appendChild(el('p', 'rogue-context-title', R.t('ui.campName', { n: camp.id + 1 })));
            box.appendChild(button('ui.restock', { type: 'restock' }));
            box.appendChild(button('ui.storageOpen', { type: 'campView', view: 'stores' })); return;
        }
        if (R.atTemp(save)) {
            box.appendChild(el('p', 'rogue-context-title', R.t('ui.tempCamp')));
            box.appendChild(el('p', 'rogue-note', R.t('ui.tempRemaining', { n: save.flags.tempCamp.expiresAt - save.turn })));
            box.appendChild(el('p', 'rogue-note', R.t('ui.tempRestCost')));
            box.appendChild(button('ui.restTemp', { type: 'restTemp' }, null, save.party.water < N.TEMP_REST_SUPPLY || save.party.food < N.TEMP_REST_SUPPLY));
            box.appendChild(button('ui.tempStoreAction', { type: 'storageView', scope: 'temp' })); return;
        }
        if (R.party.cache(save)) {
            box.appendChild(el('p', 'rogue-context-title', R.t('ui.cache')));
            box.appendChild(button('ui.cacheAction', { type: 'storageView', scope: 'cache' })); return;
        }
        if (here) {
            box.appendChild(el('p', 'rogue-context-title', siteName(here)));
            box.appendChild(el('p', 'rogue-note', R.t(here.type === 'dungeon' ? 'dungeon.' + here.dungeon + '.desc' : 'site.' + here.type + '.desc')));
            var kind = C.sites[here.type].kind;
            if (kind === 'resource') {
                box.appendChild(button('ui.gather', { type: 'gather' }));
                if (here.state === 'cleared') { box.appendChild(button('ui.occupy', { type: 'occupy' })); }
            } else if (kind === 'threat') {
                box.appendChild(here.state === 'cleared' ? el('p', 'rogue-note', R.t('ui.cleared')) : button('ui.clear', { type: 'clear' }));
            } else if (kind === 'dungeon') {
                if (here.state !== 'cleared') { box.appendChild(button('ui.enter', { type: 'enter', site: here.id })); }
            } else if (kind === 'outpost') {
                box.appendChild(button(here.state === 'occupied' ? 'ui.cleared' : 'ui.enterOutpost', { type: 'outpost', op: 'enter' }, null, here.state === 'occupied'));
            } else if (kind === 'ending') {
                box.appendChild(button('ui.launch', { type: 'confirmLaunch' }, null, !save.party.bag.hull || !save.party.bag.drive || !save.party.bag.core));
                box.appendChild(el('p', 'rogue-note', R.t('ui.shipNeed')));
            }
            return;
        }
        var view = R.map.current(save);
        if (view.tiles[save.party.y * view.map.size + save.party.x] === '+') {
            var dir = save.party.x === 1 ? 'west' : save.party.x === N.REGION_SIZE - 2 ? 'east' : save.party.y === 1 ? 'north' : 'south';
            box.appendChild(el('p', 'rogue-context-title', R.t('ui.' + dir) + ' · ' + R.t('ui.legendExit')));
            box.appendChild(button('ui.crossExit', { type: 'move', dir: dir }, null, false, 'cross:' + dir)); return;
        }
        var home = save.camps[save.activeCamp];
        box.appendChild(el('p', 'rogue-context-title', R.t('ui.around')));
        box.appendChild(el('p', 'rogue-note', R.t('ui.awayCamp')));
        if (home.region === save.party.region) { box.appendChild(button('ui.returnCamp', { type: 'route', x: home.x, y: home.y }, null, !R.map.path(save, home.x, home.y))); }
        if (save.party.bag.campKit) { box.appendChild(button('ui.deployTemp', { type: 'confirmTemp' }, null, !R.settle.canPitch(save))); }
    }
    /** Returns the named phase at a given action count without changing time. */
    function phase(turn) {
        var part = turn % N.TURNS_PER_DAY;
        return part < 10 ? 'dawn' : part < 25 ? 'day' : part < 35 ? 'dusk' : 'night';
    }
    /** Renders a persistent day, action counter and accessible day-progress bar. */
    function renderTime(save) {
        var bar = document.getElementById('rogue-timebar'); bar.textContent = ''; bar.hidden = !save || (save.over && !save.flags.abyss);
        if (bar.hidden) { return; }
        var info = button('ui.timeTitle', { type: 'modal', kind: 'time' }); info.className += ' rogue-time-info'; info.textContent = '';
        info.appendChild(el('span', '', R.t('ui.day', { n: save.day + 1 }) + ' · ' + R.t('ui.phase.' + phase(save.turn))));
        info.appendChild(el('span', 'rogue-note', R.t('ui.todayActions', { n: save.turn % N.TURNS_PER_DAY, max: N.TURNS_PER_DAY })));
        bar.appendChild(info);
        var progress = el('div', 'rogue-day-progress'); progress.setAttribute('role', 'progressbar'); progress.setAttribute('aria-label', R.t('ui.timeTitle'));
        progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', String(N.TURNS_PER_DAY)); progress.setAttribute('aria-valuenow', String(save.turn % N.TURNS_PER_DAY));
        var fill = el('span'); fill.style.width = (save.turn % N.TURNS_PER_DAY) / N.TURNS_PER_DAY * 100 + '%'; progress.appendChild(fill); bar.appendChild(progress);
    }
    /** Adds the preview of a deliberate rest so its time cost is visible before acting. */
    function restPreview(parent, save) {
        var end = save.turn + N.NIGHT_TURNS[save.speed];
        parent.appendChild(el('p', 'rogue-note', R.t('ui.restPreview', { n: N.NIGHT_TURNS[save.speed], day: Math.floor(end / N.TURNS_PER_DAY) + 1, phase: R.t('ui.phase.' + phase(end)) })));
    }
    /** Limits long management lists to a small page with explicit navigation. */
    function pageSlice(values) {
        var size = menuSize();
        menuPage = Math.min(menuPage, Math.max(0, Math.ceil(values.length / size) - 1));
        return values.slice(menuPage * size, (menuPage + 1) * size);
    }
    /** Reduces management page length on short screens and with large text. */
    function menuSize() { return window.innerHeight < 640 ? 2 : R.ui.preferences.font >= 20 ? 3 : N.MENU_PAGE_SIZE; }
    /** Appends page controls when a management collection needs more than one screen. */
    function pagination(parent, count) {
        var pages = Math.ceil(count / menuSize());
        if (pages < 2) { return; }
        var nav = el('nav', 'rogue-pagination');
        nav.appendChild(button('ui.previous', { type: 'campPage', delta: -1 }, null, menuPage === 0));
        nav.appendChild(el('span', 'rogue-note', R.t('ui.page', { n: menuPage + 1, max: pages })));
        nav.appendChild(button('ui.next', { type: 'campPage', delta: 1 }, null, menuPage >= pages - 1)); parent.appendChild(nav);
    }
    /** Creates one compact entry point to a camp subpage. */
    function campTile(parent, id, key, summary) {
        var tile = button(key, { type: 'campView', view: id }, null, false, 'camp-view:' + id); tile.className += ' rogue-menu-tile'; tile.textContent = '';
        tile.appendChild(el('span', 'rogue-tile-title', R.t(key))); tile.appendChild(el('span', 'rogue-note', summary));
        var arrow = el('span', 'rogue-tile-arrow', '›'); arrow.setAttribute('aria-hidden', 'true'); tile.appendChild(arrow); parent.appendChild(tile);
    }
    /** Renders a short camp dashboard with direct entry points instead of a long list. */
    function renderCamp(save) {
        var panel = panels.camp; panel.textContent = ''; panel.setAttribute('data-camp-view', campView);
        var camp = save.camps[save.activeCamp];
        var here = R.atCamp(save); if (here && here.id !== camp.id) { here = null; }
        var titles = { supplies: 'ui.supplies', stores: 'ui.shared', tempStores: 'ui.tempStorage', workers: 'ui.workers', buildings: 'ui.buildings', recipes: 'ui.recipes', research: 'ui.research', expansion: 'ui.campExpansion' };
        var heading = el('div', 'rogue-panel-heading');
        heading.appendChild(el('h2', '', R.t(campView === 'overview' ? 'ui.campName' : titles[campView], { n: camp.id + 1 })));
        if (campView !== 'overview') { var back = button('ui.backTo', { type: 'campView', view: 'overview' }, { page: R.t('ui.campHome') }, false, 'camp-inline-return'); back.className += ' rogue-camp-inline-back'; heading.appendChild(back); }
        else { heading.appendChild(el('span', 'rogue-eyebrow', R.t('ui.campCapacity', { n: save.camps.length }))); }
        panel.appendChild(heading);
        if (campView !== 'overview') { renderCampDetail(panel, save, camp, here); return; }
        if (R.atTemp(save)) { var local = el('div', 'rogue-camp-local'); local.appendChild(el('p', 'rogue-note', R.t('ui.tempRemaining', { n: save.flags.tempCamp.expiresAt - save.turn }))); local.appendChild(button('ui.tempStoreAction', { type: 'campView', view: 'tempStores' })); panel.appendChild(local); }
        if (save.camps.length > 1) {
            var selector = el('div', 'rogue-segment'); var s;
            for (s = 0; s < save.camps.length; s++) {
                var choose = button('ui.campName', { type: 'selectCamp', camp: s }, { n: save.camps[s].id + 1 });
                choose.setAttribute('aria-pressed', s === save.activeCamp ? 'true' : 'false'); selector.appendChild(choose);
            }
            panel.appendChild(selector);
        }
        var status = el('div', 'rogue-camp-status');
        stat(status, 'ui.fire', R.t('ui.fireLevel', { n: camp.fire }));
        stat(status, 'ui.population', R.t('ui.populationValue', { n: camp.pop, max: N.FIRE[camp.fire].pop })); panel.appendChild(status);
        if (!here) { panel.appendChild(el('p', 'rogue-note', R.t('ui.awayCamp'))); }
        var actions = el('div', 'rogue-action-grid rogue-camp-actions');
        var forage = button('ui.forageShort', { type: 'forage' }, null, !here); forage.setAttribute('aria-label', R.t('ui.forage')); actions.appendChild(forage);
        var refill = button('ui.restockShort', { type: 'restock' }, null, !here); refill.setAttribute('aria-label', R.t('ui.restock')); actions.appendChild(refill);
        var rest = button('ui.restShort', { type: 'campView', view: 'supplies' }, null, false, 'camp-view:supplies'); rest.setAttribute('aria-label', R.t('ui.supplies')); actions.appendChild(rest); panel.appendChild(actions);
        var store = R.stores(save); var resources = 0; var sites = 0; var built = 0; var researched = 0; var key; var i;
        for (key in store) { if (store[key] > 0) { resources += 1; } }
        for (key in camp.buildings) { built += camp.buildings[key]; }
        for (key in save.regions) { for (i = 0; i < save.regions[key].sites.length; i++) { if (save.regions[key].sites[i].ownerCamp === camp.id) { sites += 1; } } }
        for (i = 0; i < C.research.length; i++) { if (save.flags['tech.' + C.research[i].id]) { researched += 1; } }
        var menu = el('nav', 'rogue-camp-menu');
        campTile(menu, 'stores', 'ui.shared', R.t('ui.storesSummary', { n: resources }));
        campTile(menu, 'workers', 'ui.workers', R.t('ui.workersSummary', { n: Math.max(0, camp.pop - R.settle.employed(save, camp)), sites: sites }));
        campTile(menu, 'buildings', 'ui.buildings', R.t('ui.buildSummary', { n: camp.fire, built: built }));
        campTile(menu, 'recipes', 'ui.recipes', R.t('ui.recipesSummary'));
        campTile(menu, 'research', 'ui.research', R.t('ui.researchSummary', { n: researched, max: C.research.length }));
        campTile(menu, 'expansion', 'ui.campExpansion', R.t('ui.expansionSummary', { n: save.camps.length })); panel.appendChild(menu);
    }
    /** Renders one selected camp management page, keeping unrelated lists out of view. */
    function renderCampDetail(panel, save, camp, here) {
        var id; var i;
        if (campView === 'supplies') {
            panel.appendChild(el('p', 'rogue-note', R.t(here ? 'ui.inCamp' : 'ui.awayCamp')));
            var actions = el('div', 'rogue-action-grid');
            actions.appendChild(button('ui.restock', { type: 'restock' }, null, !here)); actions.appendChild(button('ui.deposit', { type: 'deposit' }, null, !here));
            actions.appendChild(button('ui.night', { type: 'night' }, null, !here)); panel.appendChild(actions); restPreview(panel, save);
            panel.appendChild(el('p', 'rogue-note', R.t('ui.reserveHint')));
            if (save.flags.trader) { panel.appendChild(button('ui.trade', { type: 'trade' }, null, !here || !R.affords(save, N.TRADE_COST))); }
        } else if (campView === 'stores' || campView === 'tempStores') {
            renderStorage(panel, save, campView === 'stores' ? 'store' : 'temp', storageOptions);
        } else if (campView === 'workers') { renderWorkers(panel, save, camp); }
        else if (campView === 'buildings') {
            var builds = ['fire'].concat(Object.keys(C.buildings)); var visible = pageSlice(builds);
            for (i = 0; i < visible.length; i++) {
                id = visible[i];
                if (id === 'fire') {
                    if (camp.fire < N.FIRE.length - 1) { priced(panel, 'ui.fireLevel', null, { wood: N.FIRE[camp.fire + 1].wood }, { type: 'fire' }, !here, { n: camp.fire + 1 }); }
                    else { panel.appendChild(el('p', 'rogue-note', R.t('ui.fireMax'))); }
                } else {
                    var definition = C.buildings[id];
                    if ((camp.buildings[id] || 0) >= definition.max) { panel.appendChild(el('p', 'rogue-note', R.t('ui.building.' + id) + ' · ' + R.t('ui.built'))); }
                    else { priced(panel, 'ui.building.' + id, 'ui.building.' + id + '.desc', R.settle.cost(save, definition.cost), { type: 'build', building: id }, !here); }
                }
            }
            pagination(panel, builds.length);
        } else if (campView === 'recipes') {
            var filters = ['weapons', 'armour', 'tools', 'consume', 'modules']; var tabs = el('nav', 'rogue-filter-tabs');
            for (i = 0; i < filters.length; i++) { var filter = button('ui.filter.' + filters[i], { type: 'campFilter', filter: filters[i] }, null, false, 'filter:' + filters[i]); filter.setAttribute('aria-pressed', campFilter === filters[i] ? 'true' : 'false'); tabs.appendChild(filter); } panel.appendChild(tabs);
            var items = []; var kinds = { weapons: 'weapon', armour: 'armour', tools: 'tool', consume: 'consume', modules: 'module' };
            for (id in C.items) { var item = C.items[id]; if (item.cost && (item.kind === kinds[campFilter] || (campFilter === 'consume' && item.kind === 'resource')) && (!item.blueprint || save.blueprints.indexOf(item.blueprint) >= 0)) { items.push(id); } }
            var recipes = pageSlice(items);
            for (i = 0; i < recipes.length; i++) { id = recipes[i]; var recipe = C.items[id]; priced(panel, 'item.' + id, ['waterskin', 'canteen', 'pack'].indexOf(id) >= 0 && ((save.flags.made && save.flags.made[id]) || R.party.owned(save, id)) ? id === 'waterskin' ? 'ui.waterskinDone' : 'ui.toolDone' : recipe.workshop && (!here || !here.buildings.workshop) ? 'err.workshop' : null, recipe.cost, { type: 'craft', item: id }, !here || !R.settle.recipeAllowed(save, id)); }
            if (!items.length) { panel.appendChild(el('p', 'rogue-note', R.t('ui.noRecipes'))); } pagination(panel, items.length);
        } else if (campView === 'research') {
            if (!here || !here.buildings.workshop) { panel.appendChild(el('p', 'rogue-note', R.t('err.workshop'))); }
            var research = pageSlice(C.research);
            for (i = 0; i < research.length; i++) { var tech = research[i]; if (save.flags['tech.' + tech.id]) { panel.appendChild(el('p', 'rogue-note', R.t('ui.research.' + tech.id) + ' · ' + R.t('ui.researched'))); } else { priced(panel, 'ui.research.' + tech.id, 'ui.research.' + tech.id + '.desc', tech.cost, { type: 'research', research: tech.id }, !here || !here.buildings.workshop); } } pagination(panel, C.research.length);
        } else if (campView === 'expansion') {
            panel.appendChild(el('h3', 'rogue-section-title', R.t('ui.campCapacity', { n: save.camps.length })));
            panel.appendChild(el('p', 'rogue-note', R.t('ui.campRule'))); panel.appendChild(el('p', 'rogue-note', R.t('ui.campPlace')));
            panel.appendChild(el('p', 'rogue-note', R.t('ui.cost', { cost: costText(N.CAMP_UNLOCK) })));
            panel.appendChild(button('ui.newCamp', { type: 'newCamp' }, null, !R.settle.canPitch(save) || save.camps.length >= N.MAX_CAMPS || !R.affords(save, N.CAMP_UNLOCK)));
            if (here && here.id !== 0) { panel.appendChild(button('ui.moveCamp', { type: 'confirmDismantle' })); }
            var temp = section(panel, 'ui.tempCamp'); temp.appendChild(el('p', 'rogue-note', R.t('ui.tempRule'))); temp.appendChild(el('p', 'rogue-note', R.t('ui.tempPurpose')));
            if (save.flags.tempCamp) { var shelter = save.flags.tempCamp; temp.appendChild(el('p', 'rogue-note', R.t('ui.tempLocation', { region: R.t('room.' + save.regions[shelter.region].theme) }))); temp.appendChild(el('p', 'rogue-note', R.t('ui.tempRemaining', { n: Math.max(0, shelter.expiresAt - save.turn) }))); }
            else { temp.appendChild(el('p', 'rogue-note', R.t('ui.tempEmpty'))); }
            temp.appendChild(el('p', 'rogue-note', R.t('ui.tempKitCount', { n: save.party.bag.campKit || 0 })));
            temp.appendChild(button('ui.deployTemp', { type: 'confirmTemp' }, null, !R.settle.canPitch(save) || !save.party.bag.campKit));
            if (R.atTemp(save)) {
                temp.appendChild(el('p', 'rogue-note', R.t('ui.tempRestCost')));
                temp.appendChild(button('ui.restTemp', { type: 'restTemp' }, null, save.party.water < N.TEMP_REST_SUPPLY || save.party.food < N.TEMP_REST_SUPPLY));
                temp.appendChild(button('ui.tempStoreAction', { type: 'campView', view: 'tempStores' }));
                temp.appendChild(button('ui.packTemp', { type: 'confirmPack' }));
            } else if (save.flags.tempCamp && save.flags.tempCamp.region === save.party.region && !save.flags.insideDungeon) {
                temp.appendChild(button('ui.tempRoute', { type: 'route', x: save.flags.tempCamp.x, y: save.flags.tempCamp.y }, null, !R.map.path(save, save.flags.tempCamp.x, save.flags.tempCamp.y)));
            }
        }
    }
    /** Renders the selected camp's guards and a page of occupied production sites. */
    function renderWorkers(parent, save, camp) {
        var idle = Math.max(0, camp.pop - R.settle.employed(save, camp)); parent.appendChild(el('p', 'rogue-note', R.t('ui.idle', { n: idle })));
        var guard = el('div', 'rogue-worker-row'); guard.appendChild(el('div', '', R.t('ui.guards')));
        var minus = button('ui.removeWorker', { type: 'guard', delta: -1 }, null, !(camp.jobs.guard > 0), 'guard:minus'); minus.textContent = '−'; guard.appendChild(minus);
        guard.appendChild(el('span', 'rogue-worker-count', camp.jobs.guard || 0));
        var plus = button('ui.addWorker', { type: 'guard', delta: 1 }, null, !idle, 'guard:plus'); plus.textContent = '+'; guard.appendChild(plus); parent.appendChild(guard);
        var sites = []; var key; var i;
        for (key in save.regions) { for (i = 0; i < save.regions[key].sites.length; i++) { var site = save.regions[key].sites[i]; if (site.state === 'occupied' && site.ownerCamp === camp.id) { sites.push({ site: site, region: key }); } } }
        var visible = pageSlice(sites);
        for (i = 0; i < visible.length; i++) {
            var entry = visible[i]; var place = entry.site; var row = el('div', 'rogue-worker-card'); var assignment = el('div', 'rogue-worker-row'); var copy = el('div');
            copy.appendChild(el('div', '', siteName(place))); var loss = R.settle.loss(save, entry.region, place);
            copy.appendChild(el('p', 'rogue-note', R.t('ui.income', { n: format(C.sites[place.type].rate * place.workers * (1 - loss) * (1 + R.bonus(save, 'income'))) }))); assignment.appendChild(copy);
            var less = button('ui.removeWorker', { type: 'worker', site: place.id, delta: -1 }, null, !place.workers, 'worker:minus:' + place.id); less.textContent = '−'; less.setAttribute('aria-label', R.t('ui.removeWorker') + ' · ' + siteName(place)); assignment.appendChild(less);
            assignment.appendChild(el('span', 'rogue-worker-count', place.workers)); var more = button('ui.addWorker', { type: 'worker', site: place.id, delta: 1 }, null, !idle, 'worker:plus:' + place.id); more.textContent = '+'; more.setAttribute('aria-label', R.t('ui.addWorker') + ' · ' + siteName(place)); assignment.appendChild(more); row.appendChild(assignment);
            var road = el('div', 'rogue-road-row'); road.appendChild(el('span', 'rogue-note', R.t('ui.loss', { n: Math.round(loss * 100) })));
            road.appendChild(place.road ? el('span', 'rogue-note', R.t('ui.roadBuilt')) : button('ui.road', { type: 'road', site: place.id }, null, !R.affords(save, N.ROAD_COST))); row.appendChild(road); parent.appendChild(row);
        }
        if (!sites.length) { parent.appendChild(el('p', 'rogue-note', R.t('ui.noWorkers'))); } pagination(parent, sites.length);
    }
    /** Renders a bounded action journal in a stable place on every primary panel. */
    function renderLiveLog(save) {
        var node = document.getElementById('rogue-live-log'); node.textContent = '';
        node.hidden = !save || (save.over && !save.flags.abyss);
        if (node.hidden) { return; }
        var heading = el('div', 'rogue-log-heading'); heading.appendChild(el('h3', '', R.t('ui.liveLog')));
        heading.appendChild(button('ui.logAll', { type: 'modal', kind: 'journal' })); node.appendChild(heading);
        var list = el('ol', 'rogue-live-entries'); list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'polite');
        var i;
        for (i = save.flags.log.length - 1; i >= Math.max(0, save.flags.log.length - 4); i--) {
            var entry = save.flags.log[i]; var line = el('li', /Warning|waterUnknown/.test(entry.key) ? 'rogue-log-warning' : '');
            line.appendChild(el('span', 'rogue-log-turn', String(entry.turn)));
            line.appendChild(el('span', '', R.t(entry.key, entry.values))); list.appendChild(line);
        }
        node.appendChild(list);
    }
    /** Renders the party overview with direct entry into personal gear and packs. */
    function renderParty(save) {
        var panel = panels.party; panel.textContent = '';
        var heading = el('div', 'rogue-panel-heading'); heading.appendChild(el('h2', '', R.t('ui.party'))); heading.appendChild(el('span', 'rogue-eyebrow', save.party.hp + '/' + save.party.maxHp)); panel.appendChild(heading);
        health(panel, save.party.hp, save.party.maxHp);
        var reserves = el('div', 'rogue-party-reserves'); stat(reserves, 'ui.water', waterText(save.party.water) + '/' + R.waterMax(save)); stat(reserves, 'ui.food', save.party.food); panel.appendChild(reserves);
        var supplies = el('div', 'rogue-quick-supplies'); var supplyIds = ['water', 'food', 'medicine']; var s;
        for (s = 0; s < supplyIds.length; s++) {
            var supply = supplyIds[s];
            supplies.appendChild(button(supply === 'water' ? 'ui.reserveWater' : supply === 'food' ? 'ui.reserveFood' : 'ui.reserveMedicine', { type: 'use', item: supply }, { n: format(save.party.bag[supply] || 0) }, !save.party.bag[supply] || (supply === 'medicine' ? save.party.hp === save.party.maxHp : supply === 'water' ? save.party.water >= R.waterMax(save) : save.party.food >= N.SUPPLY_FOOD), 'quick:' + supply));
        }
        panel.appendChild(supplies);
        panel.appendChild(el('p', 'rogue-note', R.t('ui.reserveExplanation')));
        var equipment = section(panel, 'ui.equipment');
        stat(equipment, 'ui.weapon', R.t('item.' + save.party.weapon)); stat(equipment, 'ui.armour', save.party.armour ? R.t('item.' + save.party.armour) : R.t('ui.none'));
        equipment.appendChild(el('p', 'rogue-note', R.t('ui.damage', { n: C.items[save.party.weapon].dmg + R.bonus(save, 'attack') })));
        var controls = el('div', 'rogue-action-grid');
        controls.appendChild(button('ui.editEquipment', { type: 'memberView', member: 'player' })); controls.appendChild(button('ui.openBag', { type: 'bagView', member: 'player' })); equipment.appendChild(controls);
        equipment.appendChild(el('p', 'rogue-note', R.t('ui.bagCapacity', { n: format(R.bagWeight(save)), max: R.party.capacity(save, save.party) })));
        var companions = section(panel, 'ui.companions'); var i;
        for (i = 0; i < save.party.companions.length; i++) {
            var ally = save.party.companions[i]; var card = el('div', 'rogue-companion');
            var title = el('div', 'rogue-panel-heading'); title.appendChild(el('h4', '', R.t('ui.name.' + ally.name))); title.appendChild(el('span', 'rogue-note', ally.hp + '/' + ally.maxHp)); card.appendChild(title);
            card.appendChild(el('p', 'rogue-note', R.t('ui.stats', ally)));
            card.appendChild(el('p', 'rogue-note', R.t('item.' + ally.weapon) + ' · ' + (ally.armour ? R.t('item.' + ally.armour) : R.t('ui.none'))));
            card.appendChild(button('ui.manageCompanion', { type: 'memberView', member: ally.id }, null, false, 'member:' + ally.id)); companions.appendChild(card);
        }
        if (!save.party.companions.length) { companions.appendChild(el('p', 'rogue-note', R.t('ui.alone'))); }
        var home = R.atCamp(save); var recruitReason = !home ? 'ui.recruitAway' : save.party.companions.length >= N.MAX_COMPANIONS ? 'ui.recruitFull' : home.pop <= 1 ? 'ui.recruitPopulation' : !R.affords(save, { food: N.RECRUIT_FOOD }) ? 'ui.recruitFood' : null;
        companions.appendChild(button('ui.recruit', { type: 'recruit' }, null, !!recruitReason)); companions.appendChild(el('p', 'rogue-note', R.t(recruitReason || 'ui.recruitHint')));
        var discoveries = disclosure(panel, 'blueprints', 'ui.blueprints');
        if (!save.blueprints.length) { discoveries.appendChild(el('p', 'rogue-note', R.t('ui.noBlueprints'))); }
        for (i = 0; i < save.blueprints.length; i++) { discoveries.appendChild(el('p', '', R.t('item.' + save.blueprints[i]))); }
        if (save.flags.memorial.length) { var memorial = disclosure(panel, 'memorial', 'ui.memorial'); for (i = 0; i < save.flags.memorial.length; i++) { memorial.appendChild(el('p', 'rogue-note', R.t('ui.name.' + save.flags.memorial[i].name))); } }
    }
    /** Names the owner of a personal pack or shared warehouse. */
    function ownerName(save, id) { var owner = R.party.member(save, id); return id === 'store' ? R.t('ui.shared') : id === 'temp' ? R.t('ui.tempStorage') : id === 'cache' ? R.t('ui.cache') : owner === save.party ? R.t('ui.myPack') : owner ? R.t('ui.name.' + owner.name) : R.t('ui.none'); }
    /** Resolves the local storage entry offered from a pack without exposing a distant warehouse. */
    function localStore(save) { return R.atTemp(save) ? 'temp' : R.party.cache(save) ? 'cache' : 'store'; }
    /** Selects the single-page storage group for one known item. */
    function storageGroup(id) { return ['food', 'water', 'medicine'].indexOf(id) >= 0 ? 'supplies' : C.items[id].kind === 'resource' ? 'materials' : 'gear'; }
    /** Renders a two-way manifest with clear ownership, quantities and direct deposit/withdraw controls. */
    function renderStorage(parent, save, scope, options) {
        var store = R.party.inventory(save, scope); var available = !!store;
        var bag = scope === 'store' ? R.stores(save) : store ? store.bag : {};
        var member = R.party.member(save, options.member) || save.party;
        var memberId = member === save.party ? 'player' : member.id;
        var heading = el('div', 'rogue-storage-summary');
        heading.appendChild(el('p', 'rogue-note', R.t(scope === 'store' ? available ? 'ui.storageHere' : 'ui.storageAway' : scope === 'temp' ? available ? 'ui.storageTempHint' : 'err.storageAway' : 'ui.storageCacheHint')));
        if (scope === 'temp' && available) { heading.appendChild(el('p', 'rogue-note', R.t('ui.storageCapacity', { n: waterText(R.party.weight(bag)), max: N.TEMP_STORAGE }))); }
        heading.appendChild(el('p', 'rogue-note', R.t('ui.bagCapacity', { n: waterText(R.party.weight(member.bag)), max: R.party.capacity(save, member) }))); parent.appendChild(heading);
        var members = ['player']; var i; var id;
        for (i = 0; i < save.party.companions.length; i++) { members.push(save.party.companions[i].id); }
        if (members.length > 1) {
            var selectors = el('div', 'rogue-segment');
            for (i = 0; i < members.length; i++) { var select = button('ui.you', { type: 'storageOption', key: 'member', value: members[i] }, null, false, 'storage-member:' + members[i]); select.textContent = ownerName(save, members[i]); select.setAttribute('aria-pressed', members[i] === memberId ? 'true' : 'false'); selectors.appendChild(select); } parent.appendChild(selectors);
        }
        if (member === save.party) {
            var supply = el('div', 'rogue-storage-supply'); supply.appendChild(el('p', 'rogue-note', R.t('ui.activeSupplies', { water: waterText(save.party.water), max: R.waterMax(save), food: waterText(save.party.food) })));
            if (scope === 'store') { supply.appendChild(button('ui.restockShort', { type: 'restock' }, null, !available)); }
            parent.appendChild(supply);
        }
        var controls = el('div', 'rogue-storage-controls'); var quantities = [1, 10, 'all']; var labels = ['ui.quantityOne', 'ui.quantityTen', 'ui.quantityAll'];
        controls.setAttribute('aria-label', R.t('ui.storageQuantity'));
        for (i = 0; i < quantities.length; i++) { var quantity = button(labels[i], { type: 'storageOption', key: 'quantity', value: quantities[i] }, null, false, 'storage-quantity:' + quantities[i]); quantity.setAttribute('aria-pressed', options.quantity === quantities[i] ? 'true' : 'false'); controls.appendChild(quantity); } parent.appendChild(controls);
        var filters = ['all', 'supplies', 'materials', 'gear']; var filterKeys = ['ui.storageAll', 'ui.storageSupplies', 'ui.storageMaterials', 'ui.storageGear']; var filter = el('nav', 'rogue-storage-filters');
        for (i = 0; i < filters.length; i++) { var choice = button(filterKeys[i], { type: 'storageOption', key: 'filter', value: filters[i] }, null, false, 'storage-filter:' + filters[i]); choice.setAttribute('aria-pressed', options.filter === filters[i] ? 'true' : 'false'); filter.appendChild(choice); } parent.appendChild(filter);
        var items = [];
        for (id in C.items) { if (id !== 'fists' && ((bag[id] || 0) > 0 || (scope !== 'cache' && (member.bag[id] || 0) > 0)) && (options.filter === 'all' || options.filter === storageGroup(id))) { items.push(id); } }
        var size = menuSize(); var pages = Math.max(1, Math.ceil(items.length / size)); options.page = Math.min(options.page, pages - 1);
        var manifest = el('div', 'rogue-storage-list');
        for (i = options.page * size; i < Math.min(items.length, (options.page + 1) * size); i++) {
            id = items[i]; var row = el('article', 'rogue-storage-row'); row.setAttribute('data-storage-item', id);
            var copy = el('div', 'rogue-storage-copy'); copy.appendChild(el('h3', '', R.t('item.' + id)));
            copy.appendChild(el('p', 'rogue-note', R.t('ui.storageCounts', { bag: waterText(member.bag[id] || 0), store: waterText(bag[id] || 0) })));
            if (member.weapon === id || member.armour === id) { copy.appendChild(el('span', 'rogue-eyebrow', R.t('ui.equippedMark'))); }
            if (['waterskin', 'canteen', 'pack'].indexOf(id) >= 0) { copy.appendChild(el('span', 'rogue-eyebrow', R.t('ui.personalToolMark'))); }
            row.appendChild(copy);
            var actions = el('div', 'rogue-storage-row-actions'); var put = available ? R.party.transferAmount(save, memberId, scope, id, options.quantity) : 0; var take = available ? R.party.transferAmount(save, scope, memberId, id, options.quantity) : 0;
            if (scope !== 'cache') {
                var deposit = button('ui.storageDeposit', { type: 'transfer', from: memberId, to: scope, item: id, quantity: options.quantity }, { n: put }, !put, 'store-put:' + id);
                deposit.setAttribute('aria-label', R.t('ui.storageDepositLabel', { name: R.t('item.' + id), n: put })); actions.appendChild(deposit);
            }
            var withdraw = button('ui.storageWithdraw', { type: 'transfer', from: scope, to: memberId, item: id, quantity: options.quantity }, { n: take }, !take, 'store-take:' + id);
            withdraw.setAttribute('aria-label', R.t('ui.storageWithdrawLabel', { name: R.t('item.' + id), n: take })); actions.appendChild(withdraw); row.appendChild(actions); manifest.appendChild(row);
        }
        if (!items.length) { manifest.appendChild(el('p', 'rogue-note', R.t('ui.storageNoItems'))); } parent.appendChild(manifest);
        if (pages > 1) {
            var nav = el('nav', 'rogue-pagination'); nav.appendChild(button('ui.previous', { type: 'storageOption', key: 'page', value: options.page - 1 }, null, options.page === 0)); nav.appendChild(el('span', 'rogue-note', R.t('ui.page', { n: options.page + 1, max: pages }))); nav.appendChild(button('ui.next', { type: 'storageOption', key: 'page', value: options.page + 1 }, null, options.page >= pages - 1)); parent.appendChild(nav);
        }
        if (available && scope !== 'cache') {
            var materials = false;
            for (id in member.bag) { if (storageGroup(id) === 'materials' && R.party.transferAmount(save, memberId, scope, id, 'all') > 0) { materials = true; break; } }
            parent.appendChild(button('ui.stowMaterials', { type: 'stowMaterials', member: memberId, to: scope }, null, !materials)); parent.appendChild(el('p', 'rogue-note', R.t('ui.stowHint')));
        }
    }
    /** Renders one member's real attack, armour, health and safe dismissal controls. */
    function renderMember(content, save) {
        var id = modalOptions.member; var owner = R.party.member(save, id);
        if (!owner) { content.appendChild(el('p', 'rogue-note', R.t('ui.memberGone'))); return; }
        content.appendChild(el('h3', 'rogue-section-title', ownerName(save, id)));
        stat(content, 'ui.hp', owner.hp + '/' + owner.maxHp); health(content, owner.hp, owner.maxHp);
        if (owner !== save.party) { content.appendChild(el('p', 'rogue-note', R.t('ui.stats', owner))); }
        stat(content, 'ui.weapon', R.t('item.' + owner.weapon));
        stat(content, 'ui.damageLabel', C.items[owner.weapon].dmg + (owner === save.party ? R.bonus(save, 'attack') : owner.str + R.bonus(save, 'companion')));
        content.appendChild(button('ui.chooseWeapon', { type: 'gearView', member: id, kind: 'weapon' }));
        stat(content, 'ui.armour', owner.armour ? R.t('item.' + owner.armour) : R.t('ui.none'));
        stat(content, 'ui.armourLabel', Math.round((owner.armour ? C.items[owner.armour].protection : 0) * 100) + '%');
        content.appendChild(button('ui.chooseArmour', { type: 'gearView', member: id, kind: 'armour' }));
        content.appendChild(button('ui.openBag', { type: 'bagView', member: id }));
        if (owner !== save.party) {
            content.appendChild(button('ui.allyMedicine', { type: 'allyUse', member: id, item: 'medicine' }, null, !owner.bag.medicine || owner.hp >= owner.maxHp));
            content.appendChild(button('ui.dismiss', { type: 'confirmDismiss', member: id }, null, !R.atCamp(save)));
            content.appendChild(el('p', 'rogue-note', R.t('ui.dismissHint')));
        }
    }
    /** Renders a page of items or equipment choices while keeping navigation outside scrolling content. */
    function renderBag(content, save, gearOnly) {
        var id = modalOptions.member || 'player'; var owner = id === 'store' ? null : R.party.member(save, id);
        if (!owner && id !== 'store') { content.appendChild(el('p', 'rogue-note', R.t('ui.memberGone'))); return; }
        var bag = owner ? owner.bag : R.stores(save);
        content.appendChild(el('h3', 'rogue-section-title', ownerName(save, id)));
        if (owner) { content.appendChild(el('p', 'rogue-note', R.t('ui.bagCapacity', { n: format(R.party.weight(bag)), max: R.party.capacity(save, owner) }))); }
        content.appendChild(el('p', 'rogue-note', R.t(gearOnly ? 'ui.gearHint' : 'ui.inventoryHint')));
        var items = []; var key; var i;
        for (key in bag) { if (bag[key] > 0 && (!gearOnly || C.items[key].kind === modalOptions.kind)) { items.push(key); } }
        var page = Math.min(modalOptions.page || 0, Math.max(0, Math.ceil(items.length / menuSize()) - 1));
        for (i = page * menuSize(); i < Math.min(items.length, (page + 1) * menuSize()); i++) {
            key = items[i];
            var row = el('div', 'rogue-pack-row'); row.appendChild(el('span', '', R.t('item.' + key) + ' ×' + format(bag[key])));
            row.appendChild(button(gearOnly ? 'ui.equip' : 'ui.manageItem', gearOnly ? { type: 'equip', member: id, item: key } : { type: 'itemView', member: id, item: key }, null, gearOnly && (owner.weapon === key || owner.armour === key), (gearOnly ? 'equip:' : 'item:') + key)); content.appendChild(row);
        }
        if (!items.length) { content.appendChild(el('p', 'rogue-note', R.t('ui.bagEmpty'))); }
        if (gearOnly) { content.appendChild(button('ui.unequip', { type: 'unequip', member: id, kind: modalOptions.kind }, null, modalOptions.kind === 'weapon' ? owner.weapon === 'fists' : !owner.armour)); }
        if (items.length > menuSize()) {
            var nav = el('div', 'rogue-pagination'); nav.appendChild(button('ui.previous', { type: 'bagPage', page: page - 1 }, null, page === 0)); nav.appendChild(el('span', 'rogue-note', (page + 1) + '/' + Math.ceil(items.length / menuSize()))); nav.appendChild(button('ui.next', { type: 'bagPage', page: page + 1 }, null, (page + 1) * menuSize() >= items.length)); content.appendChild(nav);
        }
        if (!gearOnly && owner) { var storeId = localStore(save); content.appendChild(button(storeId === 'temp' ? 'ui.tempStoreAction' : storeId === 'cache' ? 'ui.cacheAction' : 'ui.storageOpen', { type: 'storageView', scope: storeId, member: id })); }
    }
    /** Presents explicit destinations for one physical item, including automatic removal of its last worn copy. */
    function renderItem(content, save) {
        var from = modalOptions.member; var owner = from === 'store' ? null : R.party.member(save, from); var id = modalOptions.item; var item = C.items[id];
        var bag = owner ? owner.bag : R.stores(save); var amount = Math.min(item.kind === 'resource' ? N.DROP_BUNDLE : 1, bag[id] || 0);
        content.appendChild(el('h3', 'rogue-section-title', R.t('item.' + id) + ' ×' + format(bag[id] || 0)));
        content.appendChild(el('p', 'rogue-note', R.t('ui.transferHint', { n: format(amount) })));
        if (owner && (owner.weapon === id || owner.armour === id)) { content.appendChild(el('p', 'rogue-note', R.t('ui.wornTransferHint'))); }
        if (owner && (item.kind === 'weapon' || item.kind === 'armour')) {
            content.appendChild(el('p', 'rogue-note', R.t('ui.gearHint')));
            content.appendChild(button(owner[item.kind] === id ? 'ui.unequip' : 'ui.equip', owner[item.kind] === id ? { type: 'unequip', member: from, kind: item.kind } : { type: 'equip', member: from, item: id }, null, !amount));
        }
        if (owner === save.party && (['water', 'food', 'medicine'].indexOf(id) >= 0)) { content.appendChild(button('ui.use', { type: 'use', item: id }, null, !amount)); }
        if (owner && item.kind === 'resource') { content.appendChild(button('ui.drop', { type: 'confirmDrop', member: from, item: id }, null, !amount)); }
        var destinations = ['player']; var i;
        for (i = 0; i < save.party.companions.length; i++) { destinations.push(save.party.companions[i].id); }
        if (R.atCamp(save)) { destinations.push('store'); }
        else if (R.atTemp(save)) { destinations.push('temp'); }
        for (i = 0; i < destinations.length; i++) {
            var to = destinations[i]; if (to === from) { continue; }
            var transferable = R.party.transferAmount(save, from, to, id);
            content.appendChild(button(to === 'store' ? 'ui.storeItem' : to === 'temp' ? 'ui.tempStoreItem' : 'ui.giveItem', { type: 'transfer', from: from, to: to, item: id }, { name: ownerName(save, to), n: format(transferable) }, !transferable, 'transfer:' + to));
        }
    }
    /** Renders fixed event choices and their exact rewards or carried-resource prices. */
    function renderEvent(content, save) {
        var event = save.flags.wildEvent;
        if (!event) { return; }
        content.appendChild(el('h3', 'rogue-section-title', R.t('event.' + event.kind + '.title')));
        content.appendChild(el('p', 'rogue-help-copy', R.t('event.' + event.kind)));
        if (event.kind === 'merchant') {
            content.appendChild(el('p', 'rogue-note', R.t('ui.merchantHint'))); var i;
            for (i = 0; i < event.offers.length; i++) {
                var offer = event.offers[i]; var card = el('div', 'rogue-trade-offer'); card.appendChild(el('p', '', R.t('item.' + offer.item) + ' ×' + offer.quantity));
                card.appendChild(el('p', 'rogue-note', R.t('ui.carriedPrice', { cost: costText(offer.cost) })));
                var enough = true; var key; for (key in offer.cost) { if ((save.party.bag[key] || 0) < offer.cost[key]) { enough = false; } }
                card.appendChild(button(offer.sold ? 'ui.sold' : 'ui.buy', { type: 'event', op: 'buy', index: i }, null, offer.sold || !enough, 'event-buy:' + i)); content.appendChild(card);
            }
        } else {
            content.appendChild(el('p', 'rogue-note', R.t('ui.eventReward', { cost: costText(event.reward) })));
            if (event.kind === 'survivor') { content.appendChild(el('p', 'rogue-note', R.t('ui.survivorCost'))); }
            content.appendChild(button(event.kind === 'survivor' ? 'ui.helpSurvivor' : 'ui.collectCache', { type: 'event', op: 'collect' }, null, event.kind === 'survivor' && save.party.food < 3));
        }
        content.appendChild(button('ui.openBag', { type: 'bagView', member: 'player' }));
    }
    /** Renders one compact interior room and the next deliberate step in a hostile compound. */
    function renderOutpost(content, save) {
        var site = R.outpost.current(save); if (!site) { return; }
        content.appendChild(el('h3', 'rogue-section-title', R.t('outpost.room.' + site.assault)));
        content.appendChild(el('p', 'rogue-help-copy', R.t('outpost.room.' + site.assault + '.desc')));
        content.appendChild(el('p', 'rogue-note', R.t('ui.outpostProgress', { n: site.assault, max: N.OUTPOST_STAGES })));
        if (site.assault < N.OUTPOST_STAGES) {
            content.appendChild(button(site.assault % 2 ? 'ui.searchRoom' : 'ui.assaultNext', { type: 'outpost', op: 'explore' }));
        } else {
            content.appendChild(el('p', 'rogue-note', R.t('ui.cost', { cost: costText(N.OUTPOST_REPAIR) })));
            content.appendChild(el('p', 'rogue-note', R.t('ui.claimHint')));
            content.appendChild(button(save.camps.length >= N.MAX_CAMPS ? 'ui.replaceOutpost' : 'ui.claimOutpost', { type: 'confirmClaim' }, null, !R.affords(save, N.OUTPOST_REPAIR)));
        }
        content.appendChild(button('ui.openBag', { type: 'bagView', member: 'player' }));
    }

    /** Renders the slot chooser without starting a run or creating save keys. */
    function renderSlots() {
        var container = document.getElementById('rogue-launcher'); container.textContent = '';
        var intro = el('header', 'rogue-launcher-heading'); intro.appendChild(el('p', 'rogue-eyebrow', R.t('ui.mode'))); intro.appendChild(el('h1', '', R.t('ui.title'))); intro.appendChild(el('p', 'rogue-note', R.t('ui.tagline'))); container.appendChild(intro);
        var slots = R.save.list();
        var list = el('div', 'rogue-slot-list');
        var i;
        for (i = 0; i < slots.length; i++) {
            var item = slots[i];
            var row = el('div', 'rogue-slot');
            var open = button('ui.slot', { type: item.empty ? 'new' : 'resume', slot: i }, { n: i + 1 }, item.corrupt);
            open.className += ' rogue-slot-open'; open.textContent = '';
            open.appendChild(el('span', 'rogue-slot-name', R.t('ui.slot', { n: i + 1 })));
            open.appendChild(el('span', 'rogue-note', item.corrupt ? R.t('ui.corruptSlot') : item.empty ? R.t('ui.empty') : R.t('ui.day', { n: item.save.day + 1 }) + ' · ' + R.t('ui.turn', { n: item.save.turn }) + (item.save.over ? ' · ' + R.t('ui.ended') : '')));
            if (item.save) { open.appendChild(el('span', 'rogue-note', R.t('ui.seedValue', { n: item.save.seed }))); }
            row.appendChild(open);
            if (!item.empty) { row.appendChild(button('ui.delete', { type: 'confirmDelete', slot: i }, null, false, 'delete:' + i)); }
            list.appendChild(row);
        }
        container.appendChild(list);
        container.appendChild(el('p', 'rogue-launcher-note', R.t('ui.rules')));
        var help = button('ui.help', { type: 'modal', kind: 'guide' }); help.className += ' rogue-text-button'; container.appendChild(help);
        var home = button('ui.back', { type: 'home' }); home.className += ' rogue-text-button'; container.appendChild(home);
        container.appendChild(el('p', 'rogue-attribution', R.t('ui.attribution')));
    }
    /** Renders a completed expedition with a clear next action and optional abyss. */
    function renderEnding(save) {
        var container = document.getElementById('rogue-ending'); container.textContent = '';
        var reason = save.endReason === 'ship' ? 'Ship' : save.endReason === 'wiped' ? 'Wiped' : 'Died';
        container.appendChild(el('p', 'rogue-eyebrow', R.t('ui.mode')));
        container.appendChild(endingArt(save.endReason === 'ship'));
        container.appendChild(el('h1', '', R.t('ui.ending' + reason)));
        container.appendChild(el('p', 'rogue-ending-copy', R.t('ui.ending' + reason + 'Body')));
        container.appendChild(el('p', 'rogue-note', R.t('ui.endingStats', { days: save.day + 1, turns: save.turn, regions: Object.keys(save.regions).length })));
        if (save.cheat) { container.appendChild(el('p', 'rogue-note', R.t('ui.cheatMark'))); }
        if (save.endReason === 'ship') {
            container.appendChild(button('ui.abyssEnter', { type: 'abyss' }));
            container.appendChild(el('p', 'rogue-note', R.t('ui.abyssBest', { n: save.flags.abyssBest || 0 })));
        }
        container.appendChild(button('ui.restartSlot', { type: 'confirmRestart', slot: save.slot }));
        container.appendChild(button('ui.chooseSlot', { type: 'slots' }));
        container.appendChild(button('ui.back', { type: 'home' }));
    }
    /** Draws an offline monochrome campfire or departing ship with recognisable silhouettes. */
    function endingArt(ship) {
        var art = svgElement('svg', { viewBox: '0 0 240 132', 'class': 'rogue-ending-illustration', role: 'img', 'aria-label': R.t(ship ? 'ui.endingArtShip' : 'ui.endingArtCamp') });
        if (ship) {
            art.appendChild(svgElement('path', { d: 'M120 14 C104 29 102 48 102 77 L138 77 C138 48 136 29 120 14 Z M102 57 L87 81 L102 76 M138 57 L153 81 L138 76 M110 85 L106 109 M120 85 L120 119 M130 85 L134 109', fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));
            art.appendChild(svgElement('circle', { cx: 120, cy: 46, r: 7, fill: 'none', stroke: 'currentColor', 'stroke-width': 2 }));
            art.appendChild(svgElement('path', { d: 'M65 32 L65 42 M60 37 L70 37 M171 67 L171 77 M166 72 L176 72', stroke: 'currentColor', 'stroke-width': 1.5, opacity: 0.5 }));
        } else {
            art.appendChild(svgElement('path', { d: 'M113 65 C98 52 128 45 114 30 M129 57 C119 46 139 37 128 22', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.5, 'stroke-linecap': 'round', opacity: 0.45 }));
            art.appendChild(svgElement('path', { d: 'M107 86 C102 79 112 74 114 66 C123 76 119 76 125 82 C128 90 115 96 107 86 Z', fill: 'currentColor', opacity: 0.5 }));
            art.appendChild(svgElement('path', { d: 'M77 83 L164 103 L161 112 L74 92 Z M162 83 L75 103 L78 112 L165 92 Z', fill: 'var(--rogue-surface)', stroke: 'currentColor', 'stroke-width': 2.5, 'stroke-linejoin': 'round' }));
            art.appendChild(svgElement('path', { d: 'M90 90 L106 94 M139 102 L153 106 M143 92 L129 96 M100 103 L85 107', fill: 'none', stroke: 'currentColor', 'stroke-width': 1, opacity: 0.7 }));
            art.appendChild(svgElement('circle', { cx: 62, cy: 111, r: 1.5, fill: 'currentColor', opacity: 0.5 }));
            art.appendChild(svgElement('circle', { cx: 178, cy: 108, r: 1.5, fill: 'currentColor', opacity: 0.5 }));
        }
        return art;
    }
    /** Renders battle information and returns controls that stay outside its scrolling body. */
    function renderCombat(content, save) {
        var session = save.flags.combat;
        var enemies = el('div', 'rogue-enemies');
        var i;
        for (i = 0; i < session.enemies.length; i++) {
            var enemy = session.enemies[i];
            var target = button('ui.combatTarget', { type: 'target', target: i }, { name: R.t('enemy.' + enemy.type) }, enemy.hp <= 0, 'target:' + i);
            target.className += ' rogue-enemy'; target.setAttribute('aria-pressed', session.target === i ? 'true' : 'false'); target.textContent = '';
            target.appendChild(el('span', 'rogue-enemy-symbol', C.enemies[enemy.type].symbol));
            target.appendChild(el('span', '', R.t('enemy.' + enemy.type)));
            target.appendChild(el('span', 'rogue-note', enemy.hp + '/' + enemy.maxHp));
            health(target, enemy.hp, enemy.maxHp, R.t('enemy.' + enemy.type)); enemies.appendChild(target);
        }
        content.appendChild(enemies);
        var party = el('div', 'rogue-combat-party'); stat(party, 'ui.hp', save.party.hp + '/' + save.party.maxHp); health(party, save.party.hp, save.party.maxHp); content.appendChild(party);
        var log = el('ol', 'rogue-combat-log'); log.setAttribute('aria-live', 'polite'); log.setAttribute('aria-atomic', 'false');
        for (i = 0; i < session.log.length; i++) { log.appendChild(el('li', '', R.t(session.log[i].key, session.log[i].values))); }
        content.appendChild(log);
        var actions = el('div', 'rogue-combat-actions');
        var types = ['attack', 'guard', 'dodge'];
        for (i = 0; i < types.length; i++) { actions.appendChild(button('ui.' + types[i], { type: 'combat', action: { type: types[i], target: session.target } })); }
        actions.appendChild(button('ui.medicine', { type: 'combat', action: { type: 'item', item: 'medicine' } }, null, !save.party.bag.medicine || save.party.hp === save.party.maxHp));
        var flee = button('ui.fleeChance', { type: 'combat', action: { type: 'flee' } }, { n: Math.round(R.combat.escapeChance(session) * 100) }); flee.className += ' rogue-flee'; actions.appendChild(flee);
        content.appendChild(el('p', 'rogue-note', R.t('ui.combatHint'))); return actions;
    }
    /** Creates a native SVG map element without external resources. */
    function svgElement(tag, attributes, text) {
        var node = document.createElementNS('http://www.w3.org/2000/svg', tag);
        var key;
        for (key in attributes) { node.setAttribute(key, String(attributes[key])); }
        if (text !== undefined) { node.textContent = text; }
        return node;
    }
    /** Draws the actual explored region arrangement without exposing undiscovered neighbours. */
    function renderWorldChart(content, save) {
        var keys = Object.keys(save.regions); var points = {}; var minX = Infinity; var minY = Infinity; var maxX = -Infinity; var maxY = -Infinity; var i;
        for (i = 0; i < keys.length; i++) {
            var pair = keys[i].split(','); var x = Number(pair[0]); var y = Number(pair[1]);
            points[keys[i]] = { x: x, y: y }; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        var chart = svgElement('svg', { viewBox: '0 0 ' + ((maxX - minX + 1) * 112) + ' ' + ((maxY - minY + 1) * 64), role: 'img', 'aria-label': R.t('ui.worldExplored'), 'class': 'rogue-world-chart' });
        for (i = 0; i < save.regionGraph.edges.length; i++) {
            var edge = save.regionGraph.edges[i]; var a = points[edge[0]]; var b = points[edge[1]];
            if (!a || !b) { continue; }
            var region = save.regions[edge[0]]; var dx = b.x - a.x; var dy = b.y - a.y;
            var gx = dx < 0 ? 1 : dx > 0 ? N.REGION_SIZE - 2 : N.REGION_CENTER; var gy = dy < 0 ? 1 : dy > 0 ? N.REGION_SIZE - 2 : N.REGION_CENTER;
            if (!R.mask.has(R.mask.decode(region.mask), gy * N.REGION_SIZE + gx)) { continue; }
            chart.appendChild(svgElement('line', { x1: (a.x - minX) * 112 + 56, y1: (a.y - minY) * 64 + 32, x2: (b.x - minX) * 112 + 56, y2: (b.y - minY) * 64 + 32, 'class': R.worldgen.isBlocked(save.regionGraph, edge[0], edge[1]) ? 'rogue-chart-blocked' : 'rogue-chart-road' }));
        }
        for (i = 0; i < keys.length; i++) {
            var key = keys[i]; var point = points[key]; var left = (point.x - minX) * 112 + 8; var top = (point.y - minY) * 64 + 12;
            chart.appendChild(svgElement('rect', { x: left, y: top, width: 96, height: 40, 'class': key === save.party.region ? 'rogue-chart-current' : 'rogue-chart-region' }));
            chart.appendChild(svgElement('text', { x: left + 48, y: top + 25, 'text-anchor': 'middle', 'class': key === save.party.region ? 'rogue-chart-current-label' : 'rogue-chart-label' }, R.t('room.' + save.regions[key].theme)));
        }
        content.appendChild(chart);
    }
    /** Renders only places already visited and roads physically found in the current region. */
    function renderWorld(content, save) {
        content.appendChild(el('p', 'rogue-note', R.t('ui.worldUnknown')));
        renderWorldChart(content, save);
        content.appendChild(button('ui.legend', { type: 'modal', kind: 'guide' }));
        var i;
        var roads = section(content, 'ui.knownExits'); var exits = R.map.exits(save, true);
        for (i = 0; i < exits.length; i++) {
            var exit = exits[i]; var row = el('div', 'rogue-road-description'); var copy = el('div'); copy.appendChild(el('span', '', R.t('ui.' + exit.dir)));
            copy.appendChild(el('p', 'rogue-note', exit.blocked ? R.t('ui.routeBlocked') : save.regions[exit.target] ? R.t('room.' + save.regions[exit.target].theme) : R.t('ui.unvisitedRoad'))); row.appendChild(copy);
            row.appendChild(button('ui.route', { type: 'gate', dir: exit.dir }, null, !!save.flags.insideDungeon)); roads.appendChild(row);
        }
        if (!exits.length) { roads.appendChild(el('p', 'rogue-note', R.t('ui.noKnownExits'))); }
        var visited = section(content, 'ui.worldExplored'); visited.appendChild(el('p', 'rogue-note', R.t('ui.worldVisited', { n: Object.keys(save.regions).length })));
        var key;
        for (key in save.regions) {
            var region = save.regions[key]; var node = el('div', 'rogue-region-entry'); var found = 0;
            for (i = 0; i < region.sites.length; i++) { if (region.sites[i].state !== 'unknown') { found += 1; } }
            node.appendChild(el('span', '', R.t('room.' + region.theme) + (key === save.party.region ? ' · ' + R.t('ui.current') : '')));
            node.appendChild(el('p', 'rogue-note', R.t('ui.knownSites', { n: found }))); visited.appendChild(node);
        }
    }
    /** Renders appearance, pacing and explicit save/navigation controls. */
    function renderMenu(content, save) {
        var appearance = section(content, 'ui.theme');
        var theme = el('div', 'rogue-segment');
        var light = button('ui.light', { type: 'theme', dark: false }); light.setAttribute('aria-pressed', R.ui.preferences.dark ? 'false' : 'true'); theme.appendChild(light);
        var dark = button('ui.dark', { type: 'theme', dark: true }); dark.setAttribute('aria-pressed', R.ui.preferences.dark ? 'true' : 'false'); theme.appendChild(dark); appearance.appendChild(theme);
        var fonts = el('div', 'rogue-font-controls'); fonts.appendChild(el('span', '', R.t('ui.font')));
        var smaller = button('ui.smaller', { type: 'font', delta: -2 }); smaller.textContent = 'A−'; smaller.setAttribute('aria-label', R.t('ui.smaller')); fonts.appendChild(smaller);
        fonts.appendChild(el('span', 'rogue-note', R.ui.preferences.font));
        var larger = button('ui.larger', { type: 'font', delta: 2 }); larger.textContent = 'A+'; larger.setAttribute('aria-label', R.t('ui.larger')); fonts.appendChild(larger); appearance.appendChild(fonts);
        var warnings = section(content, 'ui.supplyWarnings');
        var toggle = button('ui.waterWarningToggle', { type: 'waterWarning' }, { state: R.t(R.ui.preferences.waterWarning ? 'ui.enabled' : 'ui.disabled') }); toggle.setAttribute('aria-pressed', R.ui.preferences.waterWarning ? 'true' : 'false'); warnings.appendChild(toggle);
        warnings.appendChild(el('p', 'rogue-note', R.t('ui.waterWarningHint')));
        if (save) {
            var speed = section(content, 'ui.speed'); var speeds = el('div', 'rogue-segment');
            var labels = ['ui.slow', 'ui.normal', 'ui.fast'];
            var i;
            for (i = 0; i < labels.length; i++) { var choose = button(labels[i], { type: 'speed', speed: i + 1 }); choose.setAttribute('aria-pressed', save.speed === i + 1 ? 'true' : 'false'); speeds.appendChild(choose); }
            speed.appendChild(speeds); speed.appendChild(el('p', 'rogue-note', R.t('ui.speedHint')));
            var controls = el('div', 'rogue-menu-actions');
            controls.appendChild(button('ui.save', { type: 'save' }));
            controls.appendChild(button('ui.chooseSlot', { type: 'slots' }));
            controls.appendChild(button('ui.journal', { type: 'modal', kind: 'journal' })); content.appendChild(controls);
            if (window.ADRNativeLocalApp) {
                controls.appendChild(button('ui.backup', { type: 'native', target: 'backup' }));
                controls.appendChild(button('ui.restore', { type: 'native', target: 'restore' }));
            }
            var help = disclosure(content, 'assistance', 'ui.cheat'); help.appendChild(el('p', 'rogue-note', R.t('ui.cheatHint'))); help.appendChild(button('ui.cheat', { type: 'confirmCheat' }, null, save.over));
        }
        content.appendChild(button('ui.help', { type: 'modal', kind: 'guide' }));
        content.appendChild(button('ui.back', { type: 'home' }));
        if (save) { content.appendChild(el('p', 'rogue-note', R.t('ui.seedValue', { n: save.seed }))); }
    }
    /** Names the actual destination of the current secondary page's return control. */
    function returnPage(save) {
        var parent = modalStack.length ? modalStack[modalStack.length - 1].kind : null;
        if (parent && ['member', 'bag', 'gear', 'item', 'storage', 'event', 'outpost'].indexOf(parent) >= 0) { return 'ui.page.' + parent; }
        if (parent) { return parent === 'menu' ? 'ui.menu' : parent === 'combat' ? 'ui.battleLabel' : parent === 'new' ? 'ui.newrun' : 'ui.exploreNotes'; }
        if (!save) { return 'ui.slots'; }
        if (save.over && !save.flags.abyss) { return 'ui.endingPage'; }
        return 'ui.' + activeTab;
    }
    /** Renders a modal's body according to the current UI-only view. */
    function renderModal() {
        overlay.textContent = '';
        if (!modal) { overlay.hidden = true; frame.removeAttribute('aria-hidden'); frame.inert = false; document.body.classList.remove('rogue-modal-open'); return; }
        overlay.hidden = false; frame.setAttribute('aria-hidden', 'true'); frame.inert = true; document.body.classList.add('rogue-modal-open');
        var dialog = el('section', 'rogue-dialog' + (modal === 'combat' ? ' rogue-combat-dialog' : '') + (modal === 'storage' ? ' rogue-storage-dialog' : ''));
        dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-labelledby', 'rogue-dialog-title');
        var heading = el('div', 'rogue-dialog-heading');
        var titles = { storage: modalOptions && modalOptions.scope === 'temp' ? 'ui.tempStorage' : modalOptions && modalOptions.scope === 'cache' ? 'ui.cache' : 'ui.storage', member: 'ui.page.member', bag: 'ui.page.bag', gear: 'ui.page.gear', item: 'ui.page.item', event: 'ui.page.event', outpost: 'site.outpost', combat: 'ui.combat', world: 'ui.exploreNotes', nearby: 'ui.exploreNotes', clues: 'ui.exploreNotes', goals: 'ui.exploreNotes', menu: 'ui.settings', guide: 'ui.help', time: 'ui.timeTitle', journal: 'ui.journal', new: 'ui.newrun', confirm: modalOptions ? modalOptions.title : 'ui.confirm' };
        var title = el('h2', '', R.t(titles[modal])); title.id = 'rogue-dialog-title'; heading.appendChild(title);
        dialog.appendChild(heading);
        var content = el('div', 'rogue-dialog-content'); var save = R.state.current;
        content.setAttribute('data-modal', modal);
        var exploreViews = ['world', 'nearby', 'clues', 'goals'];
        if (exploreViews.indexOf(modal) >= 0) {
            var exploreTabs = el('nav', 'rogue-explore-tabs'); var labels = ['ui.regionMap', 'ui.around', 'ui.clues', 'ui.goals']; var e;
            exploreTabs.setAttribute('aria-label', R.t('ui.exploreNotes'));
            for (e = 0; e < exploreViews.length; e++) { var entry = button(labels[e], { type: 'exploreView', view: exploreViews[e] }); entry.setAttribute('aria-pressed', modal === exploreViews[e] ? 'true' : 'false'); exploreTabs.appendChild(entry); }
            dialog.appendChild(exploreTabs);
        }
        var combatActions;
        if (modal === 'member') { renderMember(content, save); }
        else if (modal === 'bag' || modal === 'gear') { renderBag(content, save, modal === 'gear'); }
        else if (modal === 'item') { renderItem(content, save); }
        else if (modal === 'storage') { renderStorage(content, save, modalOptions.scope, modalOptions); }
        else if (modal === 'event') { renderEvent(content, save); }
        else if (modal === 'outpost') { renderOutpost(content, save); }
        else if (modal === 'combat') { combatActions = renderCombat(content, save); }
        else if (modal === 'world') { renderWorld(content, save); }
        else if (modal === 'nearby') { renderNearby(content, save); }
        else if (modal === 'clues') {
            content.appendChild(el('h3', 'rogue-section-title', R.t('ui.localClues')));
            var traces = R.map.clues(save); var t;
            for (t = 0; t < traces.length; t++) { content.appendChild(el('p', 'rogue-clue', R.t(traces[t].key, traces[t].values))); }
        } else if (modal === 'goals') {
            var goal = quest(save);
            content.appendChild(el('h3', 'rogue-section-title', R.t('ui.quest.' + goal)));
            content.appendChild(el('p', 'rogue-help-copy', R.t('ui.quest.' + goal + '.desc')));
            content.appendChild(button('ui.help', { type: 'modal', kind: 'guide' }));
        }
        else if (modal === 'menu') { renderMenu(content, save); }
        else if (modal === 'time') {
            content.appendChild(el('p', 'rogue-help-copy', R.t('ui.timeBody')));
            content.appendChild(el('p', 'rogue-note', R.t('ui.timeTotal', { n: save.turn })));
            content.appendChild(el('p', 'rogue-note', R.t('ui.nextDay', { n: N.TURNS_PER_DAY - save.turn % N.TURNS_PER_DAY })));
        }
        else if (modal === 'guide') {
            content.appendChild(el('p', 'rogue-help-copy', R.t('ui.helpBody')));
            var legend = el('div', 'rogue-legend');
            var symbols = [['@', 'ui.legendPlayer'], ['^', 'ui.tempCamp'], ['*', 'ui.cache'], ['B', 'ui.legendCamp'], ['+', 'ui.legendExit'], ['.', 'ui.legendFloor'], ['#', 'ui.legendWall']];
            var id;
            for (id in C.sites) { symbols.push([C.sites[id].symbol, 'site.' + id]); }
            var i;
            for (i = 0; i < symbols.length; i++) { var entry = el('div', 'rogue-legend-entry'); entry.appendChild(el('span', 'rogue-symbol', symbols[i][0])); entry.appendChild(el('span', '', R.t(symbols[i][1]))); legend.appendChild(entry); }
            content.appendChild(legend);
        } else if (modal === 'journal' && save) {
            var logs = el('ol', 'rogue-journal');
            var j;
            for (j = save.flags.log.length - 1; j >= 0; j--) { var log = save.flags.log[j]; var line = el('li'); line.appendChild(el('span', 'rogue-eyebrow', R.t('ui.turn', { n: log.turn }))); line.appendChild(el('p', '', R.t(log.key, log.values))); logs.appendChild(line); }
            content.appendChild(logs);
        } else if (modal === 'new') {
            content.appendChild(el('p', 'rogue-note', R.t('ui.seedHelp')));
            var form = el('form', 'rogue-new-form'); form.id = 'rogue-new-form';
            var label = el('label', '', R.t('ui.seed')); label.htmlFor = 'rogue-seed'; form.appendChild(label);
            var seed = el('input'); seed.id = 'rogue-seed'; seed.name = 'seed'; seed.type = 'text'; seed.inputMode = 'numeric'; seed.maxLength = 10; seed.placeholder = R.t('ui.seedHint'); seed.autocomplete = 'off'; form.appendChild(seed);
            form.appendChild(button('ui.new', { type: 'create', slot: modalOptions.slot })); content.appendChild(form);
        } else if (modal === 'confirm') {
            content.appendChild(el('p', 'rogue-confirm-copy', R.t(modalOptions.body, modalOptions.values)));
        }
        dialog.appendChild(content);
        if (combatActions) { dialog.appendChild(combatActions); }
        var footer = el('footer', 'rogue-dialog-footer');
        if (modal === 'confirm') { footer.appendChild(button('ui.cancel', { type: 'closeModal' })); footer.appendChild(button('ui.confirm', { type: 'confirmed', action: modalOptions.action })); }
        else if (modal === 'event' || modal === 'outpost') { footer.appendChild(button('ui.pause', { type: 'modal', kind: 'menu' })); var leave = button(modal === 'event' ? 'ui.leaveEvent' : 'ui.leaveOutpost', { type: modal === 'event' ? 'event' : 'outpost', op: 'leave' }); leave.className += ' rogue-return'; footer.appendChild(leave); }
        else if (modal === 'combat') { footer.appendChild(button('ui.pause', { type: 'modal', kind: 'menu' })); }
        else { var back = button('ui.backTo', { type: 'closeModal' }, { page: R.t(returnPage(save)) }); back.className += ' rogue-return'; footer.appendChild(back); }
        dialog.appendChild(footer); overlay.appendChild(dialog);
        if (modalScroll !== null) { content.scrollTop = modalScroll; }
        var combatLog = overlay.querySelector('.rogue-combat-log');
        if (combatLog) { combatLog.scrollTop = combatLog.scrollHeight; }
    }
    /** Restores an equivalent focus target after a state render. */
    function restoreFocus(token) {
        if (!token) { return; }
        var nodes = (modal ? overlay : frame).querySelectorAll('[data-focus]');
        var i;
        for (i = 0; i < nodes.length; i++) { if (nodes[i].getAttribute('data-focus') === token && !nodes[i].disabled && nodes[i].getClientRects().length) { nodes[i].focus({ preventScroll: true }); return; } }
    }
    /** Moves focus into the current dialog without scrolling the background. */
    function focusDialog() {
        var first = overlay.querySelector('input, button:not(:disabled)');
        if (first) { first.focus({ preventScroll: true }); }
    }
    /** Saves UI preferences separately from either game's progress. */
    function preferences() {
        document.documentElement.classList.toggle('rogue-dark', !!R.ui.preferences.dark);
        root.style.setProperty('--rogue-font-size', R.ui.preferences.font + 'px');
        try { localStorage.setItem('roguePreferences', JSON.stringify(R.ui.preferences)); } catch (error) { R.ui.notice('err.savefull'); }
    }
    /** Opens a specified run and records its slot in the URL for refresh continuity. */
    function start(save) {
        R.state.current = save; selected = null; clearModals(); R.map.reset(); activeTab = 'map'; campView = 'overview'; menuPage = 0; tabScroll = { map: 0, camp: 0, party: 0 };
        storageOptions = { member: 'player', quantity: 10, filter: 'all', page: 0 }; peekView = 'nearby';
        try { history.replaceState(null, '', '?mode=rogue&slot=' + save.slot); } catch (error) { /* File-origin WebViews may restrict history replacement. */ }
        R.ui.render(); window.scrollTo(0, 0);
    }
    /** Executes a short route as discrete player actions, stopping immediately for any encounter. */
    function walk(x, y) {
        var save = R.state.current;
        var route = R.map.path(save, x, y);
        if (!route) { R.ui.notice('err.route'); return; }
        clearModals(); activeTab = 'map';
        var i;
        for (i = 0; i < Math.min(route.length, N.ROUTE_STEPS); i++) {
            if (!R.state.act({ type: 'move', dir: route[i] }) || save.flags.combat || save.flags.wildEvent || save.flags.outpost || (save.over && !save.flags.abyss)) { break; }
        }
        R.ui.render();
    }
    /** Clears suspended interface layers when changing the active run or destination. */
    function clearModals() { modal = null; modalOptions = null; modalStack = []; modalScroll = null; returnFocus = null; }
    /** Switches primary panels while remembering each panel's reading position. */
    function switchTab(tab) {
        tabScroll[activeTab] = window.pageYOffset; activeTab = tab; R.ui.render(); window.scrollTo(0, tabScroll[tab] || 0);
    }
    /** Handles a delegated button action without introducing a simulation clock. */
    function dispatch(action) {
        var save = R.state.current;
        noticeKey = null;
        if (action.type === 'tab') { switchTab(action.tab); }
        else if (action.type === 'back') { R.ui.back(); }
        else if (action.type === 'campView') { activeTab = 'camp'; campView = action.view; menuPage = 0; R.ui.render(); window.scrollTo(0, 0); }
        else if (action.type === 'peek') { if (document.getElementById('rogue-explore-preview')) { peekView = action.view; R.ui.render(); if (!document.getElementById('rogue-explore-preview')) { R.ui.open(action.view); } } else { R.ui.open(action.view); } }
        else if (action.type === 'storageView') { R.ui.open('storage', { scope: action.scope, member: action.member || 'player', quantity: 10, filter: 'all', page: 0 }); }
        else if (action.type === 'storageOption') { var options = modal === 'storage' ? modalOptions : storageOptions; options[action.key] = action.value; if (action.key !== 'page') { options.page = 0; } if (modal) { modalScroll = 0; } R.ui.render(); }
        else if (action.type === 'exploreView') { modal = action.view; modalScroll = 0; R.ui.render(); focusDialog(); }
        else if (action.type === 'campFilter') { campFilter = action.filter; menuPage = 0; R.ui.render(); window.scrollTo(0, 0); }
        else if (action.type === 'campPage') { menuPage = Math.max(0, menuPage + action.delta); R.ui.render(); window.scrollTo(0, 0); }
        else if (action.type === 'memberView') { R.ui.open('member', { member: action.member }); }
        else if (action.type === 'bagView') { if (action.member === 'store') { R.ui.open('storage', { scope: 'store', member: 'player', quantity: 10, filter: 'all', page: 0 }); } else { R.ui.open('bag', { member: action.member, page: 0 }); } }
        else if (action.type === 'gearView') { R.ui.open('gear', { member: action.member, kind: action.kind, page: 0 }); }
        else if (action.type === 'itemView') { R.ui.open('item', { member: action.member, item: action.item }); }
        else if (action.type === 'bagPage') { modalOptions.page = Math.max(0, action.page); modalScroll = 0; R.ui.render(); }
        else if (action.type === 'confirmDismiss') { R.ui.open('confirm', { title: 'ui.dismissTitle', body: 'ui.dismissBody', action: { type: 'dismiss', member: action.member } }); }
        else if (action.type === 'confirmClaim') { R.ui.open('confirm', { title: 'ui.claimTitle', body: save.camps.length >= N.MAX_CAMPS ? 'ui.claimReplaceBody' : 'ui.claimBody', action: { type: 'outpost', op: 'claim', replace: save.camps.length >= N.MAX_CAMPS } }); }
        else if (action.type === 'waterWarning') { R.ui.preferences.waterWarning = !R.ui.preferences.waterWarning; preferences(); if (save) { R.wild.warn(save); R.save.write(save); } R.ui.render(); }
        else if (action.type === 'confirmTemp') { if (save.flags.tempCamp) { R.ui.open('confirm', { title: 'ui.tempReplaceTitle', body: 'ui.tempReplaceBody', action: { type: 'deployTemp' } }); } else { R.state.act({ type: 'deployTemp' }); } }
        else if (action.type === 'confirmPack') { R.ui.open('confirm', { title: 'ui.tempPackTitle', body: 'ui.tempPackBody', action: { type: 'packTemp' } }); }
        else if (action.type === 'confirmDrop') { R.ui.open('confirm', { title: 'ui.dropTitle', body: 'ui.dropBody', values: { n: format(Math.min(N.DROP_BUNDLE, R.party.member(save, action.member).bag[action.item] || 0)), name: R.t('item.' + action.item) }, action: { type: 'drop', member: action.member, item: action.item } }); }
        else if (action.type === 'home') { if (save) { R.ui.open('confirm', { title: 'ui.exitTitle', body: 'ui.exitBody', action: { type: 'exitHome' } }); } else { R.home(); } }
        else if (action.type === 'exitHome') { R.home(); }
        else if (action.type === 'modal') { R.ui.open(action.kind); }
        else if (action.type === 'closeModal') { R.ui.close(); }
        else if (action.type === 'new') { R.ui.open('new', { slot: action.slot }); }
        else if (action.type === 'resume') { var loaded = R.save.load(action.slot); if (loaded) { start(loaded); } else { R.ui.notice('err.corrupt'); } }
        else if (action.type === 'create') {
            var raw = document.getElementById('rogue-seed').value.trim();
            if (raw && (!/^[0-9]+$/.test(raw) || Number(raw) > 4294967295)) { R.ui.notice('err.invalidSeed'); return; }
            var seed;
            if (raw) { seed = Number(raw); }
            else if (window.crypto && window.crypto.getRandomValues) { var bytes = new Uint32Array(1); window.crypto.getRandomValues(bytes); seed = bytes[0]; }
            else { seed = R.hash(Date.now(), String(performance.now())); }
            var created = R.state.create({ slot: action.slot, seed: seed });
            if (R.save.write(created)) { start(created); }
        } else if (action.type === 'confirmed') { R.ui.close(); dispatch(action.action); }
        else if (action.type === 'confirmDelete') { R.ui.open('confirm', { title: 'ui.deleteTitle', body: 'ui.deleteBody', action: { type: 'delete', slot: action.slot } }); }
        else if (action.type === 'delete') { R.save.remove(action.slot); R.ui.render(); }
        else if (action.type === 'confirmCheat') { R.ui.open('confirm', { title: 'ui.cheatConfirm', body: 'ui.cheatHint', action: { type: 'cheat' } }); }
        else if (action.type === 'confirmDismantle') { R.ui.open('confirm', { title: 'ui.moveCamp', body: 'ui.moveCampHint', action: { type: 'dismantle' } }); }
        else if (action.type === 'confirmLaunch') { R.ui.open('confirm', { title: 'ui.launchTitle', body: 'ui.launchBody', action: { type: 'launch' } }); }
        else if (action.type === 'confirmRestart') { R.ui.open('confirm', { title: 'ui.restartConfirm', body: 'ui.restartBody', action: { type: 'restart', slot: action.slot } }); }
        else if (action.type === 'restart') { R.ui.open('new', { slot: action.slot }); }
        else if (action.type === 'slots') {
            if (save && !R.save.write(save)) { return; }
            R.state.current = null; clearModals(); selected = null;
            try { history.replaceState(null, '', '?mode=rogue'); } catch (error) { /* Navigation still works without history access. */ }
            R.ui.render(); window.scrollTo(0, 0);
        } else if (action.type === 'selectCamp') { save.activeCamp = action.camp; R.save.write(save); R.ui.render(); }
        else if (action.type === 'selectSite') {
            var site = R.map.site(save, action.site); selected = { site: site.id, x: site.x, y: site.y, region: save.party.region }; clearModals(); activeTab = 'map'; R.ui.render();
            root.querySelector('.rogue-context').scrollIntoView({ block: 'nearest' });
        } else if (action.type === 'route') { walk(action.x, action.y); }
        else if (action.type === 'gate') {
            if (save.flags.insideDungeon) { return; }
            var delta = R.map.directions[action.dir];
            var x = delta[0] < 0 ? 1 : delta[0] > 0 ? N.REGION_SIZE - 2 : N.REGION_CENTER;
            var y = delta[1] < 0 ? 1 : delta[1] > 0 ? N.REGION_SIZE - 2 : N.REGION_CENTER;
            selected = { x: x, y: y, region: save.party.region }; clearModals(); activeTab = 'map';
            if (save.party.x === x && save.party.y === y) { R.state.act({ type: 'move', dir: action.dir }); }
            else { walk(x, y); }
        } else if (action.type === 'theme') { R.ui.preferences.dark = action.dark; preferences(); R.ui.render(); }
        else if (action.type === 'font') { R.ui.preferences.font = R.clamp(R.ui.preferences.font + action.delta, 16, 22); preferences(); R.ui.render(); }
        else if (action.type === 'speed') { save.speed = action.speed; R.save.write(save); R.ui.render(); }
        else if (action.type === 'save') { if (R.save.write(save)) { R.ui.notice('ui.saved'); } }
        else if (action.type === 'native') { window.location.href = 'adr-offline://' + action.target; }
        else if (action.type === 'restoreBackup') { R.importJSON(action.raw); }
        else if (action.type === 'target') { save.flags.combat.target = action.target; R.save.write(save); R.ui.render(); }
        else if (action.type === 'abyss') { R.dungeon.enterAbyss(save); R.ui.render(); }
        else {
            if (action.type === 'move') { selected = null; }
            if (!R.state.act(action)) { R.ui.renderNotice(); }
        }
    }
    /** Delegates controls and selectable explored map tiles. */
    function clicked(event) {
        var target = event.target.closest && event.target.closest('[data-rogue-action]');
        if (target && root.contains(target) && !target.disabled) { event.preventDefault(); dispatch(target._rogueAction); return; }
        var cell = event.target.closest && event.target.closest('.rogue-grid [data-x]');
        if (cell && R.state.current && !R.state.current.flags.insideDungeon) {
            selected = { x: Number(cell.getAttribute('data-x')), y: Number(cell.getAttribute('data-y')), site: cell.getAttribute('data-site'), region: R.state.current.party.region };
            R.ui.render();
        }
        if (event.target === overlay && modal !== 'combat') { R.ui.close(); }
    }
    /** Preserves disclosure expansion independently of game turns. */
    function toggled(event) { if (event.target.hasAttribute && event.target.hasAttribute('data-section')) { sections[event.target.getAttribute('data-section')] = event.target.open; } }
    /** Submits the seed form with Enter without navigating away. */
    function submitted(event) {
        if (event.target.id === 'rogue-new-form') { event.preventDefault(); dispatch({ type: 'create', slot: modalOptions.slot }); }
    }
    /** Supports movement shortcuts, dialog focus trapping and layered back navigation. */
    function keyed(event) {
        if (event.key === 'Escape') { event.preventDefault(); R.ui.back(); return; }
        if (modal && event.key === 'Tab') {
            var controls = overlay.querySelectorAll('button:not(:disabled), input, a[href]');
            var visible = [];
            var i;
            for (i = 0; i < controls.length; i++) { if (controls[i].getClientRects().length) { visible.push(controls[i]); } }
            if (!visible.length) { event.preventDefault(); return; }
            var first = visible[0]; var last = visible[visible.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            return;
        }
        if (modal || !R.state.current || /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName)) { return; }
        var keys = { ArrowUp: 'north', w: 'north', W: 'north', ArrowRight: 'east', d: 'east', D: 'east', ArrowDown: 'south', s: 'south', S: 'south', ArrowLeft: 'west', a: 'west', A: 'west' };
        if (keys[event.key] && activeTab === 'map') { event.preventDefault(); dispatch({ type: 'move', dir: keys[event.key] }); }
        else if (event.code === 'Space' && activeTab === 'map' && event.target.tagName !== 'BUTTON') { event.preventDefault(); dispatch({ type: 'wait' }); }
    }
    /** Reflows responsive previews and fixed-control spacing when the viewport changes. */
    function resized() { if (root) { R.ui.render(); } }
    R.ui = {
        costText: costText,
        preferences: { dark: false, font: 16, waterWarning: true },
        /** Mounts the three panels, responsive navigation and one reusable modal layer. */
        mount: function () {
            root = el('div', 'rogue-root'); root.id = 'rogue-root';
            try {
                var prefs = JSON.parse(localStorage.getItem('roguePreferences') || 'null');
                var normal = null;
                if (!prefs) { try { normal = JSON.parse(localStorage.getItem('gameState') || 'null'); } catch (invalidNormal) { /* Independent preferences remain usable with a damaged ordinary save. */ } }
                this.preferences.waterWarning = !prefs || prefs.waterWarning !== false;
                this.preferences.dark = prefs ? !!prefs.dark : !!(normal && normal.config && normal.config.lightsOff);
                this.preferences.font = R.clamp(Number(prefs ? prefs.font : localStorage.getItem('offlineFontSize')) || 16, 16, 22);
            } catch (error) { /* Invalid normal saves must never prevent an independent Rogue run. */ }
            document.documentElement.classList.toggle('rogue-dark', this.preferences.dark); root.style.setProperty('--rogue-font-size', this.preferences.font + 'px');
            frame = el('div', 'rogue-frame');
            var header = el('header', 'rogue-header');
            header.appendChild(el('span', 'rogue-wordmark', R.t('ui.originalTitle')));
            var brand = el('div', 'rogue-brand'); brand.appendChild(el('span', '', R.t('ui.title'))); header.appendChild(brand);
            var pageTitle = el('span', 'rogue-eyebrow'); pageTitle.id = 'rogue-page-title'; header.appendChild(pageTitle); frame.appendChild(header);
            var launcher = el('main', 'rogue-launcher'); launcher.id = 'rogue-launcher'; frame.appendChild(launcher);
            var ending = el('main', 'rogue-ending'); ending.id = 'rogue-ending'; ending.hidden = true; frame.appendChild(ending);
            var layout = el('main', 'rogue-layout'); layout.id = 'rogue-layout';
            var names = ['map', 'camp', 'party'];
            var i;
            for (i = 0; i < names.length; i++) {
                var panel = el('section', 'rogue-panel'); panel.id = 'rogue-panel-' + names[i]; panel.setAttribute('aria-label', R.t('ui.' + names[i])); panels[names[i]] = panel; layout.appendChild(panel);
            }
            frame.appendChild(layout);
            var footer = el('footer', 'rogue-bottom'); footer.id = 'rogue-bottom';
            var liveLog = el('aside', 'rogue-live-log'); liveLog.id = 'rogue-live-log'; liveLog.setAttribute('aria-label', R.t('ui.liveLog')); footer.appendChild(liveLog);
            var campBack = el('div', 'rogue-subpage-return'); campBack.id = 'rogue-camp-back';
            var campReturn = button('ui.backTo', { type: 'campView', view: 'overview' }, { page: R.t('ui.campHome') }, false, 'camp-return'); campReturn.className += ' rogue-return'; campBack.appendChild(campReturn); footer.appendChild(campBack);
            var notice = el('p', 'rogue-notice'); notice.id = 'rogue-notice'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); notice.hidden = true; footer.appendChild(notice);
            var time = el('div', 'rogue-timebar'); time.id = 'rogue-timebar'; footer.appendChild(time);
            var nav = el('nav', 'rogue-tabs'); nav.setAttribute('aria-label', R.t('ui.mode'));
            var back = button('ui.close', { type: 'back' }); back.id = 'rogue-back'; nav.appendChild(back);
            for (i = 0; i < names.length; i++) { var tab = button('ui.' + names[i], { type: 'tab', tab: names[i] }); tab.id = 'rogue-tab-' + names[i]; tab.setAttribute('aria-controls', 'rogue-panel-' + names[i]); nav.appendChild(tab); }
            var menu = button('ui.menu', { type: 'modal', kind: 'menu' }); menu.id = 'rogue-menu'; nav.appendChild(menu);
            footer.appendChild(nav); frame.appendChild(footer); root.appendChild(frame);
            overlay = el('div', 'rogue-overlay'); overlay.hidden = true; root.appendChild(overlay); document.body.appendChild(root);
            root.addEventListener('click', clicked); root.addEventListener('toggle', toggled, true); root.addEventListener('submit', submitted); document.addEventListener('keydown', keyed); window.addEventListener('resize', resized);
            this.render();
        },
        /** Repaints current values while preserving scroll, focus and open management sections. */
        render: function () {
            if (!root) { return; }
            var token = document.activeElement && document.activeElement.getAttribute('data-focus');
            var scrollY = window.pageYOffset;
            var oldContent = overlay.querySelector('.rogue-dialog-content');
            if (modalScroll === null && oldContent && oldContent.getAttribute('data-modal') === modal) { modalScroll = oldContent.scrollTop; }
            var save = R.state.current;
            renderTime(save); renderLiveLog(save);
            var running = !!save && (!save.over || save.flags.abyss);
            var nextView = !save ? 'slots' : running ? 'run' : 'ending';
            if (root.getAttribute('data-view') !== nextView) { scrollY = 0; }
            root.setAttribute('data-tab', activeTab);
            root.setAttribute('data-camp-view', campView);
            root.setAttribute('data-view', nextView);
            var campTitles = { supplies: 'ui.supplies', stores: 'ui.shared', tempStores: 'ui.tempStorage', workers: 'ui.workers', buildings: 'ui.buildings', recipes: 'ui.recipes', research: 'ui.research', expansion: 'ui.campExpansion' };
            document.getElementById('rogue-page-title').textContent = R.t(!save ? 'ui.slots' : running ? activeTab === 'camp' && campView !== 'overview' ? campTitles[campView] : 'ui.' + activeTab : 'ui.ended');
            document.getElementById('rogue-layout').hidden = !running;
            document.getElementById('rogue-launcher').hidden = !!save;
            document.getElementById('rogue-ending').hidden = !save || running;
            document.getElementById('rogue-camp-back').hidden = !running || activeTab !== 'camp' || campView === 'overview';
            if (!save) { renderSlots(); }
            else if (running) { renderMap(save); renderCamp(save); renderParty(save); }
            else { renderEnding(save); }
            var names = ['map', 'camp', 'party'];
            var i;
            for (i = 0; i < names.length; i++) { document.getElementById('rogue-tab-' + names[i]).setAttribute('aria-current', activeTab === names[i] ? 'page' : 'false'); }
            if (modal === 'combat' && (!save || !save.flags.combat)) { clearModals(); }
            if (save && ((modal === 'event' && !save.flags.wildEvent) || (modal === 'outpost' && !save.flags.outpost))) { clearModals(); }
            if (save && save.flags.combat && (modal === 'outpost' || modal === 'event')) { clearModals(); }
            if (save && save.flags.combat && !modal) { modal = 'combat'; }
            if (save && !modal && save.flags.wildEvent) { modal = 'event'; }
            if (save && !modal && save.flags.outpost) { modal = 'outpost'; }
            var previouslyOpen = !overlay.hidden;
            renderModal(); this.renderNotice(); fitMap(); restoreFocus(token);
            modalScroll = null;
            if (modal && (!previouslyOpen || !overlay.contains(document.activeElement))) { focusDialog(); }
            if (Math.abs(window.pageYOffset - scrollY) > 1) { window.scrollTo(0, scrollY); }
        },
        /** Opens a UI-only view without advancing the simulation. */
        open: function (kind, options) {
            if (modal === kind && !options) { return; }
            var content = overlay.querySelector('.rogue-dialog-content');
            if (modal) { modalStack.push({ kind: modal, options: modalOptions, focus: returnFocus, scroll: content ? content.scrollTop : 0 }); }
            returnFocus = document.activeElement && document.activeElement.getAttribute('data-focus');
            modal = kind; modalOptions = options || null; modalScroll = 0; this.render(); focusDialog();
        },
        /** Closes an auxiliary dialog and returns to any suspended battle. */
        close: function () {
            if (modal === 'combat') { this.open('menu'); return; }
            var focus = returnFocus; var parent = modalStack.pop();
            modal = parent ? parent.kind : null; modalOptions = parent ? parent.options : null;
            modalScroll = parent ? parent.scroll : null; returnFocus = parent ? parent.focus : null;
            this.render(); restoreFocus(focus);
        },
        /** Implements layered keyboard and Android Back behavior. */
        back: function () {
            if (modal && modal !== 'combat') { this.close(); return true; }
            if (modal === 'combat') { this.open('menu'); return true; }
            if (R.state.current && activeTab === 'camp' && campView !== 'overview') { campView = 'overview'; menuPage = 0; this.render(); window.scrollTo(0, 0); return true; }
            if (R.state.current && activeTab !== 'map' && !modal) { switchTab('map'); return true; }
            if (selected && !modal) { selected = null; this.render(); return true; }
            if (R.state.current) { this.open('menu'); return true; }
            R.home(); return true;
        },
        /** Shows a translatable persistent notice without a timeout. */
        notice: function (key) { noticeKey = key; this.renderNotice(); },
        /** Updates the notice node without destroying an in-progress seed form. */
        renderNotice: function () {
            if (!root) { return; }
            var notice = document.getElementById('rogue-notice');
            var footer = document.getElementById('rogue-bottom');
            if (root.getAttribute('data-view') === 'run') { footer.insertBefore(notice, document.getElementById('rogue-timebar')); }
            else { frame.insertBefore(notice, document.getElementById('rogue-launcher')); }
            var error = noticeKey || R.save.lastError;
            notice.hidden = !error || !!modal; notice.textContent = error ? R.t(error) : '';
            if (modal && error) {
                var existing = overlay.querySelector('.rogue-modal-notice');
                if (!existing) { existing = el('p', 'rogue-modal-notice'); existing.setAttribute('role', 'alert'); overlay.querySelector('.rogue-dialog-content').insertBefore(existing, overlay.querySelector('.rogue-dialog-content').firstChild); }
                existing.textContent = R.t(error);
            }
            if (modal && !error) { var stale = overlay.querySelector('.rogue-modal-notice'); if (stale) { stale.parentNode.removeChild(stale); } }
            var bottomHeight = document.getElementById('rogue-bottom').offsetHeight + 'px';
            root.style.setProperty('--rogue-bottom-height', bottomHeight);
            document.documentElement.style.setProperty('--rogue-bottom-height', bottomHeight);
        },
        resume: start,
        /** Removes all Rogue interface nodes and event handlers on shutdown. */
        unmount: function () {
            document.removeEventListener('keydown', keyed);
            window.removeEventListener('resize', resized);
            if (root) { root.removeEventListener('click', clicked); root.removeEventListener('toggle', toggled, true); root.removeEventListener('submit', submitted); root.parentNode.removeChild(root); }
            root = null; panels = {}; clearModals(); selected = null; noticeKey = null; activeTab = 'map';
            document.body.classList.remove('rogue-modal-open'); document.documentElement.classList.remove('rogue-dark');
        }
    };
})();
