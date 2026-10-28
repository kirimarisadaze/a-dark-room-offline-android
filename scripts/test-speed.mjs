// Verify real controls, timer cancellation, pending waits and cooldown progress.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const module of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
  try { playwright = require(module); break; } catch {}
}
assert(playwright, 'Playwright is required');
const output = path.join(root, '.local/speed-tests');
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true, offline: true });
  const errors = [];
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    assert.equal(url.origin, 'https://appassets.androidplatform.net');
    const file = path.join(root, 'android/app/src/main/assets', decodeURIComponent(url.pathname));
    const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.flac': 'audio/flac', '.png': 'image/png', '.ico': 'image/x-icon' };
    await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'text/plain' });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const ready = () => page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
  await page.goto('https://appassets.androidplatform.net/game/index.html');
  await ready();
  await page.evaluate(() => $SM.set('playStats.audioAlertShown', true));
  await page.locator('#offline-menu-button').tap();
  for (const rate of [1, 2, 3, 4]) {
    await page.locator(`#offline-speed-controls [data-speed="${rate}"]`).tap();
    const actual = await page.evaluate(() => ({ rate: OfflineGame.getSpeed(), saved: JSON.parse(localStorage.gameState).config.offlineSpeed }));
    assert.deepEqual(actual, { rate, saved: rate });
    assert.equal(await page.locator('#offline-speed-controls [aria-pressed="true"]').count(), 1);
    const elapsed = await page.evaluate(() => new Promise(resolve => {
      const start = performance.now();
      Engine.setTimeout(() => resolve(performance.now() - start), 800);
    }));
    assert(elapsed >= 800 / rate * .8 && elapsed < 800 / rate + 300, `Unexpected ${rate}x timer duration: ${elapsed}`);
    checks.push({ name: 'selected-speed-and-real-timeout', rate, elapsed });
  }
  const pending = await page.evaluate(() => new Promise(resolve => {
    OfflineGame.setSpeed(1);
    const start = performance.now();
    Engine.setTimeout(() => resolve(performance.now() - start), 1200);
    setTimeout(() => OfflineGame.setSpeed(4), 300);
  }));
  assert(pending >= 470 && pending < 800, `A pending wait restarted or kept its old speed: ${pending}`);
  checks.push({ name: 'pending-wait-rescaled-with-progress', elapsed: pending });
  const cancelled = await page.evaluate(() => new Promise(resolve => {
    let count = 0;
    const timer = Engine.setInterval(() => {
      count++;
      if (count === 3) {
        clearInterval(timer);
        setTimeout(() => resolve(count), 200);
      }
    }, 160);
  }));
  assert.equal(cancelled, 3, 'Cancelled repeating timers must not be rescheduled');
  const cleared = await page.evaluate(() => new Promise(resolve => {
    let fired = false;
    const timer = Engine.setTimeout(() => { fired = true; }, 200);
    clearInterval(timer);
    const interval = Engine.setInterval(() => { fired = true; }, 200);
    clearTimeout(interval);
    setTimeout(() => resolve(fired), 180);
  }));
  assert.equal(cleared, false, 'Both browser cancellation APIs must cancel either kind of game timer');
  const production = await page.evaluate(() => new Promise(resolve => {
    const original = State.income;
    const before = $SM.get('stores.wood', true) || 0;
    State.income = { 'speed-test': { stores: { wood: 1 }, delay: 1, timeLeft: 1 } };
    setTimeout(() => {
      const gained = $SM.get('stores.wood') - before;
      State.income = original;
      resolve(gained);
    }, 1050);
  }));
  assert(production >= 3 && production <= 5, `Actual production did not run four game seconds: ${production}`);
  checks.push({ name: 'real-income-collection-at-four-times', gained: production });
  const unscaled = await page.evaluate(() => new Promise(resolve => {
    const start = performance.now();
    Engine.setTimeout(() => resolve(performance.now() - start), 400, true);
  }));
  assert(unscaled >= 350, 'Unscaled timers must retain their duration at 4x');
  checks.push({ name: 'interval-cancellation-and-unscaled-wait', cancelled, unscaled });
  await page.locator('#offline-menu-close').tap();
  const cooldown = await page.evaluate(() => new Promise(resolve => {
    OfflineGame.setSpeed(1);
    const button = new Button.Button({ id: 'speed-cooldown-check', text: '冷却检查', cooldown: 2, click() {} }).appendTo('#roomPanel');
    const start = performance.now();
    button.trigger('click');
    let percentage;
    setTimeout(() => {
      percentage = button.find('.cooldown').width() / button.width();
      OfflineGame.setSpeed(4);
    }, 400);
    const poll = setInterval(() => {
      if (button.data('onCooldown')) return;
      clearInterval(poll);
      const stored = $SM.get('cooldown.speed-cooldown-check');
      resolve({ elapsed: performance.now() - start, percentage, stored: stored || null, enabled: !button.hasClass('disabled') });
      button.remove();
    }, 20);
  }));
  assert(cooldown.elapsed > 650 && cooldown.elapsed < 1200, `Cooldown did not retain progress when switching speed: ${JSON.stringify(cooldown)}`);
  assert(cooldown.percentage > .6 && cooldown.percentage < 1);
  assert(cooldown.enabled && cooldown.stored === null);
  checks.push({ name: 'actual-button-cooldown-and-state', ...cooldown });
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 4, 'Speed must survive reopening');
  await page.evaluate(() => { delete State.config.offlineSpeed; State.config.hyperMode = true; Engine.saveGame(); });
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 2, 'Old hyper-mode saves must migrate to 2x');
  await page.evaluate(() => { State.config.offlineSpeed = 9; State.config.hyperMode = false; Engine.saveGame(); });
  await page.reload(); await ready();
  assert.equal(await page.evaluate(() => OfflineGame.getSpeed()), 1, 'Invalid stored speeds must normalize');
  assert.equal(await page.evaluate(() => OfflineGame.setSpeed(0)), false);
  assert.equal(await page.evaluate(() => OfflineGame.setSpeed(5)), false);
  checks.push({ name: 'restart-persistence-legacy-save-and-invalid-input' });
  await page.evaluate(() => { OfflineGame.setSpeed(4); Engine.turnLightsOff(); });
  await page.waitForFunction(() => document.body.classList.contains('offline-dark'));
  await page.locator('#offline-menu-button').tap();
  await page.screenshot({ path: path.join(output, 'speed-menu-night.png') });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks }, null, 2));
  console.log(JSON.stringify({ passed: true, checks }));
} finally { await browser.close(); }
