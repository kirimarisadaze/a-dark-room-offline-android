<!-- SPDX-License-Identifier: MPL-2.0 -->
# 1.3.7 构建、发布与集成验证

2026-10-30，探索与建设结构调整经 PR #9 合入主线。版本为 **1.3.7 / 26**，包名 `org.adarkroom.offline`，正式 APK 使用仓库原签名。Release 提供 APK、最终标签对应的完整源码 ZIP 和两个 SHA-256 文件，GitHub 另提供 Source code ZIP / tar.gz。

## 实现与独立审核

探索、据点和队伍使用顶部文字标签；建设左侧为操作，右侧为资源与人口，建造、制造和研究子页保留右侧库存。地图上方显示行囊与补给，方向控制占用地图右下方的独立空间。保留柔和按钮配色、分页、固定标题、日志、逐级返回与焦点恢复。

独立只读审核确认 19 个候选变更路径均为 UI、CSS、版本、对应测试、文档及浏览器截图；51 份非 UI 游戏与 Android 网页文件规范化换行后与基线一致，行动分发、键盘与表单处理未改。语法、空白和凭证模式检查通过，未提交签名材料、生成资源、IDE 文件或个人存档。游戏逻辑、数值与存档版本保持不变。

候选提交为 `16a649afb58f48c03d812d4e7f31f0b1f785360b`，PR #9 合并提交为 `3d58015d9d17aa1b11051ede23b961dd18193391`，二者 tree 均为 `98456d02289d888850a52be9200a1d8fdfc453f2`。

## 实际执行的本地回归

| 命令 | 结果 |
| --- | --- |
| `node scripts/test-rogue.mjs --playthrough` | 17 项，模型完整流程通过 |
| `node scripts/test-rogue-storage.mjs` | 仓库与临时储物模型通过 |
| `node scripts/test-rogue-issues.mjs` | 撤离、补给、返回与隔离回归通过 |
| `python scripts/test-android-ci.py` | 6 项通过 |
| `node scripts/test-rogue-ui.mjs` | 10 组通过 |
| `node scripts/test-rogue-storage-ui.mjs` | 14 组布局及储物操作通过 |
| `node scripts/test-rogue-survival-ui.mjs` | 生存操作与 10 组布局通过 |
| `node scripts/test-rogue-expansion-ui.mjs` | 4 组后期布局通过 |
| `node scripts/test-rogue-playthrough-ui.mjs` | 真实按钮完整流程通过 |

以上进程均以退出码 0 结束，先使用 `prepare-android-assets.py` 生成资源。主 UI 覆盖 320×512、360×740、412×915、740×360、1440×900 的实际日夜主题与大字号，检查 44px 控件、横向溢出、遮挡、返回、弹窗、焦点和存档隔离。

真实按钮从 seed 42 新局完成九区、13 个地牢、74 场战斗、飞船结局及深渊第 2 层，共 4073 次行动、4619 次点击，飞船结局第 4084 回合。`cheat=false`，普通模式存档原始字节保持不变，错误、警告、缺失资源和外网请求均为空。此轮耗时 231 秒。

模型流程与真实按钮流程分别记录；按钮规划可只读完整地形，不代表仅凭玩家已知信息探索。前序页面调整记录见 [专项核查](QA-REFERENCE-LAYOUT.md)。

## 原签名构建与字节核验

PR #9 的 [云端回归 41024289281](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/runs/41024289281) 通过。主线 [Actions 41024830216](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/runs/41024830216) 的离线回归和原签名构建均成功，覆盖核心模型、问题、储物、新手、离线加载、主页和多存档检查。

构建提交为 `3d58015d9d17aa1b11051ede23b961dd18193391`。云端五份构建产物已下载，APK 与源码 ZIP 的大小及 SHA-256 与 `build-info.json`、校验文件一致；CI 源码 ZIP 逐文件匹配构建提交的 Git blob。正式源码 ZIP 必须从后续最终 `v1.3.7` 标签重新生成，不复用该较早提交的源码 ZIP。

- APK：`a-dark-room-offline-1.3.7.apk`，**5,789,349 字节**。
- SHA-256：`ef490e86cbd13f195aeb0429d2173ee0875b4f9c3de267103ad18d56f1a8a21a`。
- 原证书 SHA-256：`84604fa048968f6f4bac6ba50fec1ff75566d501a5d4d4ba4ce32221fea81713`。
- 单 signer、v1 / v2 / v3 签名、包名与两项版本字段、ZIP 对齐、无 INTERNET 权限检查通过。
- 177 个 ZIP 条目、170 个网页资源，无 Windows 反斜杠条目。

本机候选将改动文本显式保存为 LF，Windows CI 检出为 CRLF；直接比较时仅 UI JS 与 CSS 体现这项换行差异。按 CI 的 Windows 检出方式在独立目录导出同一提交并重新生成资源后，170 个资源与云端 APK 逐字节一致，没有修改生成物或放宽校验器。它们也与前序本地 1.3.7 已完整按钮通关的 170 个网页资源逐字节一致。

后续发布元数据仅修改文档与 JSON 索引，APK 构建输入保持上述构建提交的内容。源码 ZIP 最终按标签 Git blob 核对，正式附件下载验收记录在 Release 说明与发布交付记录中。

## 安装与验证边界

正式 APK 可覆盖本项目公开原签名的 1.3.3；升级前建议备份存档。此前本机的 1.3.7 测试 APK 使用另一证书，不能与正式包直接互相覆盖，原测试文件保留。

存档继续使用 v3，兼容 v1 / v2；普通模式两个原始存档字符串保持隔离，坏档不静默覆盖。Android 最低 6.0、WebView 最低目标 80，完全离线。

**未做 Android 真机安装、系统文件选择器或 WebView 80 实机验证。** 浏览器截图不是手机实拍；当前回合、终局铁库存和点击数仍未达到既定平衡目标，本次未调整经济或玩法。
