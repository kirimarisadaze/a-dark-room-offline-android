/* Local title, mode and save selection. The game engine only runs after a slot is chosen. MPL-2.0. */
(function () {
  'use strict';
  var title = document.getElementById('offline-home-title');
  var modes = document.getElementById('offline-home-modes');
  var slots = document.getElementById('offline-home-slots');
  var main = document.getElementById('offline-home-main');
  var footer = document.querySelector('.home-footer');
  var dialog = document.getElementById('offline-home-dialog-layer');
  var start = document.getElementById('offline-home-start');
  var close = document.getElementById('offline-home-dialog-close');
  var confirm = document.getElementById('offline-home-dialog-confirm');
  var feedback = document.getElementById('offline-home-feedback');
  var mode = 'normal';
  var restoring = false;
  var returnFocus = start;
  var confirmAction = null;
  try {
    var size = Math.max(16, Math.min(22, Number(localStorage.offlineFontSize) || 16));
    document.documentElement.style.fontSize = size + 'px';
    var state = JSON.parse(localStorage.getItem('gameState') || 'null');
    document.documentElement.classList.toggle('home-dark', !!(state && state.config && state.config.lightsOff));
  } catch (error) { /* The picker preserves invalid data and reports it per slot. */ }

  function fail(error) {
    feedback.textContent = error.message || '操作未完成，原始存档已保留。';
    feedback.hidden = false;
  }
  function screen(which) {
    title.hidden = which !== title;
    modes.hidden = which !== modes;
    slots.hidden = which !== slots;
    feedback.hidden = true;
    document.body.classList.toggle('home-selecting-slot', which === slots);
  }
  function showModes() {
    screen(modes);
    document.getElementById('offline-mode-heading').focus();
  }
  function closeDialog() {
    dialog.hidden = true;
    main.removeAttribute('aria-hidden');
    footer.removeAttribute('aria-hidden');
    main.inert = footer.inert = false;
    confirmAction = null;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }
  function showDialog(heading, description, trigger, action) {
    returnFocus = trigger;
    confirmAction = action || null;
    document.getElementById('offline-home-dialog-heading').textContent = heading;
    document.getElementById('offline-home-dialog-description').textContent = description;
    confirm.hidden = !action;
    close.textContent = action ? '取消' : '返回';
    dialog.hidden = false;
    main.setAttribute('aria-hidden', 'true');
    footer.setAttribute('aria-hidden', 'true');
    main.inert = footer.inert = true;
    close.focus();
  }
  function timeText(stamp) {
    if (!stamp) return '尚未开始';
    var d = new Date(stamp);
    function pad(n) { return ('0' + n).slice(-2); }
    return '保存于 ' + d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function showSlots(nextMode, restore) {
    mode = nextMode;
    restoring = !!restore;
    screen(slots);
    document.getElementById('offline-slots-mode').textContent = mode === 'normal' ? '普通模式' : 'Roguelike 模式 · 暂未开放';
    document.getElementById('offline-slots-heading').textContent = restoring ? '选择恢复位置' : '选择存档';
    var list = document.getElementById('offline-slot-list');
    list.textContent = '';
    try {
      SaveSlots.list(mode).forEach(function (entry) {
        var row = document.createElement('div');
        row.className = 'home-slot';
        row.setAttribute('data-slot', entry.slot);
        var open = document.createElement('button');
        open.type = 'button';
        open.className = 'home-slot-open';
        open.id = 'offline-slot-' + entry.slot;
        var heading = document.createElement('strong');
        heading.className = 'home-slot-name';
        heading.textContent = '存档 ' + entry.slot;
        var summary = document.createElement('span');
        summary.className = 'home-slot-summary';
        summary.textContent = mode === 'rogue' && entry.empty ? '空存档 · 预留栏位' : entry.summary;
        var time = document.createElement('span');
        time.className = 'home-slot-time';
        time.textContent = timeText(entry.updatedAt);
        open.appendChild(heading); open.appendChild(summary); open.appendChild(time);
        open.addEventListener('click', function () {
          try {
            if (mode === 'rogue') {
              SaveSlots.reserveRogue(entry.slot);
              showSlots('rogue');
              showDialog('Roguelike · 存档 ' + entry.slot, '栏位已预留。玩法尚未开放，敬请期待。', document.getElementById('offline-slot-' + entry.slot));
            } else if (restoring && !entry.empty) {
              showDialog('恢复到存档 ' + entry.slot + '？', '导入会替换这个栏位的进度，其他存档不受影响。', open, function () {
                SaveSlots.selectNormal(entry.slot);
                location.href = 'adr-offline://restore-slot';
              });
              confirm.textContent = '继续';
            } else {
              SaveSlots.selectNormal(entry.slot);
              location.href = restoring ? 'adr-offline://restore-slot' : 'index.html';
            }
          } catch (error) { fail(error); }
        });
        row.appendChild(open);
        if (!entry.empty || entry.reserved || entry.broken) {
          var remove = document.createElement('button');
          remove.type = 'button'; remove.className = 'home-slot-delete';
          remove.textContent = '删除'; remove.setAttribute('aria-label', '删除存档 ' + entry.slot);
          remove.addEventListener('click', function () {
            showDialog('删除存档 ' + entry.slot + '？', '这个栏位的进度将被删除，其他存档不受影响。', remove, function () {
              SaveSlots.remove(mode, entry.slot);
              showSlots(mode, restoring);
              returnFocus = document.getElementById('offline-slot-' + entry.slot);
            });
            confirm.textContent = '删除';
          });
          row.appendChild(remove);
        }
        list.appendChild(row);
      });
    } catch (error) { fail(error); }
    document.getElementById('offline-slots-heading').focus();
  }
  function back() {
    if (!dialog.hidden) { closeDialog(); return true; }
    if (!slots.hidden) { showModes(); return true; }
    if (!modes.hidden) { screen(title); start.focus(); return true; }
    return false;
  }
  window.OfflineHome = { back: back, beginRestore: function () { showSlots('normal', true); } };
  start.addEventListener('click', showModes);
  document.getElementById('offline-home-back').addEventListener('click', back);
  document.getElementById('offline-slots-back').addEventListener('click', back);
  document.getElementById('offline-mode-normal').addEventListener('click', function () { showSlots('normal'); });
  document.getElementById('offline-mode-rogue').addEventListener('click', function () { showSlots('rogue'); });
  close.addEventListener('click', closeDialog);
  confirm.addEventListener('click', function () {
    try { if (confirmAction) confirmAction(); closeDialog(); }
    catch (error) { closeDialog(); fail(error); }
  });
  dialog.addEventListener('click', function (event) { if (event.target === dialog) closeDialog(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && back()) { event.preventDefault(); }
    if (!dialog.hidden && event.key === 'Tab') {
      var first = close, last = confirm.hidden ? close : confirm;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  });
  document.addEventListener('focusin', function (event) {
    if (!dialog.hidden && !dialog.contains(event.target)) close.focus();
  });
})();
