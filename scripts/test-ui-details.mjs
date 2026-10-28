// Costs before purchase, functional workforce allocation, centered events and theme controls.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
for (const candidate of [process.env.PLAYWRIGHT_MODULE, 'playwright', path.join(root,'../kubi/node_modules/playwright')].filter(Boolean)) {
  try { playwright = require(candidate); break; } catch {}
}
assert(playwright, 'Playwright is required');
const output = path.join(root,'.local/ui-details');
await fs.mkdir(output,{recursive:true});
const browser = await playwright.chromium.launch({headless:true});
const checks=[], scenarios=[], errors=[], remote=[];
async function settle(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function geometry(page,label) {
  await settle(page);
  const result = await page.evaluate(() => {
    const overlaps = (a,b) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>.5 && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>.5;
    const visible = n => n.getBoundingClientRect().width>0 && n.getBoundingClientRect().height>0;
    const failures=[];
    for(const row of document.querySelectorAll('#workers .workerRow')) {
      if(!visible(row)) continue;
      const nodes = [row.querySelector('.row_key'),row.querySelector('.row_val > span'),...row.querySelectorAll('[role="button"]'),row.querySelector('.offline-worker-income')].filter(n=>n&&visible(n));
      for(let i=0;i<nodes.length;i++) {
        const a=nodes[i].getBoundingClientRect();
        if(a.left<19 || a.right>innerWidth-19) failures.push(row.id+':offscreen');
        for(let j=i+1;j<nodes.length;j++) if(overlaps(a,nodes[j].getBoundingClientRect())) failures.push(row.id+':overlap');
      }
    }
    for(const card of document.querySelectorAll('.offline-cost-card')) {
      if(!visible(card))continue;
      const r=card.getBoundingClientRect();
      for(const row of card.querySelectorAll('.offline-cost-row')) {
        for(const n of row.children) {
          const b=n.getBoundingClientRect();
          if(b.left<r.left || b.right>r.right || n.scrollWidth>n.clientWidth+1) failures.push(card.querySelector('.button').id+':clipped-cost');
        }
      }
    }
    return {width:innerWidth,font:localStorage.offlineFontSize,night:document.body.classList.contains('offline-dark'),overflow:document.documentElement.scrollWidth>innerWidth,failures};
  });
  assert(!result.overflow,label+':page overflow');
  assert.deepEqual(result.failures,[],label);
  scenarios.push({label,...result});
}
try {
  for(const [width,height,font] of [[320,512,16],[320,512,22],[360,740,16],[412,915,22]]) {
    const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,offline:true});
    await context.addInitScript(font=>{localStorage.offlineFontSize=String(font);},font);
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.origin!=='https://appassets.androidplatform.net'||!url.pathname.startsWith('/game/')) {remote.push(url.href);await route.abort();return;}
      const file=path.join(root,'android/app/src/main/assets',decodeURIComponent(url.pathname));
      await route.fulfill({body:await fs.readFile(file),contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.flac':'audio/flac','.png':'image/png'})[path.extname(file)]||'application/octet-stream'});
    });
    const page=await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto('https://appassets.androidplatform.net/game/index.html');
    await page.waitForFunction(()=>window.OfflineGame&&Engine.activeModule===Room);
    await page.evaluate(()=>{
      $.fx.off=true;$SM.set('playStats.audioAlertShown',true);
      $SM.set('game.builder.level',4);$SM.set('game.fire',Room.FireEnum.Roaring);$SM.set('game.temperature',Room.TempEnum.Hot);
      $SM.setM('stores',{wood:134,fur:10,meat:5});
      if(!Outside.panel) Outside.init();
      $SM.set('game.buildings.hut',1);Room.updateBuildButtons();
    });
    await settle(page);
    const hut=page.locator('#build_hut');
    const cost=()=>hut.locator('..').locator('.offline-costs').innerText();
    assert.match(await cost(),/木头\s*150\s*还缺\s*16/,'Required wood and shortfall visible before tapping');
    assert.equal(await page.evaluate(()=>$SM.get('stores.wood')),134,'Rendering materials does not spend wood');
    await page.evaluate(()=>$SM.add('stores.wood',100));
    await settle(page);
    assert(!/还缺/.test(await cost()),'Shortfall updates when resources arrive');
    await hut.tap();
    await page.waitForFunction(()=>$SM.get('game.buildings.hut')===2);
    assert.equal(await page.evaluate(()=>$SM.get('stores.wood')),84,'Actual build spends the displayed cost');
    await settle(page);
    assert.match(await cost(),/木头\s*200\s*还缺\s*116/,'Next building cost updates after purchase');
    await page.evaluate(()=>$SM.setM('stores',{wood:134,fur:2,meat:2}));
    await settle(page);
    const lodge=page.locator('#build_lodge').locator('..').locator('.offline-costs');
    assert.match(await lodge.innerText(),/木头\s*200\s*还缺\s*66/);
    assert.match(await lodge.innerText(),/毛皮\s*10\s*还缺\s*8/);
    assert.match(await lodge.innerText(),/肉\s*5\s*还缺\s*3/);
    await geometry(page,'room-materials-day');
    await page.evaluate(()=>Engine.turnLightsOff());await settle(page);
    await geometry(page,'room-materials-night');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:path.join(output,`materials-night-${width}-font${font}.png`)});

    await page.evaluate(()=>{
      $SM.setM('stores',{wood:1000,fur:100,meat:100});
      $SM.setM('game.buildings',{hut:20,lodge:1,tannery:1,smokehouse:1,steelworks:1,armoury:1});
      $SM.set('game.population',30);Outside.updateVillage();Outside.updateWorkersView();Engine.travelTo(Outside);
    });
    await settle(page);
    const hunter=page.locator('#workers_row_hunter');
    await hunter.locator('.upBtn').tap();
    assert.equal(await page.evaluate(()=>$SM.get('game.workers.hunter')),1);
    await page.locator('#offline-worker-steps [data-step="10"]').tap();await settle(page);
    await hunter.locator('.upManyBtn').tap();
    assert.equal(await page.evaluate(()=>$SM.get('game.workers.hunter')),11);
    await settle(page);
    assert.match(await hunter.locator('.offline-worker-income').innerText(),/毛皮 \+5.5.*肉 \+5.5/,'Total job income updates with allocation');
    await hunter.locator('.dnManyBtn').tap();
    assert.equal(await page.evaluate(()=>$SM.get('game.workers.hunter')),1);
    await page.locator('#offline-worker-steps [data-step="1"]').tap();await settle(page);
    await hunter.locator('.upBtn').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>$SM.get('game.workers.hunter')),2,'Keyboard activation allocates exactly one');
    await settle(page);
    assert.equal(await page.locator('#offline-workforce-total').innerText(),'30');
    assert.equal(await page.locator('#offline-workforce-assigned').innerText(),'2');
    assert.equal(await page.locator('#offline-workforce-gatherers').innerText(),'28');
    await geometry(page,'workers-one-person-night');
    await page.locator('#offline-workers-panel').screenshot({path:path.join(output,`workers-night-${width}-font${font}.png`)});
    await page.locator('#offline-worker-steps [data-step="10"]').tap();await settle(page);
    await hunter.locator('.upManyBtn').tap();await hunter.locator('.upManyBtn').tap();await hunter.locator('.upManyBtn').tap();
    assert.equal(await page.evaluate(()=>Outside.getNumGatherers()),0,'Batch allocation clamps at available population');
    assert.equal(await page.evaluate(()=>$SM.get('game.workers.hunter')),30);
    await settle(page);
    assert.equal(await hunter.locator('.upManyBtn').getAttribute('aria-disabled'),'true');
    await geometry(page,'workers-ten-people-night');
    await page.reload();await page.waitForFunction(()=>window.OfflineGame&&Engine.activeModule===Room);
    await page.evaluate(()=>{ $.fx.off=true; Engine.travelTo(Outside); });await settle(page);
    assert.equal(await page.locator('#offline-worker-steps [data-step="10"]').getAttribute('aria-pressed'),'true','Step survives reload');
    await hunter.locator('.dnManyBtn').tap();
    assert.equal(await page.evaluate(()=>$SM.get('game.workers.hunter')),20,'Restored job controls remain usable');
    await page.evaluate(()=>Engine.turnLightsOff());await settle(page);
    await geometry(page,'workers-day');

    for(const night of [false,true]) {
      if(night) await page.evaluate(()=>Engine.turnLightsOff());
      await settle(page);
      await page.locator('#offline-menu-button').tap();
      await page.locator('#offline-cheat-enable').check();
      await page.locator('#offline-cheat-cooldown').check();
      const styles=await page.evaluate(()=>{
        const selected=document.querySelector('#offline-speed-controls [aria-pressed="true"]');
        const mark=document.querySelector('#offline-cheat-enable + .offline-check');
        const css=getComputedStyle(mark),tick=getComputedStyle(mark,'::after'),button=getComputedStyle(selected);
        return {fill:css.backgroundColor,tick:tick.borderRightColor,appearance: getComputedStyle(document.querySelector('#offline-cheat-enable')).opacity,selected:button.backgroundColor,selectedInk:button.color};
      });
      assert.equal(styles.appearance,'0','Native checkboxes cannot paint their default white control');
      assert.notEqual(styles.fill,styles.tick,'Check mark must contrast with its fill');
      if(night) assert.deepEqual(styles,{fill:'rgb(66, 68, 59)',tick:'rgb(238, 238, 238)',appearance:'0',selected:'rgb(66, 68, 59)',selectedInk:'rgb(238, 238, 238)'});
      await page.locator('#offline-cheat-enable').scrollIntoViewIfNeeded();
      await page.screenshot({path:path.join(output,`menu-${night?'night':'day'}-${width}-font${font}.png`)});
      await page.locator('#offline-menu-close').tap();
      await page.evaluate(()=>Events.startEvent({title:'损毁的陷阱',scenes:{start:{text:['一些陷阱损毁了','巨大的足印延伸至森林'],buttons:{ignore:{text:'忽略',nextScene:'end'}}}}}));
      await settle(page);
      const bounds=await page.locator('#event').boundingBox();
      assert(Math.abs(bounds.x+bounds.width/2-width/2)<1&&Math.abs(bounds.y+bounds.height/2-height/2)<1,'Story event is centered in both axes');
      await page.screenshot({path:path.join(output,`event-${night?'night':'day'}-${width}-font${font}.png`)});
      await page.locator('#event #ignore').tap();await page.waitForFunction(()=>!Events.activeEvent());
      await page.locator('#offline-messages-button').tap();
      const messages=await page.locator('#offline-messages-panel').boundingBox();
      assert(Math.abs(messages.x+messages.width/2-width/2)<1&&Math.abs(messages.y+messages.height/2-height/2)<1,'Message history is centered');
      await page.locator('#offline-messages-close').tap();
    }
    if(width===360) {
      await page.evaluate(()=>{if(!Ship.panel)Ship.init();$SM.set('stores["alien alloy"]',0);Engine.travelTo(Ship);});await settle(page);
      assert.match(await page.locator('#engineButton').locator('..').innerText(),/外星合金\s*1\s*还缺\s*1/,'Ship upgrade material displayed');
      await page.evaluate(()=>{if(!Fabricator.panel)Fabricator.init();Engine.travelTo(Fabricator);});await settle(page);
      assert(await page.locator('#fabricateButtons .offline-costs').count()>0,'Fabricator materials displayed');
      await geometry(page,'fabricator-costs');
    }
    checks.push({width,height,font,passed:true});
    await context.close();
  }
  assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify({passed:true,checks,scenarios,errors,remote},null,2));
  console.log(JSON.stringify({passed:true,checks,scenarios:scenarios.length}));
} finally {await browser.close();}
