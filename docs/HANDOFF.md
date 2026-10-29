<!-- SPDX-License-Identifier: MPL-2.0 -->
# 换电脑与新 AI 窗口接手

[项目首页](../README.md) · [文档目录](README.md) · [构建与测试](ANDROID.md) · [正式发布](RELEASING.md)

适用于在新电脑、新目录或没有原聊天记录的 AI 窗口继续开发。项目的持久记录是 GitHub 上的源码、维护文档、提交、Issue、PR 和 Release；新 AI 先核实这些记录，再接着已有进度工作。旧电脑路径、旧聊天标题和上次测试结果都不能当作当前环境的事实。

## 给新 AI 的第一条消息

在 AI 工具中打开克隆后的项目目录，将下面这段话和本次需求一起发送即可，无需搬运整段旧聊天：

```text
接手 https://github.com/kirimarisadaze/a-dark-room-offline-android 。
这是已有项目，先读取 AGENTS.md、AI_README.md、docs/HANDOFF.md；
需要打包时再读 docs/ANDROID.md 和 docs/RELEASING.md。
检查当前目录、Git 状态、最近提交、远端 main、未合并 PR 和最新 Release，
说明哪些已在主线、哪些仅在 PR、哪些已经发布 APK，接着已有进度做。
缺少本机工具时先检查并按本次授权配置；不要沿用旧电脑绝对路径。
开发、自检、独立审核、合并和发布按仓库流程及本次授权处理，
无需把常规操作逐个交回给我；遇到真实阻塞说明缺少什么。
正式发包先确认原签名可用，缺失时不要生成新签名冒充可覆盖旧版的更新。
本次需求见我接下来的消息。
```

不同 AI 工具读取本地规则的方式可能不同，首次接手时明确提供上述入口。GitHub 权限与工具登录需要在新环境重新确认；旧聊天里的登录状态不会随源码迁移。

## 哪些能从 GitHub 接续

| 资料 | 新环境如何取得 |
| --- | --- |
| 主线源码、规则、玩法、构建与发布脚本 | 克隆仓库；先读 [AGENTS.md](../AGENTS.md) 和 [AI_README.md](../AI_README.md) |
| 尚未合并的工作、审核和交接 | 查 [开放 PR](https://github.com/kirimarisadaze/a-dark-room-offline-android/pulls) 的分支、正文及实际提交；克隆默认分支不会自动包含它们 |
| 已发布 APK、源码 ZIP 和校验值 | 查 [最新 Release](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases/latest) 与 [版本记录](RELEASES.md) |
| 工具链、缓存和本地测试产物 | 按 [Android 开发说明](ANDROID.md#从源码构建) 在新环境重新安装或生成 |
| 原签名私钥及密码 | 从维护者的私有备份恢复；公开仓库、源码包和 APK 均不能还原私钥 |
| GitHub 写入与发布权限 | 在新环境登录并核实当前账号；公开可读不等于有写权限 |
| 未提交 / 未推送改动、个人游戏存档 | 离开旧环境前另行保存；GitHub 不会自动接收这些数据 |

## 新环境首次准备

以下是新建工作目录的 Windows PowerShell 示例。已有项目目录时先检查现状，不覆盖、不重置别人的工作。

```powershell
git clone https://github.com/kirimarisadaze/a-dark-room-offline-android.git
cd a-dark-room-offline-android
git status --short
git log -5 --oneline
git remote -v
git fetch origin
```

需要查询 PR、推送主仓库或发 Release 时，配置 GitHub CLI：

```powershell
gh auth login
gh auth status
gh pr list --state open
gh release view
```

公开源码可匿名下载；授权页面的登录由账号持有人完成，不把令牌粘进公开文件或聊天。若网络访问失败，先说明远端状态尚未核实，不把缓存中的 `origin/main` 当作已更新。

构建工具为 Python 3.10+、JDK 17、Android SDK Platform 35 / Build Tools 35.0.0+；测试另需 Node.js 和 Playwright Chromium。APK 构建脚本当前面向 Windows PowerShell；换到其他系统不能直接宣称已有同等构建支持。游戏本身仍是离线静态网页，无 npm 运行依赖。安装与命令见 [构建与测试](ANDROID.md)。

## 包名、签名与换电脑

项目保持开源。任何人都能下载、修改，并用自己的签名打包。包名 `org.adarkroom.offline` 标识应用；Android 覆盖升级还要求签名兼容和合适的版本号，只有包名一致并不足够。

正式版本使用同一把签名私钥，私钥不绑定电脑或 AI 窗口。原密钥与密码应完整恢复到实际构建目录中：

```text
项目目录/
  .local/
    signing/
      a-dark-room-offline.jks
      keystore-password.txt
```

**在第一次正式构建之前恢复这两个文件。** 当前脚本找不到密钥时会生成新签名；生成的包能用于自建测试，但不能当作可覆盖既有 Release 的正式更新。日常协作者无需拿到正式私钥，正式发包由指定维护者统一处理。

原私钥只做私有备份与授权迁移，不进入公开仓库、Issue、PR、Release、源码 ZIP 或聊天。公开的是源码、构建流程和证书信息；私钥是签发正式更新的凭证。仅持有包名、APK 或公开证书无法恢复它。缺少原签名时，代码开发和测试仍可继续，正式升级发布须等恢复签名。

构建后使用 `-VerifyOnly` 验证 APK，并把输出的签名证书 SHA-256 与 [releases.json](releases.json) 对应正式版本的 `certificateSha256` 比对。`-VerifyOnly` 校验签名有效性，不自动保证签名与历史 Release 相同；不要把 APK 文件哈希与证书指纹混用。

### 希望签名留在云端

可另行配置 GitHub Actions，由仓库或发布环境的 Secrets 保存原签名与密码，在受控发布任务中使用；这样新电脑可在取得相应 GitHub 权限后触发构建，无需每次搬运私钥。公有代码仓库不妨碍私密保存这些凭证。

**当前仓库尚未配置这套自动签名构建。** 此文没有上传密钥或创建 Secrets；推送代码、创建或合并 PR 都不会自动生成 APK。配置时还需明确 workflow、运行环境、发布触发与权限、签名指纹核对以及不向不可信 PR 暴露凭证，按实际授权单独实现。

## 从接手到新版 APK

1. 先核实 `main`、本次任务分支、相关 PR 和最新 Release，明确接着哪项工作；不把所有开放 PR 自动纳入本次任务。
2. 在独立 `codex/` 分支开发，按 [协作流程](AI_COLLABORATION.md) 运行实际回归、提交并推送，创建或更新对应 PR。
3. 完成独立审核后合入 `main`；多人改动还要检查组合结果。已授权时可由维护 AI 处理，不要求用户逐个手点；没有权限或审核条件不足时如实说明。
4. 用户需要新 APK 时，由发布负责人按 [发布流程](RELEASING.md) 统一准备版本、使用原签名构建并校验；只有文档变化不递增应用版本、不发新 APK。
5. 在实际发布提交上创建标签，上传 APK、源码 ZIP 和两份 SHA-256 文件；检查公开下载、签名与源码对应关系，再报告实际结果。

| GitHub 上的状态 | 能说明什么 |
| --- | --- |
| 已提交并推送 | 代码已保存在远端任务分支 |
| PR 开放 / 待审核 | 改动已经提交供审核，通常仍未进入 `main` |
| PR 已合并 | 改动已进入目标分支；仍须核实目标是否为 `main` |
| Release 已发布并有 APK 附件 | 有可下载的安装包；以该版本标签和附件为准 |

## 离开当前环境前

将本任务可公开的改动提交、推送并记录到对应 PR：当前提交与分支、测试命令和所测提交、审核情况、未完成项、下一步及发布状态。未推送的文件仍只在旧电脑上；签名私钥和个人存档仍需私下备份。后续 AI 先重新检查这些事实，不把历史通过报告当成本次验证。
