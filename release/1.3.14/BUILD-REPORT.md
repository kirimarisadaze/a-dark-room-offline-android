# 1.3.14 本地构建记录

- 构建日期：2026-10-31；来源：当前工作区 `code/`，包含区域页双列布局。
- 版本：1.3.14 / versionCode 33；包名：`org.adarkroom.offline`；minSdk 23 / targetSdk 35。
- APK：`a-dark-room-offline-1.3.14.apk`，5,801,722 字节。
- SHA-256：`c6a3f891af796c61fa839527ac36aca6ad7f0fb15efb616d0ee90175c0544e85`；与 `code/dist/a-dark-room-offline.apk` 一致。
- 签名证书 SHA-256：`371bca3141e79e9bff04ee8efd908e01d2391fa6123cd3efb10377c912695033`，与本地 1.3.13 相同；v1/v2/v3 签名均通过。

从 `code/` 使用 JDK 17 与 Android SDK 35 执行 `build-android.ps1`，随后执行独立 `-VerifyOnly`。APK 资源完整性、ZIP 对齐、无 INTERNET 权限通过；`aapt2 dump badging` 确认包名、版本和 SDK。记录保存在 `code/.local/build-1.3.14.log`、`verify-1.3.14.log`。

本轮 `test-rogue.mjs`、`test-rogue-issues.mjs`、`test-rogue-storage.mjs` 与 `test-rogue-region-columns.mjs` 均通过，输出见 `code/.local/test-1.3.14-*.log`。区域专项覆盖 20 种布局及双列滚动、栏目、库存和派工。此前完整真实按钮通关见 `code/docs/QA-REGION-COLUMNS-20261031.md`，版本构建后没有重跑完整通关。

保留旧 `release/1.3.13/` 包。本次仅本地构建、归档，未提交、推送或发布；未做 Android 真机验证。此本地签名与 GitHub 正式包不同，不能直接覆盖安装正式包。
