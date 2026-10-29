// Offline launch flow: no game on the title screen, placeholder isolation and save continuity.
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
const assets = path.join(root, 'android/app/src/main/assets/game');
const output = path.join(root, '.local/home-tests');
const origin = 'https://appassets.androidplatform.net';
const base = origin + '/game/';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.md': 'text/plain' };
const errors = [], remote = [], missing = [], checks = [], layouts = [];
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
async function setup(width = 360, height = 740, seed) {
  const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, offline: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36' });
  if (seed) await context.addInitScript(seed => {
    if (localStorage.getItem('__home_test_seeded')) return;
    Object.entries(seed).forEach(([key, value]) => localStorage.setItem(key, value));
    localStorage.setItem('__home_test_seeded', '1');
  }, seed);
  const requests = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || !url.pathname.startsWith('/game/')) {
      remote.push(url.href); await route.abort('internetdisconnected'); return;
    }
    const relative = decodeURIComponent(url.pathname.slice('/game/'.length));
    requests.push(relative);
    const file = path.resolve(assets, relative);
    assert(file.startsWith(assets + path.sep));
    try { await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' }); }
    catch { missing.push(relative); await route.fulfill({ status: 404, body: 'Missing local asset' }); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  return { context, page, requests };
}
async function home(page) {
  await page.goto(base + 'home.html');
  await page.waitForFunction(() => window.OfflineHome);
}
/** Waits for the normal room and its saved theme stylesheet to finish loading. */
async function ready(page) {
  await page.waitForFunction(() => window.OfflineGame && window.State && window.Room && Engine.activeModule === Room &&
    Engine.isLightsOff() === !!$SM.get('config.lightsOff'));
}
async function storage(page) {
  return page.evaluate(() => JSON.stringify(Object.fromEntries(Object.keys(localStorage).sort().map(key => [key, localStorage.getItem(key)]))));
}
async function dormant(page, requests) {
  assert.equal(await page.evaluate(() => typeof window.Engine), 'undefined');
  assert.equal(await page.evaluate(() => typeof window.OfflineGame), 'undefined');
  assert.equal(requests.some(name => /^(script\/|audio\/|offline\.js)/.test(name) && name !== 'script/rogue/lang/zh.js'), false, 'The launcher loads only Rogue translations, never the game engine or audio');
}
async function inspect(page, scene, tag) {
  const result = await page.evaluate(() => {
    const failures = [];
    if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('horizontal-overflow');
    const modal = !document.getElementById('offline-home-dialog-layer').hidden;
    const selector = modal ? '#offline-home-dialog, #offline-home-dialog button' : '.home-screen:not([hidden]), .home-screen:not([hidden]) button, .home-screen:not([hidden]) a, .home-footer a';
    const controls = [...document.querySelectorAll(selector)];
    for (const node of controls) {
      if (!node.getClientRects().length || node.closest('#offline-slot-list')) continue;
      const r = node.getBoundingClientRect();
      if (r.left < -1 || r.right > innerWidth + 1 || r.top < -1 || r.bottom > innerHeight + 1) failures.push('offscreen:' + node.id);
      if (node.matches('a,button') && r.height < 43) failures.push('small-target:' + node.id);
    }
    if (modal) {
      const r = document.getElementById('offline-home-dialog').getBoundingClientRect();
      if (Math.abs((r.top + r.bottom) / 2 - innerHeight / 2) > 1) failures.push('dialog-not-centered');
    }
    return { failures, dark: document.documentElement.classList.contains('home-dark') };
  });
  assert.deepEqual(result.failures, [], tag + ' ' + scene);
  layouts.push({ tag, scene, ...result });
  await page.screenshot({ path: path.join(output, tag + '-' + scene + '.png') });
}
try {
  const fixture = await setup();
  await fixture.page.goto(base + 'index.html'); await ready(fixture.page);
  await fixture.page.locator('#lightButton').tap();
  const saved = await fixture.page.evaluate(() => {
    $SM.set('stores.wood', 3210); $SM.set('playStats.audioAlertShown', true); OfflineGame.save(); return localStorage.gameState;
  });
  await fixture.context.close();
  for (const [width, height, font] of [[320,512,16], [320,512,22], [360,740,16], [412,915,22]]) {
    for (const night of [false, true]) {
      const state = JSON.parse(saved);
      state.config.lightsOff = night;
      state.config.offlineSpeed = 3;
      const seed = { gameState: JSON.stringify(state), offlineFontSize: String(font) };
      const { context, page, requests } = await setup(width, height, seed);
      const tag = `${width}x${height}-${font}-${night ? 'night' : 'day'}`;
      await home(page); await dormant(page, requests);
      const before = await storage(page);
      assert.equal(await page.locator('html').evaluate(node => getComputedStyle(node).fontSize), font + 'px');
      assert.equal(await page.locator('html').evaluate(node => node.classList.contains('home-dark')), night);
      await inspect(page, 'title', tag);
      await page.locator('#offline-home-start').tap();
      assert.equal(await page.locator('#offline-home-modes').isVisible(), true);
      await inspect(page, 'modes', tag);
      assert.equal(await storage(page), before, 'Title and mode selection alone do not touch storage');
      await page.locator('#offline-mode-normal').tap();
      assert.match(await page.locator('#offline-slot-1').innerText(), /小黑屋|村庄|探索|飞船/);
      assert.match(await page.locator('#offline-slot-2').innerText(), /空存档/);
      await inspect(page, 'slots', tag);
      await page.locator('#offline-slots-back').tap();
      await page.locator('#offline-mode-rogue').tap();
      await page.waitForURL(base + 'index.html?mode=rogue');
      assert.equal(await page.locator('.rogue-slot-open').count(), 3);
      assert.equal(await page.evaluate(() => typeof window.State), 'undefined');
      assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), null);
      await page.getByRole('button', { name: '返回主页面', exact: true }).click();
      await page.waitForURL(base + 'home.html');
      assert.equal(await page.evaluate(() => OfflineHome.back()), false, 'Title allows Android to exit');
      assert.equal(await page.evaluate(() => localStorage.gameState), seed.gameState, 'Rogue selection must retain the working game save');
      const afterSelection = await storage(page);
      await dormant(page, []);
      await page.locator('.home-footer a').tap();
      await page.waitForURL(base + 'about.html?from=home');
      assert.equal(await page.locator('#about-return').getAttribute('href'), 'home.html');
      await page.locator('#about-return').tap();
      await page.waitForFunction(() => window.OfflineHome);
      assert.equal(await storage(page), afterSelection, 'Attribution navigation must retain storage');
      await page.locator('#offline-home-start').tap();
      await page.locator('#offline-home-back').tap();
      assert.equal(await page.locator('#offline-home-title').isVisible(), true);
      await page.locator('#offline-home-start').tap();
      await page.locator('#offline-mode-normal').tap(); await page.locator('#offline-slot-1').tap(); await ready(page);
      assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 3210);
      assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 3);
      assert.equal(await page.evaluate(() => Engine.isLightsOff()), night);
      await page.evaluate(() => { $SM.set('stores.wood', 4321); OfflineGame.save(); });
      await page.locator('#offline-menu-button').tap();
      await page.locator('#offline-home').tap();
      await page.waitForFunction(() => window.OfflineHome);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.gameState).stores.wood), 4321);
      assert.equal(await page.evaluate(() => typeof window.Engine), 'undefined');
      await page.locator('#offline-home-start').tap(); await page.locator('#offline-mode-normal').tap(); await page.locator('#offline-slot-1').tap(); await ready(page);
      assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 4321, 'Re-entering normal mode resumes the saved game');
      checks.push({ tag, passed: true });
      await context.close();
    }
  }
  const fresh = await setup();
  await home(fresh.page); await dormant(fresh.page, fresh.requests);
  assert.equal(await fresh.page.evaluate(() => localStorage.getItem('gameState')), null);
  await fresh.page.locator('#offline-home-start').focus(); await fresh.page.keyboard.press('Enter');
  await fresh.page.locator('#offline-mode-rogue').focus(); await fresh.page.keyboard.press('Enter');
  await fresh.page.waitForURL(base + 'index.html?mode=rogue');
  assert.equal(await fresh.page.evaluate(() => localStorage.getItem('gameState')), null, 'Rogue launcher creates no normal progress');
  assert.equal(await fresh.page.evaluate(() => localStorage.getItem('rogueSlot0')), null, 'Rogue launcher creates no run until explicitly started');
  await fresh.page.getByRole('button', { name: '返回主页面', exact: true }).click();
  await fresh.page.waitForURL(base + 'home.html');
  await fresh.page.locator('#offline-home-start').tap();
  await fresh.page.locator('#offline-mode-normal').tap(); await fresh.page.locator('#offline-slot-1').tap(); await ready(fresh.page);
  assert.equal(await fresh.page.evaluate(() => OfflineGame.getCheats().enabled), false);
  assert.equal(await fresh.page.evaluate(() => OfflineGame.getSpeed()), 1);
  await fresh.page.locator('#lightButton').tap();
  assert(await fresh.page.evaluate(() => $SM.get('game.fire.value') > 0));
  await fresh.context.close();
  const invalid = await setup(320, 512, { gameState: '{invalid-save', offlineFontSize: 'invalid' });
  await home(invalid.page);
  assert.equal(await invalid.page.evaluate(() => localStorage.gameState), '{invalid-save');
  await invalid.page.locator('#offline-home-start').tap(); await invalid.page.locator('#offline-mode-rogue').tap();
  await invalid.page.waitForURL(base + 'index.html?mode=rogue');
  assert.equal(await invalid.page.evaluate(() => localStorage.gameState), '{invalid-save', 'Even malformed saves are untouched by the launcher');
  await invalid.context.close();
  checks.push({ freshStart: true, keyboard: true, invalidSavePreserved: true, passed: true });
  assert.deepEqual(errors, []); assert.deepEqual(remote, []); assert.deepEqual(missing, []);
  const report = { passed: true, checks, layoutScenarios: layouts.length, layouts, errors, remote, missing };
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, layoutScenarios: layouts.length }));
} finally { await browser.close(); }
