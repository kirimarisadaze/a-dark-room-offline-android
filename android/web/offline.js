/* Offline Android integration and optional local cheats. Upstream files remain unchanged. MPL-2.0. */
(function () {
  'use strict';
  if (window.ROGUE_MODE) {
    Rogue.nativeBridge();
    return;
  }
  var skipSaving = false;
  var activeModule = Engine.activeModule;
  var frame = null;
  var held = {};
  var repeatTimer = null;
  var worldPointer = null;
  var ignoreNavigationClick = false;
  var pausedAt = null;
  var resetScroll = false;
  var fullMap = false;
  var fontSize = 16;
  var tiltX = 0;
  var gameSpeed = 1;
  var workerStep = 1;
  var cheats = { enabled: false, noCooldown: false, protection: false };
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
      try { return Engine.saveGame() !== false; } catch (error) { return false; }
    },
    reload: function () {
      if (window.ADRNativeLocalApp === true) { location.href = 'adr-offline://reload'; }
      else { location.reload(); }
    },
    prepareRestore: function () { skipSaving = true; OfflineGame.releaseControls(); },
    cancelRestore: function () { skipSaving = false; },
    getSpeed: function () { return gameSpeed; },
    getCheats: function () { return $.extend({}, cheats); },
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
      worldPointer = null;
      clearInterval(repeatTimer);
      repeatTimer = null;
      $('#offline-controls .offline-direction').removeClass('offline-held').attr('aria-pressed', 'false');
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
  var originalSaveGame = Engine.saveGame;
  Engine.saveGame = function () {
    if (skipSaving || Engine.GAME_OVER || !window.State) return;
    // Persist this page's bound slot before updating the upstream working cache.
    // Older pages can never save into a different slot selected by a newer page.
    try { SaveSlots.save(JSON.stringify(State)); }
    catch (error) {
      $('#saveNotify').stop(true).text('保存失败，请检查剩余空间').css('opacity', 1);
      return false;
    }
    $('#saveNotify').text('已保存');
    try { originalSaveGame.apply(Engine, arguments); } catch (error) { /* The slot database is already saved. */ }
    return true;
  };
  Engine.generateExport64 = function () { return Base64.encode(JSON.stringify(State)).replace(/[\s.]/g, ''); };
  Engine.loadGame = function () {
    originalLoadGame.apply(Engine, arguments);
    if (!State.config || typeof State.config !== 'object') { State.config = {}; }
    State.config.lightsOff = OfflineTheme.isDark();
    var saved = Number(State.config.offlineSpeed);
    gameSpeed = [1, 2, 3, 4].indexOf(saved) >= 0 ? saved : (State.config.hyperMode ? 2 : 1);
    Engine.options.doubleTime = gameSpeed > 1;
    State.config.offlineSpeed = gameSpeed;
    State.config.hyperMode = gameSpeed > 1;
    var savedCheats = State.config.offlineCheats || {};
    cheats = {
      enabled: savedCheats.enabled === true,
      noCooldown: savedCheats.noCooldown === true,
      protection: savedCheats.protection === true
    };
    State.config.offlineCheats = cheats;
    workerStep = State.config.offlineWorkerStep === 10 ? 10 : 1;
  };
  Engine.triggerHyperMode = function () {
    if (!initializing) { OfflineGame.setSpeed(gameSpeed === 1 ? 2 : 1); }
  };

  function cheatActive(option) { return cheats.enabled && cheats[option]; }

  // Never remove affordability/scene restrictions when skipping a cooldown.
  var originalCooldown = Button.cooldown;
  Button.cooldown = function (button) {
    if (cheatActive('noCooldown')) {
      Button.clearCooldown(button);
      $SM.remove('cooldown.' + button.attr('id'));
      return;
    }
    return originalCooldown.apply(Button, arguments);
  };

  function clearActiveCooldowns() {
    if (!cheatActive('noCooldown')) { return; }
    $('.button').each(function () {
      var button = $(this);
      if (button.data('onCooldown')) { Button.clearCooldown(button); }
    });
  }

  function restoreVitals() {
    World.setHp(World.getMaxHealth());
    World.setWater(World.getMaxWater());
    World.foodMove = World.waterMove = 0;
    World.starvation = World.thirst = false;
    var player = $('#wanderer');
    if (player.length) {
      player.data('hp', World.health);
      Events.updateFighterDiv(player);
      Events.setHeal();
    }
  }

  var originalSetHp = World.setHp;
  World.setHp = function (hp) {
    return originalSetHp.call(World, cheatActive('protection') && activeModule === World ? World.getMaxHealth() : hp);
  };
  var originalUseSupplies = World.useSupplies;
  World.useSupplies = function () {
    if (cheatActive('protection')) { restoreVitals(); return true; }
    return originalUseSupplies.apply(World, arguments);
  };
  var originalCheckDeath = Events.checkPlayerDeath;
  Events.checkPlayerDeath = function () {
    if (cheatActive('protection') && activeModule === World) { restoreVitals(); return false; }
    return originalCheckDeath.apply(Events, arguments);
  };

  function updateCheats() {
    $('#offline-cheat-enable').prop('checked', cheats.enabled);
    $('#offline-cheat-options').prop('hidden', !cheats.enabled);
    $('#offline-cheat-cooldown').prop('checked', cheats.noCooldown);
    $('#offline-cheat-protection').prop('checked', cheats.protection);
    $('#offline-cheat-badge').prop('hidden', !cheats.enabled);
    State.config.offlineCheats = cheats;
    clearActiveCooldowns();
    if (cheatActive('protection') && activeModule === World) { restoreVitals(); }
    updateMapCheatAction();
    OfflineGame.save();
  }

  function savedWorldMap() {
    var map = $SM.get('game.world.map');
    return Array.isArray(map) && map.length && map.every(function (column) { return Array.isArray(column) && column.length; }) ? map : null;
  }

  function updateMapCheatAction() {
    var ready = !!savedWorldMap();
    $('#offline-cheat-map').prop('disabled', !cheats.enabled || !ready);
    $('#offline-cheat-map-note').text(ready ? '仅揭开迷雾，不会通关地标；关闭作弊后仍保留。' : '解锁漫漫尘途后可用。');
  }

  function revealWorldMap() {
    if (!cheats.enabled) { return; }
    var map = savedWorldMap();
    if (!map) { updateMapCheatAction(); return; }
    // Expeditions use a temporary world. Reveal its mask and the saved mask,
    // without committing unfinished fights, rewards, roads or captured mines.
    $SM.set('game.world.mask', map.map(function (column) { return column.map(function () { return true; }); }));
    if (World.state && Array.isArray(World.state.map)) {
      World.state.mask = World.state.map.map(function (column) { return column.map(function () { return true; }); });
    }
    World.seenAll = false;
    World.testMap();
    if (activeModule === World && World.state && World.curPos) { fullMap = true; World.drawMap(); }
    $('#offline-cheat-feedback').text('地图迷雾已全部揭开，已保存。');
    OfflineGame.save();
  }

  var landmarkCatalog = [
    { group: '据点与矿场', tile: 'VILLAGE', name: '村庄', text: '旅途的起点。安全返回这里后，带回物资并保留本次探索成果。' },
    { group: '据点与矿场', tile: 'OUTPOST', name: '前哨站', text: '荒野中的补给点，可补满水并拾取熏肉；每次出征只能使用一次。部分地点清理后会变成哨站。' },
    { group: '据点与矿场', tile: 'IRON_MINE', name: '铁矿', text: '清除矿内的危险并安全回村后，可安排村民开采铁。' },
    { group: '据点与矿场', tile: 'COAL_MINE', name: '煤矿', text: '击败占据矿场的敌人并安全回村后，可安排村民开采煤。' },
    { group: '据点与矿场', tile: 'SULPHUR_MINE', name: '硫磺矿', text: '有武装人员驻守。清理并安全回村后，可安排村民开采硫磺。' },
    { group: '探索地标', tile: 'HOUSE', name: '旧房子', text: '可搜索遗留的食物、布料等物资，也可能遭遇敌人。' },
    { group: '探索地标', tile: 'CAVE', name: '潮湿洞穴', text: '深入黑暗需要火把。洞内有野兽和物资，探索前准备食物、武器与照明。' },
    { group: '探索地标', tile: 'TOWN', name: '废弃小镇', text: '可探索多处建筑，搜寻补给与装备；可能经历连续战斗。' },
    { group: '探索地标', tile: 'CITY', name: '废墟城市', text: '规模较大的探索地点，有多条路径、物资与强敌，适合做好准备后进入。' },
    { group: '探索地标', tile: 'BATTLEFIELD', name: '被遗忘的战场', text: '可搜寻遗留武器、弹药、能量电池及外星合金，具体收获随机。' },
    { group: '探索地标', tile: 'BOREHOLE', name: '巨坑', text: '古老开采活动留下的深坑，边缘可找到外星合金。' },
    { group: '探索地标', tile: 'SWAMP', name: '阴暗沼泽', text: '沼泽中的小屋住着一位流浪者，带上护身符可以与他交谈。' },
    { group: '探索地标', tile: 'SHIP', name: '坠毁星舰', text: '找到并安全回村后，可着手修复飞船，准备后续旅程。' },
    { group: '探索地标', tile: 'EXECUTIONER', name: '残破战舰', text: '守卫森严的后期地点，与制造器和先进装备蓝图有关。' },
    { group: '探索地标', tile: 'CACHE', name: '被摧毁的村落', text: '拥有前代遗留物资时才会出现，可取回上一轮留下的物资。' },
    { group: '人物与地形', symbol: '@', name: '你的位置', text: '当前探索者所在的格子。附近地图会跟随你移动。' },
    { group: '人物与地形', tile: 'FOREST', name: '森林', text: '树木覆盖的野外地形，行走时仍需留意补给和随机遭遇。', terrain: true },
    { group: '人物与地形', tile: 'FIELD', name: '原野', text: '开阔的野外地形，可能遭遇敌人。', terrain: true },
    { group: '人物与地形', tile: 'BARRENS', name: '荒地', text: '荒芜的野外地形，远行前准备足够的水和食物。', terrain: true },
    { group: '人物与地形', tile: 'ROAD', name: '道路', text: '连接村庄与部分已清理地标的路线。', terrain: true }
  ];

  function createLandmarkGuide() {
    var content = makeSheet('landmarks', '地标图鉴');
    $('<input>').attr({ id: 'offline-landmark-search', type: 'search', placeholder: '搜索名称或符号', 'aria-label': '搜索地标名称、符号或用途', autocomplete: 'off' })
      .on('input', filterLandmarks).appendTo(content);
    $('<p>').attr('id', 'offline-landmark-note').addClass('offline-settings-note').appendTo(content);
    var list = $('<div>').attr('id', 'offline-landmark-list').appendTo(content);
    var group;
    landmarkCatalog.forEach(function (entry) {
      if (!group || group.attr('data-group') !== entry.group) {
        group = $('<section>').addClass('offline-landmark-group').attr('data-group', entry.group).appendTo(list);
        $('<h3>').text(entry.group).appendTo(group);
        $('<ul>').appendTo(group);
      }
      var symbol = entry.symbol || World.TILE[entry.tile];
      var row = $('<li>').addClass('offline-landmark-entry').attr({ 'data-symbol': symbol, 'data-search': (symbol + ' ' + entry.name + ' ' + entry.text).toLowerCase() }).appendTo(group.children('ul'));
      $('<code>').addClass('offline-landmark-symbol').text(symbol).appendTo(row);
      var body = $('<div>').addClass('offline-landmark-body').appendTo(row);
      $('<strong>').text(entry.name).appendTo(body);
      if (entry.tile && !entry.terrain) { $('<span>').addClass('offline-landmark-count').appendTo(body); }
      $('<p>').text(entry.text).appendTo(body);
    });
    $('<p>').attr({ id: 'offline-landmark-empty', hidden: true, role: 'status' }).text('没有找到对应地标，试试名称或地图符号。').appendTo(content);
  }

  function refreshLandmarks() {
    var savedMap = savedWorldMap();
    var world = activeModule === World && World.state ? World.state : (savedMap ? $SM.get('game.world') : null);
    var counts = {};
    if (world && Array.isArray(world.map) && Array.isArray(world.mask)) {
      world.map.forEach(function (column, x) {
        column.forEach(function (tile, y) {
          if (world.mask[x] && world.mask[x][y] && typeof tile === 'string') {
            var symbol = tile.charAt(0);
            counts[symbol] = (counts[symbol] || 0) + 1;
          }
        });
      });
    }
    $('#offline-landmark-note').text(world ? '数量只统计当前已揭开区域；地点清理后可能变成哨站。' : '按名称或符号查找。解锁漫漫尘途后显示地图可见数量。');
    $('#offline-landmark-list .offline-landmark-entry').each(function () {
      $(this).find('.offline-landmark-count').prop('hidden', !world).text(world ? '地图可见 ' + (counts[this.getAttribute('data-symbol')] || 0) + ' 处' : '');
    });
    filterLandmarks();
  }

  function filterLandmarks() {
    var query = ($('#offline-landmark-search').val() || '').trim().toLowerCase();
    var visible = 0;
    $('#offline-landmark-list .offline-landmark-group').each(function () {
      var matches = 0;
      $(this).find('.offline-landmark-entry').each(function () {
        var match = !query || this.getAttribute('data-search').indexOf(query) >= 0;
        this.hidden = !match;
        if (match) { matches++; }
      });
      this.hidden = matches === 0;
      visible += matches;
    });
    $('#offline-landmark-empty').prop('hidden', visible > 0);
  }

  // Reference search and sheet navigation must not send WASD/arrow input to
  // the game underneath. Native editing and focused button activation still work.
  ['keyDown', 'keyUp'].forEach(function (name) {
    var original = Engine[name];
    Engine[name] = function () {
      if (document.body && document.body.classList.contains('offline-sheet-open')) { return true; }
      return original.apply(Engine, arguments);
    };
  });
  Engine.isMobile = function () { return false; };
  Engine.event = function () {};
  Engine.getApp = Engine.share = function () {};
  Events.Marketing = [];
  window.open = function () { return null; };

  // Keep the original world grid and movement rules; revealing fog is explicit.
  var originalDrawMap = World.drawMap;
  World.drawMap = function () {
    originalDrawMap.apply(World, arguments);
    var map = $('#map');
    map.off('click'); // The desktop click-to-walk geometry assumes an uncropped map.
    map.wrapInner('<div class="offline-map-tiles"></div>');
    if (!document.getElementById('offline-map-toolbar')) {
      var toolbar = $('<div>').attr('id', 'offline-map-toolbar').insertBefore(map);
      $('<span>').attr('id', 'offline-map-label').appendTo(toolbar);
      var actions = $('<div>').attr('id', 'offline-map-actions').appendTo(toolbar);
      $('<button>').attr({ id: 'offline-map-toggle', type: 'button' })
        .on('click', function () { fullMap = !fullMap; updateMapViewport(); })
        .appendTo(actions);
      $('<button>').attr({ id: 'offline-map-guide', type: 'button', 'aria-controls': 'offline-landmarks-panel', 'aria-expanded': 'false' })
        .text('地标图鉴').on('click', function (event) { toggleSheet('landmarks', event); }).appendTo(actions);
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
    var menu = document.getElementById('offline-bottom-bar');
    var menuTop = menu ? menu.getBoundingClientRect().top : document.documentElement.clientHeight - 100;
    var mapTop = map.getBoundingClientRect().top;
    var controls = document.getElementById('offline-controls');
    var controlTop = controls && !controls.hidden ? controls.getBoundingClientRect().top : menuTop - 180;
    // The map ends above the cross-shaped controls even on short viewports.
    map.style.height = Math.max(72, Math.floor(controlTop - mapTop - 12)) + 'px';
    if (fullMap) { return; }
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
      if (activeModule !== module) { resetScroll = true; }
      activeModule = module;
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
      SaveSlots.importJSON(JSON.stringify(decoded));
    } catch (error) {
      skipSaving = false;
      alert('无法写入存档，当前进度已保留。请检查手机存储空间后重试。');
      return;
    }
    skipSaving = true;
    OfflineGame.reload();
  };
  Engine.deleteSave = function (noReload) {
    var prestige = Prestige.get();
    var replacement = { previous: prestige };
    try { SaveSlots.save(JSON.stringify(replacement)); }
    catch (error) { alert('无法重新开始，原存档已保留。请检查手机剩余空间。'); return; }
    skipSaving = true;
    window.State = replacement;
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
    try { SaveSlots.prepareNormal(); }
    catch (error) {
      window.__ADR_BOOT_ERROR = error.message || '无法读取存档，原始进度已保留。';
      var wrapper = document.getElementById('wrapper');
      wrapper.textContent = window.__ADR_BOOT_ERROR;
      var home = document.createElement('a');
      home.href = 'home.html'; home.textContent = ' 返回主页面'; wrapper.appendChild(home);
      return;
    }
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
    createSceneSwipes();
    var observer = new MutationObserver(function (changes) {
      if (changes.some(function (change) {
        if (Array.prototype.some.call(change.removedNodes, function (node) { return node.nodeType === 1 && node.id === 'event'; })) { return true; }
        return Array.prototype.some.call(change.addedNodes, function (node) {
          return node.nodeType === 1 && (node.classList.contains('location') ||
            node.classList.contains('workerRow') || node.classList.contains('outfitRow') ||
            node.classList.contains('button') || node.classList.contains('storeRow') ||
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
    $('<span>').attr({ id: 'offline-cheat-badge', hidden: !cheats.enabled }).text('作弊已开').insertBefore('#offline-menu-button');
    messagesButton.on('click', function (event) { toggleSheet('messages', event); });

    var menu = makeSheet('menu', '菜单');
    $('<p>').attr('id', 'offline-current-save').addClass('offline-settings-note').text(SaveSlots.label()).appendTo(menu);
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
    $('<button>').attr({ id: 'offline-landmarks-button', type: 'button', 'aria-controls': 'offline-landmarks-panel', 'aria-expanded': 'false' })
      .text('地标图鉴').on('click', function (event) { toggleSheet('landmarks', event); }).appendTo(settings);
    $('<a>').attr({ id: 'offline-about', href: 'about.html' }).text('关于与许可')
      .on('click', function () { OfflineGame.save(); closeSheets(); }).appendTo(settings);
    $('<a>').attr({ id: 'offline-home', href: 'home.html' }).text('返回主页面')
      .on('click', function () { OfflineGame.releaseControls(); OfflineGame.save(); }).appendTo(settings);
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
    createCheatSettings(menu);
    $('<p>').addClass('offline-settings-note').text('场景页可左右滑动切换；探索和飞行使用方向键。').appendTo(menu);
    var messages = makeSheet('messages', '消息');
    $('#notifications').appendTo(messages);
    createLandmarkGuide();
    updateMessagePreview();
  }

  function createCheatSettings(menu) {
    var section = $('<div>').attr('id', 'offline-cheats').appendTo(menu);
    function toggle(parent, id, label, checked, handler) {
      var row = $('<label>').addClass('offline-toggle').appendTo(parent);
      $('<span>').text(label).appendTo(row);
      $('<input>').attr({ id: id, type: 'checkbox' }).prop('checked', checked)
        .on('change', function () { handler(this.checked); updateCheats(); }).appendTo(row);
      $('<span>').addClass('offline-check').attr('aria-hidden', 'true').appendTo(row);
    }
    toggle(section, 'offline-cheat-enable', '作弊模式', cheats.enabled, function (checked) { cheats.enabled = checked; });
    var options = $('<div>').attr({ id: 'offline-cheat-options', hidden: !cheats.enabled }).appendTo(section);
    $('<p>').addClass('offline-settings-note').text('关闭后恢复正常规则；已添加的物资会保留。').appendTo(options);
    toggle(options, 'offline-cheat-cooldown', '行动免冷却', cheats.noCooldown, function (checked) { cheats.noCooldown = checked; });
    toggle(options, 'offline-cheat-protection', '探索保护', cheats.protection, function (checked) { cheats.protection = checked; });
    $('<p>').addClass('offline-settings-note').text('探索保护维持生命和水量，行走不消耗食物。').appendTo(options);
    var actions = $('<div>').addClass('offline-settings-grid').appendTo(options);
    $('<button>').attr({ id: 'offline-cheat-resources', type: 'button' }).text('常用物资 +1000').appendTo(actions)
      .on('click', function () {
        if (!cheats.enabled) { return; }
        var resources = {};
        ['wood', 'fur', 'meat', 'bait', 'teeth', 'scales', 'cloth', 'leather', 'cured meat',
          'iron', 'coal', 'sulphur', 'steel', 'bullets', 'medicine', 'energy cell', 'alien alloy'].forEach(function (name) { resources[name] = 1000; });
        $SM.addM('stores', resources);
        $('#offline-cheat-feedback').text('常用物资各增加 1000，已保存。');
        OfflineGame.save();
      });
    $('<button>').attr({ id: 'offline-cheat-heal', type: 'button' }).text('恢复生命与水').appendTo(actions)
      .on('click', function () {
        if (!cheats.enabled) { return; }
        restoreVitals();
        $('#offline-cheat-feedback').text('生命和水量已恢复。');
        OfflineGame.save();
      });
    $('<button>').attr({ id: 'offline-cheat-map', type: 'button' }).text('地图全开').on('click', revealWorldMap).appendTo(actions);
    $('<p>').attr('id', 'offline-cheat-map-note').addClass('offline-settings-note').appendTo(options);
    $('<div>').attr({ id: 'offline-cheat-feedback', role: 'status', 'aria-live': 'polite' }).appendTo(options);
    updateMapCheatAction();
  }

  function createSceneSwipes() {
    var gesture = null;
    var suppressClickUntil = 0;
    function allowed() {
      return !Engine.keyLock && !Engine.GAME_OVER && activeModule !== World && activeModule !== Space &&
        !Events.activeEvent() && !document.body.classList.contains('offline-sheet-open');
    }
    document.addEventListener('pointerdown', function (event) {
      // A new touch is deliberate; suppress only the click generated by the swipe.
      suppressClickUntil = 0;
      if (gesture || !event.isPrimary) { gesture = null; return; }
      if (event.pointerType === 'mouse') { return; }
      if (event.target.closest('input,textarea,select,[contenteditable="true"],#header')) { return; }
      var excluded = 'button,a,input,textarea,select,summary,.button,.headerButton,.offline-sheet,' +
        '.upBtn,.dnBtn,.upManyBtn,.dnManyBtn,#offline-bottom-bar,#offline-inventory';
      var bar = document.getElementById('offline-bottom-bar').getBoundingClientRect();
      if (event.clientX < 24 || event.clientX > innerWidth - 24) { return; }
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, started: performance.now(),
        module: activeModule, horizontal: false,
        navigate: allowed() && event.clientY < bar.top && !event.target.closest(excluded) };
    });
    document.addEventListener('pointermove', function (event) {
      if (!gesture || event.pointerId !== gesture.id) { return; }
      var dx = Math.abs(event.clientX - gesture.x);
      var dy = Math.abs(event.clientY - gesture.y);
      if (!gesture.horizontal && dy > 12 && dy > dx / 1.4) { gesture = null; return; }
      if (dx > 12 && dx > dy * 1.4) { gesture.horizontal = true; }
    });
    document.addEventListener('touchmove', function (event) {
      if (gesture && gesture.horizontal && event.cancelable) { event.preventDefault(); }
    }, { passive: false });
    document.addEventListener('pointerup', function (event) {
      var start = gesture;
      gesture = null;
      if (!start || event.pointerId !== start.id) { return; }
      var dx = event.clientX - start.x;
      var dy = Math.abs(event.clientY - start.y);
      if (!start.horizontal || Math.abs(dx) < 56 || Math.abs(dx) < dy * 1.4 || performance.now() - start.started > 900) { return; }
      suppressClickUntil = performance.now() + 350;
      if (!start.navigate || !allowed() || activeModule !== start.module) { return; }
      var tabs = $('#header .headerButton').filter(function () { return this.getBoundingClientRect().width > 0; }).toArray();
      var current = tabs.indexOf(activeModule.tab && activeModule.tab[0]);
      var next = current + (dx < 0 ? 1 : -1);
      if (current < 0 || next < 0 || next >= tabs.length) { return; }
      tabs[next].click();
    });
    document.addEventListener('pointercancel', function () { gesture = null; });
    document.addEventListener('click', function (event) {
      if (event.isTrusted && performance.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
    }, true);
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
      if (name === 'menu') { updateMapCheatAction(); }
      if (name === 'landmarks') { refreshLandmarks(); panel.scrollTop = 0; }
      OfflineGame.releaseControls();
      panel.hidden = false;
      document.getElementById('offline-sheet-backdrop').hidden = false;
      document.getElementById('offline-' + name + '-button').setAttribute('aria-expanded', 'true');
      if (name === 'landmarks') { $('#offline-map-guide').attr('aria-expanded', 'true'); }
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
    $('#offline-menu-button, #offline-messages-button, #offline-landmarks-button, #offline-map-guide').attr('aria-expanded', 'false');
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
  var originalVillage = Outside.updateVillage;
  Outside.updateVillage = function () { var result = originalVillage.apply(Outside, arguments); scheduleLayout(); return result; };
  var originalWorkers = Outside.updateWorkersView;
  Outside.updateWorkersView = function () { var result = originalWorkers.apply(Outside, arguments); scheduleLayout(); return result; };
  var originalStores = Room.updateStoresView;
  Room.updateStoresView = function () { var result = originalStores.apply(Room, arguments); scheduleLayout(); return result; };
  var originalOutfitting = Path.updateOutfitting;
  Path.updateOutfitting = function () { var result = originalOutfitting.apply(Path, arguments); scheduleLayout(); return result; };
  Notifications.clearHidden = function () { $('#notifications .notification').slice(60).remove(); };
  var originalStartEvent = Events.startEvent;
  Events.startEvent = function () {
    var navigationTouch = worldPointer !== null;
    closeSheets(); OfflineGame.releaseControls();
    if (navigationTouch) { ignoreNavigationClick = true; }
    var result = originalStartEvent.apply(Events, arguments);
    scheduleLayout();
    return result;
  };
  var originalStartCombat = Events.startCombat;
  Events.startCombat = function () {
    var result = originalStartCombat.apply(Events, arguments);
    Events.eventPanel().removeClass('offline-loot').addClass('offline-combat');
    arrangeCombat();
    return result;
  };
  function arrangeCombat() {
    var panel = $('#event.offline-combat');
    if (!panel.length) { return; }
    // Upstream inserts the fallback punch outside the attack group when ammo
    // runs out. Keep that real button in the same scrollable action area.
    panel.find('#buttons > .weaponButton').prependTo(panel.find('#attackButtons'));
    panel.find('#attackButtons,#healButtons').each(function () {
      $(this).toggleClass('offline-single-action', $(this).children('.button').length === 1);
    });
  }
  var originalStartStory = Events.startStory;
  Events.startStory = function () {
    if (Events.activeEvent()) { Events.eventPanel().removeClass('offline-combat offline-loot'); }
    return originalStartStory.apply(Events, arguments);
  };

  // Keep the upstream inventory/capacity rules and button handlers. Only the
  // loot presentation and the separate collect/leave interaction change.
  var originalDrawLoot = Events.drawLoot;
  Events.drawLoot = function () {
    Events.eventPanel().removeClass('offline-combat').addClass('offline-loot');
    var result = originalDrawLoot.apply(Events, arguments);
    arrangeLoot(); scheduleLayout();
    return result;
  };
  var originalLootRow = Events.drawLootRow;
  Events.drawLootRow = function () {
    var row = originalLootRow.apply(Events, arguments);
    $('<div>').addClass('offline-loot-item').append($('<span>').addClass('offline-loot-name'))
      .append($('<span>').addClass('offline-loot-count')).prependTo(row);
    row.children('.lootTake').off('mouseenter');
    return row;
  };
  var originalSetTakeAll = Events.setTakeAll;
  Events.setTakeAll = function () {
    var result = originalSetTakeAll.apply(Events, arguments);
    arrangeLoot();
    return result;
  };
  var originalCanLeave = Events.canLeave;
  Events.canLeave = function (button) {
    if (!button.closest('#lootButtons').length) { return originalCanLeave.apply(Events, arguments); }
    button.data('canLeave', false);
    arrangeLoot();
  };
  var originalGetLoot = Events.getLoot;
  Events.getLoot = function () {
    $('#dropMenu').remove();
    var result = originalGetLoot.apply(Events, arguments);
    arrangeLoot(); scheduleLayout();
    return result;
  };
  var originalDrawDrop = Events.drawDrop;
  Events.drawDrop = function (button) {
    originalDrawDrop.apply(Events, arguments);
    var menu = $('#dropMenu');
    if (!menu.length) { return; }
    // A full backpack opens choices below the item, never a hover overlay.
    button.off('mouseleave');
    menu.data('offline-target', button).attr('data-legend', '选择换出物品，腾出空间')
      .appendTo(button.closest('.lootRow'));
    menu.children('#no_drop').text('取消替换');
    menu.children('div').attr({ role: 'button', tabindex: '0' }).off('keydown.offline').on('keydown.offline', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); $(this).trigger('click'); }
    });
  };
  var originalDropStuff = Events.dropStuff;
  Events.dropStuff = function () {
    var menu = $(this).closest('#dropMenu'), target = menu.data('offline-target');
    // The original handler locates the target via its nearest button. Restore
    // that relationship during the synchronous exchange, before the next paint.
    if (target && target.length) { menu.appendTo(target); }
    var result = originalDropStuff.apply(this, arguments);
    arrangeLoot(); scheduleLayout();
    return result;
  };

  function arrangeLoot() {
    if (!Events.activeEvent()) { return; }
    var panel = Events.eventPanel(), loot = panel.find('#lootButtons');
    var summary = panel.find('#offline-loot-summary');
    if (!loot.length && !summary.length) { return; }
    panel.removeClass('offline-combat').addClass('offline-loot');
    var exits = panel.find('#exitButtons');
    exits.toggleClass('offline-single-exit', exits.children('.button').length === 1);
    if (!summary.length) {
      summary = $('<div>').attr('id', 'offline-loot-summary').insertBefore(loot);
      $('<span>').addClass('offline-loot-heading').appendTo(summary);
      $('<span>').attr('id', 'offline-loot-capacity').appendTo(summary);
    }
    var free = Math.max(0, Math.round(Path.getFreeSpace() * 10) / 10);
    summary.children('.offline-loot-heading').text(loot.find('.lootRow').length ? '获得物品' : '没有待拾取物品');
    summary.children('#offline-loot-capacity').text('背包剩余 ' + free + ' / ' + Path.getCapacity());
    loot.children('.lootRow').each(function () {
      var row = $(this), name = row.data('item'), take = row.children('.lootTake'), all = row.children('.lootTakeAll');
      var count = Number(take.data('numLeft')) || 0;
      row.find('.offline-loot-name').text(_(name));
      row.find('.offline-loot-count').text('×' + count);
      var fits = Path.getWeight(name) <= free;
      var text = fits ? '拿 1' : '替换';
      if (take.text() !== text) { take.text(text); }
      take.attr({ role: 'button', tabindex: '0', 'aria-label': (fits ? '拾取一件' : '换出物品以拾取') + _(name) });
      all.contents().filter(function () { return this.nodeType === 3; }).remove();
      var amount = Math.max(0, Number(all.data('numLeft')) || 0);
      all.children('span').first().text(amount === 0 ? '装不下' : amount >= count ? '全拿' : '拿 ' + amount);
      all.attr({ role: 'button', tabindex: '0', 'aria-disabled': String(all.hasClass('disabled')), 'aria-label': '拾取' + _(name) + ' ' + amount + ' 件' });
    });
    var everything = loot.find('#loot_takeEverything');
    everything.data('canLeave', false).attr({ role: 'button', tabindex: '0', 'aria-disabled': String(everything.hasClass('disabled')) });
    everything.children('span').first().text(everything.hasClass('disabled') ? '背包已满' : everything.data('canTakeEverything') ? '全部拾取' : '拾取能装下的物品');
    loot.find('.lootTake,.lootTakeAll,#loot_takeEverything').off('keydown.offline').on('keydown.offline', function (event) {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); $(this).trigger('click'); }
    });
  }
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { OfflineGame.back(); }
  });
  // A landmark can open a modal underneath a finger that is still holding a
  // direction. Its release must not activate the newly appeared leave button.
  document.addEventListener('pointerdown', function (event) {
    if (event.isPrimary) { ignoreNavigationClick = false; }
  }, true);
  document.addEventListener('click', function (event) {
    if (ignoreNavigationClick && event.isTrusted && event.detail !== 0) {
      ignoreNavigationClick = false;
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }, true);

  function compactStoreCount(value) {
    var count = Math.max(0, Math.floor(Number(value) || 0));
    var units = count >= 1e12 ? [1e12, '万亿'] : count >= 1e8 ? [1e8, '亿'] : count >= 1e4 ? [1e4, '万'] : null;
    if (!units) { return String(count); }
    var scaled = count / units[0];
    return (scaled >= 100 || units[0] === 1e12 ? Math.floor(scaled) : Math.floor(scaled * 10) / 10) + units[1];
  }

  function arrangeOutfitting() {
    $('#outfitting .outfitRow[key]').each(function () {
      var row = $(this), fragments = [];
      row.children('.tooltip').children('.row_key').each(function () {
        var key = $(this), label = key.text().trim(), value = key.next('.row_val');
        if (!label) { return; }
        fragments.push(label + (value.length ? ' ' + (value.hasClass('numAvailable') ? compactStoreCount(value.text()) : value.text()) : ''));
      });
      var details = row.children('.offline-outfit-details');
      if (!details.length) { details = $('<div>').addClass('offline-outfit-details').appendTo(row); }
      var text = fragments.join(' · ');
      if (details.text() !== text) { details.text(text); }
    });
  }

  function arrangeWorkers(village) {
    var workers = $('#workers');
    if (!workers.length) { return; }
    var panel = $('#offline-workers-panel');
    if (!panel.length) {
      panel = $('<section>').attr({ id: 'offline-workers-panel', 'aria-label': '村民分工' }).insertBefore(workers);
      $('<div>').addClass('offline-workers-title').text('村民分工').appendTo(panel);
      var summary = $('<div>').attr('id', 'offline-workforce').appendTo(panel);
      [['total', '总人数'], ['assigned', '已分工'], ['gatherers', '自动伐木']].forEach(function (entry) {
        var stat = $('<div>').appendTo(summary);
        $('<span>').text(entry[1]).appendTo(stat);
        $('<strong>').attr('id', 'offline-workforce-' + entry[0]).appendTo(stat);
      });
      var steps = $('<div>').attr('id', 'offline-worker-steps').appendTo(panel);
      $('<span>').text('每次调整').appendTo(steps);
      [1, 10].forEach(function (amount) {
        $('<button>').attr({ type: 'button', 'data-step': amount }).text(amount + ' 人').appendTo(steps)
          .on('click', function () {
            workerStep = amount;
            State.config.offlineWorkerStep = amount;
            scheduleLayout();
            OfflineGame.save();
          });
      });
      $('<p>').addClass('offline-settings-note').text('未分配的村民会自动伐木。').appendTo(panel);
      workers.appendTo(panel);
    }
    if (village.next()[0] !== panel[0]) { panel.insertAfter(village); }
    var population = Number($SM.get('game.population', true));
    var gatherers = Math.max(0, Outside.getNumGatherers());
    $('#offline-workforce-total').text(population);
    $('#offline-workforce-assigned').text(Math.max(0, population - gatherers));
    $('#offline-workforce-gatherers').text(gatherers);
    $('#offline-worker-steps button').each(function () {
      $(this).attr('aria-pressed', Number(this.getAttribute('data-step')) === workerStep ? 'true' : 'false');
    });
    $('#offline-worker-steps').prop('hidden', !workers.find('.upBtn').length);
    workers.children('.workerRow').each(function () {
      var row = $(this);
      var key = row.attr('key');
      var income = Outside._INCOME[key];
      var count = Number(row.find('.row_val > span').text()) || 0;
      var label = row.children('.row_key').text();
      row.find('.upBtn,.dnBtn,.upManyBtn,.dnManyBtn').each(function () {
        var control = $(this);
        var many = control.hasClass('upManyBtn') || control.hasClass('dnManyBtn');
        var increase = control.hasClass('upBtn') || control.hasClass('upManyBtn');
        control.prop('hidden', many !== (workerStep === 10));
        control.attr({ role: 'button', tabindex: '0', 'aria-disabled': String(control.hasClass('disabled')),
          'aria-label': (increase ? '增加 ' : '减少 ') + (many ? 10 : 1) + ' 名' + label });
        control.off('keydown.offline').on('keydown.offline', function (event) {
          if (event.key !== 'Enter' && event.key !== ' ') { return; }
          event.preventDefault(); event.stopPropagation();
          if (!control.hasClass('disabled')) { control.trigger('click'); }
        });
      });
      if (!income) { return; }
      var details = row.children('.offline-worker-income');
      if (!details.length) { details = $('<div>').addClass('offline-worker-income').appendTo(row); }
      var text = (count ? '每 ' : '每人每 ') + income.delay + ' 秒：' + Object.keys(income.stores).map(function (name) {
        var amount = Math.round(income.stores[name] * (count || 1) * 100) / 100;
        return _(name) + ' ' + (amount > 0 ? '+' : '−') + Math.abs(amount);
      }).join(' · ');
      if (details.text() !== text) { details.text(text); }
    });
  }

  function updateCostCard(button, spec) {
    if (!button.length || !spec || typeof spec.cost !== 'function') { return; }
    var card = button.parent('.offline-cost-card');
    if (!card.length) {
      card = $('<div>').addClass('offline-cost-card').insertBefore(button);
      button.appendTo(card);
      $('<div>').addClass('offline-costs').appendTo(card);
      var label = button.contents().filter(function () { return this.nodeType === 3; }).text().trim();
      button.data('offline-label', label);
    }
    var costs = spec.cost();
    var maximum = Number(spec.maximum);
    var limit = button.data('disabled') === true && Number.isFinite(maximum);
    var rows = Object.keys(costs).map(function (name) {
      var required = Number(costs[name]);
      var available = Number($SM.get('stores["' + name + '"]', true));
      return { name: name, required: required, missing: Math.max(0, Math.ceil(required - available)) };
    });
    // Reserve the original material rows even after an item reaches its limit.
    // Resource updates must never move the action under a player's finger.
    card[0].style.setProperty('--offline-cost-count', Math.max(1, rows.length));
    var signature = JSON.stringify([limit, rows]);
    if (card.data('offline-cost-state') === signature) { return; }
    card.data('offline-cost-state', signature);
    var content = card.children('.offline-costs').empty();
    var description = [];
    if (limit) {
      var limitLabel = maximum === 1 ? (spec.type === 'building' ? '已建造' : '已拥有') : '已达上限';
      $('<span>').addClass('offline-cost-limit').text(limitLabel).appendTo(content);
      description.push(limitLabel);
    } else {
      rows.forEach(function (item) {
        var row = $('<div>').addClass('offline-cost-row').appendTo(content);
        $('<span>').text(_(item.name)).appendTo(row);
        $('<span>').text(item.required).appendTo(row);
        description.push(_(item.name) + ' ' + item.required);
        var shortfall = $('<span>').addClass('offline-cost-shortfall').appendTo(row);
        if (item.missing) {
          shortfall.text('还缺 ' + item.missing);
          description.push('还缺 ' + item.missing);
        } else {
          // An empty fixed column prevents both wrapping and changing row height.
          shortfall.attr('aria-hidden', 'true');
        }
      });
    }
    content.attr('aria-label', '需要材料');
    button.attr('aria-label', button.data('offline-label') + '，' + description.join('，'));
  }

  function arrangeCosts() {
    $('#roomPanel .button[buildThing]').each(function () {
      var button = $(this), key = button.attr('buildThing');
      updateCostCard(button, Room.Craftables[key] || Room.TradeGoods[key]);
    });
    $('#fabricatorPanel .button[fabricateThing]').each(function () {
      var button = $(this);
      updateCostCard(button, Fabricator.Craftables[button.attr('fabricateThing')]);
    });
    updateCostCard($('#reinforceButton'), { cost: function () { return { 'alien alloy': Ship.ALLOY_PER_HULL }; } });
    updateCostCard($('#engineButton'), { cost: function () { return { 'alien alloy': Ship.ALLOY_PER_THRUSTER }; } });
  }

  function arrangePanels() {
    $('.workerRow, .outfitRow').each(function () {
      $(this).toggleClass('offline-adjustable', !!$(this).find('.upBtn').length);
    });
    [Room, Outside, Path, Ship].forEach(function (module) {
      if (!module.panel) { return; }
      var buttons = module.panel.children('.button');
      if (module === Path) { buttons = buttons.add(module.panel.find('#embarkButton')); }
      var actions = module.panel.children('.offline-location-actions');
      if (!buttons.length && !actions.length) { return; }
      if (!actions.length) { actions = $('<div>').addClass('offline-location-actions').prependTo(module.panel); }
      buttons.filter(function () { return this.parentNode !== actions[0]; }).appendTo(actions);
      var shipStatus = module === Ship && module.panel.children('#offline-ship-status');
      if (shipStatus && shipStatus.length) {
        if (shipStatus.next()[0] !== actions[0]) { actions.insertAfter(shipStatus); }
      } else if (module.panel.children().first()[0] !== actions[0]) { actions.prependTo(module.panel); }
    });
    var fabricateButtons = $('#fabricateButtons');
    var fabrication = fabricateButtons.closest('#offline-fabrication');
    if (!fabrication.length) { fabrication = fabricateButtons; }
    if (fabrication.length && Fabricator.panel && Fabricator.panel.children().first()[0] !== fabrication[0]) {
      fabrication.prependTo(Fabricator.panel);
    }
    if ($('#hullRow').length && !document.getElementById('offline-ship-status')) {
      var statusPanel = $('<div>').attr('id', 'offline-ship-status').prependTo(Ship.panel);
      $('#hullRow, #engineRow').appendTo(statusPanel);
    }
    var shipStatus = $('#offline-ship-status');
    if (shipStatus.length && Ship.panel.children().first()[0] !== shipStatus[0]) { shipStatus.prependTo(Ship.panel); }
    var bagspace = $('#bagspace');
    if (bagspace.length && bagspace.parent().children().first()[0] !== bagspace[0]) { bagspace.prependTo('#outfitting'); }
    function disclosure(selector, id, title, costs) {
      var content = $(selector);
      if (!content.length || content.parent().attr('id') === id) { return; }
      var details = $('#' + id);
      if (!details.length) {
        details = $('<details>').attr('id', id).addClass('offline-disclosure').insertBefore(content);
        if (costs || id === 'offline-inventory' || id === 'offline-village') { details.prop('open', true); }
        if (costs) { details.addClass('offline-cost-section'); }
        var summary = $('<summary>').appendTo(details);
        $('<span>').addClass('offline-section-title').text(title).appendTo(summary);
      }
      content.appendTo(details);
    }
    disclosure('#buildBtns', 'offline-buildings', '建筑物', true);
    disclosure('#craftBtns', 'offline-crafting', '制作', true);
    disclosure('#buyBtns', 'offline-trading', '购买', true);
    disclosure('#fabricateButtons', 'offline-fabrication', '制造', true);
    var previousSection = Room.panel.children('.offline-location-actions');
    ['offline-buildings', 'offline-crafting', 'offline-trading'].forEach(function (id) {
      var section = $('#' + id);
      if (!section.length) { return; }
      if (previousSection.length && previousSection.next()[0] !== section[0]) { section.insertAfter(previousSection); }
      previousSection = section;
    });
    disclosure('#blueprints', 'offline-blueprints', '已掌握的蓝图');
    disclosure('#perks', 'offline-perks', '能力');
    disclosure('#village', 'offline-village', '村庄');
    disclosure('#storesContainer', 'offline-inventory', '仓库');
    var village = $('#offline-village');
    if (village.length && Outside.panel) {
      var population = $('#offline-population');
      if (!population.length) { population = $('<span>').attr('id', 'offline-population').appendTo(village.children('summary')); }
      var hasHuts = $SM.get('game.buildings.hut', true) > 0;
      village.find('.offline-section-title').text(hasHuts ? '村庄' : '森林设施');
      population.text($('#population').text()).prop('hidden', !hasHuts);
      var actions = Outside.panel.children('.offline-location-actions');
      if (actions.length && actions.next()[0] !== village[0]) { village.insertAfter(actions); }
      arrangeWorkers(village);
    }
    $('#offline-inventory').prop('hidden', !$('#storesContainer .storeRow').length);
    // Compact display only; inventory calculations and exported saves keep full counts.
    Object.keys(State.stores || {}).forEach(function (name) {
      var row = document.getElementById('row_' + name.replace(/ /g, '-'));
      if (!row) { return; }
      var count = Math.max(0, Math.floor(Number(State.stores[name]) || 0));
      var label = compactStoreCount(count);
      row.title = _(name) + '：' + count;
      row.setAttribute('aria-label', row.title);
      var quantity = row.querySelector('.row_val');
      if (quantity && quantity.textContent !== label) { quantity.textContent = label; }
    });
    arrangeOutfitting();
    var outer = $('#worldOuter');
    if (outer.length && !document.getElementById('offline-world-status')) {
      var status = $('<div>').attr('id', 'offline-world-status').prependTo(outer);
      $('#backpackTitle, #healthCounter, #backpackSpace').appendTo(status);
    }
    arrangeCosts();
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
    document.body.classList.toggle('offline-event-open', !!Events.activeEvent());
    arrangePanels();
    arrangeCombat();
    arrangeLoot();
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
    var tab = activeModule.tab && activeModule.tab[0];
    var header = document.getElementById('header');
    if (tab && header) {
      var bounds = tab.getBoundingClientRect();
      var headerBounds = header.getBoundingClientRect();
      if (bounds.left < headerBounds.left || bounds.right > headerBounds.right) {
        header.scrollLeft += bounds.left - headerBounds.left - (header.clientWidth - bounds.width) / 2;
      }
    }
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
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('pointerdown', function (event) {
        event.preventDefault();
        if (Engine.keyLock || document.body.classList.contains('offline-sheet-open') || (activeModule !== World && activeModule !== Space)) { return; }
        if (activeModule === World) {
          if (!event.isPrimary) { return; }
          OfflineGame.releaseControls();
          worldPointer = event.pointerId;
        }
        button.setPointerCapture(event.pointerId);
        held[direction[2]] = true;
        button.classList.add('offline-held');
        button.setAttribute('aria-pressed', 'true');
        Engine.keyDown({ which: direction[2], keyCode: direction[2] });
        applyTilt();
        // World movement repeats slowly; flight has its own 30fps movement loop.
        if (activeModule === World && !Engine.keyLock && !repeatTimer) {
          repeatTimer = setInterval(function () {
            if (activeModule !== World || Engine.keyLock) { return; }
            Object.keys(held).forEach(function (key) { Engine.keyDown({ which: Number(key) }); });
          }, 350);
        }
      });
      function release(event) {
        if (event) { event.preventDefault(); }
        if (worldPointer !== null && (!event || event.pointerId === worldPointer)) { OfflineGame.releaseControls(); return; }
        button.classList.remove('offline-held');
        button.setAttribute('aria-pressed', 'false');
        if (!held[direction[2]]) { return; }
        delete held[direction[2]];
        Engine.keyUp({ which: direction[2] });
        applyTilt();
        if (!Object.keys(held).length) { clearInterval(repeatTimer); repeatTimer = null; }
      }
      button.addEventListener('pointerup', release);
      button.addEventListener('pointercancel', release);
      button.addEventListener('lostpointercapture', release);
      button.addEventListener('click', function (event) {
        if (event.detail !== 0 || activeModule !== World || Engine.keyLock || document.body.classList.contains('offline-sheet-open')) { return; }
        Engine.keyDown({ which: direction[2], keyCode: direction[2] });
        Engine.keyUp({ which: direction[2] });
      });
      controls.appendChild(button);
    });
    controls.addEventListener('pointermove', function (event) {
      if (activeModule !== World || worldPointer !== event.pointerId || Engine.keyLock) { return; }
      var hit = document.elementFromPoint(event.clientX, event.clientY);
      var next = hit && hit.closest('#offline-controls .offline-direction');
      var key = next && Number({ up: 38, left: 37, down: 40, right: 39 }[next.getAttribute('data-direction')]);
      if (key && held[key]) { return; }
      Object.keys(held).forEach(function (code) { Engine.keyUp({ which: Number(code) }); });
      held = {};
      $('#offline-controls .offline-direction').removeClass('offline-held').attr('aria-pressed', 'false');
      if (!key) { return; }
      held[key] = true;
      next.classList.add('offline-held'); next.setAttribute('aria-pressed', 'true');
      Engine.keyDown({ which: key, keyCode: key });
    });
    document.body.appendChild(controls);
  }

  var originalLights = Engine.turnLightsOff;
  /** Applies the shared theme to the active ordinary game without touching other slots. */
  function syncTheme() {
    if (!window.State || initializing) { return; }
    var dark = OfflineTheme.isDark();
    if (!!$SM.get('config.lightsOff') !== dark) { originalLights(); }
    document.body.classList.toggle('offline-dark', dark);
    $('#offline-lights').text(dark ? '日间模式' : '夜间模式');
    scheduleLayout();
  }
  Engine.turnLightsOff = function () {
    if (initializing) { originalLights(); return; }
    if (!OfflineTheme.setDark(!$SM.get('config.lightsOff'))) {
      $('#saveNotify').stop(true).text(Rogue.t('err.themeSave')).css('opacity', 1);
    }
  };
  window.addEventListener('adrthemechange', syncTheme);
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
