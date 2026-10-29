<!-- SPDX-License-Identifier: MPL-2.0 -->
# 文档目录

[返回项目首页](../README.md) · [下载最新版](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases/latest) · [反馈问题](https://github.com/kirimarisadaze/a-dark-room-offline-android/issues)

## 游玩与备份

| 内容 | 入口 |
| --- | --- |
| 安装、升级与 APK 校验 | [安装与升级](PLAYING.md#安装与升级) |
| 模式选择、普通模式操作 | [功能与操作](PLAYING.md#功能与操作) |
| 随机九区、据点、队伍、地牢与深渊 | [生存模式详解](ROGUELIKE.md) |
| 三存档、文件备份、恢复与迁移 | [玩家说明](PLAYING.md#存档与备份) · [存档实现](../android/SAVE_SLOTS.md) |
| 安装失败、WebView、声音等问题 | [常见问题](PLAYING.md#常见问题) |
| 普通模式与生存模式画面 | [界面截图](SCREENSHOTS.md)（可能包含后期内容） |

## 开发与协作

| 内容 | 入口 |
| --- | --- |
| 离线实现、工具要求、构建与签名 | [Android 开发说明](ANDROID.md) |
| 不迁移私钥的云端构建、触发与下载 | [GitHub 自动打包](CI.md) |
| 自动化检查命令与环境 | [测试与验证范围](ANDROID.md#测试与验证范围) |
| 源码与入口位置 | [目录结构](ANDROID.md#目录结构) |
| Issue / PR 与验证要求 | [贡献指南](../CONTRIBUTING.md) |
| AI 开工规则与已确认约定 | [AGENTS.md](../AGENTS.md) · [AI_README.md](../AI_README.md) |
| 换电脑、新 AI 窗口、私有签名恢复与接续发版 | [新环境接手](HANDOFF.md) |
| 不同任务、独立目录、分支、审核与交接 | [AI 多人协作流程](AI_COLLABORATION.md) |
| 版本选择、原签名、源码包与 GitHub 发布 | [发布维护说明](RELEASING.md) |

## 版本与验证

| 内容 | 入口 |
| --- | --- |
| 各版改动 | [CHANGELOG.md](../CHANGELOG.md) |
| APK / 源码下载与历史说明 | [版本归档](RELEASES.md) · [GitHub Releases](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases) |
| 机器可读发布元数据 | [releases.json](releases.json) |
| 功能与界面历史验证 | [VALIDATION.md](../android/VALIDATION.md) |
| 窄屏、大字与主题历史验证 | [LAYOUT_VALIDATION.md](../android/LAYOUT_VALIDATION.md) |
| 原生资源拦截与真机验证限制 | [NATIVE_VALIDATION.md](../android/NATIVE_VALIDATION.md) |
| 1.3.2 撤离、整备与返回专项 | [QA-1.3.2.md](QA-1.3.2.md) |
| 1.3.3 测试构建与集成验证 | [QA-1.3.3.md](QA-1.3.3.md) |
| 新手目标、补给反馈与后续改进 | [需求核查](NEWCOMER_EXPERIENCE.md) · [专项验证](QA-SURVIVAL-ONBOARDING.md) |

验证记录按各自版本和范围阅读；浏览器自动化截图与模型通关不等同于 Android 真机实测。

## 上游与许可

- [许可全文](../LICENSE.md) · [原作来源与改动署名](../android/UPSTREAM.md)
- [上游原始 README](UPSTREAM_README.md)
- [上游设计、事件、翻译与贡献资料](upstream/README.md)
