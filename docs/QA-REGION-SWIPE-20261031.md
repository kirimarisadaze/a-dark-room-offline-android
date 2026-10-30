# 区域页与左右滑动验收

需求开始于 2026-10-30，最终验收完成于 2026-10-31（Asia/Shanghai）。范围：本地源码及离线浏览器验证。

## 需求与实现

- 用户确认“只能在玩家所在区域互动”按当前站立地点解释：站在据点才能建设，走到资源点、遗迹等地点才能操作。
- 顶部导航显示“探索 / 区域 / 队伍”；内部已有 camp 标识保留，存档仍为 v3。
- 区域页随当前位置显示永久据点建设、制造、研究、仓库与派工，或者采集、占领、遗迹、封锁据点、飞船、出口、临时营地、遗留物资和地牢操作。原地图下方的现场互动区已移除，地图保留方向键、等待、图例、物资与选点寻路。
- 区域页不再提供远处据点切换。生产派工和道路须在站点现场或同一区域的所属据点内操作；守卫只调整玩家脚下据点。行动层拒绝越区或远程操作，不扣回合和资源。
- 单指横滑按主导航顺序切页，手指移动时页面跟随，释放后以 220ms 动画进入相邻页面，首尾不循环。短距离拖动回弹，纵向阅读、多指、取消手势、按钮、日志和弹窗不触发切页；战斗与事件沿用模态锁定。
- 切页保留子页及阅读位置，不推进回合、不改写旅程或普通存档。支持减少动态效果设置，生命周期退出时移除触摸监听。
- 数值配置位于 rogue.num.js，新增中文位于现有词典；没有新增运行依赖或模拟时钟。

## 验证命令

在 code/ 执行，先使用 `python scripts/prepare-android-assets.py` 生成 171 个离线资源。浏览器测试使用已安装的 Playwright 与 .local/playwright-browsers，未安装游戏运行依赖。

| 命令 | 已取得的结果 |
| --- | --- |
| `node scripts/test-rogue.mjs` | 核心 16 项通过 |
| `node scripts/test-rogue-issues.mjs` | 7 组通过，包括 960 个紧急撤离场景 |
| `node scripts/test-rogue-storage.mjs` | 5 组通过，储物、容量、坏档与普通档隔离 |
| `node scripts/test-rogue-region-swipe.mjs` | 20 组尺寸/主题/字号；原生触摸滑动、动画、首尾、手势排除、阅读位置、触摸按钮与地点权限通过 |
| `node scripts/test-rogue-ui.mjs` | 10 组通过；20 组布局覆盖全部建设子页、分页、返回、战斗与日志 |
| `node scripts/test-rogue-storage-ui.mjs` | 储物交互及 16 组布局通过 |
| `node scripts/test-rogue-survival-ui.mjs` | 同行者、装备、商人、据点占领与 10 组布局通过 |
| `node scripts/test-rogue-expansion-ui.mjs` | 4 组后期布局、九区、组件、营地上限与丢弃确认通过 |
| `node scripts/test-rogue-onboarding.mjs` | 新局引导、配方、补给与种子抽查通过 |
| `node scripts/test-rogue-explore-redesign.mjs` | 20 组布局、全屏日志、历史加载、存档隔离与日志时间通过 |
| `node scripts/test-rogue-survival.mjs` | 6 组生存规则与迁移通过 |
| `node scripts/test-home.mjs` | 9 项、24 个布局场景通过 |
| `node scripts/test-offline.mjs` | 5 个尺寸的普通模式离线加载、操作、保存和输入隔离通过 |
| `node scripts/test-save-slots.mjs` | 普通模式三存档 14 项通过 |
| `node scripts/test-rogue.mjs --playthrough` | 模型层 17 项通过，飞船结局及深渊链路通过 |
| `node scripts/test-rogue-playthrough-ui.mjs` | 真实新局通过实际按钮完成飞船结局及深渊第 2 层 |

专项与通用 UI 的尺寸均包含 320×512、360×740、412×915、740×360、1440×900，覆盖日夜主题与 16/22px 字号。检查主要控件至少 44×44px、无横向溢出、焦点、返回和普通存档原始字节。

## 真实按钮通关

- seed：42；实际行动：4175；实际点击：4979。
- 82 场战斗、13 个地牢、9 个区域。
- 飞船结局回合：4195；随后到达深渊第 2 层并返回。
- cheat=false，普通 gameState 与 adr.saveSlots.v1 原始字节不变。
- 控制台错误、警告、缺失资源、外网请求均为 0。
- 所有推进通过实际可见控件完成；只读状态用于规划路线，没有注入物资、生命、迷雾、图纸或直接调用行动接口。
- 测试脚本已适配新的现场操作：从区域页采集与进入地牢，实际走到生产站点派工，不能继续沿用旧版的跨区远程操作。

模型层验证另行通过，记录的完成回合为 5278。模型结果不视为实际按钮通关，也不作为真人平衡或游玩时长结论。

## 最终复核

完整按钮通关之后仅补齐地图选点的寻路距离、跨区选点清理、本区站点计数和代码缩进，未改变行动、存档或手势逻辑。重新生成资源后，最终区域专项、通用 UI 和三项必跑回归全部通过，专项报告核对最终生成资源与源码一致；修改过的运行脚本语法检查通过。

必跑回归输出摘录（完整日志见 code/.local/region-final-test-*.log）：

```text
test-rogue.mjs:
  "passed": true,
  "count": 16,

test-rogue-issues.mjs:
PASS full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type

test-rogue-storage.mjs:
PASS expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
```

## 证据

- 本次日志：`../.local/region-*.log`。
- 区域专项：`../.local/rogue-tests/region-swipe/report.json`。
- 浏览器截图：`../.local/rogue-tests/region-swipe/explore.png`、`region-camp.png`、`region-resource.png`（均位于同一目录）。
- 真实按钮通关：`../.local/rogue-tests/ui-playthrough/report.json`、`completed-run.json`。
- 修改前源码备份：`../.local/region-swipe-before/`。

最终运行源码 SHA-256：

| 文件 | SHA-256 |
| --- | --- |
| script/rogue/rogue.ui.js | d02a82542d7c3585bd61e0903147c6605a99782f5816c8e37b217e612427f0ec |
| script/rogue/rogue.settle.js | d04126dbe5c6949db69c1ba4d092b9bc66c845dbfdf45b3f4ba93aee336dc99c |
| script/rogue/rogue.num.js | 023adb143252a52ed54c45406d8098908926fda85b23b09824a4a4a04a51dc7b |
| script/rogue/lang/zh.js | e0229839a4fe34831f67dbec160c0eecc2ebd252bbd8492bb2cdd6e997013646 |
| css/rogue.css | 69686992d3a3ec92fb9d6b114b67b930827015a9d9cbe644837fdf3ae8daf183 |

## 交付边界

- 本轮为本地源码修改；版本字段保持 1.3.10，未提交、推送、打标签或发布。
- 未重新编译或覆盖 `release/1.3.10/a-dark-room-offline-1.3.10.apk`。该 APK 仍为本轮修改之前的包，SHA-256 保持 `5ae6a72e94692c7b9ff758c61eb16c9a6cb0123b6b46e823e774c67acce2ca1d`。
- 未做 Android 真机安装、WebView 80 实机手势或系统文件选择器验证；截图和触摸测试均来自浏览器。
