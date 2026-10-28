// Save isolation: migration, six independent slots, import/restart/deletion and failed writes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch {}
}
assert(playwright, 'Playwright is required');
const base = 'https://appassets.androidplatform.net/game/';
const assets = path.join(root, 'android/app/src/main/assets/game');
const output = path.join(root, '.local/save-slot-tests');
const KEY = 'adr.saveSlots.v1';
const mime = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg' };
const errors = [], remote = [], missing = [], checks = [];
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
async function setup(seed = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, offline: true });
  await context.addInitScript(seed => {
    if (localStorage.getItem('__slots_seeded')) return;
    Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
    localStorage.setItem('__slots_seeded', '1');
  }, seed);
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
    const name = path.resolve(assets, decodeURIComponent(new URL(url).pathname.slice('/game/'.length)));
    assert(name.startsWith(assets + path.sep));
    try { await route.fulfill({ body: await fs.readFile(name), contentType: mime[path.extname(name)] || 'application/octet-stream' }); }
    catch { missing.push(url); await route.fulfill({ status: 404, body: '' }); }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  return { context, page };
}
async function home(page) { await page.goto(base + 'home.html'); await page.waitForFunction(() => window.OfflineHome); }
async function ready(page) { await page.waitForFunction(() => window.State && window.OfflineGame && window.Room && Engine.activeModule === Room); }
async function pickMode(page, mode = 'normal') {
  await page.locator('#offline-home-start').tap(); await page.locator('#offline-mode-' + mode).tap();
}
async function enter(page, slot) {
  await home(page); await pickMode(page); await page.locator('#offline-slot-' + slot).tap(); await ready(page);
}
async function db(page) { return page.evaluate(KEY => JSON.parse(localStorage.getItem(KEY)), KEY); }
function rawSave(index, mode, slot) { return index.modes[mode][slot - 1]?.data ?? null; }
function mark(name) { checks.push({ name, passed: true }); }
try {
  // Build a real upstream save, then present it as an old single-save installation.
  const fixture = await setup(); await fixture.page.goto(base + 'index.html'); await ready(fixture.page);
  const legacy = await fixture.page.evaluate(() => {
    $SM.set('stores.wood', 1111); $SM.set('playStats.audioAlertShown', true); OfflineGame.setSpeed(3);
    OfflineGame.save(); return localStorage.gameState;
  });
  await fixture.context.close();
  const { context, page } = await setup({ gameState: legacy, offlineFontSize: '22', unrelated: 'keep' });
  await home(page); await pickMode(page);
  assert.equal(rawSave(await db(page), 'normal', 1), legacy, 'Migration preserves the exact old save string');
  assert.equal(await page.evaluate(() => localStorage.gameState), legacy);
  assert.equal((await db(page)).modes.normal.length, 3); assert.equal((await db(page)).modes.rogue.length, 3);
  await page.reload(); await pickMode(page);
  assert.equal(rawSave(await db(page), 'normal', 1), legacy, 'Migration runs once');
  mark('lossless legacy migration to normal slot 1 and reload');

  await page.locator('#offline-slot-2').tap(); await ready(page);
  assert.notEqual(await page.evaluate(() => $SM.get('stores.wood')), 1111);
  assert.equal(await page.evaluate(() => SaveSlots.current().slot), 2);
  assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 1, 'Empty slot does not inherit old game speed');
  await page.locator('#lightButton').tap();
  await page.evaluate(() => { $SM.set('stores.wood', 2222); OfflineGame.setSpeed(4); OfflineGame.save(); });
  assert.equal(JSON.parse(rawSave(await db(page), 'normal', 2)).stores.wood, 2222);
  assert.equal(rawSave(await db(page), 'normal', 1), legacy);
  mark('new slot 2 is independent and saves actual gameplay');
  await page.evaluate(() => $SM.set('stores.wood', 2233));
  assert.equal(JSON.parse(rawSave(await db(page), 'normal', 2)).stores.wood, 2233, 'Real state updates automatically save into slot 2');
  await page.evaluate(() => $SM.set('stores.wood', 2222));
  mark('automatic state saves target the active slot without a manual save action');

  await enter(page, 3);
  await page.evaluate(() => { $SM.set('stores.wood', 3333); OfflineGame.save(); });
  await enter(page, 1);
  assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 1111);
  assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 3);
  await page.locator('#offline-menu-button').tap();
  assert.match(await page.locator('#offline-current-save').innerText(), /普通模式 · 存档 1/);
  await page.locator('#offline-home').tap(); await page.waitForFunction(() => window.OfflineHome);
  await enter(page, 2);
  assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 2222);
  assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 4);
  assert.equal(JSON.parse(rawSave(await db(page), 'normal', 3)).stores.wood, 3333);
  mark('all three normal slots resume independent progress and preferences');

  const backup = await page.evaluate(() => Engine.export64());
  const beforeImport = await db(page);
  await enter(page, 3);
  await page.evaluate(code => Engine.import64(code), backup);
  await page.waitForFunction(() => window.OfflineGame && window.Room && Engine.activeModule === Room && $SM.get('stores.wood') === 2222);
  let index = await db(page);
  assert.equal(rawSave(index, 'normal', 1), rawSave(beforeImport, 'normal', 1));
  assert.equal(JSON.parse(rawSave(index, 'normal', 2)).stores.wood, 2222);
  assert.equal(JSON.parse(rawSave(index, 'normal', 3)).stores.wood, 2222);
  await page.evaluate(() => Engine.import64('invalid-code'));
  assert.equal(await page.evaluate(() => OfflineGame.save()), true);
  mark('Base64 backup and restore target only the selected slot; invalid import retains it');

  await page.evaluate(() => {
    $SM.set('previous.stores', [4, 5, 6]); $SM.set('previous.score', 712);
  });
  const beforeRestart = await db(page);
  await page.evaluate(() => Engine.deleteSave());
  await ready(page);
  await page.waitForFunction(() => !($SM.get('stores.wood') > 0));
  index = await db(page);
  assert.equal(rawSave(index, 'normal', 1), rawSave(beforeRestart, 'normal', 1));
  assert.equal(rawSave(index, 'normal', 2), rawSave(beforeRestart, 'normal', 2));
  assert.equal(await page.evaluate(() => localStorage.unrelated), 'keep');
  assert.equal(await page.evaluate(() => localStorage.offlineFontSize), '22');
  assert.equal(await page.evaluate(() => SaveSlots.current().slot), 3);
  assert.equal(await page.evaluate(() => $SM.get('previous.score')), 712);
  assert.deepEqual(await page.evaluate(() => $SM.get('previous.stores')), [4, 5, 6], 'Restart retains the original prestige rule within its own slot');
  mark('restart resets only the bound slot and preserves the other modes and preferences');

  await home(page); await pickMode(page, 'rogue');
  const normals = JSON.stringify((await db(page)).modes.normal);
  for (const slot of [1, 2, 3]) {
    await page.locator('#offline-slot-' + slot).tap();
    assert.match(await page.locator('[role="dialog"]').innerText(), new RegExp('存档 ' + slot));
    await page.locator('#offline-home-dialog-close').tap();
  }
  index = await db(page);
  assert.equal(JSON.stringify(index.modes.normal), normals);
  assert(index.modes.rogue.every(entry => entry.kind === 'reserved' && entry.data === null));
  assert.equal(await page.evaluate(() => typeof window.Engine), 'undefined');
  await page.reload(); await pickMode(page, 'rogue');
  assert.equal(await page.locator('.home-slot-summary').filter({ hasText: '已预留' }).count(), 3);
  await page.screenshot({ path: path.join(output, 'rogue-slots.png') });
  mark('three persistent rogue slots are isolated reservations with no game engine or normal save changes');

  const rogueBefore = (await db(page)).modes.rogue;
  await page.locator('[data-slot="2"] .home-slot-delete').tap();
  await page.locator('#offline-home-dialog-close').tap();
  assert.deepEqual((await db(page)).modes.rogue, rogueBefore, 'Delete cancel preserves everything');
  await page.locator('[data-slot="2"] .home-slot-delete').tap();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'offline-home-dialog-confirm');
  await page.locator('#offline-home-dialog-confirm').tap();
  assert.equal((await db(page)).modes.rogue[1], null);
  assert.deepEqual((await db(page)).modes.rogue[0], rogueBefore[0]);
  assert.deepEqual((await db(page)).modes.rogue[2], rogueBefore[2]);
  mark('delete confirmation, cancel and keyboard focus preserve other rogue slots');

  await enter(page, 1);
  const normalBefore = await db(page);
  await home(page); await pickMode(page);
  await page.locator('[data-slot="1"] .home-slot-delete').tap(); await page.locator('#offline-home-dialog-confirm').tap();
  assert.equal(rawSave(await db(page), 'normal', 1), null);
  assert.equal(await page.evaluate(() => localStorage.getItem('gameState')), null);
  await page.reload(); await pickMode(page);
  assert.match(await page.locator('#offline-slot-1').innerText(), /空存档/);
  await page.locator('#offline-slot-1').tap(); await ready(page);
  assert.notEqual(await page.evaluate(() => $SM.get('stores.wood')), 1111, 'Deleted cache cannot resurrect old progress');
  assert.equal(rawSave(await db(page), 'normal', 2), rawSave(normalBefore, 'normal', 2));
  assert.deepEqual((await db(page)).modes.rogue, normalBefore.modes.rogue);
  mark('deleting the active normal save cannot resurrect the legacy cache');

  // A stale second page must keep saving to its own bound slot.
  await enter(page, 2);
  const older = await context.newPage();
  older.on('pageerror', error => errors.push(error.message));
  await older.goto(base + 'index.html'); await ready(older);
  await older.evaluate(() => { $SM.set('stores.wood', 2876); OfflineGame.save(); });
  await enter(page, 3);
  await page.evaluate(() => { $SM.set('stores.wood', 3987); OfflineGame.save(); });
  await older.evaluate(() => { $SM.set('stores.wood', 2888); OfflineGame.save(); });
  index = await db(page);
  assert.equal(index.active.slot, 3);
  assert.equal(JSON.parse(rawSave(index, 'normal', 2)).stores.wood, 2888);
  assert.equal(JSON.parse(rawSave(index, 'normal', 3)).stores.wood, 3987);
  await older.close();
  await page.reload(); await ready(page);
  assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 3987, 'Database wins over a stale compatibility cache');
  mark('older pages cannot save into a different newly selected slot');

  // Simulate atomic quota rejection of the authoritative database write.
  const beforeFull = await db(page);
  const quota = await page.evaluate(KEY => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === KEY) throw new DOMException('Full', 'QuotaExceededError');
      return original.call(this, key, value);
    };
    try {
      $SM.set('stores.wood', 9999);
      const saved = OfflineGame.save();
      let imported = false;
      try { SaveSlots.importJSON(JSON.stringify(State)); imported = true; } catch {}
      return { saved, imported, raw: localStorage.getItem(KEY), notice: document.getElementById('saveNotify').textContent };
    } finally { Storage.prototype.setItem = original; }
  }, KEY);
  assert.equal(quota.saved, false); assert.equal(quota.imported, false);
  assert.match(quota.notice, /保存失败/);
  assert.deepEqual(JSON.parse(quota.raw), beforeFull);
  mark('failed writes and imports leave the last database and all slots intact');
  await context.close();

  // A broken legacy save is preserved in slot 1; other slots remain playable.
  const broken = await setup({ gameState: '{broken-legacy', offlineFontSize: '16' });
  await home(broken.page); await pickMode(broken.page);
  assert.match(await broken.page.locator('#offline-slot-1').innerText(), /存档异常/);
  await broken.page.locator('#offline-slot-1').tap();
  assert.match(await broken.page.locator('#offline-home-feedback').innerText(), /原始进度已保留/);
  assert.equal(rawSave(await db(broken.page), 'normal', 1), '{broken-legacy');
  await broken.page.locator('#offline-slot-2').tap(); await ready(broken.page);
  assert.equal(rawSave(await db(broken.page), 'normal', 1), '{broken-legacy');
  await broken.context.close();
  mark('invalid legacy data is retained and never silently overwritten by a fresh start');

  const badDb = await setup({ [KEY]: '{broken-database', gameState: legacy });
  await home(badDb.page); await pickMode(badDb.page);
  assert.match(await badDb.page.locator('#offline-home-feedback').innerText(), /原始数据已保留/);
  assert.equal(await badDb.page.locator('.home-slot').count(), 0);
  assert.equal(await badDb.page.evaluate(KEY => localStorage.getItem(KEY), KEY), '{broken-database');
  assert.equal(await badDb.page.evaluate(() => localStorage.gameState), legacy);
  await badDb.context.close();
  mark('invalid slot metadata fails closed without clearing the database or legacy save');

  const native = await setup();
  await home(native.page);
  await native.page.evaluate(() => OfflineHome.beginRestore());
  assert.match(await native.page.locator('#offline-slots-heading').innerText(), /选择恢复位置/);
  await native.page.evaluate(raw => { SaveSlots.selectNormal(2); SaveSlots.importJSON(raw); }, legacy);
  await native.page.goto(base + 'index.html'); await ready(native.page);
  assert.equal(await native.page.evaluate(() => $SM.get('stores.wood')), 1111);
  assert.equal(await native.page.evaluate(() => SaveSlots.current().slot), 2);
  assert.equal(rawSave(await db(native.page), 'normal', 1), null);
  await native.context.close();
  mark('native import API works without a running game and preserves slot targeting');

  assert.deepEqual(errors, []); assert.deepEqual(remote, []); assert.deepEqual(missing, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, remote, missing }, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length }));
} finally { await browser.close(); }
