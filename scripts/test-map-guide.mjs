// Full-map cheats, expedition/save isolation and the offline landmark reference.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const name of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
  try { playwright = require(name); break; } catch {}
}
assert(playwright, 'Playwright is required');
const output = path.join(root, '.local/map-guide');
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const checks = [], scenarios = [], errors = [], remote = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function inspect(page, name, tag) {
  await settle(page);
  const result = await page.evaluate(() => {
    const rect = n => n.getBoundingClientRect();
    const panel = [...document.querySelectorAll('.offline-sheet')].find(n => !n.hidden);
    const failures = [];
    if (panel) {
      const p = rect(panel), heading = panel.querySelector('.offline-sheet-heading'), h = rect(heading);
      if (p.top < 19 || p.bottom > innerHeight - 19) failures.push('panel-offscreen');
      if (h.top < p.top - 1 || h.bottom > p.bottom) failures.push('heading-hidden');
      for (const n of panel.querySelectorAll('.offline-landmark-body,.offline-landmark-symbol,#offline-landmark-search,.offline-sheet-heading button')) {
        const b = rect(n);
        if (b.width && (b.left < p.left || b.right > p.right || n.scrollWidth > n.clientWidth + 1)) failures.push(n.className || n.id);
      }
    }
    for (const button of document.querySelectorAll('#offline-map-actions button')) {
      const b = rect(button);
      if (b.width && (b.left < 0 || b.right > innerWidth || b.height < 44)) failures.push(button.id);
    }
    return { failures, overflow: document.documentElement.scrollWidth > innerWidth, panelHeight: panel ? rect(panel).height : null };
  });
  await page.screenshot({ path: path.join(output, `${name}-${tag}.png`) });
  assert.equal(result.overflow, false, name + ': page overflow');
  assert.deepEqual(result.failures, [], name + '-' + tag);
  scenarios.push({ name, tag, ...result });
}
async function openMenu(page) { await page.locator('#offline-menu-button').tap(); }
async function closeGuide(page) { await page.locator('#offline-landmarks-close').tap(); }
// The normal fog mask contains sparse array holes. Array.from checks those
// unknown cells too, rather than skipping them like Array.prototype.every.
const maskIsFull = page => page.evaluate(() => Array.from($SM.get('game.world.mask')).every(column => Array.from(column).every(value => value === true)));
try {
  for (const [width, height, font] of [[320, 512, 16], [320, 512, 22], [360, 740, 16], [412, 915, 22]]) {
    for (const night of [false, true]) {
      const tag = `${width}-font${font}-${night ? 'night' : 'day'}`;
      const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, offline: true });
      await context.addInitScript(font => { localStorage.offlineFontSize = String(font); }, font);
      await context.route('**/*', async route => {
        const u = new URL(route.request().url());
        if (u.origin !== 'https://appassets.androidplatform.net' || !u.pathname.startsWith('/game/')) { remote.push(u.href); await route.abort(); return; }
        const file = path.join(root, 'android/app/src/main/assets', decodeURIComponent(u.pathname));
        await route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.flac': 'audio/flac' })[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('https://appassets.androidplatform.net/game/index.html');
      await page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
      await page.evaluate(night => {
        $.fx.off = true; clearTimeout(Events._eventTimeout); clearTimeout(Engine._incomeTimeout);
        $SM.set('playStats.audioAlertShown', true);
        if (night) Engine.turnLightsOff();
      }, night);
      await openMenu(page);
      await page.locator('#offline-landmarks-button').tap();
      assert.equal(await page.locator('.offline-landmark-entry').count(), 20);
      assert.deepEqual(await page.locator('.offline-landmark-entry').evaluateAll(nodes => nodes.map(n => n.dataset.symbol).sort()), await page.evaluate(() => ['@', ...Object.values(World.TILE)].sort()), 'Every upstream symbol appears exactly once');
      assert.equal(await page.evaluate(() => $SM.get('game.world.map') === undefined), true, 'Reading the reference must not create a world');
      await inspect(page, 'guide-before-unlock', tag);
      await page.locator('#offline-landmark-search').fill('硫磺');
      assert.equal(await page.locator('.offline-landmark-entry:visible').count(), 1);
      await page.locator('#offline-landmark-search').fill('X');
      assert.match(await page.locator('.offline-landmark-entry:visible').innerText(), /残破战舰/);
      await page.locator('#offline-landmark-search').fill('不存在的地标');
      assert.equal(await page.locator('#offline-landmark-empty').isVisible(), true);
      await page.locator('#offline-landmark-search').fill('');
      assert.equal(await page.locator('.offline-landmark-entry:visible').count(), 20);
      await closeGuide(page);
      await openMenu(page);
      await page.locator('#offline-cheat-enable').check();
      assert.equal(await page.locator('#offline-cheat-map').isDisabled(), true, 'No map exists before unlocking the path');
      await page.locator('#offline-cheat-enable').uncheck();
      await page.locator('#offline-menu-close').tap();
      await page.evaluate(() => {
        $SM.setM('stores', { compass: 1, convoy: 1, 'cured meat': 100 });
        if (!Path.panel) Path.init();
        Path.outfit = { 'cured meat': 30 }; $SM.set('outfit', Path.outfit);
        Engine.travelTo(Path);
      });
      await page.locator('#embarkButton').tap();
      await page.waitForFunction(() => Engine.activeModule === World && World.curPos);
      assert.equal(await maskIsFull(page), false);
      const before = await page.evaluate(() => {
        // Preserve a change made in the temporary expedition. Revealing must
        // not prematurely commit this visit or the ship-unlock flag.
        const map = World.state.map;
        let cave;
        for (let x = 0; x < map.length && !cave; x++) for (let y = 0; y < map[x].length; y++) if (map[x][y] === World.TILE.CAVE) { cave = [x, y]; break; }
        World.markVisited(...cave); World.state.ship = true;
        return { savedMap: JSON.stringify($SM.get('game.world.map')), currentMap: JSON.stringify(World.state.map), savedShip: $SM.get('game.world.ship'), position: World.curPos.slice(), outfit: { ...Path.outfit } };
      });
      await page.locator('#offline-map-guide').tap();
      const visibleCounts = await page.locator('.offline-landmark-count').allTextContents();
      await page.locator('#offline-landmark-search').focus();
      await page.keyboard.type('wasd');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowRight');
      assert.deepEqual(await page.evaluate(() => World.curPos.slice()), before.position, 'Typing and cursor keys in the reference do not move the player');
      assert.deepEqual(await page.evaluate(() => ({ ...Path.outfit })), before.outfit, 'Reference input does not consume supplies');
      await page.locator('#offline-landmark-search').fill('');
      await inspect(page, 'guide-with-fog', tag);
      await closeGuide(page);
      await openMenu(page);
      await page.locator('#offline-cheat-map').dispatchEvent('click');
      assert.equal(await maskIsFull(page), false, 'The full-map handler respects the disabled cheat master switch');
      await page.locator('#offline-cheat-enable').check();
      assert.equal(await maskIsFull(page), false, 'Enabling cheats alone must not reveal anything');
      await page.locator('#offline-cheat-map').tap();
      assert.equal(await maskIsFull(page), true);
      assert.equal(await page.evaluate(() => Array.from(World.state.mask).every(column => Array.from(column).every(value => value === true))), true);
      assert.equal(await page.evaluate(() => World.seenAll), true, 'Map rewards must not keep looking for hidden cells');
      await page.evaluate(() => World.applyMap());
      assert.deepEqual(await page.evaluate(() => ({ savedMap: JSON.stringify($SM.get('game.world.map')), currentMap: JSON.stringify(World.state.map), savedShip: $SM.get('game.world.ship'), position: World.curPos.slice(), outfit: { ...Path.outfit } })), before, 'Reveal changes masks without changing terrain, visits, pending unlocks, position or supplies');
      await inspect(page, 'map-cheat-menu', tag);
      await page.locator('#offline-cheat-map').tap();
      assert.equal(await maskIsFull(page), true, 'Reveal is safe to repeat');
      await page.locator('#offline-cheat-enable').uncheck();
      await page.locator('#offline-menu-close').tap();
      assert.equal(await maskIsFull(page), true, 'Turning cheats off retains the revealed map');
      assert.equal(await page.locator('#map').evaluate(n => n.classList.contains('offline-map-full')), true);
      await inspect(page, 'revealed-world', tag);
      await page.locator('#offline-map-guide').tap();
      const completeCounts = await page.locator('.offline-landmark-count').allTextContents();
      assert.notDeepEqual(completeCounts, visibleCounts);
      assert.match(await page.locator('[data-symbol="V"] .offline-landmark-count').innerText(), /5 处/, 'Visited V! cells retain their symbol count');
      await inspect(page, 'guide-full-map', tag);
      await page.locator('#offline-landmark-search').fill('#');
      assert.equal(await page.locator('.offline-landmark-entry:visible').count(), 1);
      assert.match(await page.locator('.offline-landmark-entry:visible').innerText(), /道路/);
      await page.locator('#offline-landmark-search').fill('');
      await page.locator('.offline-landmark-entry').last().scrollIntoViewIfNeeded();
      await inspect(page, 'guide-bottom', tag);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#offline-landmarks-panel').isVisible(), false);
      assert.equal(await page.locator('#offline-controls').evaluate(n => getComputedStyle(n).visibility), 'visible');
      await page.evaluate(() => { World.die(); OfflineGame.save(); });
      assert.equal(await maskIsFull(page), true, 'Revealed fog survives losing the temporary expedition');
      assert.equal(await page.evaluate(() => JSON.stringify($SM.get('game.world.map'))), before.savedMap, 'Death still discards the uncommitted visit');
      await page.reload();
      await page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
      assert.equal(await maskIsFull(page), true, 'The revealed map survives saving and reopening');
      assert.equal(await page.evaluate(() => OfflineGame.getCheats().enabled), false);
      await openMenu(page); await page.locator('#offline-landmarks-button').tap();
      assert.equal(await page.locator('.offline-landmark-entry').count(), 20);
      await closeGuide(page);
      checks.push({ width, height, font, night, passed: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, scenarios, errors, remote }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, scenarios: scenarios.length }));
} finally { await browser.close(); }
