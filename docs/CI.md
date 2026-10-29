<!-- SPDX-License-Identifier: MPL-2.0 -->
# GitHub 自动打包

[项目首页](../README.md) · [新环境接手](HANDOFF.md) · [本机构建](ANDROID.md) · [正式发布](RELEASING.md) · [打开 Actions](https://github.com/kirimarisadaze/a-dark-room-offline-android/actions/workflows/android-build.yml)

[Android APK workflow](../.github/workflows/android-build.yml) 沿用 `build-android.ps1`。有 Actions 操作权限的新电脑或新 AI 可触发云端构建、下载原签名 APK，无需把正式私钥搬到每台电脑。

## 触发与下载

| 操作 | 行为 |
| --- | --- |
| 向 `main` 提 PR | 只运行回归，签名 job 跳过 |
| 游戏、Android、构建代码或该 workflow 合入 `main` | 回归通过后自动签名打包 |
| `main` 的 `docs/releases.json` 更新 | 核对发布身份并构建 |
| 普通说明文档更新 | 不触发 push 打包；PR 仍做回归 |
| Actions 页面手动运行，选择 `main` | 测试并打包当前主线 |

新环境先登录有权限的 GitHub 账号，也可用 CLI：

```powershell
gh auth status
gh workflow run android-build.yml --ref main --repo kirimarisadaze/a-dark-room-offline-android
gh run list --workflow android-build.yml --branch main --limit 5 --repo kirimarisadaze/a-dark-room-offline-android
```

查看对应运行的 `Offline regression` 与 `Original-signature APK`，两项成功后下载运行页面底部的 artifact。命令发出不等于构建成功。

产物名为 `android-版本-提交前12位`，保留 **30 天**，包含版本化 APK、完整源码 ZIP、两个对应的 `.sha256` 文件及 `build-info.json`。后者记录版本、包名、完整提交 / tree、公开证书指纹、文件大小和哈希；版本来自实际清单，源码 ZIP 的每个成员与该提交的 Git blob 逐字节一致。

运行页面可找到 run ID；将示例中的 `RUN_ID` 替换为对应数字：

```powershell
gh run view RUN_ID --repo kirimarisadaze/a-dark-room-offline-android
gh run download RUN_ID --dir .local/cloud-build-RUN_ID --repo kirimarisadaze/a-dark-room-offline-android
```

Actions artifact 下载需要 GitHub 登录，不是长期公开 Release 附件。过期可重新触发构建；正式版本仍从 [Releases](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases) 获取。

## 签名与权限

原签名保存在本仓库 **`android-signing` GitHub environment**，部署分支仅允许 `main`：

| Environment Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 原 JKS 文件的 Base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | 原签名密码 |

Base64 是编码，私密性来自 Secrets 的存储与访问控制，不要公开编码文本。凭证不进入源码、artifact 或日志。日常构建使用已配置的环境，不覆盖 Secrets；维护者仍须保留私有离线备份，Secrets 无法作为可下载的密钥备份。

workflow 的 token 只有源码读取权限。测试 job 不接收 Secrets；正式签名仅限本仓库主线 push / 手动运行，没有 `pull_request_target`，PR / Fork 不运行签名 job。Actions 固定到完整 SHA。签名在临时 runner 中恢复、先核对历史证书，结束时仅清理本次创建的签名文件。不要为了换电脑重新生成密钥或修改历史指纹来绕过检查。

## 验证范围

- Ubuntu：CI 边界测试、三项必跑 Rogue 回归、新手目标与补给反馈专项、离线加载、主页和普通多存档。Playwright 安装在临时目录，不进入游戏依赖或源码包。
- Windows：JDK 17、Android SDK 35 / Build Tools 35.0.0；原脚本构建，核验 v1 / v2 签名、原证书、包名、两个版本字段、ZIP 对齐、无联网权限和全部生成资源。
- 导出：已跟踪文件不能被构建修改；源码 ZIP 清单及字节必须匹配提交，排除私钥、工具、生成目录和未提交文件。

这些检查不等于完整按钮通关、Android 真机验证或真人平衡测试；相应任务仍需满足 [AGENTS.md](../AGENTS.md)。回归失败不签名；Secrets 缺失、证书 / 包名 / 版本不匹配时失败，不回退生成新密钥。

## 正式发布

此 workflow 只产出构建包，不自动递增版本、打标签、合并 PR、创建 Release 或覆盖旧附件。连续构建可能沿用相同应用版本，须按完整提交识别，不能称为新的正式版本。

负责人按 [发布流程](RELEASING.md) 选定已审核主线及已验证 APK，记录 run ID、提交、文件哈希与原证书。随后只更新发布文档时可复用 APK，但须确认全部 APK 构建输入与最终提交一致，并从最终发布提交重新生成源码 ZIP。涉及游戏、原生资源、生成脚本或版本字段的变化必须重新构建；旧提交源码 ZIP 不能冒充后续标签的源码。
