import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve('.local/rogue-tests/explore-redesign');
fs.mkdirSync(output, { recursive: true });
const stored = new Map();
const model = vm.createContext({ window: {}, Uint8Array, btoa, atob, localStorage: { getItem: key => stored.get(key) || null, setItem: (key, value) => stored.set(key, value), removeItem: key => stored.delete(key) } });
for (const file of ['rogue.num.js', 'content/themes.js', 'content/sites.js', 'content/enemies.js', 'content/items.js', 'content/names.js', 'lang/zh.js', 'rogue.state.js', 'rogue.worldgen.js', 'rogue.map.js', 'rogue.party.js', 'rogue.wild.js', 'rogue.outpost.js', 'rogue.settle.js', 'rogue.combat.js', 'rogue.dungeon.js', 'rogue.save.js']) {
    vm.runInContext(fs.readFileSync('script/rogue/' + file, 'utf8'), model, { filename: file });
}
const game = model.window.Rogue;
const sample = game.state.create({ seed: 42, slot: 0, createdAt: 1 });
game.state.current = sample;
Object.assign(game.stores(sample), { food: 5000, water: 5000 });
sample.turn = 49; sample.day = 0;
assert(game.state.act({ type: 'wait' }));
assert.equal(sample.flags.log.findLast(entry => entry.key === 'log.action.wait').turn, 50);
assert(game.state.act({ type: 'night' }));
const night = sample.flags.log.findLast(entry => entry.key === 'log.night');
assert.equal(night.turn, sample.turn); assert.equal(night.duration, game.NUM.NIGHT_TURNS[sample.speed]);
for (let index = 0; index < 260; index++) { sample.turn++; game.log(sample, 'log.move', { direction: game.t('ui.north'), n: 1 }); }
sample.day = Math.floor(sample.turn / game.NUM.TURNS_PER_DAY);
assert.equal(sample.flags.log.filter(entry => entry.key === 'log.move').length, 260);
assert(sample.flags.log.every((entry, index, entries) => !index || entries[index - 1].turn <= entry.turn));
assert(game.save.write(sample));
assert.equal(game.save.load(0).flags.log.length, sample.flags.log.length);
assert(!sample.flags.log.some(entry => game.t(entry.key, entry.values).includes('!!')));
Object.assign(sample.party.bag, { wood: 3, stone: 2, fur: 4, medicine: 1, spear: 1, water: 3, food: 2 });
assert(game.save.validate(sample));
const fixture = JSON.stringify(sample);
const normal = ' {"ordinary":"unchanged"} \n';
const database = ' {"slots":"unchanged"} ';
const assets = path.resolve('android/app/src/main/assets/game');
const hashes = {};
for (const file of ['script/rogue/rogue.ui.js', 'script/rogue/rogue.state.js', 'script/rogue/rogue.num.js', 'script/rogue/lang/zh.js', 'css/rogue.css']) {
    const source = fs.readFileSync(file);
    assert.equal(fs.readFileSync(path.join(assets, file)).toString().replace(/\r\n/g, '\n'), source.toString().replace(/\r\n/g, '\n'), 'generated asset matches source: ' + file);
    hashes[file] = createHash('sha256').update(source).digest('hex');
}
const base = 'https://appassets.androidplatform.net/game/';
const errors = [], warnings = [], missing = [], remote = [];
const browser = await chromium.launch({ headless: true });
async function tap(locator) {
    await locator.evaluate(node => node.scrollIntoView({ block: 'center' }));
    await locator.click();
}
async function inspect(page) {
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished.catch(() => {}))));
    return page.evaluate(() => {
        const failures = [];
        if (document.documentElement.scrollWidth > innerWidth) failures.push('horizontal overflow');
        if (document.body.innerText.includes('!!')) failures.push('missing translation');
        for (const button of document.querySelectorAll('#rogue-root button')) {
            if (!button.getClientRects().length || button.closest('[aria-hidden="true"]')) continue;
            const box = button.getBoundingClientRect();
            if (box.width < 43.9 || box.height < 43.9) failures.push('small touch target:' + button.textContent);
        }
        return failures;
    });
}
let layouts = 0;
try {
    for (const [width, height] of [[320, 512], [360, 740], [412, 915], [740, 360], [1440, 900]]) {
        for (const dark of [false, true]) for (const font of [16, 22]) {
            const session = await browser.newContext({ viewport: { width, height }, isMobile: width < 1100, hasTouch: true, offline: true });
            await session.addInitScript(({ fixture, normal, database, dark, font }) => {
                if (sessionStorage.getItem('redesign')) return;
                sessionStorage.setItem('redesign', '1'); localStorage.setItem('rogueSlot0', fixture);
                localStorage.setItem('gameState', normal); localStorage.setItem('adr.saveSlots.v1', database);
                localStorage.setItem('roguePreferences', JSON.stringify({ dark, font }));
            }, { fixture, normal, database, dark, font });
            await session.route('**/*', async route => {
                const url = route.request().url();
                if (!url.startsWith(base)) { remote.push(url); await route.abort(); return; }
                const file = path.resolve(assets, decodeURIComponent(new URL(url).pathname.slice(6)));
                assert(file.startsWith(assets + path.sep));
                try { await route.fulfill({ body: fs.readFileSync(file), contentType: ({ '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.ico': 'image/x-icon' })[path.extname(file)] || 'application/octet-stream' }); }
                catch { missing.push(file); await route.fulfill({ status: 404, body: '' }); }
            });
            const page = await session.newPage(); page.setDefaultTimeout(7000);
            page.on('pageerror', error => errors.push(error.message));
            page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); if (message.type() === 'warning') warnings.push(message.text()); });
            await page.goto(base + 'index.html?mode=rogue&slot=0'); await page.waitForFunction(() => window.Rogue?.state.current);
            const tag = `${width}x${height}-${dark ? 'dark' : 'light'}-${font}`;
            assert.deepEqual(await inspect(page), [], tag);
            assert.equal(await page.evaluate(() => document.documentElement.classList.contains('rogue-dark')), dark);
            assert.equal(await page.evaluate(() => Rogue.ui.preferences.font), font);
            assert.equal(await page.locator('.rogue-scene-tabs,.rogue-explore-shortcuts,#rogue-explore-preview').count(), 0);
            assert.equal(await page.locator('#rogue-back').isVisible(), false);
            assert.equal(await page.locator('.rogue-explore-pack [data-item="water"],.rogue-explore-pack [data-item="food"]').count(), 0);
            const pack = await page.locator('.rogue-explore-pack').evaluate(node => ({ columns: getComputedStyle(node).gridTemplateColumns.split(' ').length, items: [...node.children].map(item => [item.dataset.item, item.querySelector('strong')?.textContent]) }));
            assert.equal(pack.columns, 3); assert(pack.items.some(([id, quantity]) => id === 'wood' && quantity === '3'));
            const symbols = await page.evaluate(() => ({ map: [...new Set([...document.querySelectorAll('.rogue-grid span')].map(node => node.textContent))].sort(), legend: [...document.querySelectorAll('.rogue-local-symbol')].map(node => node.dataset.symbol).sort() }));
            assert.deepEqual(symbols.legend, symbols.map);
            const list = page.locator('#rogue-live-log .rogue-action-journal');
            assert.equal(await list.locator('li').count(), 100);
            const before = await page.evaluate(() => JSON.stringify(Rogue.state.current));
            const listHeight = await list.evaluate(node => node.clientHeight);
            assert(Math.abs(listHeight - Math.min(160, Math.max(72, height * .18))) <= 1);
            await list.evaluate(node => { node.scrollTop = 0; });
            await page.waitForFunction(() => document.querySelector('#rogue-live-log .rogue-action-journal').children.length >= 200).catch(async error => {
                console.log(await list.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight, count: node.children.length, start: node._journalRead.start })));
                await page.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }); throw error;
            });
            const readTop = await list.evaluate(node => node.scrollTop);
            await page.locator('[data-focus="journal-toggle"]').click();
            const fullscreen = page.locator('.rogue-journal-fullscreen');
            const box = await fullscreen.boundingBox(); assert.equal(box.height, height); assert.equal(box.width, width);
            for (let tab = 0; tab < 4; tab++) {
                await page.keyboard.press('Tab');
                assert(await page.evaluate(() => !!document.activeElement.closest('.rogue-journal-fullscreen')));
            }
            await page.keyboard.press('ArrowUp');
            assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
            assert.deepEqual(await inspect(page), [], tag + '-fullscreen');
            if (width === 412 && !dark && font === 16) {
                const history = fullscreen.locator('.rogue-action-journal');
                const oldOffset = await history.evaluate(node => node.scrollTop);
                const touch = await session.newCDPSession(page);
                await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 210, y: 300 }] });
                for (let step = 1; step <= 8; step++) {
                    await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 210, y: 300 + step * 20 }] });
                    await page.waitForTimeout(20);
                }
                await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                await page.waitForFunction(offset => document.querySelector('.rogue-journal-fullscreen .rogue-action-journal').scrollTop < offset - 40, oldOffset);
                await touch.detach();
            }
            if (width === 412 && font === 16) await page.screenshot({ path: path.join(output, tag + '-journal.png') });
            await page.locator('[data-focus="journal-collapse"]').click();
            assert(Math.abs(await list.evaluate(node => node.scrollTop) - readTop) < 2);
            await page.locator('[data-focus="journal-toggle"]').click(); await page.keyboard.press('Escape');
            assert.equal(await page.getByRole('dialog').count(), 0);
            assert.equal(await page.evaluate(() => JSON.stringify(Rogue.state.current)), before);
            const readingOffset = await list.evaluate(node => node.scrollTop);
            await tap(page.locator('.rogue-dpad-center'));
            assert(Math.abs(await list.evaluate(node => node.scrollTop) - readingOffset) < 2, 'new actions preserve history reading');
            await list.evaluate(node => { node.scrollTop = node.scrollHeight; });
            await page.waitForFunction(() => document.querySelector('#rogue-live-log .rogue-action-journal')._journalRead.follow);
            await tap(page.locator('.rogue-dpad-center'));
            assert(await list.evaluate(node => node.scrollHeight - node.clientHeight - node.scrollTop < 2), 'latest logs follow new actions');
            await tap(page.locator('.rogue-north'));
            await page.keyboard.press('Escape');
            if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
            assert.deepEqual(await inspect(page), [], tag + '-movement');
            await page.locator('#rogue-tab-camp').click(); assert(await page.locator('#rogue-back').isVisible());
            await page.locator('#rogue-tab-party').click(); assert(await page.locator('#rogue-back').isVisible());
            await page.locator('#rogue-tab-map').click();
            assert.equal(await page.evaluate(() => localStorage.gameState), normal);
            assert.equal(await page.evaluate(() => localStorage.getItem('adr.saveSlots.v1')), database);
            await page.evaluate(() => window.scrollTo(0, 0));
            if (font === 16) await page.screenshot({ path: path.join(output, tag + '.png'), fullPage: true });
            if (width === 412 && dark && font === 16) {
                await page.setViewportSize({ width, height: 1100 });
                await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
                await page.screenshot({ path: path.join(output, 'preview-dark.png') });
                await page.setViewportSize({ width, height });
            }
            const count = await page.evaluate(() => Rogue.state.current.flags.log.length);
            await page.reload(); await page.waitForFunction(() => window.Rogue?.state.current);
            assert.equal(await page.evaluate(() => Rogue.state.current.flags.log.length), count);
            assert(count > 260); layouts++; await session.close();
            console.log('PASS', tag);
        }
    }
    assert.deepEqual({ errors, warnings, missing, remote }, { errors: [], warnings: [], missing: [], remote: [] });
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ passed: true, layouts, model: 'cross-day timestamps, multi-turn duration, unmerged full history, persistence', hashes, errors, warnings, missing, remote }, null, 2));
    console.log('PASS exploration redesign: 20 layouts, fullscreen journal, lazy history, save isolation and model chronology');
} finally { await browser.close(); }
