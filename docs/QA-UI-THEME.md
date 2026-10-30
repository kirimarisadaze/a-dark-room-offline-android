<!-- SPDX-License-Identifier: MPL-2.0 -->
# 界面信息层级与主题同步核查

日期：2026-10-30。基线为正式 1.3.7 提交 d6e30840bef2a90aea1e18329c4e3d96821086fe；本记录对应其后尚未发布的源码改动，现有 1.3.7 APK 不包含此轮变更。

## 实现范围

- 保留顶部探索 / 据点 / 队伍导航、建设左右分栏、固定标题、底部时间、日志与逐级返回。
- 据点左栏分为日常操作和四个管理入口，不重复显示子页配方；费用与阻止操作的原因保留，建筑与研究的长用途说明按需展开，并保持展开状态。
- 增加操作组之间的留白，缩短队伍备用物资提示；菜单的缺水规则可展开阅读。
- 主菜单新增深浅色按钮，与普通、生存模式共用 roguePreferences.dark。没有明确选择时只读回退普通存档的旧主题；损坏普通档不影响共享偏好。
- 主题修改合并保留字号、缺水提醒及未知偏好字段。字号仍保持原有设置范围，只统一深浅色。主页和生存模式不改普通存档；普通模式仅把当前主题应用到正在运行的自身配置。
- 仅改前端、现有 Android 网页集成、翻译、相关测试与文档；游戏引擎、行动层、数值、存档结构和版本号不变。

## 实际验证

先运行 python scripts/prepare-android-assets.py，从源文件生成 Android 网页资源。浏览器以 Android 同源的虚拟 HTTPS 地址加载真实资源，禁止外网，使用独立合成存储，未访问玩家存档。

| 命令 | 结果 |
| --- | --- |
| node scripts/test-theme-sync.mjs | 三处双向同步、实际背景色、跨页即时更新、刷新、旧存档主题、坏档、偏好字段保留、存储失败与展开说明检查通过 |
| node scripts/test-rogue.mjs --playthrough | 17 项，模型完整流程通过 |
| node scripts/test-rogue-storage.mjs | 5 项储物模型通过 |
| node scripts/test-rogue-issues.mjs | 7 项回归通过，含 960 个撤离场景和实际控件 |
| node scripts/test-rogue-ui.mjs | 10 组核心 UI 检查通过 |
| node scripts/test-home.mjs | 9 项、24 个主页布局场景通过 |
| node scripts/test-rogue-storage-ui.mjs | 储物操作与 14 组日夜布局通过 |
| node scripts/test-rogue-survival-ui.mjs | 生存操作与 10 组日夜布局通过 |
| node scripts/test-rogue-expansion-ui.mjs | 4 组后期布局通过 |
| node scripts/test-rogue-onboarding.mjs | 8 项引导、补给提醒与日夜大字检查通过 |
| node scripts/test-offline.mjs | 5 种尺寸的普通模式离线启动、菜单、主题、保存恢复与地图控件检查通过 |
| node scripts/test-save-slots.mjs | 14 项多存档检查通过 |
| node scripts/test-ui-details.mjs | 21 个普通模式设置与布局场景通过 |
| node scripts/test-rogue-playthrough-ui.mjs | 从新局通过实际按钮完整通关，通过 |

核心布局覆盖 320×512、360×740、412×915、740×360、1440×900 的实际日夜主题与大字；检查固定标题、44px 控件、横向溢出、日志、返回和焦点。已查看日夜据点、探索、窄屏建造和研究截图；它们是浏览器截图。

独立只读审核通过；审核者另外重跑主题专项、语法检查和 git diff --check。新增设置保存失败提示已按审核建议移入中文词典。

## 真实按钮完整流程

seed 42；4073 次行动、4619 次点击、74 场战斗、13 个地牢、9 个区域，飞船结局第 4084 回合，随后进入深渊第 2 层并退出。cheat=false；未注入物资、生命、迷雾或图纸；普通存档原始字节不变。错误、警告、缺失资源与外网请求均为空，耗时 229 秒。规划器只读完整地形，不能视为仅凭玩家已知信息探索。

模型通关和真实按钮通关分别执行，未用模型代替控件操作。现有回合与点击数不因此成为真人平衡结论。

## 边界

本轮交付源码，未重新编译或替换公开 1.3.7 APK。未做 Android 真机安装、系统文件选择器及 WebView 80 实机验证。游戏玩法与经济数值没有调整。
