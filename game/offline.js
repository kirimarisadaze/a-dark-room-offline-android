/* Offline Android integration. Game rules and upstream files remain unchanged. MPL-2.0. */
(function () {
  'use strict';
  var skipSaving = false;
  var activeModule = Engine.activeModule;
  var frame = null;
  var held = {};
  var repeatTimer = null;
  var pausedAt = null;
  var resetScroll = false;
  var fullMap = false;
  var fontSize = 16;
  var tiltX = 0;
  try { fontSize = Math.max(16, Math.min(22, Number(localStorage.offlineFontSize) || 16)); } catch (error) {}
  document.documentElement.style.setProperty('--offline-font-size', fontSize + 'px');

  window.OfflineGame = {
    save: function () {
      if (skipSaving || Engine.GAME_OVER || !window.State) { return false; }
      try { Engine.saveGame(); return true; } catch (error) { return false; }
    },
    prepareRestore: function () { skipSaving = true; OfflineGame.releaseControls(); },
    cancelRestore: function () { skipSaving = false; },
    pause: function () {
      if (pausedAt === null) { pausedAt = Date.now(); }
      OfflineGame.save();
      OfflineGame.releaseControls();
      if (AudioEngine._audioContext && AudioEngine._audioContext.state === 'running') {
        AudioEngine._audioContext.suspend().catch(function () {});
      }
    },
    resume: function () {
      OfflineGame.releaseControls();
      if (pausedAt !== null) {
        var elapsed = Math.max(0, Date.now() - pausedAt);
        var animations = [];
        // jQuery measures animation progress against wall time. WebView.pauseTimers
        // freezes callbacks, so advance their start times to keep flight/cooldowns paused.
        ($.timers || []).forEach(function (timer) {
          var animation = timer.anim;
          if (animation && animations.indexOf(animation) < 0) {
            animation.startTime += elapsed;
            animations.push(animation);
          }
        });
        Space.lastMove = Date.now();
        pausedAt = null;
      }
      if (AudioEngine._audioContext && AudioEngine._audioContext.state === 'suspended') {
        AudioEngine._audioContext.resume().catch(function () {});
      }
    },
    releaseControls: function () {
      Object.keys(held).forEach(function (key) { Engine.keyUp({ which: Number(key) }); });
      held = {};
      clearInterval(repeatTimer);
      repeatTimer = null;
      tiltX = 0;
      if (typeof Space !== 'undefined') { Space.left = Space.right = Space.up = Space.down = false; }
    },
    // Android supplies screen-relative horizontal acceleration in m/s².
    // Positive means the phone tilts left. Touch directions take priority.
    tilt: function (x) {
      tiltX = activeModule === Space ? (Number(x) || 0) : 0;
      applyTilt();
    },
    refresh: scheduleLayout
  };

  Engine.isMobile = function () { return false; };
  Engine.event = function () {};
  Engine.getApp = Engine.share = function () {};
  Events.Marketing = [];
  window.open = function () { return null; };

  // Keep the original 61x61 map and fog-of-war intact. Only its viewport changes.
  var originalDrawMap = World.drawMap;
  World.drawMap = function () {
    originalDrawMap.apply(World, arguments);
    var map = $('#map');
    map.off('click'); // The desktop click-to-walk geometry assumes an uncropped map.
    map.wrapInner('<div class="offline-map-tiles"></div>');
    if (!document.getElementById('offline-map-toolbar')) {
      var toolbar = $('<div>').attr('id', 'offline-map-toolbar').insertBefore(map);
      $('<span>').attr('id', 'offline-map-label').appendTo(toolbar);
      $('<button>').attr({ id: 'offline-map-toggle', type: 'button' })
        .on('click', function () { fullMap = !fullMap; updateMapViewport(); })
        .appendTo(toolbar);
    }
    updateMapViewport();
    scheduleLayout();
  };

  function updateMapViewport() {
    var map = document.getElementById('map');
    if (!map) { return; }
    var tiles = map.querySelector('.offline-map-tiles');
    if (!tiles) { return; }
    var label = document.getElementById('offline-map-label');
    var toggle = document.getElementById('offline-map-toggle');
    map.classList.toggle('offline-map-full', fullMap);
    if (label) { label.textContent = lang === 'zh_cn' ? (fullMap ? '全图' : '附近') : (fullMap ? 'Full map' : 'Nearby'); }
    if (toggle) {
      toggle.textContent = lang === 'zh_cn' ? (fullMap ? '查看附近' : '查看全图') : (fullMap ? 'Nearby' : 'Full map');
      toggle.setAttribute('aria-pressed', String(fullMap));
    }
    tiles.style.transform = '';
    if (fullMap) { map.style.height = ''; return; }
    var menu = document.querySelector('.menu');
    var menuTop = menu ? menu.getBoundingClientRect().top : document.documentElement.clientHeight - 100;
    var mapTop = map.getBoundingClientRect().top;
    // Reserve a row for the map's four touch directions below the viewport.
    map.style.height = Math.min(320, Math.max(100, menuTop - mapTop - 84)) + 'px';
    var wanderer = Array.prototype.find.call(tiles.querySelectorAll('.landmark'), function (node) {
      return node.firstChild && node.firstChild.nodeValue === '@';
    });
    if (wanderer) {
      var playerBounds = wanderer.getBoundingClientRect();
      var tileBounds = tiles.getBoundingClientRect();
      var x = map.clientWidth / 2 - (playerBounds.left - tileBounds.left + playerBounds.width / 2);
      var y = map.clientHeight / 2 - (playerBounds.top - tileBounds.top + playerBounds.height / 2);
      tiles.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    }
  }

  // Several game modules change activeModule directly (expeditions, crashes, liftoff).
  Object.defineProperty(Engine, 'activeModule', {
    configurable: true,
    get: function () { return activeModule; },
    set: function (module) {
      OfflineGame.releaseControls();
      activeModule = module;
      if (module === World || module === Space) { resetScroll = true; }
      scheduleLayout();
    }
  });

  // Save first, including the chosen language, before the page is replaced.
  Engine.switchLanguage = function () {};
  Engine.saveLanguage = function () { localStorage.lang = 'zh_cn'; };

  // An unload save must never overwrite an imported save or a deliberate restart.
  var originalImport = Engine.import64;
  Engine.import64 = function (value) {
    try {
      var decoded = JSON.parse(Base64.decode(String(value).replace(/[\s.]/g, '')));
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) || !decoded.game) {
        throw new Error('Invalid save');
      }
    } catch (error) {
      alert(lang === 'zh_cn' ? '存档代码无效，当前进度已保留。' : 'Invalid save code. Your current progress has been kept.');
      return;
    }
    skipSaving = true;
    originalImport(value);
  };
  var originalDelete = Engine.deleteSave;
  Engine.deleteSave = function (noReload) {
    skipSaving = true;
    originalDelete(noReload);
  };

  // Retain scores and restart, and omit the web edition's store advertisements.
  var originalEnding = Space.showEndingOptions;
  Space.showEndingOptions = function () {
    originalEnding();
    $('.centerCont > .endGame').each(function (index) { if (index > 2) { $(this).remove(); } });
    scheduleLayout();
  };

  var originalInit = Engine.init;
  Engine.init = function (options) {
    originalInit.call(Engine, options);
    var menu = $('.menu');
    menu.find('.appStore, .customSelect').remove();
    menu.children('.menuBtn').filter(function () {
      return $(this).text() === _('share.') || $(this).text() === _('github.');
    }).remove();
    var fonts = $('<div>').attr('id', 'offline-font-controls').appendTo(menu);
    $('<button>').attr({ id: 'offline-font-smaller', type: 'button', 'aria-label': '缩小字号' })
      .text('A−').on('click', function () { changeFont(-1); }).appendTo(fonts);
    $('<button>').attr({ id: 'offline-font-larger', type: 'button', 'aria-label': '放大字号' })
      .text('A+').on('click', function () { changeFont(1); }).appendTo(fonts);
    changeFont(0);
    $('<a>').addClass('offline-about').attr('href', 'about.html')
      .text(lang === 'zh_cn' ? '关于' : 'about').on('click', OfflineGame.save).appendTo(menu);
    createControls();
    $('<div>').attr('id', 'offline-flight-hint').text('左右倾斜手机，或使用方向键').appendTo('body');
    // Keep the shared inventory outside individual hidden location panels.
    $('#storesContainer').appendTo('#main');
    $('#outerSlider').off('swipeleft swiperight swipeup swipedown');
    var observer = new MutationObserver(function (changes) {
      if (changes.some(function (change) {
        return Array.prototype.some.call(change.addedNodes, function (node) {
          return node.nodeType === 1 && (node.classList.contains('location') || node.id === 'storesContainer');
        });
      })) { scheduleLayout(); }
    });
    observer.observe(document.getElementById('wrapper'), { childList: true, subtree: true });
    scheduleLayout();
  };

  function scheduleLayout() {
    if (frame === null) {
      frame = requestAnimationFrame(function () { frame = null; layout(); });
    }
  }

  function changeFont(delta) {
    fontSize = Math.max(16, Math.min(22, fontSize + delta));
    document.documentElement.style.setProperty('--offline-font-size', fontSize + 'px');
    try { localStorage.offlineFontSize = String(fontSize); } catch (error) {}
    $('#offline-font-smaller').prop('disabled', fontSize <= 16);
    $('#offline-font-larger').prop('disabled', fontSize >= 22);
    scheduleLayout();
  }

  function applyTilt() {
    if (activeModule !== Space || Engine.keyLock || Space.done) { return; }
    var horizontalTouch = held[37] || held[39];
    Space.left = horizontalTouch ? !!held[37] : tiltX > 1.2;
    Space.right = horizontalTouch ? !!held[39] : tiltX < -1.2;
    Space.up = !!held[38];
    Space.down = !!held[40];
  }

  function layout() {
    if (!document.body || !activeModule) { return; }
    var inWorld = activeModule === World;
    var inSpace = activeModule === Space && !Engine.GAME_OVER;
    document.body.classList.toggle('offline-world', inWorld);
    document.body.classList.toggle('offline-space', inSpace);
    $('.location').removeClass('offline-active');
    if (activeModule.panel) { activeModule.panel.addClass('offline-active'); }
    var controls = document.getElementById('offline-controls');
    if (controls) { controls.hidden = !(inWorld || (inSpace && !Space.done)); }
    var menu = document.querySelector('.menu');
    if (controls && menu) { controls.style.bottom = (menu.getBoundingClientRect().height + 12) + 'px'; }
    if (inSpace) {
      // All flight positions, collision bounds and asteroid paths use a 700px plane.
      var content = document.getElementById('content');
      var visibleWidth = content ? content.clientWidth : document.documentElement.clientWidth - 32;
      var scale = Math.min(1, Math.max(0.25, visibleWidth / 700));
      $('#spacePanel').css('transform', 'scale(' + scale + ')');
      $('#outerSlider').css('min-height', (700 * scale) + 'px');
    } else {
      $('#outerSlider').css('min-height', '');
    }
    var stores = $('#storesContainer');
    if (stores.length && stores.parent().attr('id') !== 'main') { stores.appendTo('#main'); }
    document.body.classList.toggle('offline-dark', Engine.isLightsOff());
    if (resetScroll) { window.scrollTo(0, 0); resetScroll = false; }
    if (inWorld) { updateMapViewport(); }
  }

  function createControls() {
    if (document.getElementById('offline-controls')) { return; }
    var controls = document.createElement('div');
    controls.id = 'offline-controls';
    controls.hidden = true;
    controls.setAttribute('aria-label', '方向控制');
    var directions = [ ['up', '↑', 38, '向上'], ['left', '←', 37, '向左'], ['down', '↓', 40, '向下'], ['right', '→', 39, '向右'] ];
    directions.forEach(function (direction) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'offline-direction ' + direction[0];
      button.setAttribute('data-direction', direction[0]);
      button.textContent = direction[1];
      button.setAttribute('aria-label', direction[3]);
      button.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        if (Engine.keyLock || (activeModule !== World && activeModule !== Space)) { return; }
        button.setPointerCapture(event.pointerId);
        held[direction[2]] = true;
        Engine.keyDown({ which: direction[2], keyCode: direction[2] });
        applyTilt();
        // World movement repeats slowly; flight has its own 30fps movement loop.
        if (activeModule === World && !repeatTimer) {
          repeatTimer = setInterval(function () {
            if (activeModule !== World || Engine.keyLock) { return; }
            Object.keys(held).forEach(function (key) { Engine.keyDown({ which: Number(key) }); });
          }, 350);
        }
      });
      function release(event) {
        if (event) { event.preventDefault(); }
        if (!held[direction[2]]) { return; }
        delete held[direction[2]];
        Engine.keyUp({ which: direction[2] });
        applyTilt();
        if (!Object.keys(held).length) { clearInterval(repeatTimer); repeatTimer = null; }
      }
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      controls.appendChild(button);
    });
    document.body.appendChild(controls);
  }

  var originalLights = Engine.turnLightsOff;
  Engine.turnLightsOff = function () { originalLights(); scheduleLayout(); };
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('blur', OfflineGame.releaseControls);
  window.addEventListener('pagehide', OfflineGame.save);
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { OfflineGame.releaseControls(); OfflineGame.save(); }
  });
  // Normal links to the bundled attribution page also keep the latest state.
  document.addEventListener('click', function (event) {
    var link = event.target.closest && event.target.closest('a');
    if (link) { OfflineGame.save(); }
  }, true);
})();
