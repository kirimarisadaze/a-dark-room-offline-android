// Compact combat, reachable touch controls and real attacks against offline assets.
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
const output = path.join(root, '.local/combat-ui');
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const scenarios = [], errors = [], remote = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function inspect(page, name, tag) {
  await settle(page);
  const result = await page.evaluate(() => {
    const rect = n => n.getBoundingClientRect();
    const panel = document.querySelector('#event'), bounds = rect(panel);
    const attack = document.querySelector('#attackButtons'), heal = document.querySelector('#healButtons');
    const description = document.querySelector('#description'), fight = document.querySelector('#fight');
    const failures = [];
    if (Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) > 1 || Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) > 1) failures.push('not-centered');
    if (bounds.top < 19 || bounds.bottom > innerHeight - 19) failures.push('outside-viewport');
    if (panel.scrollHeight > panel.clientHeight + 1) failures.push('whole-dialog-scrolls');
    if (description.scrollHeight > description.clientHeight + 1) failures.push('cropped-fighter');
    if (rect(fight).bottom > rect(attack).top - 8) failures.push('fighter-action-overlap');
    if (rect(heal).top - rect(attack).bottom > 16 || rect(heal).top < rect(attack).bottom + 7) failures.push('attack-heal-gap');
    for (const n of panel.querySelectorAll('#healButtons .button')) {
      const b = rect(n);
      if (b.top < bounds.top || b.bottom > bounds.bottom - 8) failures.push(n.id + ':hidden');
    }
    for (const n of panel.querySelectorAll('#attackButtons .button,#healButtons .button')) {
      const b = rect(n);
      if (b.width < 44 || b.height < 44 || n.scrollWidth > n.clientWidth + 1) failures.push(n.id + ':bad-target');
    }
    for (const n of panel.querySelectorAll('.button > .tooltip')) if (rect(n).width > 0) failures.push('floating-cost-tooltip');
    if (getComputedStyle(document.querySelector('#offline-controls')).visibility !== 'hidden') failures.push('background-directions-visible');
    return { height: bounds.height, width: bounds.width, firstAttackCenter: rect(attack).top + Math.min(rect(attack).height, 48) / 2, attackRows: attack.querySelectorAll('.button').length, heals: heal.querySelectorAll('.button').length, attackScrolls: attack.scrollHeight > attack.clientHeight + 1, overflow: document.documentElement.scrollWidth > innerWidth, failures };
  });
  await page.screenshot({ path: path.join(output, `${name}-${tag}.png`) });
  assert.equal(result.overflow, false, name + ': horizontal overflow');
  assert.deepEqual(result.failures, [], name + '-' + tag);
  scenarios.push({ name, tag, ...result });
  return result;
}
try {
  for (const [width, height, font] of [[320, 512, 16], [320, 512, 22], [360, 740, 16], [412, 915, 16], [412, 915, 22]]) {
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
        $SM.setM('stores', { compass: 1, 'cargo drone': 1, 'i armour': 1, 'cured meat': 100, rifle: 1, bullets: 100 });
        if (night) Engine.turnLightsOff();
        if (!Path.panel) Path.init();
        Path.outfit = { 'cured meat': 30, rifle: 1, bullets: 95 };
        Engine.travelTo(Path);
      }, night);
      await page.locator('#embarkButton').tap();
      await page.waitForFunction(() => Engine.activeModule === World);
      for (const name of ['single-rifle', 'fists', 'many-weapons', 'long-notification']) {
        await page.evaluate(name => {
          if (Events.activeEvent()) Events.endEvent();
          const advanced = name === 'many-weapons' || name === 'long-notification';
          $SM.set('stores["kinetic armour"]', advanced ? 1 : 0);
          Path.outfit = advanced ? { 'cured meat': 20, medicine: 3, hypo: 2, stim: 1, bullets: 20, 'energy cell': 10, 'bone spear': 1, 'iron sword': 1, 'steel sword': 1, rifle: 1, 'laser rifle': 1, bayonet: 1, 'energy blade': 1, 'plasma rifle': 1, disruptor: 1, bolas: 2, grenade: 1 } : { 'cured meat': 30, ...(name === 'single-rifle' ? { rifle: 1, bullets: 95 } : {}) };
          World.updateSupplies(); World.setHp(World.getMaxHealth() - 10);
          Events.startEvent({ title: '潮湿洞穴', scenes: { start: { combat: true, notification: name === 'long-notification' ? '一头巨兽冲出黑暗。'.repeat(24) : '一头巨兽冲出黑暗。', enemy: 'test', enemyName: '巨兽', chara: 'B', health: 1000, damage: 1, hit: 0, attackDelay: 999, deathMessage: '巨兽倒下了。', loot: { fur: { min: 5, max: 5, chance: 1 } } } } });
          clearInterval(Events._enemyAttackTimer);
        }, name);
        const result = await inspect(page, name, tag);
        if (name === 'single-rifle' || name === 'fists') {
          assert(result.height <= Math.min(420, height * .82), 'A simple fight must use a compact content-sized dialog');
          assert(result.firstAttackCenter > height * .45, 'The main action must not sit at the top of the screen');
        } else {
          assert.equal(result.heals, 5);
          if (height === 512) assert(result.attackScrolls, 'Many weapons must scroll independently on short screens');
        }
        const hp = await page.evaluate(() => World.health);
        await page.locator('#eat').tap();
        assert(await page.evaluate(hp => World.health > hp, hp), 'Actual healing works from the compact footer');
        const action = name === 'fists' ? '#attack_fists' : name === 'single-rifle' ? '#attack_rifle' : '#attack_disruptor';
        const punches = await page.evaluate(() => $SM.get('character.punches', true));
        if (name === 'single-rifle') await page.evaluate(() => { Path.outfit.bullets = 1; World.updateSupplies(); });
        await page.locator(action).tap();
        if (name === 'single-rifle') {
          assert.equal(await page.evaluate(() => Path.outfit.bullets), 0, 'Actual fire consumes the last bullet');
          await settle(page);
          assert.equal(await page.locator('#attackButtons #attack_fists').count(), 1, 'The fallback punch stays in the attack area');
          await inspect(page, 'ammo-empty', tag);
          await page.locator('#attack_fists').tap();
          assert.equal(await page.evaluate(() => $SM.get('character.punches')), punches + 1);
        }
        else if (name === 'fists') assert.equal(await page.evaluate(() => $SM.get('character.punches')), punches + 1, 'The actual punch handler records the attack');
        else assert.equal(await page.locator(action).evaluate(n => $(n).data('onCooldown')), true, 'The last scrolling weapon activates its real cooldown');
        await page.evaluate(() => { Events.clearTimeouts(); Events.endEvent(); });
        await settle(page);
        assert.equal(await page.locator('#offline-controls').evaluate(n => getComputedStyle(n).visibility), 'visible', 'Closing combat restores map directions');
      }
      await context.close();
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, scenarios, errors, remote }, null, 2));
  console.log(JSON.stringify({ passed: true, scenes: scenarios.length }));
} finally { await browser.close(); }
