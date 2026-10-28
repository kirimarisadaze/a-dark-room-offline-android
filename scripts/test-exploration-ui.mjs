// Real movement/loot input and capacity rules against the packaged offline assets.
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
const output = path.join(root, '.local/exploration-ui');
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const checks = [], scenarios = [], errors = [], remote = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
async function inspect(page, name, tag) {
  await settle(page);
  const result = await page.evaluate(() => {
    const r = n => n.getBoundingClientRect();
    const rect = n => r(n).toJSON();
    const visible = n => r(n).width > 0 && r(n).height > 0;
    const failures = [];
    const controls = document.querySelector('#offline-controls');
    const directions = Object.fromEntries([...controls.querySelectorAll('button')].map(n => [n.dataset.direction, rect(n)]));
    const map = document.querySelector('#map');
    const event = document.querySelector('#event');
    if (event) {
      const e = r(event), description = event.querySelector('#description');
      if (Math.abs(e.left + e.width / 2 - innerWidth / 2) > 1 || Math.abs(e.top + e.height / 2 - innerHeight / 2) > 1) failures.push('dialog-not-centered');
      if (e.top < 19 || e.bottom > innerHeight - 19) failures.push('dialog-outside-viewport');
      for (const button of event.querySelectorAll('#exitButtons .button,#healButtons .button')) {
        const b = r(button);
        if (b.top < e.top || b.bottom > e.bottom - 8) failures.push(button.id + ':hidden-exit');
        if (b.height < 44 || b.width < 44) failures.push(button.id + ':small-target');
      }
      const heals = event.querySelector('#healButtons'), exits = event.querySelector('#exitButtons');
      if (heals && exits && r(heals).bottom > r(exits).top - 8) failures.push('healing-below-exit');
      for (const row of event.querySelectorAll('.lootRow')) {
        const b = r(row), nodes = [...row.querySelectorAll(':scope > .offline-loot-item,:scope > .button')];
        for (const n of nodes) if (n.scrollWidth > n.clientWidth + 1 || r(n).left < b.left || r(n).right > b.right + 1) failures.push(row.id + ':clipped-row');
        for (let i = 1; i < nodes.length; i++) if (r(nodes[i - 1]).right > r(nodes[i]).left + 1) failures.push(row.id + ':overlap');
      }
      return { failures, height: e.height, className: event.className, rows: event.querySelectorAll('.lootRow').length, scrollable: description.scrollHeight > description.clientHeight + 1, overflow: document.documentElement.scrollWidth > innerWidth };
    }
    const top = Math.min(...Object.values(directions).map(b => b.top));
    if (r(map).bottom > top - 8) failures.push('map-under-controls');
    for (const [key, b] of Object.entries(directions)) {
      if (b.width < 44 || b.height < 44 || b.top < 0 || b.bottom > r(document.querySelector('#offline-bottom-bar')).top - 8) failures.push(key + ':bad-target');
    }
    if (!(directions.up.top < directions.left.top && directions.down.top > directions.left.top && directions.left.left < directions.up.left && directions.right.left > directions.up.left)) failures.push('not-a-cross');
    const bag = document.querySelector('#bagspace-world');
    for (const n of [bag, ...bag.querySelectorAll('.supplyItem')]) if (parseFloat(getComputedStyle(n).borderTopWidth) > 0) failures.push('supply-frame');
    return { failures, directions, map: rect(map), glyphSize: parseFloat(getComputedStyle(document.querySelector('.offline-map-tiles')).fontSize), overflow: document.documentElement.scrollWidth > innerWidth };
  });
  await page.screenshot({ path: path.join(output, name + '-' + tag + '.png') });
  assert.equal(result.overflow, false, name + ': horizontal overflow');
  assert.deepEqual(result.failures, [], name + '-' + tag);
  scenarios.push({ name, tag, ...result });
  return result;
}
async function lootEvent(page, loot, outfit) {
  await page.evaluate(({ loot, outfit }) => {
    if (Events.activeEvent()) Events.endEvent();
    if (outfit) { Path.outfit = outfit; World.updateSupplies(); }
    Events.startEvent({ title: '潮湿洞穴', scenes: { start: { text: [], loot: Object.fromEntries(Object.entries(loot).map(([key, value]) => [key, { min: value, max: value, chance: 1 }])), buttons: { deeper: { text: '继续深入', nextScene: { 1: 'deeper' } }, leave: { text: '离开洞穴', nextScene: 'end' } } }, deeper: { text: ['洞穴更深处。'], buttons: { leave: { text: '离开洞穴', nextScene: 'end' } } } } });
  }, { loot, outfit });
  await settle(page);
}
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
        $SM.setM('stores', { compass: 1, convoy: 1, rucksack: 1, 'i armour': 1, 'water tank': 1, 'cured meat': 100, rifle: 1, bullets: 100, torch: 10 });
        if (night) Engine.turnLightsOff();
        if (!Path.panel) Path.init();
        Path.outfit = { 'cured meat': 30, rifle: 1, bullets: 95, torch: 9 };
        $SM.set('outfit', Path.outfit);
        // Keep encounters deterministic while exercising the real World.move,
        // map drawing and supply use, then create actual event/combat panels below.
        World.doSpace = () => World.useSupplies();
        Engine.travelTo(Path);
      }, night);
      await page.locator('#embarkButton').tap();
      await page.waitForFunction(() => Engine.activeModule === World && World.curPos);
      await inspect(page, 'world', tag);
      await page.locator('#offline-map-toggle').tap();
      await inspect(page, 'world-overview', tag);
      await page.locator('#offline-map-toggle').tap();
      const position = () => page.evaluate(() => World.curPos.slice());
      const start = await position();
      for (const [direction, delta] of [['up', [0, -1]], ['right', [1, 0]], ['down', [0, 1]], ['left', [-1, 0]]]) {
        const before = await position();
        await page.locator(`#offline-controls .${direction}`).tap();
        assert.deepEqual(await position(), before.map((v, i) => v + delta[i]), 'Tap ' + direction + ' moves exactly one cell');
      }
      assert.deepEqual(await position(), start);
      const cdp = await context.newCDPSession(page);
      const center = async direction => { const r = await page.locator('#offline-controls .' + direction).boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, id: 1 }; };
      let before = await position();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('right')] });
      await page.waitForTimeout(800);
      assert.equal(await page.locator('#offline-controls .right').getAttribute('aria-pressed'), 'true');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      const after = await position();
      assert(after[0] >= before[0] + 2, 'Holding direction repeats real movement');
      await page.waitForTimeout(400); assert.deepEqual(await position(), after, 'Release stops movement');
      before = await position();
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('right')] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [await center('up')] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual(await position(), [before[0] + 1, before[1] - 1], 'Dragging changes to the new direction once');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('down')] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
      const cancelled = await position();
      await page.waitForTimeout(400); assert.deepEqual(await position(), cancelled, 'Cancelled touch does not keep walking');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('down')] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 35, y: 200, id: 1 }] });
      const outside = await position();
      await page.waitForTimeout(400); assert.deepEqual(await position(), outside, 'Moving outside the keys pauses held movement');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [await center('left')] });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert.deepEqual(await position(), [outside[0] - 1, outside[1]], 'Moving back onto a key resumes with the selected direction');
      await page.locator('#offline-controls .left').focus(); before = await position();
      await page.keyboard.press('Enter'); assert.deepEqual(await position(), [before[0] - 1, before[1]], 'Focused control supports keyboard input');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [await center('right')] });
      const locked = await position();
      await lootEvent(page, { fur: 5, teeth: 3 }, { 'cured meat': 30, rifle: 1, bullets: 95, torch: 9 });
      assert(await page.locator('#event').count(), 'Loot exists before releasing the held touch');
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      assert(await page.locator('#event').count(), 'Releasing the held touch must not click through the new dialog');
      await page.waitForTimeout(400); assert.deepEqual(await position(), locked, 'Opening an event releases held navigation');
      assert.equal(await page.locator('#offline-controls [aria-pressed="true"]').count(), 0);
      const loot = await inspect(page, 'loot-two-items', tag);
      assert(loot.height < height - 100, 'Short loot uses content height rather than the full combat frame: ' + JSON.stringify(loot));
      await page.locator('#take_fur').tap();
      assert.equal(await page.evaluate(() => Path.outfit.fur), 1);
      assert.equal(await page.locator('#loot_fur .offline-loot-count').innerText(), '×4');
      await page.locator('#all_take_fur').tap();
      assert.equal(await page.evaluate(() => Path.outfit.fur), 5);
      await page.locator('#loot_takeEverything').tap();
      assert.equal(await page.evaluate(() => Path.outfit.teeth), 3);
      assert.equal(await page.evaluate(() => Events.activeScene), 'start', 'Collecting all does not automatically leave');
      await page.locator('#deeper').tap();
      assert.equal(await page.evaluate(() => Events.activeScene), 'deeper');
      await page.locator('#leave').tap(); await page.waitForFunction(() => !Events.activeEvent());

      await lootEvent(page, { iron: 5, teeth: 3 }, { 'cured meat': 68 });
      assert.equal(await page.locator('#all_take_iron span').first().innerText(), '拿 2');
      await page.locator('#all_take_iron').tap();
      assert.equal(await page.evaluate(() => Path.outfit.iron), 2);
      assert.equal(await page.evaluate(() => Path.getFreeSpace()), 0);
      await inspect(page, 'loot-partial-capacity', tag);

      await lootEvent(page, { fur: 5, teeth: 3 }, { 'cured meat': 70 });
      assert.equal(await page.locator('#take_fur').innerText(), '替换');
      assert.equal(await page.locator('#loot_takeEverything').getAttribute('aria-disabled'), 'true');
      await page.locator('#take_fur').tap();
      await inspect(page, 'loot-full-backpack', tag);
      await page.locator('#no_drop').tap();
      assert.equal(await page.locator('#dropMenu').count(), 0);
      assert.deepEqual(await page.evaluate(() => Path.outfit), { 'cured meat': 70 });
      await page.locator('#take_fur').tap();
      await page.locator('#drop_cured-meat').tap();
      assert.equal(await page.evaluate(() => Path.outfit['cured meat']), 69);
      assert.equal(await page.evaluate(() => Path.outfit.fur), 1);
      assert.equal(await page.locator('#loot_cured-meat .offline-loot-count').innerText(), '×1', 'Swapped-out items remain recoverable loot');
      await inspect(page, 'loot-after-exchange', tag);

      const many = Object.fromEntries(['fur', 'teeth', 'scales', 'iron', 'coal', 'sulphur', 'steel', 'cloth', 'leather', 'bullets', 'energy cell', 'alien alloy', 'medicine', 'plasma rifle'].map((key, i) => [key, i + 2]));
      await lootEvent(page, many, { 'cured meat': 5 });
      const long = await inspect(page, 'loot-many-items', tag);
      assert(long.scrollable, 'Long loot scrolls inside its description while exits remain visible');
      await page.locator('#loot_plasma-rifle .lootTake').tap();
      assert.equal(await page.evaluate(() => Path.outfit['plasma rifle']), 1);
      await page.locator('#leave').tap(); await page.waitForFunction(() => !Events.activeEvent());
      await page.evaluate(() => {
        Events.startEvent({ title: '洞穴战斗', scenes: { start: { combat: true, notification: '野兽扑了过来。', enemy: 'test', enemyName: '野兽', chara: 'B', health: 1, damage: 1, hit: 0, attackDelay: 999, deathMessage: '野兽倒下了。', loot: { fur: { min: 5, max: 5, chance: 1 }, teeth: { min: 3, max: 3, chance: 1 } }, buttons: { deeper: { text: '继续深入', nextScene: 'end' }, leave: { text: '离开洞穴', nextScene: 'end' } } } } });
        clearInterval(Events._enemyAttackTimer);
        $('#enemy').data('hp', 0); Events.winFight();
      });
      await page.waitForSelector('#event.offline-loot');
      const victory = await inspect(page, 'loot-after-combat', tag);
      assert(!victory.className.includes('offline-combat'), 'Winning removes the fixed combat layout');
      assert(victory.height < height - 80, 'Victory loot shrinks to the actual contents');
      await page.evaluate(() => {
        Events.endEvent();
        $SM.set('stores["kinetic armour"]', 1);
        Path.outfit = { 'cured meat': 20, medicine: 3, hypo: 2, stim: 1 };
        World.health = World.getMaxHealth() - 20;
        Events.startEvent({ title: '战后收获与治疗', scenes: { start: { combat: true, notification: '击败最后的敌人。', enemy: 'test', enemyName: '野兽', chara: 'B', health: 1, damage: 1, hit: 0, attackDelay: 999, deathMessage: '野兽倒下了。', loot: { fur: { min: 5, max: 5, chance: 1 } } } } });
        clearInterval(Events._enemyAttackTimer);
        $('#enemy').data('hp', 0); Events.winFight();
      });
      await page.waitForSelector('#event.offline-loot');
      await inspect(page, 'loot-with-healing', tag);
      // Upstream keeps the three recovery actions after victory; shield/stim
      // are combat-only. The combat suite separately exercises all five.
      assert.equal(await page.locator('#healButtons .button').count(), 3);
      const hp = await page.evaluate(() => World.health);
      await page.locator('#eat').tap();
      assert(await page.evaluate(previous => World.health > previous, hp), 'Healing works from the loot footer');
      checks.push({ width, height, font, night, passed: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []); assert.deepEqual(remote, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, scenarios, errors, remote }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, scenes: scenarios.length }));
} finally { await browser.close(); }
