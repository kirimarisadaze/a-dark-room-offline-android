# 1.3.12 构建、发布与集成验证

版本为 **1.3.12 / versionCode 31**，包名 `org.adarkroom.offline`。本次整合公开 1.3.7 之后的本地界面与交互改动，正式 APK 使用仓库原证书；本地测试证书包单独保留。构建日期按 Asia/Shanghai（UTC+08:00）记录，2026-10-31；Actions API 同一时刻显示 2026-10-30 UTC。

## 源码与独立审核

源码 PR #11 基线 `d6e30840bef2a90aea1e18329c4e3d96821086fe`，候选 `e4270b14f87f6148684b8046349f91fb0a6907f3`，主线合并提交 `7496fab438c3502d224c62e055130bce31c22f30`。候选与合并提交 tree 同为 `9c696860ad80f25d3b8dda052f7c8b6f3335b110`。

经用户授权的独立只读审核检查手势覆盖、纵向滚动、取消/多指/弹窗/战斗/误点保护、当前位置管理权限、行动日志时序、主题同步与普通存档隔离，未发现阻塞合入的可复现缺陷。审核人核读测试断言与实际 PASS 日志，未重复执行测试。未引入游戏运行依赖、联网权限、生成资源或签名材料。

“探索 / 区域 / 队伍”从地图、按钮、日志、底栏和短页空白起手横滑；区域页按脚下地点提供互动；探索日志支持完整时间记录、分批加载和全屏阅读，手机建设采用全宽条目，主页与两种模式同步主题。详细修复及验证见 [横滑验收](QA-SWIPE-COVERAGE-20261031.md)、[区域互动](QA-REGION-SWIPE-20261031.md)、[探索日志](QA-EXPLORE-REDESIGN-20261030.md)。

## 实际回归

同一会话横滑修复后，先生成 171 个资源，再运行 10 个套件：核心 16 项、问题 7 组（含 960 个紧急撤离场景）、储物 5 组、横滑 8 组、通用 UI、探索日志、主页、普通离线、三存档和完整按钮通关，全部通过。手势覆盖五种尺寸、日夜主题及 16/22px 字号共 20 组，并检查误点、纵向滚动、子页阅读位置和普通存档原始字节。

真实新局 seed 42，通过实际控件完成九区、13 个地牢、82 场战斗、飞船结局及深渊第 2 层，共 4175 次行动、4979 次点击，飞船结局第 4195 回合，`cheat=false`。普通档原始字节保持不变，错误、警告、资源缺失与外网请求均为空；自动化运行 931 秒不作为真人游玩时长。规划器只读完整地形，不能等同于仅凭已知信息探索。完整流程发生在同一会话的本地源目录，发布副本没有再跑完整通关。

发布 checkout 另行执行以下检查，退出码均为 0：

| 命令 | 结果 |
| --- | --- |
| `python scripts/test-android-ci.py` | 6 项通过 |
| `node scripts/test-rogue.mjs` | 16 项通过 |
| `node scripts/test-rogue-issues.mjs` | 7 组通过 |
| `node scripts/test-rogue-storage.mjs` | 5 组通过 |
| `node scripts/test-theme-sync.mjs` | 3 组通过 |
| `node scripts/test-rogue-region-swipe.mjs` | 8 组、20 个布局通过 |

发布副本 66 个运行文件与上述已测本地源码统一换行后完全一致。Windows checkout 使用 CRLF，历史验收文档中的 LF 源码 SHA-256 因换行不同而不同；不将这些哈希直接当作正式 APK 原始字节哈希。

输出摘录：

```text
核心："passed": true, "count": 16
问题：PASS emergency and exit confirmations fit short/narrow/tall/landscape/desktop viewports in both actual themes and enlarged type
储物：PASS building a permanent camp at a shelter recovers its local supplies once; existing v3 saves without storage fields remain byte-preserved on load
横滑：PASS map, action buttons, disabled controls, disclosures, title, navigation, time and footer all accept swipes without accidental clicks; fresh taps still act once
横滑：PASS vertical journal and page drags still scroll natively without switching tabs or acting
横滑：PASS local camp, second camp, resource, occupied site, wilderness and dungeon expose matching actions; remote management rejects without mutation
```

## 原签名构建

PR #11 的 [Actions 41098694915](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/runs/41098694915) 离线回归通过；PR 不执行签名作业符合凭证隔离要求。主线 [Actions 41101041734](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/runs/41101041734) 对应上述合并提交，离线回归与原签名构建均成功。下载五份 CI 产物，APK 与 CI 源码 ZIP 的大小、SHA-256 和校验文件均匹配 build-info.json；CI 源码 ZIP 逐文件匹配构建提交的 Git blob。

- APK：`a-dark-room-offline-1.3.12.apk`，**5,797,626 字节**。
- APK SHA-256：`afdefd8cb67e0fb9c53abc5e8de5a835ae81c80d226a0ba59af66674c75c5d94`。
- 原证书 SHA-256：`84604fa048968f6f4bac6ba50fec1ff75566d501a5d4d4ba4ce32221fea81713`。
- 包名、versionName / versionCode、单 signer、v1 / v2 / v3 签名、ZIP 对齐及无 INTERNET 权限通过。
- 178 个 ZIP 条目，171 个网页资源，无反斜杠路径。首次与发布 checkout 比对，仅 `rogue.theme.js` 因本地 LF、云端 CRLF 不同而失败，统一换行后内容相同。随后从同一提交按 Windows CI 的 CRLF 方式检出到独立目录并重新生成资源，171 个资源与 APK 逐字节一致；没有修改生成文件或放宽校验器。独立 `-VerifyOnly` 通过，DEX 包含 1.3.12 关于标题。

最终元数据仅修改文档与 JSON 索引；正式源码 ZIP 必须从最终标签重新生成并逐文件匹配 Git blob，不将较早 CI 构建提交的源码 ZIP 当作最终源码。发布后的标签、源码包哈希及匿名下载验收另记在 Release 与本地交付报告。

## 安装与验证边界

正式包沿用仓库原证书，可覆盖公开原签名 1.3.7。此前本机交付的 1.3.12 测试 APK 使用另一证书，不能直接互相覆盖；切换来源前先导出存档，原测试文件保留。存档继续使用 v3，旧档此前丢失的日志不补造。

**未做 Android 真机安装、手势、系统文件选择器或 WebView 80 实机验证。** 浏览器截图不是手机实拍；当前通关回合、终局铁库存和点击数仍未达到既定平衡目标，真人体验和长期性能仍待验证。
