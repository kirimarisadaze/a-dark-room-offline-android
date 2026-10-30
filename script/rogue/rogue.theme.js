/* SPDX-License-Identifier: MPL-2.0 */
/** Shares appearance preferences without writing either mode's game saves. */
(function () {
    'use strict';
    /** Reads valid preferences while preserving unknown preference fields. */
    function read() {
        try {
            var value = JSON.parse(localStorage.getItem('roguePreferences') || 'null');
            return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
        } catch (error) { return {}; }
    }
    /** Uses the shared choice, falling back read-only to the original saved theme. */
    function isDark() {
        var value = read();
        if (typeof value.dark === 'boolean') { return value.dark; }
        try {
            var normal = JSON.parse(localStorage.getItem('gameState') || 'null');
            return !!(normal && normal.config && normal.config.lightsOff);
        } catch (error) { return false; }
    }
    /** Applies page colors and notifies mounted interfaces without persisting progress. */
    function refresh() {
        var dark = isDark();
        document.documentElement.classList.toggle('home-dark', dark);
        document.documentElement.classList.toggle('rogue-dark', dark);
        document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
        window.dispatchEvent(new Event('adrthemechange'));
    }
    /** Merges only supplied appearance fields and reports storage failures. */
    function update(changes) {
        var value = read();
        Object.keys(changes).forEach(function (key) { value[key] = changes[key]; });
        try { localStorage.setItem('roguePreferences', JSON.stringify(value)); }
        catch (error) { return false; }
        refresh(); return true;
    }
    /** Persists the same explicit theme choice for the launcher and both modes. */
    function setDark(dark) { return update({ dark: !!dark }); }
    window.OfflineTheme = { read: read, isDark: isDark, update: update, setDark: setDark };
    window.addEventListener('storage', function (event) { if (event.key === 'roguePreferences' || event.key === null) { refresh(); } });
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    refresh();
})();
