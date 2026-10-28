# 小黑屋 · 离线 v1.0.11 网页资源归档

**纯 AI 项目**：Android 移植、移动适配、附加功能、测试脚本、文档与发布整理由 AI 根据用户需求和反馈完成；原作及上游代码、翻译、音效和第三方库保留各自作者署名。

这是本次公开归档创建的历史资源快照。`game/` 的 146 个文件直接取自对应 APK，保留逐字节内容。历史构建日期为 2026-10-28，本次归档日期为 2026-10-28；Git 提交时间为实际归档时间，不代表原始开发日期。

**范围：仅 APK 内的网页源码与资源。** 当时的 Android Java 工程、原生清单与构建脚本快照未完整保留。此标签不是可独立构建原版 APK 的完整工程；完整当前工程见 [main](https://github.com/kirimarisadaze/a-dark-room-offline-android/tree/main)。

本版为历史归档，日常使用建议下载最新版。

## 文件

- `game/`：APK 内的 HTML、JavaScript、CSS、中文翻译、图片、音效与许可。
- `asset-manifest.json`：原始 APK 路径、归档路径、逐文件大小和 SHA-256。
- `release.json`：版本、包名、安装包哈希、签名证书指纹、来源及范围。
- `LICENSE.md`：MPL-2.0 全文；第三方署名继续保留在游戏源文件中。

原 APK 中的路径分隔符如果是反斜杠，提取时规范为 `/` 以便源码归档可读；**仅规范路径，不改写文件内容或修补历史安装包**。本目录设置 `* -text`，避免 Git 换行转换改变这些原始文件。

## 安装包与签名

[下载本版 APK](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases/download/v1.0.11/a-dark-room-offline-1.0.11.apk) · [本版 Release](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases/tag/v1.0.11) · [完整版本说明](https://github.com/kirimarisadaze/a-dark-room-offline-android/blob/main/docs/RELEASES.md)

文件 `a-dark-room-offline-1.0.11.apk`，大小 5,672,703 字节；SHA-256：

```text
639211732a125921c6076d3e5f4ea16d7f40a8b84e50b14a791a5c8e384cab4e
```

保留的原始签名 APK，归档时未重新构建或修改。

## 来源

基于 [doublespeakgames/adarkroom](https://github.com/doublespeakgames/adarkroom)，基线提交 `1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`。原作 Michael Townsend / doublespeak games 及上游贡献者；原作、翻译、音效与第三方库署名保留。新增 Android 移植和适配代码同样按 MPL-2.0 提供，非官方商店版本。
