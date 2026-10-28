# 发布维护说明

本项目为纯 AI 项目，需求和体验反馈由用户提供。新增 Android 封装、适配、文档及测试代码按 MPL-2.0 提供，上游署名与许可必须保留。

## 新版本流程

1. 从 `main` 修改源文件。Android 版本以 `android/app/src/main/AndroidManifest.xml` 的 `versionName` 为准；每次发布递增 `versionCode`。不要直接修改生成的 `assets/game/`。
2. 在 `CHANGELOG.md` 写明行为变化、修复与验证范围。涉及界面或逻辑的改动，运行相应离线回归；原生加载变更还需要验证原生拦截器与实际启动行为。
3. 使用私下保存的 `.local/signing/` 构建；没有原密钥时不能生成可覆盖旧 Release 的 APK。密钥和密码不得写入 Git、Issue 或 Release。
4. 运行构建与 `-VerifyOnly`，核对版本、包名、签名、对齐、无联网权限。复制为带版本号的 APK，生成 SHA-256，保留原始包。
5. 更新 `README.md` 当前版本、下载地址、哈希及 `docs/releases.json` / `docs/RELEASES.md`。在提交前检查文件清单，排除 `.local/`、工具、设备数据和个人资料。
6. 提交完整源码并在该提交创建 `v<version>` 标签；以后每一版都应保留完整工程，不再使用早期归档分支的部分源码模式。
7. 运行 `python scripts/package-source.py`，将 ZIP 复制为带版本号的文件并生成 SHA-256。源码 ZIP 与标签应包含同一版工程文件。
8. 推送提交和标签，用准确的发布说明创建 Release，附带版本化 APK、APK 校验值、完整源码 ZIP 和源码校验值；正常发布设为 Latest，测试版设为 Pre-release。
9. 发布后检查公开可见性、Latest 指向、下载文件大小与 SHA-256；实际下载验证后再更新对外链接。

示例命令（将版本号和说明文件替换为本次发布内容）：

```powershell
git add .
git diff --cached --stat
git commit -m "Release Android v1.0.14"
git tag -a v1.0.14 -m "小黑屋 Android v1.0.14"
python scripts/package-source.py
git push origin main
git push origin v1.0.14
gh release create v1.0.14 --verify-tag --title "小黑屋 · 离线 v1.0.14" --notes-file .local/release-notes-1.0.14.md --latest dist/a-dark-room-offline-1.0.14.apk dist/a-dark-room-offline-1.0.14.apk.sha256 dist/a-dark-room-offline-1.0.14-source.zip dist/a-dark-room-offline-1.0.14-source.zip.sha256
```

上述示例假定版本化文件、校验值和说明已经准备好，不会自动修改 Android 清单或替你处理签名。

## 发布说明约定

- 开头说明本版实际变化，并标注“纯 AI 项目”；保留原作与上游权利说明。
- 写明 Android / WebView 最低要求、存档升级建议、测试范围及已知问题。
- 区分构建日期、归档发布日期、原始签名 APK 与恢复重签产物。
- 明确源码范围。历史标签仅含 APK 中的网页源文件时，不声称是完整历史工程。
- 发布后不静默替换同版本二进制；修复应递增版本、保留历史资产和校验值。

## 本次历史归档

`v1.0.0`–`v1.0.11` 指向 `release-archives` 上各版的实际 APK 网页资源快照，`v1.0.12` 起的标签保留完整工程。归档不是补写或伪造过去的开发提交；构建日期记录在元数据中，提交日期为真实归档时间。完整说明见 [RELEASES.md](RELEASES.md)。
