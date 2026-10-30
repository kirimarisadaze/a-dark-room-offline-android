/* SPDX-License-Identifier: MPL-2.0 */
// Browser acceptance tests for the exact offline WebView asset bundle.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root, '../kubi/node_modules/playwright')].filter(Boolean)) {
    try { playwright = require(candidate); break; } catch {}
}
assert(playwright, 'Use an existing Playwright installation through PLAYWRIGHT_MODULE.');
const assets = path.join(root, 'android/app/src/main/assets/game');
const output = path.join(root, '.local/rogue-tests');
try { await fs.access(path.join(output, 'completed-run.json')); }
catch { execFileSync(process.execPath, [path.join(root, 'scripts/test-rogue.mjs'), '--playthrough'], { cwd: root, stdio: 'inherit' }); }
const base = 'https://appassets.androidplatform.net/game/';
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.flac': 'audio/flac', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon' };
const errors = [], warnings = [], missing = [], remote = [], checks = [];
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true });
/** Creates a fully offline browser context at the same virtual origin as the Android WebView. */
async function setup(width = 360, height = 740, seed = {}) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: width < 1100, hasTouch: width < 1100, offline: true });
    await context.addInitScript(seed => {
        if (!sessionStorage.getItem('rogue-test-seed')) {
            for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value);
            sessionStorage.setItem('rogue-test-seed', 'true');
        }
    }, seed);
    await context.route('**/*', async route => {
        const url = route.request().url();
        if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
        const relative = decodeURIComponent(new URL(url).pathname.slice('/game/'.length));
        const file = path.resolve(assets, relative);
        if (!file.startsWith(assets + path.sep)) { await route.abort(); return; }
        try { await route.fulfill({ body: await fs.readFile(file), contentType: mime[path.extname(file)] || 'application/octet-stream' }); }
        catch { missing.push(relative); await route.fulfill({ status: 404, body: '' }); }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
    return { context, page };
}
/** Opens the Rogue mode and creates a run exclusively through its real controls. */
async function create(page, slot = 0) {
    await page.goto(base + 'index.html?mode=rogue');
    await page.locator('.rogue-slot-open').nth(slot).click();
    await page.locator('#rogue-seed').fill('42');
    await page.getByRole('button', { name: '点燃第一堆火', exact: true }).click();
    await page.waitForFunction(() => Rogue.state.current && document.querySelector('#rogue-root').getAttribute('data-view') === 'run');
}
/** Checks horizontal fit and the minimum touch size of currently rendered controls. */
async function fit(page, tag) {
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const result = await page.evaluate(() => {
        const failures = [];
        if (document.documentElement.scrollWidth > innerWidth + 1) failures.push('page-overflow');
        const nodes = document.querySelectorAll('#rogue-root button, #rogue-root input');
        for (const node of nodes) {
            if (!node.getClientRects().length || node.closest('[aria-hidden="true"]')) continue;
            const r = node.getBoundingClientRect();
            if (r.left < -1 || r.right > innerWidth + 1) failures.push('overflow:' + node.getAttribute('data-focus'));
            if (r.height < 43 || r.width < 43) failures.push('touch:' + node.getAttribute('data-focus') + ':' + r.width + 'x' + r.height);
        }
        if (document.body.innerText.includes('!!')) failures.push('missing-translation');
        if (document.querySelector('.rogue-header').getBoundingClientRect().top !== 0) failures.push('title-not-fixed');
        for (const node of document.querySelectorAll('.rogue-dialog-footer button, .rogue-subpage-return button, .rogue-location-tabs button')) {
            if (!node.getClientRects().length || node.closest('[aria-hidden="true"]')) continue;
            const b = node.getBoundingClientRect(); const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            if (b.top < 0 || b.bottom > innerHeight + 1 || !hit || !node.contains(hit)) failures.push('blocked-return:' + node.textContent);
        }
        return { failures, width: innerWidth, height: innerHeight };
    });
    assert.deepEqual(result.failures, [], tag);
}
/** Leaves a run through the explicit, confirmed menu action, including during battle. */
async function exitHome(page) {
    const pause = page.getByRole('button', { name: '暂停与菜单', exact: true });
    if (await pause.isVisible()) await pause.click();
    else await page.locator('#rogue-menu').click();
    await page.getByRole('button', { name: '暂离旅程', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
}
/** Records an acceptance result. */
function mark(name) { checks.push(name); console.log('PASS ' + name); }
try {
    const ordinary = await setup();
    await ordinary.page.goto(base + 'index.html');
    await ordinary.page.waitForFunction(() => window.State && Engine.activeModule === Room && window.OfflineGame);
    await ordinary.page.evaluate(() => { $SM.set('stores.wood', 4321); $SM.set('playStats.audioAlertShown', true); OfflineGame.save(); });
    const normalSave = await ordinary.page.evaluate(() => localStorage.gameState);
    const normalDatabase = await ordinary.page.evaluate(() => localStorage.getItem('adr.saveSlots.v1'));
    await ordinary.context.close();
    mark('ordinary mode still initializes Room and saves real upstream progress');
    const env = await setup(360, 740, { gameState: normalSave, unrelated: 'keep' });
    const { page } = env;
    await page.goto(base + 'home.html');
    await page.getByRole('button', { name: '开始游戏', exact: true }).click();
    assert.match(await page.locator('#offline-mode-rogue-description').innerText(), /探索/);
    await page.locator('#offline-mode-rogue').click();
    await page.waitForURL(base + 'index.html?mode=rogue');
    assert.equal(await page.locator('.rogue-slot').count(), 3);
    assert.equal(await page.evaluate(() => localStorage.getItem('rogueSlot0')), null);
    assert.equal(await page.evaluate(() => localStorage.gameState), normalSave);
    mark('existing homepage opens the three-slot Rogue launcher without creating any run');
    await create(page);
    assert.equal(await page.evaluate(() => typeof window.State), 'undefined');
    assert.equal(await page.evaluate(() => AudioEngine._initialized), false);
    assert.equal(await page.locator('.location').count(), 0);
    assert.equal(await page.evaluate(() => localStorage.gameState), normalSave);
    assert.match(await page.locator('.rogue-brand').innerText(), /无光之地/);
    await fit(page, 'initial-map');
    await page.locator('.rogue-dpad').evaluate(node => node.scrollIntoView({ block: 'center' }));
    const controls = await page.locator('.rogue-dpad').boundingBox();
    const bottom = await page.locator('.rogue-bottom').boundingBox();
    assert(controls.y + controls.height <= bottom.y, 'phone movement controls must fit above the navigation');
    assert.equal(await page.locator('.rogue-scene-tabs').count(), 0);
    assert.equal(await page.locator('.rogue-exploration-scene .rogue-map-viewport').count(), 1);
    assert.equal(await page.locator('.rogue-exploration-scene .rogue-map-lower').count(), 1);
    assert.equal(await page.locator('.rogue-header #rogue-tab-map').count(), 1);
    assert.equal(await page.locator('.rogue-bottom #rogue-tab-map').count(), 0);
    const navigationTurn = await page.evaluate(() => JSON.stringify(Rogue.state.current));
    await page.locator('#rogue-tab-camp').click();
    const workArea = await page.locator('.rogue-camp-workbench').boundingBox();
    const stockArea = await page.locator('.rogue-camp-ledger').boundingBox();
    assert(stockArea.y + stockArea.height <= workArea.y, 'phone resource summary must precede full-width camp work');
    const villageArea = await page.locator('.rogue-camp-village').boundingBox();
    assert(villageArea.y >= workArea.y + workArea.height, 'population follows camp operations on phones');
    assert.equal(await page.locator('.rogue-camp-daily [data-focus="camp-view:supplies"]').count(), 1);
    assert.equal(await page.locator('.rogue-camp-daily [data-variant="primary"]').count(), 1);
    const primaryStyle = await page.locator('.rogue-camp-daily [data-variant="primary"]').evaluate(node => {
        const style = getComputedStyle(node); return { background: style.backgroundColor, text: style.color };
    });
    assert.notEqual(primaryStyle.background, primaryStyle.text);
    assert.equal(await page.locator('.rogue-menu-tile').count(), 0);
    await page.locator('#rogue-tab-map').click();
    assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), navigationTurn);
    const initialTurn = await page.evaluate(() => Rogue.state.current.turn);
    await page.locator('[data-focus="modal:time"]').filter({ hasText: '第 1 天' }).click();
    assert.match(await page.getByRole('dialog').innerText(), /50 回合/);
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.getByRole('button', { name: '区域图', exact: true }).count(), 0);
    assert(await page.locator('.rogue-local-legend [data-symbol="@"] ').count());
    assert.equal(await page.evaluate(() => Rogue.state.current.turn), initialTurn);
    const destinationCell = page.locator('.rogue-grid [data-site]').first();
    await destinationCell.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await destinationCell.click();
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    assert.equal(await page.evaluate(() => Rogue.state.current.turn), initialTurn);
    await page.screenshot({ path: path.join(output, 'map-360-day.png'), fullPage: true });
    await page.locator('#rogue-tab-camp').click();
    assert.equal(await page.locator('.rogue-camp-stocks .rogue-resource-grid .rogue-stat').count(), 5);
    assert.equal(await page.locator('.rogue-camp-stocks [data-focus="camp-view:stores"]').count(), 1);
    const sourceSceneStyle = await page.locator('.rogue-map-lower').evaluate(node => getComputedStyle(node).display);
    assert.equal(sourceSceneStyle, 'grid');
    const campStockStyle = await page.locator('.rogue-camp-stocks .rogue-resource-grid').evaluate(node => getComputedStyle(node).display);
    assert.equal(campStockStyle, 'grid');
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '收集周围物资', exact: true }).click();
    await page.locator('[data-focus="camp-view:recipes"]').click();
    await page.locator('[data-focus="craft:spear"]').click();
    assert.equal(await page.evaluate(() => Rogue.state.current.party.weapon), 'spear');
    await page.locator('[data-focus="camp-return"]').click();
    await page.getByRole('button', { name: '整备水与口粮', exact: true }).click();
    await page.locator('#rogue-tab-map').click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '向西', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    await page.getByRole('button', { name: '采集', exact: true }).click();
    await page.getByRole('button', { name: '占领站点', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    await page.locator('[data-focus="worker:plus:0,0:0"]').click();
    assert.equal(await page.evaluate(() => Rogue.state.current.regions['0,0'].sites[0].workers), 1);
    assert.equal(await page.locator('[data-focus="camp-view:buildings"]').count(), 0, 'resource sites cannot expose remote camp construction');
    await page.screenshot({ path: path.join(output, 'region-resource-360-day.png'), fullPage: true });
    await page.locator('#rogue-tab-map').click();
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '向东', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    await page.getByRole('button', { name: '整备水与口粮', exact: true }).click();
    await page.locator('[data-focus="camp-view:expansion"]').evaluate(node => node.scrollIntoView({ block: 'center' }));
    const lastTile = await page.locator('[data-focus="camp-view:expansion"]').boundingBox();
    const campBottom = await page.locator('.rogue-bottom').boundingBox();
    assert(lastTile.y >= 100 && lastTile.y + lastTile.height <= campBottom.y, 'local camp categories must be reachable between fixed navigation and footer');
    await page.locator('#rogue-tab-map').click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '向北', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    for (let i = 0; i < 4; i++) await page.getByRole('button', { name: '采集', exact: true }).click();
    await page.locator('#rogue-tab-map').click();
    for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '向南', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    await page.getByRole('button', { name: '整备水与口粮', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    await page.locator('[data-focus="camp-view:recipes"]').click();
    await page.locator('[data-focus="filter:tools"]').click();
    await page.locator('[data-focus="craft:campKit"]').click();
    await page.locator('[data-focus="craft:campKit"]').click();
    await page.locator('[data-focus="camp-return"]').click();
    await page.locator('#rogue-tab-map').click();
    await page.getByRole('button', { name: '向东', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    await page.getByRole('button', { name: '在此扎营', exact: true }).click();
    assert.equal(await page.evaluate(() => Rogue.state.current.camps.length), 1);
    assert.equal(await page.evaluate(() => Rogue.state.current.flags.tempCamp.expiresAt - Rogue.state.current.turn), 100);
    await page.locator('#rogue-tab-map').click();
    await page.getByRole('button', { name: '向东', exact: true }).click();
    await page.locator('#rogue-tab-camp').click();
    const beforeReplacement = await page.evaluate(() => JSON.stringify(Rogue.state.current));
    await page.getByRole('button', { name: '在此扎营', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), beforeReplacement);
    await page.getByRole('button', { name: '在此扎营', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    const restStarted = await page.evaluate(() => Rogue.state.current.turn);
    await page.getByRole('button', { name: '短暂休整', exact: true }).click();
    assert.equal(await page.evaluate(() => Rogue.state.current.turn), restStarted + 5);
    await page.reload(); await page.waitForFunction(() => Rogue.state.current && Rogue.atTemp(Rogue.state.current));
    await page.locator('#rogue-tab-camp').click();
    await page.locator('[data-focus="camp-view:expansion"]').click();
    await page.getByRole('button', { name: '拆除营地', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.evaluate(() => !!Rogue.state.current.flags.tempCamp), true);
    await page.getByRole('button', { name: '拆除营地', exact: true }).click();
    await page.getByRole('button', { name: '确认', exact: true }).click();
    assert.equal(await page.evaluate(() => !!Rogue.state.current.flags.tempCamp), false);
    await page.locator('[data-focus="camp-return"]').click();
    mark('local legend matches visible map symbols; crafted temporary shelters survive refresh, rest for five turns and respect migration/removal confirmation');
    const beforePanels = await page.evaluate(() => Rogue.state.current.turn);
    await page.locator('#rogue-tab-party').click();
    await page.locator('#rogue-menu').click();
    await page.getByRole('button', { name: '夜间', exact: true }).click();
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.evaluate(() => Rogue.state.current.turn), beforePanels);
    await page.screenshot({ path: path.join(output, 'party-360-night.png'), fullPage: true });
    const beforeReload = await page.evaluate(() => JSON.stringify(Rogue.state.current));
    await page.reload();
    await page.waitForFunction(() => Rogue.state.current);
    assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), beforeReload);
    assert.equal(await page.evaluate(() => localStorage.gameState), normalSave);
    mark('real UI gathering, crafting, occupation and worker assignment persist; panels and settings consume zero turns');
    await page.locator('#rogue-tab-camp').click();
    await page.getByRole('button', { name: '返回据点', exact: true }).click();
    assert(await page.evaluate(() => !!Rogue.atCamp(Rogue.state.current)));
    const navigationState = await page.evaluate(() => JSON.stringify(Rogue.state.current));
    await page.locator('#rogue-tab-party').click();
    await page.locator('#rogue-root').click({ position: { x: 3, y: 80 } });
    await page.keyboard.press('Space');
    assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), navigationState);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    assert.equal((await page.locator('.rogue-header').boundingBox()).y, 0);
    await page.locator('#rogue-back').click();
    assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
    await page.locator('#rogue-tab-camp').click();
    await page.locator('[data-focus="camp-view:recipes"]').click();
    await page.locator('[data-focus="camp-return"]').click();
    assert.equal(await page.locator('#rogue-panel-camp').getAttribute('data-camp-view'), 'overview');
    await page.locator('#rogue-back').click();
    assert.equal(await page.locator('#rogue-root').getAttribute('data-tab'), 'map');
    await page.locator('#rogue-menu').click();
    assert.equal(await page.getByRole('dialog').getAttribute('aria-labelledby'), 'rogue-dialog-title');
    const guide = page.getByRole('button', { name: '旅途指南', exact: true });
    await guide.scrollIntoViewIfNeeded();
    const parentScroll = await page.locator('.rogue-dialog-content').evaluate(node => node.scrollTop);
    await guide.click();
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.locator('#rogue-dialog-title').innerText(), '行囊与设置');
    assert.equal(await page.locator('.rogue-dialog-content').evaluate(node => node.scrollTop), parentScroll);
    await page.getByRole('button', { name: '旅途手记', exact: true }).click();
    assert.equal(await page.locator('.rogue-dialog-footer .rogue-return').innerText(), '← 返回菜单');
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.locator('#rogue-dialog-title').innerText(), '行囊与设置');
    await page.getByRole('button', { name: '暂离旅程', exact: true }).click();
    await page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await page.locator('#rogue-dialog-title').innerText(), '行囊与设置');
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.locator('[data-focus="journal-toggle"]').click();
    assert.equal(await page.locator('.rogue-journal-fullscreen').count(), 1);
    await page.screenshot({ path: path.join(output, 'journal-360-night.png') });
    assert.equal(await page.evaluate(() => OfflineGame.back()), true);
    assert.equal(await page.getByRole('dialog').count(), 0);
    await page.locator('#rogue-menu').click();
    await page.getByRole('button', { name: '旅途指南', exact: true }).click();
    assert.equal(await page.evaluate(() => OfflineGame.back()), true);
    assert.equal(await page.locator('#rogue-dialog-title').innerText(), '行囊与设置');
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), navigationState);
    mark('fixed title, camp/root back, nested guide/menu/confirm history and scroll, fullscreen journal and native Back consume no turns');
    await page.locator('#rogue-tab-camp').click();
    await page.locator('[data-focus="camp-view:research"]').click();
    await page.evaluate(() => { Rogue.combat.encounter(Rogue.state.current, { kind: 'wild' }); Rogue.save.write(Rogue.state.current); Rogue.ui.render(); });
    await page.getByRole('button', { name: '防御反击', exact: true }).click();
    const battle = await page.evaluate(() => JSON.stringify(Rogue.state.current.flags.combat));
    if (battle) {
        await page.reload();
        await page.waitForFunction(() => Rogue.state.current && Rogue.state.current.flags.combat);
        assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current.flags.combat)), battle);
        await page.screenshot({ path: path.join(output, 'combat-360-night.png') });
    }
    const pausedBattle = await page.evaluate(() => JSON.stringify(Rogue.state.current));
    assert.equal(await page.evaluate(() => OfflineGame.back()), true);
    assert.equal(await page.locator('.rogue-dialog-footer .rogue-return').innerText(), '← 返回战斗');
    await page.getByRole('button', { name: '旅途指南', exact: true }).click();
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.locator('#rogue-dialog-title').innerText(), '行囊与设置');
    await page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
    assert.equal(await page.locator('#rogue-dialog-title').innerText(), '遭遇');
    assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), pausedBattle);
    await exitHome(page);
    await page.waitForURL(base + 'home.html');
    assert.equal(await page.evaluate(() => localStorage.gameState), normalSave);
    await page.locator('#offline-home-start').click(); await page.locator('#offline-mode-normal').click(); await page.locator('#offline-slot-1').click();
    await page.waitForFunction(() => window.State && Engine.activeModule === Room);
    assert.equal(await page.evaluate(() => $SM.get('stores.wood')), 4321);
    mark('refresh resumes the exact battle; return-home and normal-mode resume preserve prior wood and normal save');
    await env.context.close();
    const backup = await setup(360, 740, { gameState: normalSave, 'adr.saveSlots.v1': normalDatabase, rogueSlot2: '{"version":1,', unrelated: 'keep' });
    await create(backup.page, 1);
    const exported = await backup.page.evaluate(() => {
        const code = Rogue.export64();
        return { raw: Base64.decode(code), code, slot: localStorage.rogueSlot1 };
    });
    assert.equal(exported.raw, exported.slot);
    assert.equal(JSON.parse(exported.raw).slot, 1);
    const otherSlot = JSON.stringify({ ...JSON.parse(exported.raw), slot: 0 });
    await backup.page.evaluate(raw => localStorage.setItem('rogueSlot0', raw), otherSlot);
    await backup.page.locator('#rogue-tab-camp').click();
    await backup.page.getByRole('button', { name: '收集周围物资', exact: true }).click();
    const changed = await backup.page.evaluate(() => localStorage.rogueSlot1);
    assert.notEqual(changed, exported.raw);
    assert.equal(await backup.page.evaluate(() => Rogue.importJSON('{"version":1,')), false);
    assert.equal(await backup.page.evaluate(() => localStorage.rogueSlot1), changed);
    const sourceWithDifferentSlot = JSON.stringify({ ...JSON.parse(exported.raw), slot: 2 });
    assert.equal(await backup.page.evaluate(raw => Rogue.confirmRestore(raw), sourceWithDifferentSlot), true);
    const dialogButtons = backup.page.getByRole('dialog').locator('button');
    await dialogButtons.last().focus(); await backup.page.keyboard.press('Tab');
    assert.equal(await dialogButtons.first().evaluate(node => node === document.activeElement), true);
    await backup.page.keyboard.press('Shift+Tab');
    assert.equal(await dialogButtons.last().evaluate(node => node === document.activeElement), true);
    await backup.page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await backup.page.evaluate(() => localStorage.rogueSlot1), changed);
    await backup.page.evaluate(raw => Rogue.confirmRestore(raw), sourceWithDifferentSlot);
    await backup.page.getByRole('button', { name: '确认', exact: true }).click();
    assert.equal(await backup.page.evaluate(() => localStorage.rogueSlot1), exported.raw);
    const paused = await backup.page.evaluate(() => {
        const before = JSON.stringify(Rogue.state.current);
        OfflineGame.pause(); OfflineGame.resume(); OfflineGame.tilt(50);
        return { before, after: JSON.stringify(Rogue.state.current), normal: localStorage.gameState,
            database: localStorage.getItem('adr.saveSlots.v1'), other: localStorage.rogueSlot0,
            damaged: localStorage.rogueSlot2, unrelated: localStorage.unrelated };
    });
    assert.equal(paused.after, paused.before);
    assert.equal(paused.normal, normalSave); assert.equal(paused.database, normalDatabase);
    assert.equal(paused.other, otherSlot); assert.equal(paused.damaged, '{"version":1,'); assert.equal(paused.unrelated, 'keep');
    mark('native Base64 backup, cancelled/confirmed restore, modal focus loop and lifecycle retain normal bytes and other Rogue slots');
    await backup.page.locator('#rogue-menu').click();
    await backup.page.getByRole('button', { name: '切换旅程', exact: true }).click();
    assert.equal(await backup.page.locator('.rogue-slot-open').nth(2).isDisabled(), true);
    assert.match(await backup.page.locator('.rogue-slot').nth(2).innerText(), /原始数据已保留/);
    await backup.page.locator('[data-focus="delete:2"]').click();
    await backup.page.getByRole('button', { name: '取消', exact: true }).click();
    assert.equal(await backup.page.evaluate(() => localStorage.rogueSlot2), '{"version":1,');
    await backup.page.locator('[data-focus="delete:2"]').click();
    await backup.page.getByRole('button', { name: '确认', exact: true }).click();
    assert.equal(await backup.page.evaluate(() => localStorage.getItem('rogueSlot2')), null);
    assert.equal(await backup.page.evaluate(() => localStorage.rogueSlot0), otherSlot);
    assert.equal(await backup.page.evaluate(() => localStorage.rogueSlot1), exported.raw);
    await create(backup.page, 2);
    assert.equal(await backup.page.evaluate(() => Rogue.state.current.slot), 2);
    assert.equal(await backup.page.evaluate(() => localStorage.gameState), normalSave);
    mark('damaged run remains intact until explicit deletion; another slot stays playable and isolated');
    await backup.context.close();
    const completed = await fs.readFile(path.join(output, 'completed-run.json'), 'utf8');
    const ending = await setup(360, 740, { gameState: normalSave, rogueSlot0: completed });
    await ending.page.goto(base + 'index.html?mode=rogue&slot=0');
    await ending.page.getByRole('heading', { name: '星光不再遥远', exact: true }).waitFor();
    await fit(ending.page, 'ship-ending');
    await ending.page.screenshot({ path: path.join(output, 'ending-360-day.png'), fullPage: true });
    const beforeAbyss = await ending.page.evaluate(() => JSON.stringify({ party: Rogue.state.current.party, stores: Rogue.stores(Rogue.state.current) }));
    await ending.page.getByRole('button', { name: '进入深渊', exact: true }).click();
    assert.equal(await ending.page.evaluate(() => Rogue.state.current.flags.abyss), true);
    await fit(ending.page, 'abyss-map');
    await ending.page.screenshot({ path: path.join(output, 'abyss-360-day.png') });
    await ending.page.reload();
    await ending.page.waitForFunction(() => Rogue.state.current && Rogue.state.current.flags.abyss);
    await ending.page.locator('#rogue-tab-camp').click();
    await ending.page.getByRole('button', { name: '撤离地牢', exact: true }).click();
    await ending.page.getByRole('heading', { name: '星光不再遥远', exact: true }).waitFor();
    assert.equal(await ending.page.evaluate(() => JSON.stringify({ party: Rogue.state.current.party, stores: Rogue.stores(Rogue.state.current) })), beforeAbyss);
    assert.equal(await ending.page.evaluate(() => localStorage.gameState), normalSave);
    mark('real completed-run fixture renders its ship ending, enters and reloads the abyss, then returns without inventory or economic changes');
    await ending.context.close();
    const layouts = [[320, 512], [360, 740], [412, 915], [740, 360], [1440, 900]];
    for (const [width, height] of layouts) {
        for (const dark of [false, true]) for (const font of [16, 22]) {
            const layout = await setup(width, height, { gameState: normalSave, roguePreferences: JSON.stringify({ dark, font }) });
            await create(layout.page);
            const tag = width + 'x' + height + (dark ? '-night' : '-day') + '-font' + font;
            for (const tab of ['map', 'camp', 'party']) {
                await layout.page.locator('#rogue-tab-' + tab).evaluate(node => node.click());
                await fit(layout.page, tag + '-' + tab);
                assert.equal(await layout.page.locator('.rogue-layout > .rogue-panel:visible').count(), 1, 'only the selected location should be visible');
                await layout.page.screenshot({ path: path.join(output, tag + '-' + tab + '.png'), fullPage: true });
            }
            const layoutTurn = await layout.page.evaluate(() => Rogue.state.current.turn);
            await layout.page.locator('#rogue-tab-camp').evaluate(node => node.click());
            for (const view of ['stores', 'supplies', 'workers', 'buildings', 'recipes', 'research', 'expansion']) {
                await layout.page.locator('[data-focus="camp-view:' + view + '"]').click();
                await fit(layout.page, tag + '-' + view);
                assert.equal(await layout.page.locator('.rogue-camp-inline-back:visible').count(), 0, 'return controls must not be duplicated');
                if (['buildings', 'recipes', 'research'].includes(view)) {
                    const work = await layout.page.locator('.rogue-camp-workbench').boundingBox();
                    const ledger = await layout.page.locator('.rogue-camp-ledger').boundingBox();
                    if (width < 680) { assert(ledger.y + ledger.height <= work.y, tag + '-' + view + ' puts resources above full-width work'); }
                    else { assert(work.x + work.width < ledger.x, tag + '-' + view + ' keeps inventory beside work'); }
                    const rows = await layout.page.locator('.rogue-priced').evaluateAll(nodes => nodes.map(node => {
                        const title = node.querySelector('.rogue-row-title');
                        const control = node.querySelector(':scope > button');
                        const style = getComputedStyle(control);
                        return { label: control.textContent, title: title.textContent, top: title.getBoundingClientRect().top, buttonTop: control.getBoundingClientRect().top, size: parseFloat(style.fontSize) };
                    }));
                    for (const row of rows) { assert(row.label.includes(row.title)); assert(row.buttonTop > row.top); assert(row.size >= font); }
                }
                if (view === 'recipes') {
                    for (const filter of ['armour', 'tools', 'consume', 'modules', 'weapons']) {
                        await layout.page.locator('[data-focus="filter:' + filter + '"]').click();
                        await fit(layout.page, tag + '-recipes-' + filter);
                    }
                }
                if (view === 'research' || view === 'buildings') {
                    const next = layout.page.getByRole('button', { name: '下一页', exact: true });
                    let count = 0;
                    while (await next.count() && await next.isEnabled()) {
                        assert(count++ < 15, 'pagination should terminate'); await next.click(); await fit(layout.page, tag + '-' + view + '-' + count);
                    }
                    await layout.page.screenshot({ path: path.join(output, tag + '-' + view + '.png'), fullPage: true });
                }
                await layout.page.locator('[data-focus="camp-return"]').click();
            }
            assert.equal(await layout.page.evaluate(() => Rogue.state.current.turn), layoutTurn);
            await layout.page.locator('#rogue-tab-map').evaluate(node => node.click());
            await layout.page.locator('[data-focus="journal-toggle"]').click(); await fit(layout.page, tag + '-journal');
            await layout.page.locator('[data-focus="journal-collapse"]').click();
            await layout.page.locator('#rogue-menu').click(); await fit(layout.page, tag + '-menu');
            await layout.page.locator('.rogue-dialog-footer [data-focus="closeModal:"]').click();
            await layout.page.evaluate(() => { Rogue.combat.encounter(Rogue.state.current, { kind: 'wild' }); Rogue.ui.render(); });
            await fit(layout.page, tag + '-combat');
            const combatBounds = await layout.page.evaluate(() => {
                const status = document.querySelector('.rogue-combat-party').getBoundingClientRect();
                const content = document.querySelector('.rogue-combat-dialog .rogue-dialog-content').getBoundingClientRect();
                const actions = document.querySelector('.rogue-combat-actions').getBoundingClientRect();
                const attack = document.querySelector('[data-focus="combat:attack"]');
                const hit = document.elementFromPoint(status.x + status.width / 2, status.y + status.height / 2);
                return { status: status.toJSON(), content: content.toJSON(), actions: actions.toJSON(), visible: !!hit && document.querySelector('.rogue-combat-party').contains(hit), primary: attack.getAttribute('data-variant') };
            });
            assert(combatBounds.visible && combatBounds.status.bottom <= combatBounds.content.top, tag + ' keeps own health above scrollable combat content');
            assert(combatBounds.content.height >= 44 && combatBounds.content.bottom <= combatBounds.actions.top + 1, tag + ' leaves a usable scroll area above actions');
            assert.equal(combatBounds.primary, 'primary');
            await layout.page.screenshot({ path: path.join(output, tag + '-combat.png') });
            await layout.context.close();
        }
    }
    mark('twenty phone/landscape/desktop day/night and 16/22px layouts cover every camp subpage, recipe category, research page, journal and combat with 44px controls and complete translations');
    if (process.argv.includes('--soak')) {
        const soak = await setup(360, 740, { gameState: normalSave, 'adr.saveSlots.v1': normalDatabase });
        await create(soak.page);
        await soak.page.locator('#rogue-tab-camp').click();
        const started = Date.now();
        let actions = 0;
        while (Date.now() - started < 600000) {
            await soak.page.getByRole('button', { name: '收集周围物资', exact: true }).click();
            actions++;
            assert.equal(await soak.page.evaluate(() => localStorage.gameState), normalSave);
            assert.equal(await soak.page.evaluate(() => localStorage.getItem('adr.saveSlots.v1')), normalDatabase);
            if (actions % 60 === 0) console.log('SOAK ' + Math.round((Date.now() - started) / 1000) + 's / ' + actions + ' actions');
            await soak.page.waitForTimeout(1000);
        }
        await soak.page.reload();
        await soak.page.waitForFunction(() => Rogue.state.current);
        await exitHome(soak.page);
        await soak.page.waitForURL(base + 'home.html');
        assert.equal(await soak.page.evaluate(() => localStorage.gameState), normalSave);
        assert.equal(await soak.page.evaluate(() => localStorage.getItem('adr.saveSlots.v1')), normalDatabase);
        mark('T4: ten real minutes of Rogue actions, refresh and return-home preserve exact normal save and database bytes (' + actions + ' actions)');
        await soak.context.close();
    }
    assert.deepEqual(errors, []); assert.deepEqual(warnings, []); assert.deepEqual(missing, []); assert.deepEqual(remote, []);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ passed: true, checks, errors, warnings, missing, remote }, null, 2));
    console.log(JSON.stringify({ passed: true, checks: checks.length }));
} finally { await browser.close(); }
