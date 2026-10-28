// Exercise normal late-game limits, resource changes and actual touch controls offline.
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
const output = path.join(root, '.local/late-game-ui');
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const scenarios = [], checks = [], errors = [], remote = [];
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const cardSizes = page => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.offline-active .offline-cost-card')].map(card => {
  const r = card.getBoundingClientRect();
  return [card.querySelector('.button').id, [r.width, r.height]];
})));
async function inspect(page, name, shot, fullPage = false) {
  await settle(page);
  const result = await page.evaluate(() => {
    const rect = n => n.getBoundingClientRect();
    const visible = n => rect(n).width > 0 && rect(n).height > 0;
    const overlap = (a, b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > .5 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > .5;
    const failures = [], cards = [], rows = [];
    const checkRow = (row, nodes) => {
      nodes = nodes.filter(n => n && visible(n));
      for (let i = 0; i < nodes.length; i++) {
        const r = rect(nodes[i]);
        if (r.left < 0 || r.right > innerWidth + .5 || nodes[i].scrollWidth > nodes[i].clientWidth + 1) failures.push((row.id || row.closest('.offline-cost-card')?.querySelector('.button').id) + ':clipped:' + nodes[i].textContent + ':' + nodes[i].clientWidth + '/' + nodes[i].scrollWidth);
        for (let j = i + 1; j < nodes.length; j++) if (overlap(r, rect(nodes[j]))) failures.push(row.id + ':overlap');
      }
    };
    for (const card of document.querySelectorAll('.offline-active .offline-cost-card')) {
      const r = rect(card), button = card.querySelector('.button');
      const range = document.createRange();
      for (const text of [...button.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())) {
        range.selectNodeContents(text);
        for (const t of range.getClientRects()) if (t.left < r.left || t.right > rect(button).right + .5 || t.top < r.top || t.bottom > r.bottom) failures.push(button.id + ':clipped-label');
      }
      for (const row of card.querySelectorAll('.offline-cost-row')) checkRow(row, [...row.children]);
      if (card.scrollWidth > card.clientWidth + 1) failures.push(button.id + ':card-overflow');
      cards.push({ id: button.id, height: r.height, width: r.width });
    }
    for (const row of document.querySelectorAll('.offline-active .workerRow,.offline-active .outfitRow')) {
      checkRow(row, [row.querySelector('.row_key'), row.querySelector('.row_val > span'), ...row.querySelectorAll('.upBtn,.dnBtn,.upManyBtn,.dnManyBtn'), row.querySelector('.offline-worker-income,.offline-outfit-details')]);
      rows.push(row.id);
    }
    for (const row of document.querySelectorAll('#offline-inventory .storeRow')) {
      if (!visible(row)) continue;
      const key = row.querySelector('.row_key');
      checkRow(row, [key, row.querySelector('.row_val')]);
      if (key.clientHeight > parseFloat(getComputedStyle(key).lineHeight) + 1) failures.push(row.id + ':split-inventory-name');
    }
    const event = document.querySelector('#event');
    if (event && visible(event)) {
      const bounds = rect(event);
      if (Math.abs(bounds.left + bounds.width / 2 - innerWidth / 2) > 1 || Math.abs(bounds.top + bounds.height / 2 - innerHeight / 2) > 1) failures.push('event:not-centered');
      for (const n of event.querySelectorAll('#healButtons .button')) {
        const r = rect(n);
        if (r.top < bounds.top || r.bottom > bounds.bottom - 8) failures.push(n.id + ':hidden-heal');
      }
    }
    const managementLines = [...document.querySelectorAll('#offline-workers-panel,#offline-workforce > div,#workers .workerRow')].filter(visible).filter(n => {
      const css = getComputedStyle(n);
      return ['Top', 'Right', 'Bottom', 'Left'].some(side => parseFloat(css['border' + side + 'Width']) > 0);
    }).map(n => n.id);
    return { viewport: [innerWidth, innerHeight], font: localStorage.offlineFontSize, night: document.body.classList.contains('offline-dark'), overflow: document.documentElement.scrollWidth > innerWidth, failures, managementLines, cards, rows };
  });
  if (shot) await page.screenshot({ path: path.join(output, shot + '.png'), fullPage });
  assert.equal(result.overflow, false, name + ': horizontal overflow');
  assert.deepEqual(result.failures, [], name);
  assert.deepEqual(result.managementLines, [], name + ': redundant workforce rules');
  scenarios.push({ name, ...result });
}
try {
  for (const [width, height, font] of [[320, 512, 16], [320, 512, 22], [360, 740, 16], [412, 915, 22]]) {
    for (const night of [false, true]) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, offline: true });
      await context.addInitScript(font => { localStorage.offlineFontSize = String(font); }, font);
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://appassets.androidplatform.net' || !url.pathname.startsWith('/game/')) {
          remote.push(url.href); await route.abort(); return;
        }
        const file = path.join(root, 'android/app/src/main/assets', decodeURIComponent(url.pathname));
        await route.fulfill({ body: await fs.readFile(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.flac': 'audio/flac', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', e => errors.push(e.message));
      await page.goto('https://appassets.androidplatform.net/game/index.html');
      await page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
      const tag = `${width}-font${font}-${night ? 'night' : 'day'}`;
      await page.evaluate(night => {
        $.fx.off = true;
        clearTimeout(Events._eventTimeout);
        clearTimeout(Engine._incomeTimeout);
        $SM.set('playStats.audioAlertShown', true);
        $SM.set('game.builder.level', 4);
        $SM.set('game.fire', Room.FireEnum.Roaring);
        $SM.set('game.temperature', Room.TempEnum.Hot);
        // Valid end-game village: 20 huts, 80 people, all nine assignable jobs.
        for (const [key, value] of Object.entries(Room.Craftables)) if (value.type === 'building') $SM.set(`game.buildings["${key}"]`, key === 'hut' ? 20 : key === 'trap' ? 10 : 1, true);
        $SM.setM('game.buildings', { 'iron mine': 1, 'coal mine': 1, 'sulphur mine': 1 });
        $SM.set('game.population', 80, true);
        $SM.setM('game.workers', { hunter: 8, trapper: 2, tanner: 2, charcutier: 8, 'iron miner': 5, 'coal miner': 5, 'sulphur miner': 5, steelworker: 3, armourer: 2 });
        for (const key of ['wood', 'fur', 'meat', 'bait', 'leather', 'iron', 'coal', 'sulphur', 'steel', 'teeth', 'scales', 'cloth', 'bullets', 'cured meat', 'energy cell', 'alien alloy', 'medicine', 'torch', 'bone spear', 'iron sword', 'steel sword', 'rifle', 'laser rifle', 'bayonet', 'grenade', 'bolas', 'charm']) $SM.set(`stores["${key}"]`, 2000, true);
        for (const [key, value] of Object.entries(Room.Craftables)) if (value.type === 'upgrade') $SM.set(`stores["${key}"]`, 1, true);
        for (const [key, value] of Object.entries(Fabricator.Craftables)) {
          $SM.set(`character.blueprints["${key}"]`, true, true);
          $SM.set(`stores["${key}"]`, value.maximum === 1 ? 1 : 10, true);
        }
        $SM.set('stores.compass', 1);
        if (!Outside.panel) Outside.init();
        clearTimeout(Outside._popTimeout);
        Outside.updateVillage(); Outside.updateWorkersView();
        if (!Path.panel) Path.init();
        Path.outfit = { 'cured meat': 20, medicine: 3, hypo: 2, stim: 1, bullets: 20, 'energy cell': 10, rifle: 1, 'laser rifle': 1, bayonet: 1, 'energy blade': 1, 'plasma rifle': 1, disruptor: 1, bolas: 2, grenade: 1 };
        $SM.set('outfit', Path.outfit);
        if (!Ship.panel) Ship.init();
        if (!Fabricator.panel) Fabricator.init();
        Room.updateBuildButtons(); Fabricator.updateBuildButtons(); Fabricator.updateBlueprints();
        if (night) Engine.turnLightsOff();
        Engine.travelTo(Outside); OfflineGame.refresh();
      }, night);
      await settle(page);
      assert.equal(await page.locator('#offline-workforce-total').innerText(), '80');
      assert.equal(await page.locator('#workers .workerRow').count(), 10);
      await inspect(page, 'full-workforce', 'workers-top-' + tag);
      // Scroll and operate every late profession through its actual touch target.
      await page.locator('#offline-worker-steps [data-step="1"]').tap(); await settle(page);
      for (const row of await page.locator('#workers .workerRow.offline-adjustable').all()) {
        const before = Number(await row.locator('.row_val > span').innerText());
        await row.locator('.upBtn').tap(); await settle(page);
        assert.equal(Number(await row.locator('.row_val > span').innerText()), before + 1);
        await row.locator('.dnBtn').tap(); await settle(page);
        assert.equal(Number(await row.locator('.row_val > span').innerText()), before);
      }
      await page.locator('#workers .workerRow').last().scrollIntoViewIfNeeded();
      await inspect(page, 'workforce-bottom', 'workers-bottom-' + tag);
      await page.locator('#offline-workers-panel').screenshot({ path: path.join(output, 'workers-all-' + tag + '.png') });
      await page.evaluate(() => { Engine.travelTo(Room); scrollTo(0, 0); });
      await inspect(page, 'completed-buildings', 'room-completed-' + tag);
      assert.deepEqual(await page.locator('#roomPanel > .offline-cost-section').evaluateAll(nodes => nodes.map(n => n.id)), ['offline-buildings', 'offline-crafting', 'offline-trading'], 'Room categories keep their logical order regardless of unlock sequence');
      await page.locator('#offline-buildings > summary').tap();
      assert.equal(await page.locator('#build_hut').isVisible(), false, 'Completed construction list can fold away');
      assert.equal(await page.locator('#offline-crafting > summary').isVisible(), true);
      await inspect(page, 'folded-buildings', 'room-folded-' + tag);
      await page.locator('#offline-buildings > summary').tap();
      assert.equal(await page.locator('#build_hut').isVisible(), true, 'Reopening keeps the real actions');
      const completed = await cardSizes(page);
      await page.evaluate(() => {
        $SM.set('game.buildings.hut', 19);
        $SM.set('game.buildings.armoury', 0);
        $SM.set('game.buildings.lodge', 0);
        for (const key of Object.keys(State.stores)) $SM.set(`stores["${key}"]`, 0, true);
        $SM.fireUpdate('stores', true); Room.updateBuildButtons();
      });
      await inspect(page, 'all-materials-missing', 'room-missing-' + tag, true);
      assert.deepEqual(await cardSizes(page), completed, 'Completed/missing states preserve every card size');
      const missing = await cardSizes(page);
      await page.evaluate(() => {
        for (const key of Object.keys(State.stores)) $SM.set(`stores["${key}"]`, 9876543210, true);
        $SM.fireUpdate('stores', true); Room.updateBuildButtons();
      });
      await inspect(page, 'large-resource-counts', 'room-rich-' + tag);
      assert.deepEqual(await cardSizes(page), missing, 'All deficits disappearing preserves card sizes');
      // Price update and reaching the real hut maximum must retain the same frame.
      await page.locator('#build_hut').tap(); await settle(page);
      assert.equal(await page.evaluate(() => $SM.get('game.buildings.hut')), 20);
      assert.deepEqual(await cardSizes(page), missing, 'Real construction and maximum retain frame dimensions');
      await page.evaluate(() => {
        for (const [key, value] of Object.entries(Room.Craftables)) if (value.type === 'upgrade') $SM.set(`stores["${key}"]`, 1, true);
        for (const [key, value] of Object.entries(Fabricator.Craftables)) $SM.set(`stores["${key}"]`, value.maximum === 1 ? 1 : 10, true);
        Engine.travelTo(Path); Path.updateOutfitting(); scrollTo(0, 0);
      });
      await settle(page);
      assert(await page.evaluate(() => Path.getFreeSpace() >= 0), 'Expedition fixture respects real carrying capacity');
      assert.equal(await page.evaluate(() => document.querySelector('#outfitting').firstElementChild.id), 'bagspace', 'Capacity precedes the long equipment list');
      await inspect(page, 'late-expedition', 'path-' + tag, true);
      const supply = page.locator('#outfit_row_medicine');
      const medicine = Number(await supply.locator('.row_val > span').innerText());
      await supply.locator('.upBtn').tap(); await settle(page);
      assert.equal(Number(await supply.locator('.row_val > span').innerText()), medicine + 1);
      assert.match(await supply.locator('.offline-outfit-details').innerText(), /可用/);
      assert.equal(await supply.locator('.tooltip').isVisible(), false, 'Touch hints never float over other equipment');
      const adjustmentFill = await supply.locator('.upBtn').evaluate(n => getComputedStyle(n).backgroundColor);
      assert(['rgba(0, 0, 0, 0)', night ? 'rgb(66, 68, 59)' : 'rgb(233, 233, 228)'].includes(adjustmentFill), 'Touch fill follows the current theme');
      await page.locator('#outfitting .outfitRow').last().scrollIntoViewIfNeeded();
      const capacity = await page.locator('#bagspace').boundingBox();
      assert(capacity.y >= 0 && capacity.y + capacity.height <= height - 64, 'Capacity remains visible during lower equipment adjustments');
      await page.screenshot({ path: path.join(output, 'path-bottom-' + tag + '.png') });
      await page.evaluate(() => { Engine.travelTo(Fabricator); scrollTo(0, 0); });
      await inspect(page, 'all-blueprints', 'fabricator-' + tag, true);
      const energy = await page.evaluate(() => $SM.get('stores["energy blade"]'));
      await page.locator('[id="fabricate_energy blade"]').tap(); await settle(page);
      assert.equal(await page.evaluate(() => $SM.get('stores["energy blade"]')), energy + 1);
      await page.evaluate(() => { Engine.travelTo(Ship); scrollTo(0, 0); });
      await inspect(page, 'late-ship', 'ship-' + tag);
      const hull = await page.evaluate(() => $SM.get('game.spaceShip.hull'));
      await page.locator('#reinforceButton').tap(); await settle(page);
      assert.equal(await page.evaluate(() => $SM.get('game.spaceShip.hull')), hull + 1);
      await page.evaluate(() => { Engine.travelTo(Path); });
      await page.locator('#embarkButton').tap();
      await page.waitForFunction(() => Engine.activeModule === World && World.curPos);
      await inspect(page, 'late-world', 'world-' + tag);
      await page.evaluate(() => {
        World.health = World.getMaxHealth() - 10;
        Events.startEvent({ title: '后期战斗检查', scenes: { start: { combat: true, notification: '一台杀戮机器人猛扑过来。破损的装甲下，机械仍然运转自如。', enemy: 'test', enemyName: '杀戮机器人', chara: 'R', health: 100, damage: 1, hit: 0, attackDelay: 999, loot: {} } } });
        clearInterval(Events._enemyAttackTimer);
      });
      await inspect(page, 'late-combat', 'combat-' + tag);
      assert.equal(await page.locator('#healButtons .button').count(), 5);
      const hp = await page.evaluate(() => World.health);
      await page.locator('#eat').tap(); await settle(page);
      assert(await page.evaluate(previous => World.health > previous, hp), 'Healing is reachable without scrolling past attacks');
      checks.push({ width, height, font, night, jobsOperated: 9, passed: true });
      await context.close();
    }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, scenarios, errors, remote }, null, 2));
  console.log(JSON.stringify({ passed: true, checks, scenarios: scenarios.length }));
} finally { await browser.close(); }
