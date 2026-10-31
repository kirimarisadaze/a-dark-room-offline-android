# 地图移动与旅途见闻简化验收

日期：2026-10-31（Asia/Shanghai）。本次交付为本地源码与浏览器验证，版本仍为 1.3.12 / 31，未构建 APK、提交、推送或发布。

## 已实现

- 地图点击不选点、不改变状态，不再出现目的地、距离及沿路前往区。删除返回据点、返回临时营地、世界地图出口自动赶路和相关执行分支；附近地点改为只读信息。
- 地面及地牢通过屏幕方向键或键盘方向键 / WASD 移动；跨区也由方向键触发，区域页出口显示提示。进入地牢、深入、撤离等现场交互保留。
- 探索、区域、队伍和全部记录隐藏日期、回合与耗时，只显示行动及事件；底栏时间保留。
- 相邻同向有效移动显示为“向北行进3步”，其他事件和行动分段。日志合并发生在行动结算、事件排序和补给提醒之后，不影响原有按日志数量判断行动是否已记录的逻辑。
- 新创建的移动记录通过内存 WeakSet 标识，仅合并当前会话新增记录，累计完成回合取最后一步。读档后的既有条目不被合并改写；展示使用独立分组结果，旧存档单步日志也能连续显示。保持 v3 和原 flags.log 格式。
- 日志以分组后的条目分页，保留阅读位置、自动跟随和全屏返回。探索正序，区域 / 队伍及其全部记录沿用原有倒序。
- 回营需水及含备用水量移至地图框顶部左侧独立一行，正常流布局并允许换行；保留缺水强调、未知道路和据点 / 深渊的原显示条件，队伍页原提示保留。

主要运行文件：script/rogue/rogue.ui.js、rogue.state.js、rogue.num.js、lang/zh.js、css/rogue.css。
测试修改：test-rogue-explore-redesign.mjs、test-rogue-region-swipe.mjs、test-rogue-ui.mjs；新增 test-rogue-journal.mjs。
维护说明已同步 AI_README.md。未改普通模式引擎、Rogue 地图行动与存档读写模块、版本清单或 Java 入口；与本地正式发布 checkout 的对应文件规范化换行后相同。

## 本次验证

先执行 `python scripts/prepare-android-assets.py`，输出 171 个本地资源；五个变更运行文件与生成资源逐字节一致。使用既有 Node.js、Playwright 和本地 Chromium，未新增运行依赖。

| 命令（在 code 下执行） | 本次结果 |
| --- | --- |
| node scripts/test-rogue.mjs | 16 项通过，含 10,000 种子世界、确定性、坏档、普通存档隔离 |
| node scripts/test-rogue-issues.mjs | 7 组通过，含 960 个紧急撤离场景 |
| node scripts/test-rogue-storage.mjs | 5 组通过 |
| node scripts/test-rogue-journal.mjs | 4 组通过：结算后累计、读档隔离、事件分段、跨日、历史投影 |
| node scripts/test-rogue-explore-redesign.mjs | 20 组布局及地图、日志、水量、键盘、方向键触达验证通过 |
| node scripts/test-rogue-region-swipe.mjs | 8 组通过，包含 20 组尺寸 / 主题 / 字号组合 |
| node scripts/test-rogue-ui.mjs | 10 组通过，包含 20 组通用布局 |
| node scripts/test-rogue-onboarding.mjs | 8 组通过，含水量未知 / 已知、告警开关与 1,000 种子审计 |
| node scripts/test-home.mjs | 9 项、24 个布局场景通过 |
| node scripts/test-offline.mjs | 5 种屏幕尺寸通过，普通模式实际操作、暂停恢复与离线资源检查 |
| node scripts/test-save-slots.mjs | 14 项通过 |
| node scripts/test-rogue-playthrough-ui.mjs | seed 42 真实新局完整按钮流程通过 |

布局组合为 320×512、360×740、412×915、740×360、1440×900，分别测试日夜主题与 16 / 22px 字号。专项检查地图点击前后状态和存档不变、无自动赶路控件、日志日期 / 回合 / 耗时消失、125 步历史移动完整分组、每批 100 条分组分页、全屏焦点、滚动与阅读位置、水量独立顶行及未知 / 缺水换行。键盘方向键与 WASD 实际移动后返回原位置。所有方向键在滚动到可操作位置后中心点可命中，至少 44×44px；短屏和横屏需要滚动查看地图及方向键，未宣称整张地图始终同屏。

### 完整按钮通关

- 4175 次行动、4979 次实际点击、82 场战斗、13 个地牢、9 个区域。
- 飞船结局第 4195 回合，随后抵达深渊第 2 层；cheat=false。
- 所有推进通过真实控件；规划只读状态，移动逐次点击方向键。普通 gameState 和 adr.saveSlots.v1 原始字节保持不变。
- 错误 / 警告 / 缺失资源 / 外网请求均为 0。自动化耗时 559 秒，不代表真人游玩时长。
- 飞船结局存档共 2813 条日志，其中 3218 步移动保存为 993 条移动记录，最长连续段 24 步；移动步数总和与 flags.moves 相等，时间顺序正确，无错误的 log.action.move 占位日志。
- 完整流程启动后，仅修正方向文案重复“向”字并补函数说明；行动与合并逻辑未再变化。最终文案及布局通过随后重跑的专项验证，完整流程末尾也刷新加载了最终资源。早期通关截图不作为最终文案展示。

### 自检中发现并处理

- 方向词典本身是“向北”，已修正移动模板，避免“向向北”。
- 日志单元测试的补给不足和地点名称预期已按明确的边界夹具 / 现有词典修正，未放宽事件分段规则。
- 通用 UI 旧测试依赖“Esc 取消选点”和“返回据点”按钮，更新为地图点击无状态、Esc 正常打开菜单及真实方向键返回。
- 触达检查最初在切页动画结束前取坐标，已等待动画结束再命中测试；通过全部 20 组。未因此修改运行时切页行为。

## 证据

- 汇总与最终源码校验：`.local/map-journal-final.json`。
- 全部命令日志：`.local/map-journal-*.log`。
- 探索布局与截图：`.local/rogue-tests/explore-redesign/report.json` 及同目录 PNG；`*-controls.png` 为短屏 / 横屏滚动后的实际控件视口。
- 横滑：`.local/rogue-tests/region-swipe/report.json`。
- 通关：`.local/rogue-tests/ui-playthrough/report.json`、`completed-run.json`。
- 修改前源码备份：`.local/map-journal-before-20261031/`。
- 原根目录 Git 删除记录及 code 未跟踪布局保留；没有清理、重置或创建发布提交。

### 最终运行源码 SHA-256

| 文件 | SHA-256 |
| --- | --- |
| script/rogue/rogue.ui.js | b979ee759de4228b3c72a80e6de00492afff3ba7b0f0d83a754291c1e2adc80d |
| script/rogue/rogue.state.js | 005f5a02b6db45a712083f92f6f95c51c8779bc7adcc422adb2016dfe6d18319 |
| script/rogue/rogue.num.js | ec308085e67ce203c08948e68234d69813e56acea5be8d921fd35711acd1c8f0 |
| script/rogue/lang/zh.js | 08a5e3c40a02d1e0dbc23c317d839094d91654546835cd59379174697852fcb7 |
| css/rogue.css | 381ad5e6d6951e8c15be148a07b1c06a8702067f19d24b7dd10c74f3fa953caf |

## 未验证与交付边界

未做 Android 真机安装、系统 WebView 80 实机、触摸手感或性能验证。图片是浏览器截图。未递增版本，现有 1.3.12 APK 不包含本次修改；本次没有构建、签名或发布新 APK。真实设备验收与发布需另行进行。

## 各测试最后三行原始输出

### .local/map-journal-core.log

```text
    "storage quota failure rolls back an already-written slot without throwing"
  ]
}
```

### .local/map-journal-model.log

```text
PASS turns, waits, discoveries, warnings and combat records split groups; invalid movement adds neither steps nor turns
PASS cross-day settlement retains chronological events and multi-turn metadata
PASS old single-step and aggregated logs project without mutation or truncation; ordinary save bytes remain unchanged
```

### .local/map-journal-storage.log

```text
PASS moving a shelter leaves a visible cache at the original tile without teleporting, duplicating or deleting stored items
PASS expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
```

### .local/map-journal-test-rogue-issues.log

```text
PASS camp restock entrances disable real no-ops; exploration has no duplicate restock; camp/party keyboard, hidden focus, backup and two-step exit work
PASS full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
```

### .local/map-journal-explore.log

```text
PASS 1440x900-dark-16
PASS 1440x900-dark-22
PASS exploration redesign: 20 layouts, inert map, return-water header, action-only grouped journals, lazy history and save isolation
```

### .local/map-journal-test-rogue-region-swipe.log

```text
PASS short/cancelled/vertical/multitouch/modal gestures cannot switch or act; horizontal log swipes switch tabs and reduced-motion preference is respected
PASS swiping preserves the region subpage and reading offset; native button taps perform exactly one action
PASS local camp, second camp, resource, occupied site, wilderness and dungeon expose matching actions; remote management rejects without mutation
```

### .local/map-journal-test-rogue-ui.log

```text
PASS real completed-run fixture renders its ship ending, enters and reloads the abyss, then returns without inventory or economic changes
PASS twenty phone/landscape/desktop day/night and 16/22px layouts cover every camp subpage, recipe category, research page, journal and combat with 44px controls and complete translations
{"passed":true,"checks":10}
```

### .local/map-journal-test-rogue-onboarding.log

```text
  "remote": [],
  "missing": []
}
```

### .local/map-journal-test-home.log

```text
{"passed":true,"checks":9,"layoutScenarios":24}
```

### .local/map-journal-test-offline.log

```text
{"width":360,"height":584,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":195,"top":160.390625,"right":340,"bottom":355.390625,"left":20},"wanderer":{"x":173.9921875,"y":246.390625,"width":12.015625,"height":23,"top":246.390625,"right":186.0078125,"bottom":269.390625,"left":173.9921875},"menu":{"x":0,"y":520,"width":360,"height":64,"top":520,"right":360,"bottom":584,"left":0},"controls":{"x":20,"y":368,"width":320,"height":140,"top":368,"right":340,"bottom":508,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":360,"height":640,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":223,"top":160.390625,"right":340,"bottom":383.390625,"left":20},"wanderer":{"x":173.9921875,"y":260.390625,"width":12.015625,"height":23,"top":260.390625,"right":186.0078125,"bottom":283.390625,"left":173.9921875},"menu":{"x":0,"y":576,"width":360,"height":64,"top":576,"right":360,"bottom":640,"left":0},"controls":{"x":20,"y":396,"width":320,"height":168,"top":396,"right":340,"bottom":564,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":412,"height":915,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":372,"height":498,"top":160.390625,"right":392,"bottom":658.390625,"left":20},"wanderer":{"x":199.9921875,"y":397.890625,"width":12.015625,"height":23,"top":397.890625,"right":212.0078125,"bottom":420.890625,"left":199.9921875},"menu":{"x":0,"y":851,"width":412,"height":64,"top":851,"right":412,"bottom":915,"left":0},"controls":{"x":20,"y":671,"width":372,"height":168,"top":671,"right":392,"bottom":839,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":599,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
```

### .local/map-journal-test-save-slots.log

```text
{"passed":true,"checks":14}
```

### .local/map-journal-playthrough.log

```text
  "missing": [],
  "remote": []
}
```


