# 2026-10-31 · 主页面横滑覆盖修复

范围：本地源码与生成网页资源，浏览器原生触摸及回归验证。导航为“探索 / 区域 / 队伍”，区域页在据点显示据点操作。

## 问题与根因

- 原 `swipeStart` 排除全部按钮、链接、说明展开标题及整个 `#rogue-bottom`，所以从方向键、操作按钮、导航、日志或底栏起手时不会识别横滑。
- 监听位于 `#rogue-root`，但根容器没有占满视口的最小高度，短页底部空白可能落在监听区域外；横向手势约束也只配置在内容布局上。
- 旧专项主要从标题下方固定空白处起手，未覆盖控件与底栏。修复前新增真实触摸用例，在 `320×512 / 日间 / 16px` 从等待按钮横滑，得到 `transform: none`，成功复现。日志：`.local/swipe-coverage-reproduce.log`。

## 实现

- `script/rogue/rogue.ui.js`：允许在地图、普通和禁用按钮、说明展开标题、主导航、日志及底栏起手横滑；保留输入控件、可编辑内容、弹窗、战斗和事件的限制。
- 已识别为横向拖动时阻止 `touchend` 默认点击，并保留现有后续点击保护；短拖回弹、取消、边界拖动都不能误执行按钮行动。新的一次轻触正常执行。
- `css/rogue.css`：根容器至少占满视口，并设置 `touch-action: pan-y pinch-zoom`，将空白和固定栏纳入一致的横滑范围，保留原生纵向滚动。
- 沿用现有顺序、阈值、动画、首尾不循环、减少动态效果、子页与阅读位置恢复。切页不推进回合、不改写存档。
- 扩展 `scripts/test-rogue-region-swipe.mjs`；更新 `AI_README.md` 的触摸约定。通过生成脚本更新资源，未手工编辑生成目录。

## 本次验证

先执行 `python scripts/prepare-android-assets.py`，生成 171 个离线资源。使用本机既有 Playwright Chromium，通过 CDP 注入原生触摸，未新增游戏运行依赖。

| 命令 | 本次结果 |
| --- | --- |
| `node scripts/test-rogue.mjs` | 核心 16 项通过 |
| `node scripts/test-rogue-issues.mjs` | 7 组通过，包括 960 个紧急撤离场景 |
| `node scripts/test-rogue-storage.mjs` | 储物 5 组通过 |
| `node scripts/test-rogue-region-swipe.mjs` | 8 组通过，包含 20 组尺寸 / 主题 / 字号组合 |
| `node scripts/test-rogue-ui.mjs` | 10 组通过，包含 20 组布局 |
| `node scripts/test-rogue-explore-redesign.mjs` | 20 组布局、全屏日志、历史加载、存档隔离与日志时间通过 |
| `node scripts/test-home.mjs` | 9 项、24 个布局场景通过 |
| `node scripts/test-offline.mjs` | 普通模式 5 个尺寸的离线加载、操作、保存和输入隔离通过 |
| `node scripts/test-save-slots.mjs` | 普通模式三存档 14 项通过 |
| `node scripts/test-rogue-playthrough-ui.mjs` | 本次从真实新局通过实际按钮完成飞船结局及深渊第 2 层 |

手势布局覆盖 `320×512`、`360×740`、`412×915`、`740×360`、`1440×900`，各测日夜主题及 16/22px 字号。从等待按钮与日志起手横滑，检查页面跟手、相邻切换、边界、44px 控件、横向溢出及存档字节。

额外专项检查地图、采集按钮、建设入口、禁用补给按钮、禁用建设按钮、说明展开标题、页头、导航、时间、菜单及返回按钮；在 `1440×1200` 验证短区域页下方空白。检查纵向日志及页面滚动、短拖、取消、多指、弹窗、战斗、减少动态效果、阅读位置和一次轻触只执行一次行动。原生惯性滚动单独验证，避免测试在浏览器仍处理滚动时立即点击下一步骤。

手势报告中错误、警告、缺失资源与外网请求均为 0；普通 `gameState`、`adr.saveSlots.v1` 和纯切页时的 Rogue 存档原始字节保持不变。运行脚本与专项测试语法检查通过，生成资源与最终源码一致。

## 本次完整按钮通关

- seed 42；4175 次行动、4979 次点击、82 场战斗、13 个地牢、9 个区域。
- 飞船结局回合 4195，随后到达深渊第 2 层；`cheat=false`。
- 所有推进通过真实控件完成，只读状态用于规划；未注入资源、生命、迷雾或图纸，未直接调用行动接口代替点击。
- 普通存档原始字节保持不变；错误、警告、缺失资源和外网请求均为 0。
- 本次运行耗时 931 秒，属于自动化执行时间，不作为真人游玩时长结论。
- 输出：`.local/swipe-coverage-playthrough.log`；报告及通关档：`.local/rogue-tests/ui-playthrough/report.json`、`completed-run.json`。
- 这是修复后重新执行的完整按钮通关，未将上一轮报告当作本次结果；新增触摸专项的声明式边界存档与这次真实新局分开验证。

## 输出摘录与证据

各测试完整输出保存在 `.local/swipe-coverage-*.log`。关键输出摘录：

```text
核心："passed": true, "count": 16
问题：PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
储物：PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
手势：PASS swiping preserves the region subpage and reading offset; native button taps perform exactly one action
手势：PASS local camp, second camp, resource, occupied site, wilderness and dungeon expose matching actions; remote management rejects without mutation
通用 UI：{"passed":true,"checks":10}
探索：PASS exploration redesign: 20 layouts, fullscreen journal, lazy history, save isolation and model chronology
主页：{"passed":true,"checks":9,"layoutScenarios":24}
三存档：{"passed":true,"checks":14}
完整按钮通关末尾："normalSaveUnchanged": true, "errors": [], "warnings": [], "missing": [], "remote": []
```

- 手势报告与截图：`.local/rogue-tests/region-swipe/`。
- 修改前源码、测试与前次验收报告备份：`.local/swipe-coverage-before-20261031/`。
- 本次问题回归首次运行因未设置既有 Playwright 路径而中止；配置 `PLAYWRIGHT_MODULE`、`PLAYWRIGHT_BROWSERS_PATH` 后重新运行全部 7 组通过。

最终运行源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| `script/rogue/rogue.ui.js` | `a773d91f9111c8cd09b69532cf3dfa7816dc169d38f9aaf839e6907787ff7679` |
| `css/rogue.css` | `2113189ebfced1c3dbcef6d610ff3b0e11a659de47e7243489c90c0fbaec87b6` |

## 交付边界

- 当前版本字段仍为 `1.3.11 / versionCode 30`。未递增版本、构建 APK、提交、推送或发布 Release；已有 `release/1.3.11/` APK 不包含本次修复。
- 未做 Android 真机安装、手势或 WebView 80 实机验证。浏览器原生触摸和截图不能作为真机验收。
- 保留根目录原有 Git 删除和 `code/` 未跟踪状态。
