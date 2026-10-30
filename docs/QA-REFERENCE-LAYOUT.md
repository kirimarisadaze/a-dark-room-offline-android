<!-- SPDX-License-Identifier: MPL-2.0 -->
# 无光之地：参考 APK 页面结构调整核查

日期：2026-10-30。这是前序页面调整阶段的记录，保留当时的源码与本地包核验边界；其中“本轮未改版本号、未打包”指该阶段。后续 1.3.7 原签名构建与发布见 [1.3.7 核验](QA-1.3.7.md)，原 1.3.6 APK 保持原样。

## 参考与范围

用户确认按 `小黑屋_1.0.7.apk` 重排导航和分栏。参考文件 SHA-256：

```text
815b74f5e3d431c7cd3c2d5f1fcb21fb2553db62dfc750fb5e87860df35502d8
```

依据 APK 内 `assets/www` 的 CSS 和动态 DOM 代码确定结构：顶部地点文字标签、细竖线与当前项下划线；建设左操作、右资源；资源使用名称和数值行；探索保留文字地图、行囊状态和方向控制；底部使用简短日志。

参考资源是静态分析，未运行参考 APK，也未声称逐像素复刻其 Android 运行画面。

## 已实现

- 探索、据点、队伍移至顶部文字主导航，一次只展示当前主页面；模式标题继续固定居中。
- 建设总览改为左侧采集、补给、建造和制造，右侧共享仓库与据点人口。建设、制造和研究子页保留右侧库存；长列表继续分类和分页。
- 建造和制造按钮直接显示目标名称，说明与费用置于按钮下；无障碍名称仍包含动作与目标。
- 探索地图上方显示行囊、负重、生命和补给；方向控制置于地图区域右下方的独立空间，避免覆盖地图字符。
- 底部保留时间、逐级返回、菜单和最新日志；全部记录仍可打开。
- 保留上一轮柔化后的按钮配色，操作继续使用既有动作、条件与费用。

运行源码仅修改 `script/rogue/rogue.ui.js`、`css/rogue.css`；对应 UI 测试更新于 `scripts/test-rogue-ui.mjs`、`scripts/test-rogue-expansion-ui.mjs`。已同步 `AGENTS.md` 和 `AI_README.md` 中的导航、分栏约定。

## 已验证

所有下列命令均实际执行并以退出码 0 结束。UI 检查使用 `prepare-android-assets.py` 生成的离线资源；最后一次布局修复后重新生成资源并完成最终按钮通关。

| 命令 | 结果 | 本轮日志 |
| --- | --- | --- |
| `node scripts/test-rogue.mjs` | 16 项通过 | `.local/layout-reference-core.log` |
| `node scripts/test-rogue-issues.mjs` | 回合、撤离、补给、返回和确认回归通过 | `.local/layout-reference-issues.log` |
| `node scripts/test-rogue-storage.mjs` | 物资守恒、容量、临时营地和存档隔离通过 | `.local/layout-reference-storage.log` |
| `node scripts/test-rogue-ui.mjs` | 10 组通过，覆盖五尺寸日夜和建设子页左右位置 | `.local/layout-reference-ui.log` |
| `node scripts/test-rogue-storage-ui.mjs` | 14 组日夜布局，含高屏、字号和旋转检查 | `.local/layout-reference-storage-ui.log` |
| `node scripts/test-rogue-survival-ui.mjs` | 装备、同行者、商人、警告设置及 10 组布局通过 | `.local/layout-reference-survival-ui.log` |
| `node scripts/test-rogue-expansion-ui.mjs` | 4 组后期内容布局通过 | `.local/layout-reference-expansion-ui.log` |
| `node scripts/test-home.mjs` | 9 项、24 个布局场景通过 | `.local/layout-reference-home.log` |
| `node scripts/test-save-slots.mjs` | 14 项通过 | `.local/layout-reference-save-slots.log` |
| `node scripts/test-offline.mjs` | 5 个手机尺寸通过，资源无缺失、无外网请求、无页面错误 | `.local/layout-reference-offline.log` |
| `node scripts/test-rogue-playthrough-ui.mjs` | 最终代码从新局通过真实按钮完成九区、结局和深渊 | `.local/layout-reference-final-playthrough.log` |

主 UI 矩阵为 `320×512`、`360×740`、`412×915`、`740×360`、`1440×900`，分别检查实际日间和夜间主题、44px 控件、横向溢出、遮挡、返回和缺译。

独立只读审查另覆盖 320 / 360 / 412 / 1440 宽度、16 / 22 字号共 36 个场景；320×640、22 字号下检查七个建设页面末尾操作可滚动至底栏上方；菜单焦点与 Esc 恢复正确，导航没有改变游戏状态。

本轮预览脚本 `.local/layout-reference/preview.mjs` 也通过 12 个探索、建设场景及建造、制造双栏断言；切页前后完整游戏状态一致，普通存档原始字节不变。浏览器截图已实际查看，合成预览位于 `.local/layout-reference/explore-and-camp.png`。

最终按钮通关输出：

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
  "elapsedSeconds": 241,
  "normalSaveUnchanged": true,
  "errors": [],
  "warnings": [],
  "missing": [],
  "remote": []
}
```

这是浏览器真实控件自动化通关；规划可只读状态与地形，行动通过按钮完成，未注入资源或直接调用行动接口。它与模型层回归分开记录，不代表真人平衡评价。

## 字节核验与安装包边界

独立比较原 1.3.6 APK 与当前生成资源：两边均为 170 个文件，无新增、无缺失，只有 `css/rogue.css` 和 `script/rogue/rogue.ui.js` 字节变化。

共 58 个打包 JavaScript 文件中唯一变化是 UI 脚本；18 个 Rogue 非 UI 源脚本与原 APK 对应文件逐字节一致。普通模式 `engine.js`、`Button.js` 和 `events.js` 经过既有 prepare 适配后与原包一致，其余普通模式脚本也无新增差异。当前 UI / CSS 源文件与生成资源逐字节同步。

原 `release/1.3.6/a-dark-room-offline-1.3.6.apk` 保持 5,793,445 字节，SHA-256 未变：

```text
7c879d61404d1a13b82c281a2fdfba10a375cb2ac36a060ffdf4898660b07101
```

本轮未改版本号、未重新构建或覆盖 APK。未做 Android 真机安装、系统文件选择器和 WebView 验证。

## 各日志末尾输出

`.local/layout-reference-core.log`

```text
    "storage quota failure rolls back an already-written slot without throwing"
  ]
}
```

`.local/layout-reference-issues.log`

```text
PASS all four restock entrances disable real no-ops; camp/party keyboard and hidden focus are safe; building names, automatic-save copy, native backup controls and two-step exit work
PASS full active gauges with missing reserves remain useful, the next refill disables, and secondary-page metadata follows open and back
PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
```

`.local/layout-reference-storage.log`

```text
PASS moving a shelter leaves a visible cache at the original tile without teleporting, duplicating or deleting stored items
PASS expiry and dismantling preserve reclaimable supplies, caches are pickup-only and disappear when empty, malformed stores are rejected and ordinary bytes stay unchanged
PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
```

`.local/layout-reference-ui.log`

```text
PASS real completed-run fixture renders its ship ending, enters and reloads the abyss, then returns without inventory or economic changes
PASS ten phone/landscape/desktop themes cover every camp subpage, recipe category, research page, world chart and combat with 44px controls and complete translations
{"passed":true,"checks":10}
```

`.local/layout-reference-storage-ui.log`

```text
PASS warehouse uses one direct manifest, clamps requested counts to stock and remaining capacity, selects companion packs and returns to the dashboard without advancing time
PASS remote stores are read-only; shelter supplies survive reload, confirmed dismantling and expiry, remain at the original tile and are picked up without duplication
PASS fourteen day/night layouts cover direct storage, narrow-screen actions and fixed returns; tall-phone previews and larger maps fit above logs and adapt across rotation/height changes
```

`.local/layout-reference-survival-ui.log`

```text
PASS real controls conserve gear through warehouse and companion transfers, allow dismissal, lock the crafted water skin and persist the warning preference
PASS merchant purchase/reload, displayed escape odds and confirmed/cancelled replacement of the second camp work through real controls
PASS ten phone/landscape/desktop theme layouts cover live logs, member/gear/pack/transfer dialogs and the complete accessible campfire illustration
```

`.local/layout-reference-expansion-ui.log`

```text
PASS four late-game layouts, nine explored regions, unlocked modules, camp limit, confirmed/cancelled cargo disposal, reload and normal save isolation
```

`.local/layout-reference-home.log`

```text
{"passed":true,"checks":9,"layoutScenarios":24}
```

`.local/layout-reference-save-slots.log`

```text
{"passed":true,"checks":14}
```

`.local/layout-reference-offline.log`

```text
{"width":360,"height":584,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":195,"top":160.390625,"right":340,"bottom":355.390625,"left":20},"wanderer":{"x":173.9921875,"y":246.390625,"width":12.015625,"height":23,"top":246.390625,"right":186.0078125,"bottom":269.390625,"left":173.9921875},"menu":{"x":0,"y":520,"width":360,"height":64,"top":520,"right":360,"bottom":584,"left":0},"controls":{"x":20,"y":368,"width":320,"height":140,"top":368,"right":340,"bottom":508,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":593,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":360,"height":640,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":320,"height":223,"top":160.390625,"right":340,"bottom":383.390625,"left":20},"wanderer":{"x":173.9921875,"y":260.390625,"width":12.015625,"height":23,"top":260.390625,"right":186.0078125,"bottom":283.390625,"left":173.9921875},"menu":{"x":0,"y":576,"width":360,"height":64,"top":576,"right":360,"bottom":640,"left":0},"controls":{"x":20,"y":396,"width":320,"height":168,"top":396,"right":340,"bottom":564,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":593,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
{"width":412,"height":915,"passed":true,"worldLayout":{"map":{"x":20,"y":160.390625,"width":372,"height":498,"top":160.390625,"right":392,"bottom":658.390625,"left":20},"wanderer":{"x":199.9921875,"y":397.890625,"width":12.015625,"height":23,"top":397.890625,"right":212.0078125,"bottom":420.890625,"left":199.9921875},"menu":{"x":0,"y":851,"width":412,"height":64,"top":851,"right":412,"bottom":915,"left":0},"controls":{"x":20,"y":671,"width":372,"height":168,"top":671,"right":392,"bottom":839,"left":20},"mapFont":20,"full":false},"nightModeChecked":false,"resourceRequests":593,"remoteRequests":[],"missingAssets":[],"errors":[],"checks":["Chinese Android launch","light fire","save/reload","native restore transaction","invalid import safety","Base64 save roundtrip","Chinese-only language lock","menu/messages drawers","persistent font controls","readable centered nearby map","map follows player","overview toggle","map tap safety","map touch movement","combat input lock","ship hold/release","sensor tilt/neutral","65s pause/resume","FLAC audio decoding","narrow-screen layout","no network"]}
```

`.local/layout-reference-final-playthrough.log`

```text
  "missing": [],
  "remote": []
}
```
