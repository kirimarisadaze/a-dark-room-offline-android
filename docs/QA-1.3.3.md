<!-- SPDX-License-Identifier: MPL-2.0 -->
# 1.3.3 构建、发布与集成验证

2026-10-29，PR #2 的新手目标与补给反馈整合到自动打包主线。应用版本为 **1.3.3 / 22**，保持原包名与原签名；[Release](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases/tag/v1.3.3) 提供 APK、最终标签对应的完整源码 ZIP 和各自 SHA-256。GitHub 另提供 Source code ZIP / tar.gz，历史版本附件保留。

## 已执行的组合回归

游戏与 UI 测试针对整合主线后的 `c536147a85d0df8a4c61a86d8130f891687554dc` 执行，PR #2 合并 tree 与该提交一致。本次版本准备只改 Android 版本字段、关于标题及维护记录，没有后续游戏逻辑改动。

| 命令 | 实际结果 |
| --- | --- |
| `node scripts/test-rogue.mjs` | 16 组通过 |
| `node scripts/test-rogue-issues.mjs` | 7 组通过 |
| `node scripts/test-rogue-storage.mjs` | 5 组通过 |
| `node scripts/test-rogue-survival.mjs` | 8 组通过 |
| `node scripts/test-rogue-onboarding.mjs` | 8 组通过 |
| `node scripts/test-rogue-ui.mjs` | 10 组通过 |
| `node scripts/test-rogue-storage-ui.mjs` | 3 组通过，14 组布局 |
| `node scripts/test-rogue-survival-ui.mjs` | 3 组通过，10 组布局 |
| `node scripts/test-rogue.mjs --playthrough` | 模型流程 17 组通过，含深渊共 5345 回合 |
| `node scripts/test-rogue-playthrough-ui.mjs` | 真实按钮流程通过，结果见下 |

测试前使用 `prepare-android-assets.py` 生成 Android 静态资源。布局覆盖 320×512、360×740、412×915、740×360、1440×900，分别验证实际日夜主题与大字号。控制台错误 / 警告、缺失资源和外网请求均为零。新手告警、坏档、旧档原文及普通模式两份存档字节隔离专项通过。

PR #2 最新提交的云端回归 [40886440046](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/runs/40886440046) 成功。独立只读审核覆盖完整实现、主线整合和新增 CI，确认既有经济数值 / 随机流未改变、目标导航与供给读取不推进回合；详细需求范围见 [核查记录](NEWCOMER_EXPERIENCE.md)。

## 重新执行的真实按钮流程

从 seed 42 新局开始，通过可见控件完成九个区域、13 个地牢、74 场战斗、飞船结局、深渊第二层与退出主页。4073 次行动、4619 次点击，飞船结局 4084 回合，深渊最佳层数 2；未注入资源、生命、迷雾或图纸，普通模式存档原始字符串保持不变。模型层流程与按钮流程单独记录，不能混称。

规划器可只读完整地形，不代表仅使用玩家已知信息的探索。现有基线的总回合、终局铁库存和点击数仍未达到平衡目标，地牢总回合占比尚未独立统计；本次未修改经济，不能声称平衡合格。

## 构建与验证边界

主线 [Actions 40888195897](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/runs/40888195897) 已实际通过离线回归、原证书核验、Android 构建、签名清理与产物上传。已下载五个产物，核对原证书、单 signer、v1 / v2、包名 / 版本 / 对齐 / 无联网权限、170 资源字节、每个源码 Git blob 和两个哈希；私下扫描日志与解压产物未发现实际凭证。

APK 来自提交 `b38d3fea36552f16bcf0768a8de2aebae48e9224`，5,785,253 字节，SHA-256 为 `05c79c516aaa7db9b356de13deb86a9f2105c7c107a201efc8436873c5c190c1`。后续发布准备仅改文档与元数据，需复核全部 APK 构建输入一致，再从最终发布标签重新生成源码 ZIP；正式附件不能复用旧提交的源码包。最终标签、源码哈希及匿名下载验收记录在发布 PR。

浏览器布局图是自动化截图，**未做 Android 真机安装、系统文件选择器或 WebView 80 实机验证**。APK 使用 versionCode 22，可覆盖原签名的 1.3.2 / 21；建议体验前备份存档。Actions 产物保留 30 天，长期正式版本从 Releases 获取。
