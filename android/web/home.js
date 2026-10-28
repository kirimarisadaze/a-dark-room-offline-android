/* Local title and mode selection. Does not load the engine or write game saves. MPL-2.0. */
(function () {
  'use strict';
  var title = document.getElementById('offline-home-title');
  var modes = document.getElementById('offline-home-modes');
  var main = document.getElementById('offline-home-main');
  var footer = document.querySelector('.home-footer');
  var dialog = document.getElementById('offline-home-dialog-layer');
  var start = document.getElementById('offline-home-start');
  var rogue = document.getElementById('offline-mode-rogue');
  var close = document.getElementById('offline-home-dialog-close');
  try {
    var size = Math.max(16, Math.min(22, Number(localStorage.offlineFontSize) || 16));
    document.documentElement.style.fontSize = size + 'px';
    var state = JSON.parse(localStorage.getItem('gameState') || 'null');
    document.documentElement.classList.toggle('home-dark', !!(state && state.config && state.config.lightsOff));
    if (state && state.game && typeof state.game === 'object') {
      document.getElementById('offline-mode-normal-description').textContent = '原版玩法，接续本机进度。';
    }
  } catch (error) { /* Invalid saves stay untouched; the game owns save validation. */ }

  function showModes() {
    title.hidden = true;
    modes.hidden = false;
    document.getElementById('offline-mode-heading').focus();
  }
  function closeDialog() {
    dialog.hidden = true;
    main.removeAttribute('aria-hidden');
    footer.removeAttribute('aria-hidden');
    // inert is optional on older supported WebViews; keyboard focus is also trapped below.
    main.inert = footer.inert = false;
    rogue.focus();
  }
  function back() {
    if (!dialog.hidden) { closeDialog(); return true; }
    if (!modes.hidden) {
      modes.hidden = true;
      title.hidden = false;
      start.focus();
      return true;
    }
    return false;
  }
  window.OfflineHome = { back: back };
  start.addEventListener('click', showModes);
  document.getElementById('offline-home-back').addEventListener('click', back);
  rogue.addEventListener('click', function () {
    dialog.hidden = false;
    main.setAttribute('aria-hidden', 'true');
    footer.setAttribute('aria-hidden', 'true');
    main.inert = footer.inert = true;
    close.focus();
  });
  close.addEventListener('click', closeDialog);
  dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && back()) { event.preventDefault(); }
    if (!dialog.hidden && event.key === 'Tab') { event.preventDefault(); close.focus(); }
  });
  document.addEventListener('focusin', function (event) {
    if (!dialog.hidden && !dialog.contains(event.target)) close.focus();
  });
})();
