<!-- SPDX-License-Identifier: MPL-2.0 -->
# 参与维护

[项目首页](README.md) · [文档目录](docs/README.md) · [AI 多人协作流程](docs/AI_COLLABORATION.md)

## 反馈问题

在 [本项目 Issues](https://github.com/kirimarisadaze/a-dark-room-offline-android/issues) 先搜索相似问题。报告中写明应用、Android 与 WebView 版本，使用的模式、字号和日夜主题，以及复现步骤、预期和实际结果。界面问题可附截图；不要公开个人存档、签名密钥或令牌。

安装、声音和存档问题可先查 [常见问题](docs/PLAYING.md#常见问题) 与 [备份说明](docs/PLAYING.md#存档与备份)。

## 提交改动

1. 先读 [AGENTS.md](AGENTS.md)、[AI_README.md](AI_README.md) 与 [协作流程](docs/AI_COLLABORATION.md)，检查已有进度和相关 PR。
2. 每个独立任务使用自己的目录和 `codex/` 分支，明确文件范围与验收条件；不覆盖其他任务的改动。
3. 保持原生 JavaScript、离线运行、MPL-2.0 署名和普通存档隔离。实现与测试入口见 [Android 开发说明](docs/ANDROID.md)。
4. 运行三项必跑回归，界面改动另按维护约定检查布局与真实按钮完整通关。报告实际结果、失败与未验证项；模型测试和真机测试分别说明。
5. 向目标分支提交 PR，说明具体行为、验证结果和依赖，由独立审核人检查后统一集成。任务有依赖时注明前置 PR，避免重复合入。

纯文档整理检查链接、图片、锚点、引用与目录，不递增应用版本或发布 APK；仍执行 [AGENTS.md](AGENTS.md) 要求的回归。正式发包另读 [发布说明](docs/RELEASING.md)。

## 上游资料

原版英文贡献指南保留在 [docs/upstream/CONTRIBUTING.md](docs/upstream/CONTRIBUTING.md)，设计与翻译资料见 [上游资料目录](docs/upstream/README.md)。它们保留原文；本项目的 Issue、PR 和当前维护约定以本仓库入口为准。
