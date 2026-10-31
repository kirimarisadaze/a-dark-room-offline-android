# 区域页统一双列验收 · 2026-10-31

## 交付与边界

本轮按用户确认的双列方案完成本地源码修改。版本字段仍为 1.3.13 / versionCode 32；未构建 APK、提交、推送或发布。既有 release/1.3.13 APK 的 SHA-256 仍为 `a9cf0836021a5f04f12a77a077408ccd9788dadc6e7977fdf9d2ca735e5404c7`，不包含本轮双列改动。

运行源码只修改 `script/rogue/rogue.ui.js`、`css/rogue.css`、`script/rogue/lang/zh.js`。Android 网页资源通过 `python scripts/prepare-android-assets.py` 生成；三个运行文件与生成资源逐字节一致。没有修改游戏数值、行动结算、普通引擎或存档读写模块。

原有根 Git 删除记录和 code 未跟踪布局保留。修改前备份在 `.local/region-columns-before-20261031/`。本报告与 AI_README.md 记录最新规则，不使用旧发布 checkout 覆盖源码。

## 已实现

- 所有区域地点使用等宽双列。左右分别纵向滚动；右栏是一个连续滚动区域，先库存、后人口派工。顶部主导航、底部日志、时间、返回和菜单保持可见。
- 左栏为操作、建筑、制造、研究四个可同时展开的栏目，默认只展开操作。建筑/制造/研究/派工取消分页，制造保留分类和图纸可见规则。
- 操作栏承载当前位置合法行动、补给、休整、交易和扩建迁移；长补给说明可展开，过夜的回合成本与结束时段常驻。
- 非永久据点的建设栏目展开后说明需回永久据点，无远程建设、制造或研究按钮。下一步引导展开对应栏目和分类并滚动到目标。
- 永久据点及已占领且具有有效所属据点的资源点显示共享仓库，与是否有空闲人口无关。其他地点只显示临时营地或脚下遗留物资，没有独立库存时明确为空。
- 库存仅列数量大于零的物品，名称左对齐、数量右对齐。区域内没有逐项存取按钮和打开仓库入口；队伍/背包存取继续可用，营地和遗留物资也从背包进入。
- 人口、空闲人数、守卫、生产点派工及修路直接显示在右栏；站点现场只调整该站点，守卫只在脚下永久据点调整。道路显示费用和材料不足原因。
- 同地点重绘、切换主页面及弹窗返回保留展开状态、制造分类和两栏滚动位置；移动、进入新地牢层或重新加载旅程重置。界面状态只存内存，不写存档。
- 区域返回直接回探索；弹窗先按原有层级关闭。横向手势切主页面，纵向手势只滚动所在栏，横滑不会误触栏目或行动。
- 短屏采用更紧凑的位置标题行高；错误提示出现时重新测量底栏高度，保持两栏不被覆盖且不丢阅读位置。

## 实际验证

以下 16 个套件在本轮实际执行通过。命令均在 code 目录运行：`node scripts/<脚本名>`。Playwright 使用本机已有安装与 Chromium headless，未新增游戏运行依赖。

| 套件 | 脚本 | 覆盖与结果 |
|---|---|---|
| 核心 | `test-rogue.mjs` | 通过：16 项 |
| 问题回归 | `test-rogue-issues.mjs` | 通过：7 组，含 960 个紧急撤离场景 |
| 储物逻辑 | `test-rogue-storage.mjs` | 通过：5 组 |
| 双列专项 | `test-rogue-region-columns.mjs` | 通过：4 组，20 个尺寸/主题/字号组合及 9 个地点/库存场景 |
| 探索与日志布局 | `test-rogue-explore-redesign.mjs` | 通过：20 个组合 |
| 区域横滑 | `test-rogue-region-swipe.mjs` | 通过：8 组，20 个组合 |
| 通用 UI | `test-rogue-ui.mjs` | 通过：10 组，20 个组合 |
| 新手引导 | `test-rogue-onboarding.mjs` | 通过：引导、补给、旧档及 10 组布局 |
| 储物 UI | `test-rogue-storage-ui.mjs` | 通过：队伍背包入口、存取、遗留物资、16 组布局 |
| 后期 UI | `test-rogue-expansion-ui.mjs` | 通过：4 组后期布局 |
| 生存 UI | `test-rogue-survival-ui.mjs` | 通过：3 组，含 10 组布局 |
| 日志逻辑 | `test-rogue-journal.mjs` | 通过：4 组 |
| 主页 | `test-home.mjs` | 通过：9 组、24 个布局场景 |
| 普通模式离线 | `test-offline.mjs` | 通过：5 组尺寸，含夜间和离线验证 |
| 三存档 | `test-save-slots.mjs` | 通过：14 组 |
| 真实按钮通关 | `test-rogue-playthrough-ui.mjs` | 通过：seed 42，飞船结局及深渊第 2 层 |

双列专项覆盖 320×512、360×740、412×915、740×360、1440×900，分别日夜主题和 16/22px 字号。检查四栏同时展开、末尾按钮可触达、44px 控件、无横向溢出、大库存/大数值、空库存、状态恢复、刷新重置和实际触摸。地点覆盖初始据点、第二据点、可派工资源点、未占领资源点、临时营地、遗留物资、普通野外、地牢及空仓库。附加短横屏大字错误提示场景及真实移动重置。

实际新局通过正常按钮执行：**4175 次行动 / 4853 次点击 / 82 场战斗 / 13 个地牢 / 9 个区域**，飞船结局在第 **4195** 回合，随后进入深渊第 **2** 层。`cheat=false`；规划只读状态，推进均由实际控件完成。自动化耗时 681 秒，不代表真人游玩时长。

普通存档原始字节保持不变；完整按钮通关报告中的错误、警告、资源缺失和外网请求均为 0。独立专项也检查无缺译。未执行 Android 真机安装、系统文件选择器、厂商 WebView 或 WebView 80 真机验收，截图均为浏览器自动化证据。

### 验证顺序与修正

双列、折叠、库存选择、直接派工和取消分页的主实现完成后启动完整按钮通关。其运行期间和结束后的收尾包括补给长说明折叠、道路费用及守卫无障碍名称、空临时库存兼容、错误提示出现时的高度重测和短屏标题行高；没有改变游戏行动逻辑。最终代码重新生成资源并完成双列专项全部四组；通用 UI、探索、横滑、新手引导和储物 UI 在收尾阶段另行回归。不能将完整按钮通关描述为在最后一次样式与空白整理之后重新运行。

开发中修正了旧测试对管理子页、分页、区域仓库入口及整页滚动的依赖；布局测量等待切页动画结束，触达验证选择已展开的控件。额外错误提示测试实际发现 740×360 / 22px 时滚动区不足 44px，缩短位置标题的行高与间距后，定向及最终双列专项通过。重载等待增加初始化判定，避免读取尚未初始化的 Rogue.state。

## 证据与最终源码

- 最终双列报告及截图：`.local/rogue-tests/region-columns/`，其中 `report.json` 含四组验收和最终源码哈希；`camp.png` 是默认据点布局。
- 横滑与探索：`.local/rogue-tests/region-swipe/report.json`、`.local/rogue-tests/explore-redesign/report.json`。
- 真实按钮流程：`.local/rogue-tests/ui-playthrough/report.json`、`completed-run.json`；输出：`.local/region-columns-playthrough.log`。
- 回归结果：`.local/region-columns-final-results.json`、`.local/region-columns-final-ui-results.json`。各套件日志见下节。
- JavaScript 语法检查通过；相对修改前备份的差异空白检查未发现问题。Git 的 LF/CRLF 提示仅说明当前配置，未执行自动换行转换。

| 最终运行文件 | SHA-256 |
|---|---|
| `script/rogue/rogue.ui.js` | `524d71a98c78b05b99e33c49328a917573240e6e2c15f0ccbad78fb000266005` |
| `css/rogue.css` | `1214b1465b8433b8dc3964dabfdb6bc2df4f89cf9921250c6a0064e236aef411` |
| `script/rogue/lang/zh.js` | `9443e7db7246ba2923e42b857a7c392b5fde6dad6d7b9fd0b405ad1e9fc1432d` |

## 各套件输出末尾

以下为本轮实际日志末尾，完整输出在相应文件中。JSON 报告具体断言覆盖见前述套件及机器报告。

### 核心

日志：`.local/region-columns-final-test-rogue.mjs.log`

```text
    "missing translations use the explicit !!key!! marker",
    "storage quota failure rolls back an already-written slot without throwing"
  ]
}
```

### 问题回归

日志：`.local/region-columns-final-test-rogue-issues.mjs.log`

```text
PASS real emergency withdrawal shows injury, defaults to Cancel, cancels without a turn and resumes at HP 1 on the surface after refresh
PASS camp restock entrances disable real no-ops; exploration has no duplicate restock; camp/party keyboard, hidden focus, backup and two-step exit work
PASS full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
```

### 储物逻辑

日志：`.local/region-columns-final-test-rogue-storage.mjs.log`

```text
PASS temporary storage is local, capacity-limited and resumable; materials preserve supplies, tools stay carried and the last worn weapon is safely removed
PASS moving a shelter leaves a visible cache at the original tile without teleporting, duplicating or deleting stored items
PASS expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
```

### 双列专项

日志：`.local/region-columns-final-test-rogue-region-columns.mjs.log`

```text
PASS 20 layouts preserve equal columns, independent scroll, four simultaneous sections, 44px controls, fixed footer and state across redraws and navigation
PASS all local contexts choose actual stock, protect remote construction, allow local worker/road/guard controls and preserve backpack transfers
PASS native vertical drags scroll only the selected column; horizontal drags do not toggle sections or act; region Back returns directly to exploration
PASS a live error resizes the columns without losing reading position or writing saves; native Back and real movement reset region controls
```

### 探索与日志布局

日志：`.local/region-columns-final-test-rogue-explore-redesign.mjs.log`

```text
PASS 1440x900-light-22
PASS 1440x900-dark-16
PASS 1440x900-dark-22
PASS exploration redesign: 20 layouts, inert map, return-water header, action-only grouped journals, lazy history and save isolation
```

### 区域横滑

日志：`.local/region-columns-final-test-rogue-region-swipe.mjs.log`

```text
PASS swiping across a combat action cannot change tabs or trigger an attack
PASS short/cancelled/vertical/multitouch/modal gestures cannot switch or act; horizontal log swipes switch tabs and reduced-motion preference is respected
PASS swiping preserves the region subpage and reading offset; native button taps perform exactly one action
PASS local camp, second camp, resource, occupied site, wilderness and dungeon expose matching actions; remote management rejects without mutation
```

### 通用 UI

日志：`.local/region-columns-final-test-rogue-ui.mjs.log`

```text
PASS damaged run remains intact until explicit deletion; another slot stays playable and isolated
PASS real completed-run fixture renders its ship ending, enters and reloads the abyss, then returns without inventory or economic changes
PASS twenty phone/landscape/desktop day/night and 16/22px layouts cover every camp subpage, recipe category, research page, journal and combat with 44px controls and complete translations
{"passed":true,"checks":10}
```

### 新手引导

日志：`.local/region-columns-final-test-rogue-onboarding.mjs.log`

```text
  "warnings": [],
  "remote": [],
  "missing": []
}
```

### 储物 UI

日志：`.local/region-columns-final-test-rogue-storage-ui.mjs.log`

```text
PASS warehouse uses one direct manifest, clamps requested counts to stock and remaining capacity, selects companion packs and returns to the dashboard without advancing time
PASS remote stores are read-only; shelter supplies survive reload, confirmed dismantling and expiry, remain at the original tile and are picked up without duplication
PASS sixteen day/night layouts cover direct storage, narrow-screen actions, fixed returns and expandable journals across resizing
```

### 后期 UI

日志：`.local/region-columns-final-test-rogue-expansion-ui.mjs.log`

```text
PASS four late-game layouts, nine explored regions, unlocked modules, camp limit, confirmed/cancelled cargo disposal, reload and normal save isolation
```

### 生存 UI

日志：`.local/region-columns-survival-ui.log`

```text
PASS real controls conserve gear through warehouse and companion transfers, allow dismissal, lock the crafted water skin and persist the warning preference
PASS merchant purchase/reload, displayed escape odds and confirmed/cancelled replacement of the second camp work through real controls
PASS ten phone/landscape/desktop theme layouts cover live logs, member/gear/pack/transfer dialogs and the complete accessible campfire illustration
```

### 日志逻辑

日志：`.local/region-columns-journal.log`

```text
PASS successful moves accumulate after settlement; reload preserves historical entries and starts a new saved segment
PASS turns, waits, discoveries, warnings and combat records split groups; invalid movement adds neither steps nor turns
PASS cross-day settlement retains chronological events and multi-turn metadata
PASS old single-step and aggregated logs project without mutation or truncation; ordinary save bytes remain unchanged
```

### 主页

日志：`.local/region-columns-home.log`

```text
{"passed":true,"checks":9,"layoutScenarios":24}
```

### 普通模式离线

日志：`.local/region-columns-offline.log`

```text
{"width":320,"height":568,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":280,"height":179,"top":160.390625,"right":300,"bottom":339.390625,"left":20},"wanderer":{"x":153.9921875,"y":238.390625,"width":12.015625,"height":23,"top":238.390625,"right":166.0078125,"bottom":261.390625,"left":153.9921875},"menu":{"x":0,"y":504,"width":320,"height":64,"top":504,"right":320,"bottom":568,"left":0},"controls":{"x":20,"y":352,"width":280,"height":140,"top":352,"right":300,"bottom":492,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":360,"height":584,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":195,"top":160.390625,"right":340,"bottom":355.390625,"left":20},"wanderer":{"x":173.9921875,"y":246.390625,"width":12.015625,"height":23,"top":246.390625,"right":186.0078125,"bottom":269.390625,"left":173.9921875},"menu":{"x":0,"y":520,"width":360,"height":64,"top":520,"right":360,"bottom":584,"left":0},"controls":{"x":20,"y":368,"width":320,"height":140,"top":368,"right":340,"bottom":508,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":360,"height":640,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":223,"top":160.390625,"right":340,"bottom":383.390625,"left":20},"wanderer":{"x":173.9921875,"y":260.390625,"width":12.015625,"height":23,"top":260.390625,"right":186.0078125,"bottom":283.390625,"left":173.9921875},"menu":{"x":0,"y":576,"width":360,"height":64,"top":576,"right":360,"bottom":640,"left":0},"controls":{"x":20,"y":396,"width":320,"height":168,"top":396,"right":340,"bottom":564,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":412,"height":915,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":372,"height":498,"top":160.390625,"right":392,"bottom":658.390625,"left":20},"wanderer":{"x":199.9921875,"y":397.890625,"width":12.015625,"height":23,"top":397.890625,"right":212.0078125,"bottom":420.890625,"left":199.9921875},"menu":{"x":0,"y":851,"width":412,"height":64,"top":851,"right":412,"bottom":915,"left":0},"controls":{"x":20,"y":671,"width":372,"height":168,"top":671,"right":392,"bottom":839,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
```

### 三存档

日志：`.local/region-columns-slots.log`

```text
{"passed":true,"checks":14}
```

### 真实按钮通关

日志：`.local/region-columns-playthrough.log`

```text
  "warnings": [],
  "missing": [],
  "remote": []
}
```
