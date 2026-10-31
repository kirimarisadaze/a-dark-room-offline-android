# 探索页重排验收 · 2026-10-30

## 交付状态

本次为本机源码与浏览器验证交付，未提交、推送、递增版本、构建 APK 或发布 Release。根目录原有 Git 索引删除和 code/ 未跟踪状态保持不变，修改前快照在 `.local/explore-redesign-before/`。

探索页按确认方案调整：地图下沿显示当前地形/耗水、可见符号图例、现场操作和 44px 方向键；窄屏和大字时现场操作换行。地图下方三列列出本人非补给物资。移除重复入口，底部保留时间、菜单和可滚动日志；据点与队伍保持原布局。

日志保留完整旅程，逐步记录行动和完成时间，支持跨日、多回合耗时、每批100条加载、触摸滑动、全屏展开/折叠、Esc/Android返回以及焦点环回。v3顶层结构与普通存档保持不变。旧档已删除的历史无法重建。

## 验证结论

- 核心检查：`passed=true`，16 项。
- 探索专项：20 组，覆盖 320×512、360×740、412×915、740×360、1440×900；每组分别验证日夜和 16/22px 字号。另保留412×1100浏览器展示图。
- 专项验证包含三列物资、图例与画面一致、44px控件、无横向溢出、全屏尺寸、背景移动锁定、键盘焦点环回、触摸手势、上滑分批加载、阅读位置保持、新记录跟随、超过120条历史的保存重载与普通存档原始字节隔离。
- 问题回归包含960组紧急撤离，以及补给、返回、隐藏焦点和确认流程；储物、引导、生存、后期、主页、普通模式离线、三存档均通过。
- 本轮真实新局按钮通关：seed 42，4073次行动、4702次点击、74场战斗、13个地牢、9个区域；飞船结局回合4084，通关后抵达深渊第2层，cheat=false。
- 通关存档保留4858条日志，其中3138条移动均为单步，时间顺序检查通过。通关测试与构造夹具的边界测试分别执行。
- 完整按钮通关后补充了日志键盘焦点环回、地牢目标短图例及长图例换行修正；最终资源重新生成，并重跑探索专项、通用UI、问题、核心和储物回归。这些修正未改变行动与存档逻辑。
- 所有本轮浏览器报告均无控制台错误、警告、缺失资源和外网请求；普通模式两个存档键原始字节不变。

未做 Android 真机安装、系统文件选择器或 WebView 80 实机验收。截图为浏览器自动化截图，完整按钮通关不代表真人平衡或设备性能结论。

## 复现与证据

在源码目录执行 `python scripts/prepare-android-assets.py`，再执行下列测试。Playwright使用现有环境，通过 `PLAYWRIGHT_MODULE` 与 `PLAYWRIGHT_BROWSERS_PATH` 指定；游戏没有新增运行依赖。

- 原始输出：`.local/explore-*.log`
- 最终专项报告与源码SHA-256：`.local/rogue-tests/explore-redesign/report.json`
- 通关报告及存档：`.local/rogue-tests/ui-playthrough/report.json`、`completed-run.json`
- 深色预览：`.local/rogue-tests/explore-redesign/preview-dark.png`
- 全屏日志：`.local/rogue-tests/explore-redesign/412x915-dark-16-journal.png`
- 专项测试已核对最终生成资源与源码逐一一致（归一化换行）。

### 最终源码 SHA-256

- `script/rogue/rogue.ui.js`：`f366a571d3df91878a44545bcd4176448f3ddb1935e09f6e0fc35b6d869c365b`
- `script/rogue/rogue.state.js`：`d4055eb7a2bbb642dad286a1e6283061392dfcdfcb4f727b01962f25bf570d8d`
- `script/rogue/rogue.num.js`：`d20d87cee1790c1b91f06b9104a05fcb3c9ba78fc7998977bb7e75e236327014`
- `script/rogue/lang/zh.js`：`931f5cba020bea934c69a13efe7f8f5120653d825a79bcedbe42e6f4eb73ac68`
- `css/rogue.css`：`363b85bc99bdb40e930b7752b48bb1c90089dfcc154766ffffd8031be5143b92`

## 本轮命令尾部输出

### node scripts/test-rogue.mjs

退出码：0。

```text
    "storage quota failure rolls back an already-written slot without throwing"
  ]
}
```

### node scripts/test-rogue-issues.mjs

退出码：0。

```text
PASS camp restock entrances disable real no-ops; exploration has no duplicate restock; camp/party keyboard, hidden focus, backup and two-step exit work
PASS full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
```

### node scripts/test-rogue-storage.mjs

退出码：0。

```text
PASS moving a shelter leaves a visible cache at the original tile without teleporting, duplicating or deleting stored items
PASS expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
```

### node scripts/test-rogue-explore-redesign.mjs

退出码：0。

```text
PASS 1440x900-dark-16
PASS 1440x900-dark-22
PASS exploration redesign: 20 layouts, fullscreen journal, lazy history, save isolation and model chronology
```

### node scripts/test-rogue-ui.mjs

退出码：0。

```text
PASS real completed-run fixture renders its ship ending, enters and reloads the abyss, then returns without inventory or economic changes
PASS twenty phone/landscape/desktop day/night and 16/22px layouts cover every camp subpage, recipe category, research page, journal and combat with 44px controls and complete translations
{"passed":true,"checks":10}
```

### node scripts/test-rogue-storage-ui.mjs

退出码：0。

```text
PASS warehouse uses one direct manifest, clamps requested counts to stock and remaining capacity, selects companion packs and returns to the dashboard without advancing time
PASS remote stores are read-only; shelter supplies survive reload, confirmed dismantling and expiry, remain at the original tile and are picked up without duplication
PASS sixteen day/night layouts cover direct storage, narrow-screen actions, fixed returns and expandable journals across resizing
```

### node scripts/test-rogue-onboarding.mjs

退出码：0。

```text
  "remote": [],
  "missing": []
}
```

### node scripts/test-rogue-survival-ui.mjs

退出码：0。

```text
PASS real controls conserve gear through warehouse and companion transfers, allow dismissal, lock the crafted water skin and persist the warning preference
PASS merchant purchase/reload, displayed escape odds and confirmed/cancelled replacement of the second camp work through real controls
PASS ten phone/landscape/desktop theme layouts cover live logs, member/gear/pack/transfer dialogs and the complete accessible campfire illustration
```

### node scripts/test-rogue-expansion-ui.mjs

退出码：0。

```text
PASS four late-game layouts, nine explored regions, unlocked modules, camp limit, confirmed/cancelled cargo disposal, reload and normal save isolation
```

### node scripts/test-rogue-survival.mjs

退出码：0。

```text
PASS merchant prices and goods persist, high progress guarantees scarce offers, events block movement and rewards cannot be claimed twice
PASS each compound requires three battles and two search stages; reload/withdraw retain progress, claims respect two global camps and inherited buildings cannot yield refund exploits
PASS authentic v2 migration preserves all old terrain, fog, sites and RNG; ordinary save bytes remain unchanged
```

### node scripts/test-home.mjs

退出码：0。

```text
{"passed":true,"checks":9,"layoutScenarios":24}
```

### node scripts/test-offline.mjs

退出码：0。

```text
{"width":360,"height":584,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":195,"top":160.390625,"right":340,"bottom":355.390625,"left":20},"wanderer":{"x":173.9921875,"y":246.390625,"width":12.015625,"height":23,"top":246.390625,"right":186.0078125,"bottom":269.390625,"left":173.9921875},"menu":{"x":0,"y":520,"width":360,"height":64,"top":520,"right":360,"bottom":584,"left":0},"controls":{"x":20,"y":368,"width":320,"height":140,"top":368,"right":340,"bottom":508,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":360,"height":640,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":223,"top":160.390625,"right":340,"bottom":383.390625,"left":20},"wanderer":{"x":173.9921875,"y":260.390625,"width":12.015625,"height":23,"top":260.390625,"right":186.0078125,"bottom":283.390625,"left":173.9921875},"menu":{"x":0,"y":576,"width":360,"height":64,"top":576,"right":360,"bottom":640,"left":0},"controls":{"x":20,"y":396,"width":320,"height":168,"top":396,"right":340,"bottom":564,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":412,"height":915,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":372,"height":498,"top":160.390625,"right":392,"bottom":658.390625,"left":20},"wanderer":{"x":199.9921875,"y":397.890625,"width":12.015625,"height":23,"top":397.890625,"right":212.0078125,"bottom":420.890625,"left":199.9921875},"menu":{"x":0,"y":851,"width":412,"height":64,"top":851,"right":412,"bottom":915,"left":0},"controls":{"x":20,"y":671,"width":372,"height":168,"top":671,"right":392,"bottom":839,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
```

### node scripts/test-save-slots.mjs

退出码：0。

```text
{"passed":true,"checks":14}
```

### node scripts/test-rogue-playthrough-ui.mjs

退出码：0。

```text
  "missing": [],
  "remote": []
}
```

