# 无光之地布局与操作层级核查

日期：2026-10-30。以本地 1.3.8 / 27 源码及已交付 APK 为对照，按用户确认的全模式 UI 方案实现。本报告记录 UI 源码与浏览器验收阶段，当时版本号不变、旧 APK 不含本轮改动。后续应用户要求，以 1.3.9 / 28 单独打包，构建记录见工作区 `release/1.3.9/BUILD-REPORT.md`；下文保留原验收阶段的范围说明。

## 已实现

- 小于 680px 的据点按资源摘要、日常操作、建设管理、人口派工纵向排列；建造、制造、研究使用全宽配方与顶部资源摘要。宽屏保留操作与资源双栏。
- 主行动黑白实底、次要行动细边框、页面入口带箭头。入口的无障碍名称不包含装饰箭头；保留原行动标识和确认流程。禁用按钮采用虚线与可读文字，费用、缺口、制造条件靠近操作显示。
- 配方显示名称、简短用途、费用、可展开的用途说明及带行动名称的按钮。文字层级独立，常用按钮默认 16px、辅助说明至少 14px，字号偏好继续生效。
- 手机方向键位于地图下方，返程饮水信息紧邻补给。预览依剩余空间决定是否显示，空间不足时打开相同内容的详情页，不仅按屏幕高度决定。
- 队伍划分生命补给、装备行囊、同行者；仓库控制区与条目分离，手机存取按钮置于物品信息下方；派工增减控件与岗位说明分行。
- 菜单分为旅程、显示设置、存档与备份。战斗突出攻击，固定显示自身生命；防御、闪避、逃跑显示简短文字并保留完整无障碍名称，短横屏敌人状态采用横向排列。
- 整理原有 terminal 展示层的重复布局覆盖；UI 变化集中于 `rogue.ui.js`、`rogue.css` 与中文词典，未改变行动规则、经济数值或存档结构。

视觉沿用 adarkroom-Ts-skill 的文字冒险、直角和轻量分组原则；本轮明确确认的实底主按钮、手机单列优先于原参考中的默认细框按钮与双栏布局。

## 浏览器验收

由 `python scripts/prepare-android-assets.py` 生成离线资源，再用现有 Playwright/Chromium 对 Android 同源虚拟 HTTPS 地址运行回归。测试使用独立场景与存储，不访问玩家存档。

| 测试脚本（`scripts/` 下） | 本轮结果 |
| --- | --- |
| `test-rogue.mjs` | 16 项模型检查通过，包含 10,000 种种子、迁移、坏档与普通存档隔离 |
| `test-rogue-storage.mjs` | 5 项储物模型检查通过 |
| `test-rogue-issues.mjs` | 7 项检查通过，含 960 个撤离边界与真实控件 |
| `test-rogue-ui.mjs` | 10 组功能验收通过；五种尺寸 × 两主题 × 16/22px，共 20 个完整布局组合 |
| `test-rogue-storage-ui.mjs` | 直接存取、同行者行囊、临时储物、遗留物资及 16 个布局组合通过 |
| `test-rogue-survival-ui.mjs` | 装备、商人、据点迁移及 10 个布局组合通过 |
| `test-rogue-expansion-ui.mjs` | 4 个后期布局、九区、模块与丢弃确认通过 |
| `test-rogue-onboarding.mjs` | 8 组引导/补给检查通过，含 10 个日夜与大字号组合 |
| `test-theme-sync.mjs` | 主题同步、偏好保留、普通存档隔离、说明展开保持通过 |
| `test-home.mjs` | 9 项、24 个主页布局场景通过 |
| `test-save-slots.mjs` | 14 项多存档检查通过 |
| `test-offline.mjs` | 5 种尺寸的普通模式离线启动与交互通过 |
| `test-ui-details.mjs` | 21 个普通模式设置与布局场景通过 |
| `test-rogue-playthrough-ui.mjs` | 最终 UI 从新局经真实按钮完成九区、飞船结局及深渊二层 |

主布局覆盖 320×512、360×740、412×915、740×360、1440×900。检查触摸区域至少 44px、常用操作字号、横向溢出、固定返回的命中、手机上下顺序、宽屏双栏、配方文字在按钮之前、无重复返回、战斗固定生命与可滚动内容区。入口、切页、展开与返回不消耗回合。

原有“手机仍需左右分栏”和“所有据点分类都必须位于首屏”断言已按确认方案改为上下顺序、滚动后实际可达；没有删除存档与操作语义检查。预览测试同时覆盖有预览与空间不足打开详情两条路径，并验证增高视口后恢复预览。

本轮发现并修正了移动方向区首屏遮挡、装饰箭头改变按钮无障碍名称、CSS 优先级导致重复返回及短屏大字战斗信息拥挤。最终相关回归均通过。控制台错误、警告、缺失资源、外网请求为空。

### 结果摘录

```text
test-rogue.mjs: "passed": true, "count": 16
PASS storage quota failure rolls back an already-written slot without throwing

test-rogue-storage.mjs:
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load

test-rogue-issues.mjs:
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type

test-rogue-ui.mjs:
PASS twenty phone/landscape/desktop day/night and 16/22px layouts cover every camp subpage, recipe category, research page, world chart and combat with 44px controls and complete translations
{"passed":true,"checks":10}

test-rogue-storage-ui.mjs:
PASS sixteen day/night layouts cover direct storage, narrow-screen actions and fixed returns; measured previews and detail fallbacks fit the available height and survive resizing
```

完整命令输出留在 `.local/ui-layout-test-*.mjs.log`，场景报告与测试原图位于 `.local/rogue-tests/`。模型检查与真实按钮通关分别记录，不将其混称。

## 真实按钮完整流程

最终报告：seed 42，4073 次行动、4619 次点击、74 场战斗、13 个地牢、9 个区域；第 4084 回合完成飞船结局，深渊到达二层后退出。`cheat=false`，普通存档原始字节不变，错误/警告/缺失资源/外网请求均为空，耗时 228 秒。

没有注入物资、生命或图纸，推进通过实际按钮。规划器只读完整地形，因此不代表仅凭玩家已探索信息的真人体验；未调整既有通关回合或点击数平衡。最后一项 CSS 微调仅影响宽度至少 680px 且高度不超过 400px 的横屏战斗，并由最终 20 组合布局回归覆盖；按钮通关使用 360px 手机视口。

## 截图

以下为本轮浏览器自动化截图，已人工查看实际画面，非 Android 真机实拍。长页面全页截图会把固定底栏留在首屏位置；实际操作可滚动到下方条目，测试检查了返回可达性与存取操作。

| 页面 | 浅色 | 深色或大字号 |
| --- | --- | --- |
| 据点 | [360×740](screenshots/ui-layout/360x740-day-font16-camp.png) | [360×740](screenshots/ui-layout/360x740-night-font16-camp.png) |
| 探索 | [412×915](screenshots/ui-layout/412x915-day-font16-map.png) | [412×915](screenshots/ui-layout/412x915-night-font16-map.png) |
| 队伍 | [360×740](screenshots/ui-layout/360x740-day-font16-party.png) | [360×740](screenshots/ui-layout/360x740-night-font16-party.png) |
| 仓库 | [360×740](screenshots/ui-layout/warehouse-360x740-light.png) | [360×740](screenshots/ui-layout/warehouse-360x740-dark.png) |
| 研究 | — | [320×512，22px](screenshots/ui-layout/320x512-night-font22-research.png) |
| 战斗 | — | [320×512，22px](screenshots/ui-layout/320x512-night-font22-combat.png) · [740×360，22px](screenshots/ui-layout/740x360-night-font22-combat.png) |
| 宽屏据点 | [1440×900](screenshots/ui-layout/1440x900-day-font16-camp.png) | — |

## APK 与验证边界

对照原 `release/1.3.8/a-dark-room-offline-1.3.8.apk`：两边均为 171 个游戏资源，无新增或缺失；仅 `css/rogue.css`、`script/rogue/rogue.ui.js`、`script/rogue/lang/zh.js` 的字节改变，其余 168 个资源与 APK 一致。

原 APK SHA-256 保持：

```text
a4d67585ed8d47d1d8f23587eec55fb94a36a122ecf4240b05721f6a02eb6f80
```

版本仍为 1.3.8 / 27，本轮没有重编、替换 APK，没有 Git 提交或远端发布。未做 Android 真机安装、系统文件选择器或 WebView 80 实机验证。
