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
  var gameSpeed = 1;
  var initializing = false;
  var gameTimers = {};
  var nextGameTimer = -1;
  var nativeTimeout = window.setTimeout.bind(window);
  var nativeClearTimeout = window.clearTimeout.bind(window);
  var nativeInterval = window.setInterval.bind(window);
  var nativeClearInterval = window.clearInterval.bind(window);
  try { fontSize = Math.max(16, Math.min(22, Number(localStorage.offlineFontSize) || 16)); } catch (error) {}
  document.documentElement.style.setProperty('--offline-font-size', fontSize + 'px');

  window.OfflineGame = {
    save: function () {
      if (skipSaving || Engine.GAME_OVER || !window.State) { return false; }
      try { Engine.saveGame(); return true; } catch (error) { return false; }
    },
    reload: function () {
      if (window.ADRNativeLocalApp === true) { location.href = 'adr-offline://reload'; }
      else { location.reload(); }
    },
    prepareRestore: function () { skipSaving = true; OfflineGame.releaseControls(); },
    cancelRestore: function () { skipSaving = false; },
    getSpeed: function () { return gameSpeed; },
    setSpeed: function (value) {
      var next = Number(value);
      if ([1, 2, 3, 4].indexOf(next) < 0) { return false; }
      var previous = gameSpeed;
      var now = performance.now();
      gameSpeed = next;
      Engine.options.doubleTime = next > 1;
      if (window.State) {
        State.config.offlineSpeed = next;
        State.config.hyperMode = next > 1;
      }
      Object.keys(gameTimers).forEach(function (id) {
        var task = gameTimers[id];
        if (task.running) { return; }
        task.remaining = Math.max(0, task.remaining - (now - task.started) * task.rate);
        nativeClearTimeout(task.nativeId);
        scheduleGameTimer(task);
      });
      // Retain the same percentage of every active cooldown when changing speed.
      var animationNow = Date.now();
      ($.timers || []).forEach(function (timer) {
        if (!timer.anim || !$(timer.elem).hasClass('cooldown')) { return; }
        var animation = timer.anim;
        animation.startTime = animationNow - (animationNow - animation.startTime) * previous / next;
        animation.duration *= previous / next;
      });
      $('#offline-speed-controls button').each(function () {
        $(this).attr('aria-pressed', Number(this.getAttribute('data-speed')) === next ? 'true' : 'false');
      });
      OfflineGame.save();
      return true;
    },
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
        Object.keys(gameTimers).forEach(function (id) { gameTimers[id].started += elapsed; });
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

  function scheduleGameTimer(task) {
    task.started = performance.now();
    task.rate = gameSpeed;
    task.nativeId = nativeTimeout(function () {
      if (!gameTimers[task.id]) { return; }
      if (!task.repeat) { delete gameTimers[task.id]; }
      task.running = true;
      try { task.callback.call(window); }
      finally {
        task.running = false;
        if (task.repeat && gameTimers[task.id]) {
          task.remaining = task.delay;
          scheduleGameTimer(task);
        }
      }
    }, Math.max(1, task.remaining / gameSpeed));
  }

  function gameTimer(callback, delay, repeat) {
    var id = nextGameTimer--;
    var duration = Math.max(0, Number(delay) || 0);
    var task = gameTimers[id] = { id: id, callback: callback, delay: duration, remaining: duration, repeat: repeat };
    scheduleGameTimer(task);
    return id;
  }

  function clearGameTimer(id) {
    if (!gameTimers[id]) { return false; }
    nativeClearTimeout(gameTimers[id].nativeId);
    delete gameTimers[id];
    return true;
  }
  window.clearTimeout = function (id) { if (!clearGameTimer(id)) { nativeClearTimeout(id); } };
  window.clearInterval = function (id) { if (!clearGameTimer(id)) { nativeClearInterval(id); } };
  Engine.setTimeout = function (callback, delay, unscaled) {
    return unscaled ? nativeTimeout(callback, delay) : gameTimer(callback, delay, false);
  };
  Engine.setInterval = function (callback, delay, unscaled) {
    return unscaled ? nativeInterval(callback, delay) : gameTimer(callback, delay, true);
  };
  Engine.getSpeed = OfflineGame.getSpeed;
  var originalLoadGame = Engine.loadGame;
  Engine.loadGame = function () {
    originalLoadGame.apply(Engine, arguments);
    if (!State.config || typeof State.config !== 'object') { State.config = {}; }
    var saved = Number(State.config.offlineSpeed);
    gameSpeed = [1, 2, 3, 4].indexOf(saved) >= 0 ? saved : (State.config.hyperMode ? 2 : 1);
    Engine.options.doubleTime = gameSpeed > 1;
    State.config.offlineSpeed = gameSpeed;
    State.config.hyperMode = gameSpeed > 1;
  };
  Engine.triggerHyperMode = function () {
    if (!initializing) { OfflineGame.setSpeed(gameSpeed === 1 ? 2 : 1); }
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
  var originalSpaceTitle = Space.setTitle;
  Space.setTitle = function () { originalSpaceTitle.apply(Space, arguments); updateFlightStatus(); };
  var originalSpaceHull = Space.updateHull;
  Space.updateHull = function () { originalSpaceHull.apply(Space, arguments); updateFlightStatus(); };

  function updateFlightStatus() {
    var status = $('#offline-flight-status');
    if (!status.length) { return; }
    $('#offline-flight-hull').text('船体 ' + Space.hull + '/' + Ship.getMaxHull());
    $('#offline-flight-layer').text(document.title);
  }

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
    var menu = document.getElementById('offline-bottom-bar');
    var menuTop = menu ? menu.getBoundingClientRect().top : document.documentElement.clientHeight - 100;
    var mapTop = map.getBoundingClientRect().top;
    // Reserve the direction row below the viewport, outside the map itself.
    map.style.height = Math.min(360, Math.max(150, menuTop - mapTop - 84)) + 'px';
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
    try {
      localStorage.setItem('gameState', JSON.stringify(decoded));
    } catch (error) {
      skipSaving = false;
      alert('无法写入存档，当前进度已保留。请检查手机存储空间后重试。');
      return;
    }
    skipSaving = true;
    OfflineGame.reload();
  };
  var originalDelete = Engine.deleteSave;
  Engine.deleteSave = function (noReload) {
    skipSaving = true;
    originalDelete(true);
    if (!noReload) { OfflineGame.reload(); }
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
    initializing = true;
    try { originalInit.call(Engine, options); }
    finally { initializing = false; }
    $('.menu').remove();
    createShell();
    changeFont(0);
    createControls();
    var flightStatus = $('<div>').attr('id', 'offline-flight-status').appendTo('body');
    $('<span>').attr('id', 'offline-flight-hull').appendTo(flightStatus);
    $('<span>').attr('id', 'offline-flight-layer').appendTo(flightStatus);
    $('<div>').attr('id', 'offline-flight-hint').text('左右倾斜手机，或使用方向键').appendTo('body');
    // Keep the shared inventory outside individual hidden location panels.
    $('#storesContainer').appendTo('#main');
    $('#outerSlider').off('swipeleft swiperight swipeup swipedown');
    var observer = new MutationObserver(function (changes) {
      if (changes.some(function (change) {
        return Array.prototype.some.call(change.addedNodes, function (node) {
          return node.nodeType === 1 && (node.classList.contains('location') ||
            node.classList.contains('workerRow') || node.classList.contains('outfitRow') ||
            ['storesContainer', 'village', 'workers', 'perks', 'blueprints'].indexOf(node.id) >= 0);
        });
      })) { scheduleLayout(); }
    });
    observer.observe(document.getElementById('wrapper'), { childList: true, subtree: true });
    scheduleLayout();
  };

  function createShell() {
    $('<button>').attr({ id: 'offline-sheet-backdrop', type: 'button', hidden: true,
      'aria-label': '关闭面板' }).on('click', closeSheets).appendTo('body');
    var bar = $('<div>').attr('id', 'offline-bottom-bar').addClass('menu').appendTo('body');
    var messagesButton = $('<button>').attr({ id: 'offline-messages-button', type: 'button',
      'aria-controls': 'offline-messages-panel', 'aria-expanded': 'false' }).appendTo(bar);
    $('<span>').addClass('offline-bar-label').text('消息').appendTo(messagesButton);
    $('<span>').attr('id', 'offline-message-preview').appendTo(messagesButton);
    $('<button>').attr({ id: 'offline-menu-button', type: 'button', 'aria-controls': 'offline-menu-panel',
      'aria-expanded': 'false' }).text('菜单').appendTo(bar).on('click', function (event) { toggleSheet('menu', event); });
    messagesButton.on('click', function (event) { toggleSheet('messages', event); });

    var menu = makeSheet('menu', '菜单');
    var settings = $('<div>').addClass('offline-settings-grid').appendTo(menu);
    function action(id, className, label, handler) {
      return $('<button>').attr({ id: id, type: 'button' }).addClass(className)
        .text(label).on('click', function () { closeSheets(); handler(); }).appendTo(settings);
    }
    action('offline-sound', 'volume', $SM.get('config.soundOn') ? '关闭音效' : '开启音效', Engine.toggleVolume);
    action('offline-lights', 'lightsOff', Engine.isLightsOff() ? '日间模式' : '夜间模式', Engine.turnLightsOff);
    action('offline-save', '', '存档代码', Engine.exportImport);
    $('<a>').attr({ id: 'offline-backup', href: 'adr-offline://backup' }).text('备份到文件').appendTo(settings);
    $('<a>').attr({ id: 'offline-restore', href: 'adr-offline://restore' }).text('从文件恢复').appendTo(settings);
    action('offline-restart', '', '重新开始', Engine.confirmDelete);
    $('<a>').attr({ id: 'offline-about', href: 'about.html' }).text('关于与许可')
      .on('click', function () { OfflineGame.save(); closeSheets(); }).appendTo(settings);
    settings.children('a').on('click', closeSheets);
    var speeds = $('<div>').attr('id', 'offline-speed-controls').appendTo(menu);
    $('<div>').attr('id', 'offline-speed-label').text('游戏速度').appendTo(speeds);
    var choices = $('<div>').addClass('offline-speed-options').attr({ role: 'group', 'aria-labelledby': 'offline-speed-label' }).appendTo(speeds);
    [1, 2, 3, 4].forEach(function (speed) {
      $('<button>').attr({ type: 'button', 'data-speed': speed, 'aria-pressed': gameSpeed === speed ? 'true' : 'false' })
        .text(speed + ' 倍').on('click', function () { OfflineGame.setSpeed(speed); }).appendTo(choices);
    });
    var fonts = $('<div>').attr('id', 'offline-font-controls').appendTo(menu);
    $('<span>').text('文字大小').appendTo(fonts);
    $('<button>').attr({ id: 'offline-font-smaller', type: 'button', 'aria-label': '缩小字号' })
      .text('A−').on('click', function () { changeFont(-1); }).appendTo(fonts);
    $('<span>').attr('id', 'offline-font-value').text(fontSize).appendTo(fonts);
    $('<button>').attr({ id: 'offline-font-larger', type: 'button', 'aria-label': '放大字号' })
      .text('A+').on('click', function () { changeFont(1); }).appendTo(fonts);
    var messages = makeSheet('messages', '消息');
    $('#notifications').appendTo(messages);
    updateMessagePreview();
  }

  function makeSheet(name, title) {
    var panel = $('<section>').attr({ id: 'offline-' + name + '-panel', hidden: true,
      role: 'dialog', 'aria-label': title }).addClass('offline-sheet').appendTo('body');
    var heading = $('<div>').addClass('offline-sheet-heading').appendTo(panel);
    $('<strong>').text(title).appendTo(heading);
    $('<button>').attr({ id: 'offline-' + name + '-close', type: 'button', 'aria-label': '关闭' + title })
      .text('关闭').on('click', closeSheets).appendTo(heading);
    return $('<div>').addClass('offline-sheet-content').appendTo(panel);
  }

  function toggleSheet(name, event) {
    var panel = document.getElementById('offline-' + name + '-panel');
    var opening = panel && panel.hidden;
    closeSheets();
    if (opening) {
      OfflineGame.releaseControls();
      panel.hidden = false;
      document.getElementById('offline-sheet-backdrop').hidden = false;
      document.getElementById('offline-' + name + '-button').setAttribute('aria-expanded', 'true');
      document.body.classList.add('offline-sheet-open');
      // Only keyboard activation moves focus; touch must not outline the close control.
      if (!event || (event.originalEvent || event).detail === 0) {
        document.getElementById('offline-' + name + '-close').focus();
      }
    }
  }

  function closeSheets() {
    $('.offline-sheet').prop('hidden', true);
    $('#offline-sheet-backdrop').prop('hidden', true);
    $('#offline-menu-button, #offline-messages-button').attr('aria-expanded', 'false');
    document.body.classList.remove('offline-sheet-open');
  }

  OfflineGame.back = function () {
    if (document.body.classList.contains('offline-sheet-open')) { closeSheets(); return true; }
    return false;
  };

  function updateMessagePreview() {
    var latest = $('#notifications .notification').first().text();
    $('#offline-message-preview').text(latest || '暂无消息');
    $('#offline-messages-button').attr('aria-label', '消息：' + (latest || '暂无消息'));
  }
  var originalPrintMessage = Notifications.printMessage;
  Notifications.printMessage = function (text) { originalPrintMessage(text); updateMessagePreview(); };
  Notifications.clearHidden = function () { $('#notifications .notification').slice(60).remove(); };
  var originalStartEvent = Events.startEvent;
  Events.startEvent = function () { closeSheets(); return originalStartEvent.apply(Events, arguments); };
  var originalStartCombat = Events.startCombat;
  Events.startCombat = function () {
    var result = originalStartCombat.apply(Events, arguments);
    Events.eventPanel().addClass('offline-combat');
    return result;
  };
  var originalStartStory = Events.startStory;
  Events.startStory = function () {
    if (Events.activeEvent()) { Events.eventPanel().removeClass('offline-combat'); }
    return originalStartStory.apply(Events, arguments);
  };
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { OfflineGame.back(); }
  });

  function arrangePanels() {
    $('.workerRow, .outfitRow').each(function () {
      $(this).toggleClass('offline-adjustable', !!$(this).find('.upBtn').length);
    });
    [Room, Outside, Path, Ship].forEach(function (module) {
      if (!module.panel) { return; }
      var buttons = module.panel.children('.button');
      if (module === Path) { buttons = buttons.add(module.panel.find('#embarkButton')); }
      if (!buttons.length) { return; }
      var actions = module.panel.children('.offline-location-actions');
      if (!actions.length) { actions = $('<div>').addClass('offline-location-actions').prependTo(module.panel); }
      buttons.appendTo(actions);
    });
    if (Outside.panel && $('#workers').length && $('#village').length && $('#workers').parent()[0] === Outside.panel[0]) {
      $('#workers').insertBefore($('#village').parent('details').length ? $('#village').parent() : $('#village'));
    }
    var fabricateButtons = $('#fabricateButtons');
    if (fabricateButtons.length && Fabricator.panel && Fabricator.panel.children().first()[0] !== fabricateButtons[0]) {
      fabricateButtons.prependTo(Fabricator.panel);
    }
    if ($('#hullRow').length && !document.getElementById('offline-ship-status')) {
      var shipStatus = $('<div>').attr('id', 'offline-ship-status').prependTo(Ship.panel);
      $('#hullRow, #engineRow').appendTo(shipStatus);
    }
    function disclosure(selector, id, title) {
      var content = $(selector);
      if (!content.length || content.parent().attr('id') === id) { return; }
      var details = $('#' + id);
      if (!details.length) {
        details = $('<details>').attr('id', id).addClass('offline-disclosure').insertBefore(content);
        $('<summary>').text(title).appendTo(details);
      }
      content.appendTo(details);
    }
    disclosure('#blueprints', 'offline-blueprints', '已掌握的蓝图');
    disclosure('#perks', 'offline-perks', '能力');
    disclosure('#village', 'offline-village', '村庄');
    disclosure('#storesContainer', 'offline-inventory', '仓库');
    $('#offline-inventory').prop('hidden', !$('#storesContainer .storeRow').length);
    var outer = $('#worldOuter');
    if (outer.length && !document.getElementById('offline-world-status')) {
      var status = $('<div>').attr('id', 'offline-world-status').prependTo(outer);
      $('#backpackTitle, #healthCounter, #backpackSpace').appendTo(status);
    }
  }

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
    $('#offline-font-value').text(fontSize);
    scheduleLayout();
  }

  function applyTilt() {
    if (document.body && document.body.classList.contains('offline-sheet-open')) {
      Space.left = Space.right = Space.up = Space.down = false;
      return;
    }
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
    arrangePanels();
    $('.location').removeClass('offline-active');
    if (activeModule.panel) { activeModule.panel.addClass('offline-active'); }
    var controls = document.getElementById('offline-controls');
    if (controls) { controls.hidden = !(inWorld || (inSpace && !Space.done)); }
    var menu = document.getElementById('offline-bottom-bar');
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
    if (stores.length && stores.parent().attr('id') !== 'offline-inventory' && stores.parent().attr('id') !== 'main') { stores.appendTo('#main'); }
    document.body.classList.toggle('offline-dark', !!$SM.get('config.lightsOff'));
    if (resetScroll) { window.scrollTo(0, 0); resetScroll = false; }
    if (inWorld) { updateMapViewport(); }
    if (inSpace) { updateFlightStatus(); }
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
        if (Engine.keyLock || document.body.classList.contains('offline-sheet-open') || (activeModule !== World && activeModule !== Space)) { return; }
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
  Engine.turnLightsOff = function () {
    originalLights();
    $('#offline-lights').text($SM.get('config.lightsOff') ? '日间模式' : '夜间模式');
    scheduleLayout();
  };
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
