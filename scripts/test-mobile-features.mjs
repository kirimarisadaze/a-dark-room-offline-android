// Dynamic village creation, compact data, real touch gestures and opt-in cheats.
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
const output = path.join(root, '.local/mobile-features');
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
const checks = [], layouts = [], errors = [], remote = [];
async function setup(width, height, font = 16) {
  const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: true, offline: true });
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
  page.on('pageerror', error => errors.push(error.message));
  page.on('dialog', dialog => dialog.accept());
  await page.goto('https://appassets.androidplatform.net/game/index.html');
  await page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
  await page.evaluate(() => { $.fx.off = true; $SM.set('playStats.audioAlertShown', true); });
  return { context, page };
}
async function tick(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function openMenu(page) {
  await page.locator('#offline-menu-button').tap();
  await page.waitForFunction(() => !document.getElementById('offline-menu-panel').hidden);
}
async function closeMenu(page) {
  await page.locator('#offline-menu-close').tap();
  await page.waitForFunction(() => document.getElementById('offline-menu-panel').hidden);
}
async function developEarly(page) {
  await page.evaluate(() => {
    $SM.set('game.builder.level', 4);
    $SM.set('game.fire', Room.FireEnum.Roaring);
    $SM.set('game.temperature', Room.TempEnum.Hot);
    $SM.set('stores.wood', 2000);
    if (!Outside.panel) Outside.init();
    Room.updateBuildButtons();
  });
  for (const building of ['trap', 'cart', 'trap']) {
    const before = await page.evaluate(key => $SM.get('game.buildings["' + key + '"]',true), building);
    await page.locator('#build_' + building).tap();
    await page.waitForFunction(({key,before}) => $SM.get('game.buildings["' + key + '"]') === before+1, {key:building,before});
  }
  await page.evaluate(() => Engine.travelTo(Outside));
  await tick(page);
}
async function geometry(page, name, width, font) {
  await tick(page);
  const data = await page.evaluate(() => {
    const rect = node => node?.getBoundingClientRect().toJSON();
    const rows = [...document.querySelectorAll('#resources > .storeRow,#special > .storeRow,#weapons > .storeRow,#village > .storeRow')];
    return {
      width: document.documentElement.scrollWidth,
      first: Outside.panel.children().first().attr('class'),
      actions: rect(document.querySelector('#outsidePanel .offline-location-actions')),
      village: rect(document.querySelector('#offline-village')),
      workers: rect(document.querySelector('#workers')),
      inventory: rect(document.querySelector('#offline-inventory')),
      scene: rect(Outside.panel[0]),
      population: document.querySelector('#offline-population').textContent,
      populationVisible: !document.querySelector('#offline-population').hidden,
      rows: rows.filter(n => n.getBoundingClientRect().height > 0).map(n => ({
        id: n.id, row: rect(n), key: rect(n.querySelector(':scope > .row_key')), value: rect(n.querySelector(':scope > .row_val')),
        scroll: n.scrollWidth, width: n.clientWidth,
      }))
    };
  });
  assert(data.width <= width, `${name}: horizontal page overflow`);
  assert.match(data.first, /offline-location-actions/, `${name}: actions must remain first after village creation`);
  assert(data.actions.bottom <= data.village.top + 1, `${name}: village overlaps primary actions`);
  if (data.workers) assert(data.village.bottom <= data.workers.top + 1, `${name}: workers overlap village data`);
  assert(data.scene.bottom <= data.inventory.top + 1, `${name}: shared inventory overlaps active scene`);
  for (const row of data.rows) {
    assert(row.key.right <= row.value.left + 1, `${name}/${row.id}: label overlaps quantity`);
    assert(row.row.left >= 19 && row.row.right <= width - 19, `${name}/${row.id}: data escapes page`);
    assert(row.scroll <= row.width + 1, `${name}/${row.id}: data is clipped`);
  }
  layouts.push({ name, width, font, ...data });
}
try {
  for (const [width, height, font] of (process.argv.includes('--functional-only') ? [] : [[320,512,16],[320,512,22],[360,740,16],[360,740,22],[412,915,16]])) {
    const { context, page } = await setup(width, height, font);
    await developEarly(page);
    await geometry(page, 'new-traps-and-cart', width, font);
    assert.equal(layouts.at(-1).populationVisible, false, 'No population 0/0 before any hut');
    assert(layouts.at(-1).inventory.height < 150, 'Early inventory must remain compact');
    await page.screenshot({ path: path.join(output, `forest-${width}-font${font}.png`) });
    await page.evaluate(() => Engine.travelTo(Room));
    await page.locator('#build_hut').tap();
    await page.evaluate(() => Engine.travelTo(Outside));
    await geometry(page, 'first-hut', width, font);
    assert(layouts.at(-1).populationVisible);
    assert.match(layouts.at(-1).population, /0\/4/);
    await page.evaluate(() => {
      $SM.set('game.population', 4);
      $SM.setM('stores', { wood: 5000, fur: 100, meat: 100, bait: 20 });
      Engine.travelTo(Room);
      Room.updateBuildButtons();
    });
    await page.locator('#build_lodge').tap();
    await page.evaluate(() => Engine.travelTo(Outside));
    await geometry(page, 'new-jobs', width, font);
    const before = await page.evaluate(() => $SM.get('game.workers.hunter', true));
    await page.locator('#workers_row_hunter .upBtn').tap();
    assert.equal(await page.evaluate(() => $SM.get('game.workers.hunter')), before + 1, 'Worker allocation remains usable');
    await page.evaluate(() => {
      for (const key of Object.keys(Room.Craftables)) if (Room.Craftables[key].type === 'building') $SM.set('game.buildings["' + key + '"]', key === 'hut' ? 20 : 1, true);
      $SM.set('game.population', 80, true);
      for (const key of ['wood','fur','meat','bait','leather','iron','coal','sulphur','steel','teeth','scales','cloth','bullets','cured meat','energy cell','alien alloy','medicine','compass','grenade','bolas','laser rifle','bayonet','charm','rifle','energy blade','disruptor','plasma rifle','hypo','stim','glowstone']) $SM.set('stores["' + key + '"]', 9999999999, true);
      Outside.updateVillage(); Outside.updateWorkersView(); Room.updateStoresView();
    });
    await geometry(page, 'late-large-counts', width, font);
    await page.screenshot({ path: path.join(output, `village-${width}-font${font}.png`) });
    await page.locator('#offline-inventory').screenshot({ path: path.join(output, `inventory-${width}-font${font}.png`) });
    await page.evaluate(() => Engine.turnLightsOff());
    await geometry(page, 'late-night', width, font);
    await page.evaluate(() => scrollTo(0,0));
    await page.screenshot({ path: path.join(output, `village-night-${width}-font${font}.png`) });
    await page.locator('#offline-inventory').screenshot({ path: path.join(output, `inventory-night-${width}-font${font}.png`) });
    if (width === 360 && font === 16) {
      await page.evaluate(() => scrollTo(0,0));
      const scrollTouch = await context.newCDPSession(page);
      await scrollTouch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:40,y:450,id:1}]});
      for (let i=1;i<=6;i++) {
        await scrollTouch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:40,y:450-i*35,id:1}]});
        await page.waitForTimeout(20);
      }
      await scrollTouch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      assert(await page.evaluate(() => scrollY > 20 && Engine.activeModule === Outside), 'Vertical touch still scrolls the actual long village page');
    }
    await context.close();
  }
  checks.push(`${layouts.length} dynamic early/late layout scenarios, compact inventory, population and actual worker input`);

  const { context, page } = await setup(360,740);
  const cdp = await context.newCDPSession(page);
  async function swipe(x1, y1, x2, y2, cancelled = false) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1, id: 1 }] });
    for (let i = 1; i <= 6; i++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1+(x2-x1)*i/6, y: y1+(y2-y1)*i/6, id: 1 }] });
      await page.waitForTimeout(18);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: cancelled ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    await tick(page);
    await page.waitForTimeout(25);
  }
  // Use the real gap below the tabs. A fixed y=500 can now hit the inventory
  // after the shorter material rows, where gestures are intentionally excluded.
  const gestureY = async () => { const r = await page.locator('#header').boundingBox(); return r.y + r.height + 12; };
  async function sceneSwipe(right = false) {
    const y = await gestureY();
    await swipe(right ? 70 : 280, y, right ? 280 : 70, y);
  }
  const active = () => page.evaluate(() => Engine.activeModule.panel.attr('id'));
  assert.deepEqual(await page.evaluate(() => OfflineGame.getCheats()), { enabled: false, noCooldown: false, protection: false });
  await sceneSwipe();
  assert.equal(await active(), 'roomPanel', 'Only unlocked scenes are available');
  await developEarly(page);
  await sceneSwipe(true);
  assert.equal(await active(), 'roomPanel', 'Swipe right to previous scene');
  await sceneSwipe();
  assert.equal(await active(), 'outsidePanel', 'Swipe left to next scene');
  await sceneSwipe();
  assert.equal(await active(), 'outsidePanel', 'No wrap past last scene');
  const y = await gestureY();
  await swipe(70,y,90,y+210);
  await swipe(70,y,100,y);
  await swipe(70,y,200,y+200);
  await swipe(70,y,280,y,true);
  assert.equal(await active(), 'outsidePanel', 'Vertical/short/diagonal/cancelled gestures preserve scene');
  const button = await page.locator('#gatherButton').boundingBox();
  await swipe(button.x+15,button.y+15,300,button.y+15);
  assert.equal(await active(), 'outsidePanel', 'Starting on a game action cannot switch scenes');
  await page.evaluate(() => { if (!Path.panel) Path.init(); });
  await sceneSwipe();
  assert.equal(await active(), 'pathPanel', 'A newly unlocked tab joins navigation');
  await sceneSwipe(true);
  assert.equal(await active(), 'outsidePanel');
  await page.evaluate(() => { if (!Ship.panel) Ship.init(); if (!Fabricator.panel) Fabricator.init(); });
  for (const expected of ['pathPanel','fabricatorPanel','shipPanel']) {
    await sceneSwipe();
    assert.equal(await active(),expected,'All unlocked scenes follow header order');
    assert(await page.evaluate(() => {
      const tab = Engine.activeModule.tab[0].getBoundingClientRect(), header = document.querySelector('#header').getBoundingClientRect();
      return tab.left >= header.left-1 && tab.right <= header.right+1;
    }),'Selected tab stays visible in the scrolling header');
  }
  for (const expected of ['fabricatorPanel','pathPanel','outsidePanel']) {
    await sceneSwipe(true);
    assert.equal(await active(),expected);
  }
  await page.evaluate(() => { Engine.travelTo(Room); Outside.tab.hide(); });
  await sceneSwipe();
  assert.equal(await active(), 'pathPanel', 'Hidden tabs are skipped');
  await page.evaluate(() => { Outside.tab.show(); Engine.travelTo(Outside); });
  await openMenu(page);
  const sheet = await page.locator('#offline-menu-panel .offline-sheet-heading').boundingBox();
  await swipe(70,sheet.y+15,210,sheet.y+15);
  assert.equal(await active(), 'outsidePanel', 'Menu swipes cannot change the scene');
  await closeMenu(page);
  await page.evaluate(() => Engine.confirmDelete());
  await swipe(70,180,280,180);
  assert.equal(await active(), 'outsidePanel', 'Event swipes cannot change the scene');
  await page.locator('#event #no').tap();
  await page.waitForFunction(() => !Events.activeEvent());
  checks.push('real touch: locked/new/hidden tabs, both directions, bounds, action/menu/event exclusions and cancelled gestures');

  // Normal cooldown first, then turn on the optional controls through the menu.
  await page.evaluate(() => Button.clearCooldown($('#gatherButton')));
  await page.locator('#gatherButton').tap();
  assert(await page.evaluate(() => $('#gatherButton').data('onCooldown')), 'Default play retains cooldowns');
  await openMenu(page);
  assert.equal(await page.locator('#offline-cheat-options').isVisible(), false);
  const wood = await page.evaluate(() => $SM.get('stores.wood'));
  await page.locator('#offline-cheat-enable').check();
  assert.equal(await page.evaluate(() => $SM.get('stores.wood')), wood, 'Enabling cheats alone does not add resources');
  await page.locator('#offline-cheat-cooldown').check();
  assert.equal(await page.evaluate(() => !!$('#gatherButton').data('onCooldown')), false, 'An active cooldown clears immediately');
  const oldResources = await page.evaluate(() => ({ wood: $SM.get('stores.wood'), alloy: $SM.get('stores["alien alloy"]',true), compass: $SM.get('stores.compass',true) }));
  await page.locator('#offline-cheat-resources').tap();
  assert.deepEqual(await page.evaluate(() => ({ wood: $SM.get('stores.wood'), alloy: $SM.get('stores["alien alloy"]',true), compass: $SM.get('stores.compass',true) })),
    { wood: oldResources.wood+1000, alloy: oldResources.alloy+1000, compass: oldResources.compass });
  await closeMenu(page);
  const gathered = await page.evaluate(() => $SM.get('stores.wood'));
  await page.locator('#gatherButton').tap(); await page.locator('#gatherButton').tap();
  assert(await page.evaluate(previous => $SM.get('stores.wood') >= previous+20, gathered), 'Repeated actual gathering works without a cooldown');
  assert.equal(await page.evaluate(() => !!$('#gatherButton').data('onCooldown')), false);
  await page.evaluate(() => Engine.travelTo(Room));
  assert(await page.locator('#build_cart').evaluate(n => n.classList.contains('disabled')), 'Build maximum stays enforced');
  const carts = await page.evaluate(() => $SM.get('game.buildings.cart'));
  await page.locator('#build_cart').tap();
  assert.equal(await page.evaluate(() => $SM.get('game.buildings.cart')), carts);
  await page.reload();
  await page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
  assert.deepEqual(await page.evaluate(() => OfflineGame.getCheats()), { enabled: true, noCooldown: true, protection: false });
  assert(await page.evaluate(previous => $SM.get('stores.wood') >= previous+20, gathered), 'Resource changes persist');
  checks.push('cheats default off; real resource action, active/new cooldowns, resource persistence and build maximum');

  await page.evaluate(() => {
    $SM.set('stores.compass',1);
    Path.outfit = { 'cured meat': 10 };
    $SM.set('outfit',Path.outfit);
    Engine.travelTo(Path);
  });
  await page.locator('#embarkButton').tap();
  await page.waitForFunction(() => Engine.activeModule === World && World.curPos);
  await swipe(70,250,280,250);
  assert.equal(await page.evaluate(() => Engine.activeModule === World), true, 'World gestures never travel home');
  const consumed = await page.evaluate(() => {
    World.foodMove = World.MOVES_PER_FOOD-1; World.waterMove = World.MOVES_PER_WATER-1;
    const food = Path.outfit['cured meat'], water = World.water;
    World.useSupplies();
    return [food-Path.outfit['cured meat'],water-World.water];
  });
  assert.deepEqual(consumed,[1,1], 'Unselected protection preserves actual supply consumption');
  await openMenu(page);
  await page.locator('#offline-cheat-protection').check();
  await page.locator('#offline-cheat-heal').tap();
  await page.screenshot({ path: path.join(output,'cheats-menu.png') });
  await closeMenu(page);
  const protectedState = await page.evaluate(() => {
    Path.outfit['cured meat'] = 0;
    World.water = 0; World.health = 1; World.starvation = World.thirst = true;
    World.foodMove = World.MOVES_PER_FOOD; World.waterMove = World.MOVES_PER_WATER;
    const allowed = World.useSupplies();
    return { allowed, health: World.health, water: World.water, food: Path.outfit['cured meat'], hpMax: World.getMaxHealth(), waterMax: World.getMaxWater() };
  });
  assert.equal(protectedState.allowed,true);
  assert.equal(protectedState.health,protectedState.hpMax);
  assert.equal(protectedState.water,protectedState.waterMax);
  assert.equal(protectedState.food,0);
  await page.evaluate(() => {
    Events.startEvent({title:'保护检查',scenes:{start:{combat:true,notification:'战斗保护检查',enemy:'test',enemyName:'野兽',chara:'B',health:100,damage:1,hit:0,attackDelay:999,loot:{}}}});
    clearInterval(Events._enemyAttackTimer);
    Events.dotDamage($('#wanderer'),10000);
  });
  const protectedCombat = await page.evaluate(() => ({ active: !!Events.activeEvent(), hp: $('#wanderer').data('hp'), max: World.getMaxHealth(), health: World.health, dead: Events.checkPlayerDeath() }));
  assert(protectedCombat.active && !protectedCombat.dead);
  assert.equal(protectedCombat.hp,protectedCombat.max);
  assert.equal(protectedCombat.health,protectedCombat.max);
  await page.evaluate(() => { Events.clearTimeouts(); Events.endEvent(); World.goHome(); });
  await openMenu(page);
  await page.locator('#offline-cheat-enable').uncheck();
  assert.equal(await page.locator('#offline-cheat-options').isVisible(),false);
  await closeMenu(page);
  await page.evaluate(() => Engine.travelTo(Outside));
  await page.locator('#gatherButton').tap();
  assert(await page.evaluate(() => $('#gatherButton').data('onCooldown')), 'Turning off the master switch restores cooldowns');
  await page.evaluate(() => {
    Path.outfit = {'cured meat':10}; $SM.set('outfit',Path.outfit);
    Engine.travelTo(Path); Button.clearCooldown($('#embarkButton'));
  });
  await page.locator('#embarkButton').tap();
  await page.waitForFunction(() => Engine.activeModule === World && World.curPos);
  await page.evaluate(() => World.setHp(1));
  assert.equal(await page.evaluate(() => World.health),1, 'Turning off the master switch restores damage');
  await page.evaluate(() => { World.goHome(); OfflineGame.save(); });
  await page.reload();
  await page.waitForFunction(() => window.OfflineGame && Engine.activeModule === Room);
  assert.equal(await page.evaluate(() => OfflineGame.getCheats().enabled),false,'Disabled master switch persists');
  checks.push('protection consumes no supplies, prevents lethal combat damage, and switches off cleanly across reload');
  assert.deepEqual(errors,[]);
  assert.deepEqual(remote,[]);
  await context.close();
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({ passed:true, checks, layouts, errors, remote },null,2));
  console.log(JSON.stringify({passed:true,checks,layoutScenarios:layouts.length}));
} finally { await browser.close(); }
