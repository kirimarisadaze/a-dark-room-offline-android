/* Independent local save slots for each mode. MPL-2.0. */
(function () {
  'use strict';
  var KEY = 'adr.saveSlots.v1';
  var COUNT = 3;
  var bound = null;
  var names = { normal: '普通模式', rogue: 'rogue' };
  function target(mode, slot) {
    if (!Object.prototype.hasOwnProperty.call(names, mode) || slot !== Math.floor(slot) || slot < 1 || slot > COUNT) {
      throw new Error('存档栏位无效。');
    }
    return { mode: mode, slot: slot };
  }
  function parseState(raw) {
    var state = JSON.parse(raw);
    if (!state || typeof state !== 'object' || Array.isArray(state)) throw new Error('存档内容无效。');
    return state;
  }
  function persist(db) { localStorage.setItem(KEY, JSON.stringify(db)); }
  function read() {
    var raw = localStorage.getItem(KEY);
    if (raw !== null) {
      var db;
      try {
        db = JSON.parse(raw);
        if (!db || db.version !== 1 || !db.modes) throw 0;
        ['normal', 'rogue'].forEach(function (mode) {
          if (!Array.isArray(db.modes[mode]) || db.modes[mode].length !== COUNT) throw 0;
          db.modes[mode].forEach(function (entry) {
            if (entry !== null && (!entry || typeof entry !== 'object' ||
                (entry.data !== null && typeof entry.data !== 'string'))) throw 0;
          });
        });
        if (db.active !== null) target(db.active.mode, db.active.slot);
      } catch (error) { throw new Error('无法读取存档列表，原始数据已保留。'); }
      return db;
    }
    db = { version: 1, active: null, modes: { normal: [null, null, null], rogue: [null, null, null] } };
    var legacy = localStorage.getItem('gameState');
    if (legacy !== null) {
      var now = Date.now();
      db.modes.normal[0] = { data: legacy, kind: 'game', createdAt: now, updatedAt: now };
      db.active = target('normal', 1);
      // Commit the original string before any slot may replace the working cache.
      // Malformed legacy data is preserved too, and will never silently become a new game.
      persist(db);
    }
    return db;
  }
  function cache(raw, strict) {
    try {
      if (raw === null) localStorage.removeItem('gameState');
      else localStorage.setItem('gameState', raw);
    } catch (error) { if (strict) throw new Error('无法载入存档，请检查手机剩余空间。'); }
  }
  function label(which) {
    which = which || bound || read().active || target('normal', 1);
    return (which.mode === 'rogue' && window.Rogue ? window.Rogue.t('ui.mode') : names[which.mode]) + ' · 存档 ' + which.slot;
  }
  function list(mode) {
    target(mode, 1);
    var db = read();
    return db.modes[mode].map(function (entry, index) {
      var summary = '空存档 · 开始新游戏';
      var broken = false;
      if (entry && mode === 'rogue') summary = '已预留 · 玩法尚未开放';
      else if (entry && entry.data !== null) {
        try {
          var state = parseState(entry.data);
          var locations = state.features && state.features.location || {};
          summary = locations.spaceShip ? '已发现飞船' : locations.world ? '已解锁探索' : locations.outside ? '村庄发展中' : '小黑屋';
          var population = Number(state.game && state.game.population) || 0;
          if (population > 0) summary += ' · 村民 ' + population;
        } catch (error) { broken = true; summary = '存档异常 · 原始数据已保留'; }
      }
      return { slot: index + 1, empty: !entry || (mode === 'normal' && entry.data === null),
        reserved: !!entry && mode === 'rogue', broken: broken, summary: summary,
        updatedAt: entry && entry.updatedAt || null };
    });
  }
  function selectNormal(slot) {
    var which = target('normal', slot);
    var db = read();
    var entry = db.modes.normal[slot - 1];
    if (entry && entry.data !== null) {
      try { parseState(entry.data); }
      catch (error) { throw new Error('这个存档无法读取，原始进度已保留。请选择其他栏位。'); }
    }
    if (!entry) db.modes.normal[slot - 1] = entry = { data: null, kind: 'new', createdAt: Date.now(), updatedAt: null };
    db.active = which;
    persist(db);
    cache(entry.data, true);
    return which;
  }
  function prepareNormal() {
    var db = read();
    var which = db.active && db.active.mode === 'normal' ? db.active : target('normal', 1);
    selectNormal(which.slot);
    bound = target('normal', which.slot);
    return bound;
  }
  function save(raw, imported) {
    parseState(raw);
    var db = read();
    var which = bound || (db.active && db.active.mode === 'normal' ? db.active : target('normal', 1));
    if (which.mode !== 'normal') throw new Error('这个模式尚未开放。');
    var old = db.modes.normal[which.slot - 1];
    var now = Date.now();
    db.modes.normal[which.slot - 1] = { data: raw, kind: 'game', createdAt: old && old.createdAt || now, updatedAt: now };
    if (!db.active || imported) db.active = target('normal', which.slot);
    // The database is authoritative. A full disk can never partially replace another slot.
    persist(db);
    cache(raw, false);
    return true;
  }
  function reserveRogue(slot) {
    target('rogue', slot);
    var db = read();
    if (!db.modes.rogue[slot - 1]) {
      var now = Date.now();
      db.modes.rogue[slot - 1] = { data: null, kind: 'reserved', createdAt: now, updatedAt: now };
      persist(db);
    }
    return true;
  }
  function remove(mode, slot) {
    target(mode, slot);
    var db = read();
    db.modes[mode][slot - 1] = null;
    var active = db.active && db.active.mode === mode && db.active.slot === slot;
    if (active) db.active = null;
    persist(db);
    if (active) cache(null, false);
  }
  window.SaveSlots = { count: COUNT, list: list, label: label, selectNormal: selectNormal,
    prepareNormal: prepareNormal, save: function (raw) { return save(raw, false); },
    importJSON: function (raw) {
      var state = parseState(raw);
      if (!state.game || typeof state.game !== 'object' || Array.isArray(state.game)) throw new Error('存档内容无效。');
      return save(raw, true);
    },
    reserveRogue: reserveRogue, remove: remove,
    current: function () { var which = bound || read().active || target('normal', 1); return target(which.mode, which.slot); }
  };
})();
