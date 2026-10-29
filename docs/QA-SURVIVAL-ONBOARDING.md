<!-- SPDX-License-Identifier: MPL-2.0 -->
# 新手目标与补给反馈验证

日期：2026-10-29。分支：`codex/survival-onboarding`，基线：`c8e324b`。本记录对应本任务最终实现，未增加游戏版本号或发布 APK。需求核查与尚未实施的内容见 [任务记录](NEWCOMER_EXPERIENCE.md)。

## 环境与边界

Windows / Node.js 24.21.0，使用工作机已有 Playwright 的无头 Chromium，完全离线路由到 `prepare-android-assets.py` 生成的 Android WebView 静态资源。最终生成 170 个文件，6,741,306 字节。游戏未增加 npm 运行依赖。

所有浏览器布局图均为自动化截图，不是手机实拍。**未做 Android 真机安装、系统文件选择器或 WebView 80 实机验证。**

## 命令与结果

| 命令 | 实际结果 |
| --- | --- |
| `git diff --check` | 通过 |
| `python scripts/prepare-android-assets.py` | 通过，测试使用生成后的资源，未提交生成目录 |
| `node scripts/test-rogue.mjs` | 16 组通过，含 10,000 种世界拼接、900 张区域与旧档 / 普通档隔离 |
| `node scripts/test-rogue-issues.mjs` | 7 组通过，含 960 种紧急撤离条件与 10 组日夜布局 |
| `node scripts/test-rogue-storage.mjs` | 5 组通过 |
| `node scripts/test-rogue-survival.mjs` | 8 组通过，涵盖装备、同行者、水袋、群系、商人、封锁据点和迁移 |
| `node scripts/test-rogue-onboarding.mjs` | 8 组通过，含 1,000 个种子的只读地形抽查与 10 组日夜 / 大字布局 |
| `node scripts/test-rogue-ui.mjs` | 10 组通过，包括普通模式、主页、三槽、返回层级、刷新续战、备份恢复及 10 组布局 |
| `node scripts/test-rogue-storage-ui.mjs` | 3 组通过，包括 14 组布局、旋转 / 高度变化和大字预览退化 |
| `node scripts/test-rogue-survival-ui.mjs` | 3 组通过，包括装备转交、解除同行、逃跑概率及 10 组布局 |
| `node scripts/test-rogue.mjs --playthrough` | 模型层完整流程通过，17 组，含深渊共 5345 回合 |
| `node scripts/test-rogue-playthrough-ui.mjs` | 从真实新局到飞船结局、深渊二层和退出主页通过，结果见下节 |

五个指定尺寸为 `320×512`、`360×740`、`412×915`、`740×360`、`1440×900`，均实际验证日间 / 夜间主题；最窄屏用 22px，大字手机用 20px。储物测试另外覆盖两种高屏布局。专项断言检查 44px 控件、标题固定、返回可触达、无横向溢出与无缺译。新目标材料页及跳转只阅读，不推进回合。

普通模式 `gameState` 与 `adr.saveSlots.v1` 检查原始字符串；新警报在读取、刷新后去重。旧 v3 缺字段只补内存默认值，损坏字段保留坏档原文。回程夹具用四步绕墙路线验证耗水 5，而非两步直线；全队备用水、未知回程、提醒开关与深渊隔离分别覆盖。

## 本次真实按钮完整流程

最终样式调整后重新从 seed 42 开始，并再次完成全流程：

```json
{
  "passed": true,
  "seed": 42,
  "actions": 4073,
  "clicks": 4619,
  "battles": 74,
  "dungeons": 13,
  "endingTurn": 4084,
  "abyssBest": 2,
  "regions": 9,
  "cheat": false,
  "normalSaveUnchanged": true,
  "errors": [],
  "warnings": [],
  "missing": [],
  "remote": []
}
```

所有推进都点击真实可见控件。规划器只读状态和完整地形，没有注入资源、生命、迷雾或图纸，也没有调用行动接口代替点击；它**仍然具有完整地形规划信息，不是只使用玩家已知信息的探索机器人**。新手引导测试的声明夹具不混入这次流程。

飞船结局时模型层为 5323 回合，后续深渊测试后为 5345；按钮流程飞船结局为 4084 回合。两套策略不同，分别报告。按钮结局仓库铁约 971.17、水 101；模型结局铁约 1384.52、水 112.75。地牢成功移动计数均为 251，但它不包含全部地牢内战斗 / 行动，不将其直接当作地牢回合占比。

本任务未修改经济参数。当前基线的总回合、铁库存和按钮数仍未达到 `AGENTS.md` 的平衡目标，地牢总回合占比也尚未单独统计；不能把“流程可通”写成“平衡合格”。初水自适应、生产比例、站点上限、地牢层数、飞船充能与诚实探索规划仍属独立后续任务。

## 发现并修复的布局回归

新增引导一度使 `412×915 / 20px` 的探索预览被挤走，储物 UI 回归如实失败。检查实际几何后，将目标预览改为短句，并去掉上下文首个目标入口多余的上间距；完整说明仍在目标页。保持原测试断言，14 组布局最终全通过，预览完整位于日志上方，大字 / 矮屏仍按原规则退化到二级页。

## 三项必跑检查的输出摘录

`test-rogue.mjs` 最后几行（该报告的 `passed` 为 `true`，`count` 为 `16`）：

```text
    "T10: truncated saves are reported and preserved byte for byte",
    "missing translations use the explicit !!key!! marker",
    "storage quota failure rolls back an already-written slot without throwing"
  ]
}
```

`test-rogue-issues.mjs` 最后两行：

```text
PASS full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
```

`test-rogue-storage.mjs` 最后两行：

```text
PASS expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
```

完整机器报告与截图保存在工作目录的 `.local/rogue-tests/`，不提交带有旅程状态的本地测试产物。此记录与实现者自检不代替独立 PR 审核；合并与发布按协作流程处理。
