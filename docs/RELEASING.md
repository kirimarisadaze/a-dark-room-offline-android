# 发布维护说明

本项目为纯 AI 项目，需求和体验反馈由用户提供。新增 Android 封装、适配、文档及测试代码按 MPL-2.0 提供，上游署名与许可必须保留。

换电脑或新 AI 窗口先按 [新环境接手](HANDOFF.md) 恢复工具、任务上下文和原签名。当前未配置 GitHub Actions 自动签名构建；合并 PR 不会自动产出 APK。

## 新版本流程

版本按改动规模选择：兼容的修复与界面打磨递增补丁号，新增完整功能递增次版本，不兼容变化才递增主版本。只有实质大型更新才使用“大型更新”等标注，每个发布包的 Android `versionCode` 均递增。

开发、审核与集成遵循 [AI 多人协作流程](AI_COLLABORATION.md)。各任务经独立分支和 PR 合入，由当轮唯一发布负责人统一准备版本与发包；纯文档修改不递增应用版本，也不新建安装包 Release。

1. 从最新 `origin/main` 建立 `codex/release-<version>` 分支，整合已合入任务的变更说明并准备版本。Android 版本以 `android/app/src/main/AndroidManifest.xml` 的 `versionName` 为准；每次发布递增 `versionCode`。不要直接修改生成的 `assets/game/`。
2. 在 `CHANGELOG.md` 写明行为变化、修复与验证范围。涉及界面或逻辑的改动，运行相应离线回归；原生加载变更还需要验证原生拦截器与实际启动行为。
3. 使用私下保存的 `.local/signing/` 构建；没有原密钥时不能生成可覆盖旧 Release 的 APK。密钥和密码不得写入 Git、Issue 或 Release。
4. 运行构建与 `-VerifyOnly`，核对版本、包名、签名、对齐、无联网权限。复制为带版本号的 APK，生成 SHA-256，保留原始包。
5. 更新 `README.md` 当前版本与下载 / 校验链接、`docs/PLAYING.md` 的安装包版本与 SHA-256，以及 `docs/releases.json` / `docs/RELEASES.md`。构建与测试说明统一维护在 `docs/ANDROID.md`。在提交前检查文件清单，排除 `.local/`、工具、设备数据和个人资料。
6. 将版本准备提交为 PR，经过独立审核合入后，以实际合并提交复核或重建 APK，确认版本与全部资源对应，再在该提交创建 `v<version>` 标签。合入后若源码再变更，重新走 PR 与受影响检查；每一版保留完整工程，不再使用早期归档分支的部分源码模式。
7. 运行 `python scripts/package-source.py`，将 ZIP 复制为带版本号的文件并生成 SHA-256。源码 ZIP 与标签应包含同一版工程文件。
8. 确认远端 `main` 包含已审核的发布提交，推送对应标签，用准确的发布说明创建 Release，附带版本化 APK、APK 校验值、完整源码 ZIP 和源码校验值；正常发布设为 Latest，测试版设为 Pre-release。
9. 发布后检查公开可见性、Latest 指向、下载文件大小与 SHA-256；实际下载验证后再更新对外链接。

版本准备完成后的提交示例（将版本号、文件列表和说明替换为本次内容）：

```powershell
git add -- android/app/src/main/AndroidManifest.xml android/app/src/main/java/org/adarkroom/offline/MainActivity.java README.md CHANGELOG.md docs/PLAYING.md docs/releases.json docs/RELEASES.md
git diff --cached --check
git diff --cached --stat
git commit -m "Release Android v1.0.15"
git push -u origin HEAD
gh pr create --base main --title "Prepare Android v1.0.15" --body-file .local/release-pr-1.0.15.md
```

独立审核与合并完成后，由发布负责人执行：

```powershell
git fetch origin
git switch main
git pull --ff-only origin main
# 核对 HEAD 为实际发布合并提交，重新构建或比对该提交的版本、签名和资源。
# 正式源码 ZIP 须与以下标签的文件逐字节一致，必要时使用 git archive。
git tag -a v1.0.15 -m "小黑屋 Android v1.0.15"
python scripts/package-source.py
git push origin v1.0.15
gh release create v1.0.15 --verify-tag --title "小黑屋 · 离线 v1.0.15" --notes-file .local/release-notes-1.0.15.md --latest dist/a-dark-room-offline-1.0.15.apk dist/a-dark-room-offline-1.0.15.apk.sha256 dist/a-dark-room-offline-1.0.15-source.zip dist/a-dark-room-offline-1.0.15-source.zip.sha256
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
