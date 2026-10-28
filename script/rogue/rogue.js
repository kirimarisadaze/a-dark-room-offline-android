/* SPDX-License-Identifier: MPL-2.0 */
/** Assembles the independent mode and its Android lifecycle bridge. */
(function () {
    'use strict';
    var R = window.Rogue;
    var originalTitle = null;
    var viewport = null;
    window.ROGUE_MODE = /(?:^|[?&])mode=rogue(?:&|$)/.test(window.location.search);
    /** Saves the active expedition when leaving the page or hiding the application. */
    function saveCurrent() { return R.state.current ? R.save.write(R.state.current) : false; }
    /** Saves only on a hidden document; there is no background simulation. */
    function visibilityChanged() { if (document.hidden) { saveCurrent(); } }
    /** Initializes Rogue without initializing Engine, StateManager or any normal save. */
    R.boot = function () {
        if (document.getElementById('rogue-root') || window.__ADR_BOOT_ERROR) { return; }
        originalTitle = document.title; document.title = R.t('ui.title') + ' · ' + R.t('ui.mode');
        if (!document.querySelector('meta[name="viewport"]')) {
            viewport = document.createElement('meta'); viewport.name = 'viewport';
            viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover'; document.head.appendChild(viewport);
        }
        document.body.classList.add('rogue-mode'); document.documentElement.classList.add('rogue-active'); R.ui.mount();
        window.addEventListener('pagehide', saveCurrent); document.addEventListener('visibilitychange', visibilityChanged);
        var match = /(?:^|[?&])slot=([0-2])(?:&|$)/.exec(window.location.search);
        if (match) {
            var save = R.save.load(Number(match[1]));
            if (save) { R.ui.resume(save); }
            else if (R.save.lastError) { R.ui.notice(R.save.lastError); }
        }
    };
    /** Removes Rogue DOM and lifecycle handlers without writing any normal-mode state. */
    R.shutdown = function () {
        window.removeEventListener('pagehide', saveCurrent); document.removeEventListener('visibilitychange', visibilityChanged);
        R.ui.unmount(); R.map.reset(); R.state.current = null;
        document.body.classList.remove('rogue-mode'); document.documentElement.classList.remove('rogue-active');
        document.documentElement.style.removeProperty('--rogue-bottom-height');
        if (viewport) { viewport.parentNode.removeChild(viewport); viewport = null; }
        if (originalTitle !== null) { document.title = originalTitle; originalTitle = null; }
    };
    /** Saves the active run and returns to the existing offline title screen. */
    R.home = function () {
        if (R.state.current && !saveCurrent()) { return; }
        R.shutdown(); window.location.href = 'home.html';
    };
    /** Exports only the active Rogue slot using the Android host's UTF-8 Base64 format. */
    R.export64 = function () {
        if (!R.state.current || !saveCurrent()) { return null; }
        return Base64.encode(R.save.serialize(R.state.current));
    };
    /** Restores a validated Rogue backup into the currently selected Rogue slot only. */
    R.importJSON = function (raw) {
        if (!R.state.current) { return false; }
        var restored = R.save.deserialize(raw);
        if (!restored) { return R.fail('err.corrupt'); }
        restored.slot = R.state.current.slot;
        if (!R.save.write(restored)) { return false; }
        R.ui.resume(restored); R.ui.notice('ui.saved'); return true;
    };
    /** Shows a localized confirmation before applying a native file-picker backup. */
    R.confirmRestore = function (raw) {
        if (!R.save.deserialize(raw)) { return R.fail('err.corrupt'); }
        R.ui.open('confirm', { title: 'ui.restoreTitle', body: 'ui.restoreBody', action: { type: 'restoreBackup', raw: raw } });
        return true;
    };
    /** Exposes only Rogue persistence and navigation to the Android host. */
    R.nativeBridge = function () {
        window.OfflineGame = {
            save: saveCurrent,
            pause: saveCurrent,
            /** Resumes the static interface without advancing any turns. */
            resume: function () {},
            /** Consumes irrelevant tilt samples while the character map is active. */
            tilt: function () {},
            /** Handles Android Back using the same modal hierarchy as Escape. */
            back: function () { return R.ui.back(); },
            /** Reloads the current Rogue URL and resumes its selected slot. */
            reload: function () { window.location.reload(); },
            /** Prevents a normal save import from replacing an active Rogue session. */
            prepareRestore: function () {},
            /** Leaves the active session available after a cancelled import. */
            cancelRestore: function () {}
        };
    };
})();
