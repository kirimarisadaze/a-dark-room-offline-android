// Meaningful browser checks for the exact assets embedded in the APK.
// No HTTP server or Internet connection is used: the same virtual HTTPS origin
// as the Android WebView is fulfilled from files, with networking disabled.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'android/app/src/main/assets/game');
const output = path.join(root, '.local/test-results');
const origin = 'https://appassets.androidplatform.net';
const prefix = '/game/';
const mime = {'.html':'text/html', '.js':'application/javascript', '.css':'text/css',
  '.flac':'audio/flac', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml',
  '.ico':'image/x-icon', '.md':'text/plain', '.json':'application/json'};

let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright',
  path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch { /* Try next install. */ }
}
if (!playwright) throw new Error('Install playwright, or set PLAYWRIGHT_MODULE to its absolute package directory.');
await fs.access(path.join(assets, 'index.html'));
const packagedLanguages = (await fs.readdir(path.join(assets, 'lang'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
assert.deepEqual(packagedLanguages, ['zh_cn'], 'Only Simplified Chinese translations may be packaged');
await fs.mkdir(output, { recursive: true });

const results = [];
const viewports = process.argv.includes('--smallest-only')
  ? [[320,512]] : [[320,512], [320,568], [360,584], [360,640], [412,915]];
const browser = await playwright.chromium.launch({ headless: true });
try {
  for (const [width, height] of viewports) {
    const context = await browser.newContext({
      viewport: { width, height }, isMobile: true, hasTouch: true,
      userAgent: 'Mozilla/5.0 (Linux; Android 13; Offline Test) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36',
      offline: true,
    });
    const remoteRequests = [], missingAssets = [], errors = [], requests = [];
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      requests.push(url.pathname);
      if (url.origin !== origin || !url.pathname.startsWith(prefix)) {
        remoteRequests.push(url.href); await route.abort('internetdisconnected'); return;
      }
      const relative = decodeURIComponent(url.pathname.slice(prefix.length));
      const filename = path.resolve(assets, relative);
      if (!filename.startsWith(assets + path.sep)) { await route.abort(); return; }
      try {
        const body = await fs.readFile(filename);
        await route.fulfill({ status: 200, body,
          contentType: mime[path.extname(filename)] || 'application/octet-stream' });
      } catch {
        missingAssets.push(relative);
        await route.fulfill({ status: 404, body: 'Missing packaged asset' });
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    async function openMenu() {
      await page.locator('#offline-menu-button').tap();
      await page.waitForFunction(() => !document.getElementById('offline-menu-panel').hidden);
    }
    async function closeMenu() {
      await page.locator('#offline-menu-close').tap();
      await page.waitForFunction(() => document.getElementById('offline-menu-panel').hidden);
    }
    async function captureNightMode(module) {
      await openMenu();
      await page.locator('#offline-lights').tap();
      await page.waitForFunction(() => Engine.isLightsOff() && document.body.classList.contains('offline-dark'))
        .catch(async error => {
          console.error(await page.evaluate(() => ({ night: Engine.isLightsOff(), body: document.body.className,
            stylesheets: [...document.styleSheets].map(sheet => ({ title: sheet.title, disabled: sheet.disabled, href: sheet.href })) })));
          await page.screenshot({ path: path.join(output, `night-failure-${width}x${height}.png`) });
          throw error;
        });
      const colors = await page.evaluate(() => {
        const style = getComputedStyle(document.body);
        return { background: style.backgroundColor, ink: style.color };
      });
      assert.deepEqual(colors, { background: 'rgb(39, 40, 35)', ink: 'rgb(238, 238, 238)' },
        'Night mode must apply its dark surface and light ink together');
      await page.screenshot({ path: path.join(output, `${module}-night-${width}x${height}.png`) });
      if (module === 'room') {
        await openMenu();
        const sheet = await page.locator('#offline-menu-panel').evaluate(node => {
          const style = getComputedStyle(node);
          return { background: style.backgroundColor, ink: style.color };
        });
        assert.deepEqual(sheet, colors, 'Night-mode menu must match the dark game surface and ink');
        await page.screenshot({ path: path.join(output, `menu-night-${width}x${height}.png`) });
        await closeMenu();
        await openMenu();
        await page.locator('#offline-restart').tap();
        await page.waitForFunction(() => document.getElementById('event') &&
          getComputedStyle(document.getElementById('event')).opacity === '1');
        for (const fallback of [false, true]) {
          await page.evaluate(enabled => document.body.classList.toggle('noMask', enabled), fallback);
          const eventColors = await page.locator('#event').evaluate(node => {
            const style = getComputedStyle(node);
            return { background: style.backgroundColor, ink: style.color,
              titleInk: getComputedStyle(node.querySelector('.eventTitle')).color,
              descriptionInk: getComputedStyle(node.querySelector('#description')).color,
              buttonInk: getComputedStyle(node.querySelector('#no')).color };
          });
          assert.deepEqual(eventColors, { ...colors, titleInk: colors.ink,
            descriptionInk: colors.ink, buttonInk: colors.ink }, 'Night events must keep readable colors with and without mask support');
          await page.screenshot({ path: path.join(output, `event-night${fallback ? '-nomask' : ''}-${width}x${height}.png`) });
        }
        await page.evaluate(() => document.body.classList.remove('noMask'));
        await page.locator('#event #no').tap();
        await page.waitForFunction(() => !document.getElementById('event'));
        await page.evaluate(() => OfflineGame.save());
        await page.reload();
        await page.waitForFunction(() => window.Engine && Engine.activeModule === Room &&
          Engine.isLightsOff() && document.body.classList.contains('offline-dark'));
        assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor),
          colors.background, 'A saved night preference must initialize the dark surface on reload');
      }
      await openMenu();
      await page.locator('#offline-lights').tap();
      await page.waitForFunction(() => !Engine.isLightsOff() && !document.body.classList.contains('offline-dark'));
      assert.equal(await page.locator('body').evaluate(node => getComputedStyle(node).backgroundColor),
        'rgb(255, 255, 255)', 'Day mode must restore its white surface');
    }
    await page.goto(origin + prefix + 'index.html');
    await page.waitForFunction(() => window.OfflineGame && window.Engine && Engine.activeModule === Room);
    await page.evaluate(() => $SM.set('playStats.audioAlertShown', true));
    assert(!page.url().includes('Warning'), 'Android UA must enter the game');
    assert.match(await page.title(), /小黑屋|黑暗|房间/);
    assert.equal(await page.evaluate(() => localStorage.lang), 'zh_cn');
    assert.equal(await page.locator('#offline-menu-panel').isVisible(), false, 'Settings must start collapsed');
    await page.locator('#offline-messages-button').tap();
    assert.equal(await page.locator('#offline-messages-panel').isVisible(), true, 'Messages drawer must open');
    await page.locator('#offline-messages-close').tap();
    assert.equal(await page.locator('#offline-messages-panel').isVisible(), false, 'Messages drawer must close');
    await page.locator('#lightButton').tap();
    await page.waitForFunction(() => $SM.get('game.fire.value') > 0);
    const fire = await page.evaluate(() => {
      OfflineGame.save();
      return JSON.parse(localStorage.gameState).game.fire.value;
    });
    await page.waitForTimeout(1000);
    const roomEnglish = await page.evaluate(() => (document.body.innerText.match(/[A-Za-z]{3,}/g) || []));
    assert.deepEqual(roomEnglish, [], 'Visible room interface must use Chinese');
    await page.screenshot({ path: path.join(output, `room-${width}x${height}.png`) });
    await page.reload();
    await page.waitForFunction(() => window.Engine && window.Room && Engine.activeModule === Room);
    assert.equal(await page.evaluate(() => $SM.get('game.fire.value')), fire, 'Fire must survive reload');

    // Match the native import transaction. Its unload callback must not save
    // the old in-memory State over the replacement localStorage value.
    await page.evaluate(() => {
      const replacement = JSON.parse(localStorage.gameState);
      replacement.stores = replacement.stores || {};
      replacement.stores.wood = 543;
      OfflineGame.prepareRestore();
      localStorage.setItem('gameState', JSON.stringify(replacement));
      location.reload();
    });
    await page.waitForFunction(() => window.Engine && window.Room && Engine.activeModule === Room && $SM.get('stores.wood') === 543);
    assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 543, 'Import must survive pagehide');
    const saveBeforeInvalid = await page.evaluate(() => localStorage.gameState);
    await page.evaluate(() => Engine.import64('invalid-save-code'));
    assert.equal(await page.evaluate(() => localStorage.gameState), saveBeforeInvalid, 'Invalid Base64 must preserve current save');
    assert.equal(await page.evaluate(() => OfflineGame.save()), true, 'A rejected import must leave saving enabled');
    const exportCode = await page.evaluate(() => Engine.export64());
    await page.evaluate(code => {
      $SM.set('stores.wood', 17);
      OfflineGame.save();
      Engine.import64(code);
    }, exportCode);
    await page.waitForFunction(() => window.Engine && window.Room && Engine.activeModule === Room && $SM.get('stores.wood') === 543);
    assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 543, 'Valid Base64 import must restore exported progress');
    await page.evaluate(() => { OfflineGame.prepareRestore(); OfflineGame.cancelRestore(); });
    assert.equal(await page.evaluate(() => OfflineGame.save()), true, 'Canceling a failed native restore must re-enable saving');

    // This edition is Chinese only, including old saved language preferences
    // and language URL parameters carried over from the browser edition.
    await page.evaluate(() => { localStorage.lang = 'en'; });
    await page.goto(origin + prefix + 'index.html?lang=en');
    await page.waitForFunction(() => window.Engine && window.Room && Engine.activeModule === Room);
    assert.equal(await page.evaluate(() => lang), 'zh_cn', 'URL language must not disable Chinese');
    assert.equal(await page.evaluate(() => localStorage.lang), 'zh_cn', 'Old language preference must be reset to Chinese');
    assert.equal(await page.locator('#offline-language').count(), 0, 'Chinese-only edition must not expose a language selector');
    assert.match(await page.title(), /生火间|小黑屋|黑暗|房间/);
    const initialFontSize = await page.locator('body').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    await openMenu();
    await page.locator('#offline-font-larger').tap();
    const enlargedFontSize = await page.locator('body').evaluate(node => parseFloat(getComputedStyle(node).fontSize));
    assert(enlargedFontSize > initialFontSize, 'Font-size control must enlarge actual game text');
    await page.reload();
    await page.waitForFunction(() => window.Engine && Engine.activeModule === Room);
    assert.equal(await page.locator('body').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), enlargedFontSize,
      'Selected font size must survive restart');
    await openMenu();
    await page.locator('#offline-font-smaller').tap();
    assert.equal(await page.locator('body').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), initialFontSize,
      'Font-size control must shrink back to the previous size');
    for (let index=0; index<6; index++) await page.locator('#offline-font-larger').tap();
    assert.equal(await page.locator('body').evaluate(node => parseFloat(getComputedStyle(node).fontSize)), 22,
      'The largest supported font must be 22px');
    assert.equal(await page.locator('#offline-font-larger').isDisabled(), true, 'Font control must stop at its upper bound');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth+1), false,
      'The largest game font must not cause horizontal page overflow');
    await closeMenu();
    await page.screenshot({ path: path.join(output, `room-font22-${width}x${height}.png`) });
    await openMenu();
    for (let index=0; index<6; index++) await page.locator('#offline-font-smaller').tap();
    assert.equal(await page.locator('#offline-font-smaller').isDisabled(), true, 'Font control must stop at its lower bound');
    await closeMenu();
    if (width === 320 && height === 512) await captureNightMode('room');

    // Provide earned resources to reach later interfaces in bounded test time.
    // All actual rendering and movement below use the game's existing APIs.
    await page.evaluate(() => {
      $SM.set('playStats.audioAlertShown', true);
      $SM.set('stores.wood', 100);
      $SM.set('stores.compass', 1);
      $SM.set('stores["cured meat"]', 10);
      if (!Path.panel) Path.init();
      Path.outfit = { 'cured meat': 10 };
      $SM.set('outfit', Path.outfit);
      Engine.travelTo(Path);
    });
    await page.locator('#embarkButton').tap();
    await page.waitForFunction(() => Engine.activeModule === World && World.curPos);
    await page.waitForTimeout(1000);
    const worldEnglish = await page.evaluate(() => (document.body.innerText.match(/[A-Za-z]{3,}/g) || []));
    assert.deepEqual(worldEnglish, [], 'Visible expedition interface must use Chinese');
    await page.screenshot({ path: path.join(output, `world-${width}x${height}.png`) });
    await page.screenshot({ path: path.join(output, `world-full-${width}x${height}.png`), fullPage: true });
    if (width === 320 && height === 512) await captureNightMode('world');
    const worldLayout = await page.evaluate(() => {
      const wanderer = Array.from(document.querySelectorAll('#map .landmark')).find(node => node.firstChild.textContent === '@');
      return { map: document.querySelector('#map').getBoundingClientRect().toJSON(),
        wanderer: wanderer && wanderer.getBoundingClientRect().toJSON(),
        menu: document.querySelector('.menu').getBoundingClientRect().toJSON(),
        controls: document.querySelector('#offline-controls').getBoundingClientRect().toJSON(),
        mapFont: parseFloat(getComputedStyle(document.querySelector('.offline-map-tiles')).fontSize),
        full: document.querySelector('#map').classList.contains('offline-map-full') };
    });
    assert.equal(worldLayout.full, false, 'Map must start in nearby mode');
    assert(worldLayout.mapFont >= 12, 'Nearby map characters must remain readable');
    function assertCentered(layout) {
      assert(Math.abs((layout.wanderer.left + layout.wanderer.width/2) - (layout.map.left + layout.map.width/2)) < 3,
        'Nearby map must horizontally center the player');
      assert(Math.abs((layout.wanderer.top + layout.wanderer.height/2) - (layout.map.top + layout.map.height/2)) < 3,
        'Nearby map must vertically center the player');
    }
    assertCentered(worldLayout);
    assert(worldLayout.wanderer && worldLayout.wanderer.top >= 0 && worldLayout.wanderer.bottom <= worldLayout.menu.top,
      'The current map position must be visible above the bottom menu');
    assert(worldLayout.wanderer.right <= worldLayout.controls.left || worldLayout.wanderer.bottom <= worldLayout.controls.top,
      'The current map position must remain clear of direction controls');
    const before = await page.evaluate(() => World.curPos.slice());
    const right = page.locator('#offline-controls button[data-direction="right"]');
    await right.tap();
    assert.deepEqual(await page.evaluate(() => World.curPos.slice()), [before[0]+1,before[1]], 'Touch direction must move exactly one map cell');
    const movedLayout = await page.evaluate(() => {
      const wanderer = Array.from(document.querySelectorAll('#map .landmark')).find(node => node.firstChild.textContent === '@');
      return { map: document.querySelector('#map').getBoundingClientRect().toJSON(), wanderer: wanderer.getBoundingClientRect().toJSON() };
    });
    assertCentered(movedLayout);
    const beforeMapTap = await page.evaluate(() => World.curPos.slice());
    await page.evaluate(() => OfflineGame.tilt(-5));
    assert.deepEqual(await page.evaluate(() => World.curPos.slice()), beforeMapTap, 'Tilt input must not move the expedition map');
    const mapBox = await page.locator('#map').boundingBox();
    await page.touchscreen.tap(mapBox.x + 12, mapBox.y + 12);
    assert.deepEqual(await page.evaluate(() => World.curPos.slice()), beforeMapTap, 'Tapping the cropped map must not cause unintended movement');
    await page.locator('#offline-map-toggle').tap();
    assert.equal(await page.locator('#map').evaluate(node => node.classList.contains('offline-map-full')), true, 'Map toggle must show full world');
    await page.screenshot({ path: path.join(output, `world-overview-${width}x${height}.png`) });
    await page.locator('#offline-map-toggle').tap();
    assert.equal(await page.locator('#map').evaluate(node => node.classList.contains('offline-map-full')), false, 'Map toggle must restore nearby view');
    await page.evaluate(() => { Engine.keyLock = true; });
    await right.tap();
    assert.deepEqual(await page.evaluate(() => World.curPos.slice()), [before[0]+1,before[1]], 'Touch controls must respect event/combat key lock');
    await page.evaluate(() => { Engine.keyLock = false; World.goHome(); });

    // The original ship uses a 700x700 coordinate system. Test its actual
    // movement, on-screen visibility, and release rather than only button DOM.
    await page.evaluate(() => {
      if (!Ship.panel) Ship.init();
      $SM.set('game.spaceShip.hull', 100);
      $SM.set('game.spaceShip.thrusters', 1);
      $SM.set('game.spaceShip.seenWarning', true);
      Engine.travelTo(Ship);
      Ship.liftOff();
    });
    await page.waitForFunction(() => Engine.activeModule === Space);
    await page.waitForTimeout(1000);
    const flightEnglish = await page.evaluate(() => (document.body.innerText.match(/[A-Za-z]{3,}/g) || []));
    assert.deepEqual(flightEnglish, [], 'Visible flight interface must use Chinese');
    const shipBefore = await page.locator('#ship').evaluate(node => parseFloat(node.style.left));
    const box = await right.boundingBox();
    assert(box && box.x >= 0 && box.x+box.width <= width+1 && box.y >= 0 && box.y+box.height <= height+1,
      'Direction buttons must remain visible in a narrow viewport');
    await page.mouse.move(box.x+box.width/2, box.y+box.height/2);
    await page.mouse.down();
    await page.waitForTimeout(220);
    await page.mouse.up();
    const shipAfter = await page.locator('#ship').evaluate(node => parseFloat(node.style.left));
    assert(shipAfter > shipBefore, 'Holding touch control must continuously move ship');
    assert.equal(await page.evaluate(() => Space.right), false, 'Releasing direction must stop ship');
    const shipBox = await page.locator('#ship').boundingBox();
    assert(shipBox && shipBox.x >= 0 && shipBox.x+shipBox.width <= width+1,
      'The ship must be visible within the scaled game canvas');
    const beforeTilt = await page.locator('#ship').evaluate(node => parseFloat(node.style.left));
    await page.evaluate(() => OfflineGame.tilt(-5));
    await page.waitForTimeout(150);
    const afterRightTilt = await page.locator('#ship').evaluate(node => parseFloat(node.style.left));
    assert(afterRightTilt > beforeTilt, 'Rightward sensor tilt must steer the ship right');
    await page.evaluate(() => OfflineGame.tilt(5));
    await page.waitForTimeout(150);
    const afterLeftTilt = await page.locator('#ship').evaluate(node => parseFloat(node.style.left));
    assert(afterLeftTilt < afterRightTilt, 'Leftward sensor tilt must steer the ship left');
    await page.evaluate(() => OfflineGame.tilt(0));
    assert.deepEqual(await page.evaluate(() => [Space.left, Space.right, Space.up, Space.down]), [false, false, false, false],
      'Neutral sensor position must release every flight direction');
    const neutralX = await page.locator('#ship').evaluate(node => parseFloat(node.style.left));
    await page.waitForTimeout(100);
    assert(Math.abs(await page.locator('#ship').evaluate(node => parseFloat(node.style.left)) - neutralX) < 1,
      'Ship must stop drifting when the device returns to neutral');
    await page.evaluate(() => OfflineGame.tilt(-0.8));
    assert.deepEqual(await page.evaluate(() => [Space.left, Space.right]), [false, false],
      'Small sensor changes inside the dead zone must not steer the ship');
    await page.evaluate(() => OfflineGame.tilt(5));
    await page.mouse.down();
    assert.deepEqual(await page.evaluate(() => [Space.left, Space.right]), [false, true],
      'Touch direction must take priority over opposite sensor tilt');
    await page.mouse.up();
    await page.evaluate(() => OfflineGame.tilt(0));
    await page.screenshot({ path: path.join(output, `space-${width}x${height}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false,
      'Mobile page must not horizontally overflow');

    // Simulate the clock interval during Android WebView.pauseTimers without
    // running JS callbacks in that interval. Resuming must shift wall-clock
    // animations, release held controls, and avoid instantly ending the flight.
    await page.mouse.down();
    const pausedFlight = await page.evaluate(() => {
      const realNow = Date.now;
      const now = realNow();
      const animations = Array.from(new Set($.timers.map(timer => timer.anim).filter(Boolean)));
      const starts = animations.map(animation => animation.startTime);
      OfflineGame.pause();
      try {
        Date.now = () => now + 65000;
        OfflineGame.resume();
        return {
          shifts: animations.map((animation, index) => animation.startTime - starts[index]),
          longFlightAnimation: animations.some(animation => animation.duration >= 60000),
          done: Space.done, gameOver: Engine.GAME_OVER, heldRight: Space.right,
        };
      } finally {
        Date.now = realNow;
        // The host test clock rolls back; put animation clocks back as well.
        animations.forEach((animation, index) => { animation.startTime = starts[index]; });
        Space.lastMove = realNow();
      }
    });
    await page.mouse.up();
    assert(pausedFlight.longFlightAnimation, 'The real 60s ascent animation must be running');
    assert(pausedFlight.shifts.length > 0 && pausedFlight.shifts.every(shift => shift >= 64990 && shift <= 65010),
      'Resuming must compensate each animation for the 65s paused interval');
    assert.equal(pausedFlight.done, false, 'Pausing must not finish the ascent');
    assert.equal(pausedFlight.gameOver, false, 'Pausing must not end the game');
    assert.equal(pausedFlight.heldRight, false, 'Pausing must release flight controls');

    const decodedAudio = await page.evaluate(async () => {
      const buffer = await AudioEngine.loadAudioFile(AudioLibrary.LIGHT_FIRE);
      return { channels: buffer.numberOfChannels, duration: buffer.duration };
    });
    assert(decodedAudio.channels > 0 && decodedAudio.duration > 0, 'Packaged FLAC audio must decode');

    assert.deepEqual(remoteRequests, [], 'Game must make no Internet requests');
    assert.deepEqual(missingAssets, [], 'All requested resources must be embedded');
    assert.deepEqual(errors, [], 'No uncaught JavaScript errors');
    const result = { width, height, passed: true, worldLayout,
      nightModeChecked: width === 320 && height === 512, resourceRequests: requests.length,
      remoteRequests, missingAssets, errors,
      checks: ['Chinese Android launch', 'light fire', 'save/reload', 'native restore transaction',
        'invalid import safety', 'Base64 save roundtrip', 'Chinese-only language lock', 'menu/messages drawers', 'persistent font controls',
        'readable centered nearby map', 'map follows player', 'overview toggle', 'map tap safety', 'map touch movement',
        'combat input lock', 'ship hold/release', 'sensor tilt/neutral', '65s pause/resume', 'FLAC audio decoding',
        'narrow-screen layout', 'no network'] };
    results.push(result);
    console.log(JSON.stringify(result));
    await context.close();
  }
} finally {
  await browser.close();
  await fs.writeFile(path.join(output, 'browser-report.json'), JSON.stringify(results, null, 2));
}
