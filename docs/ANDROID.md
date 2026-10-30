<!-- SPDX-License-Identifier: MPL-2.0 -->
# Android 构建与开发

[返回首页](../README.md) · [文档目录](README.md) · [贡献指南](../CONTRIBUTING.md) · [发布流程](RELEASING.md)

以下命令均在仓库根目录执行。应用包名为 `org.adarkroom.offline`；版本以 [AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml) 为准，发布包及历史索引见 [Releases](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases) 和 [版本归档](RELEASES.md)。

换电脑或新 AI 窗口先读 [新环境接手](HANDOFF.md)。可使用 [GitHub 自动打包](CI.md) 在云端构建并下载原签名 APK；下文介绍本机构建，需要重新准备工具并恢复原签名。

[离线实现](#完全离线如何实现) · [源码构建](#从源码构建) · [测试与验证](#测试与验证范围) · [源码归档](#版本与源码归档) · [目录结构](#目录结构)

## 完全离线如何实现

- APK 自带游戏 HTML、CSS、JavaScript、图片、中文翻译和 **86 个 FLAC 音效**。
- 原生入口通过 `AssetManager` 读取安装包内的 HTML，再用 `loadDataWithBaseURL` 显示。
- 固定的 `https://appassets.androidplatform.net/game/index.html` 是 WebView 的**虚拟本地来源**，用于相对路径和本地存储；资源请求全部由原生拦截器从 APK 返回，不访问这个网站，也不启动 HTTP 服务。
- 构建时移除 CDN、统计与其他联网入口，仅打包简体中文。其他来源的资源、导航、文件访问和明文流量被阻止。
- Android 清单没有联网或存储读写权限。存档文件通过系统文档选择器授权访问。

仓库根目录保留上游原始网页源文件，其中可能仍有原作网页链接；安装包使用的是构建脚本生成的离线资源。修改安卓界面请优先编辑 `android/web/`，不要直接修改会被重新生成的 `android/app/src/main/assets/`。

原生入口为 [MainActivity.java](../android/app/src/main/java/org/adarkroom/offline/MainActivity.java)。`shouldInterceptRequest` 提供 APK 内部资源；`data:`、`blob:` 与 `about:blank` 等启动文档由 WebView 处理。导入和重新开始继续使用本地入口。CSP 保留上游状态管理器所需的 `unsafe-eval`；生成脚本只在产物中处理联网入口和移动适配，不改写上游玩法源文件。原生拦截器的历史验证与限制见 [NATIVE_VALIDATION.md](../android/NATIVE_VALIDATION.md)。

## 从源码构建

### 环境

目前提供的构建入口面向 **Windows PowerShell**，需要：

- Python **3.10+**。
- JDK **17**。
- Android SDK Platform **35**、Build Tools **35.0.0** 或更新版。
- 测试时另需 Node.js 和 Playwright Chromium；仅构建 APK 不需要 npm、Gradle、Android Studio 或网页服务器。

可以通过 Android SDK 的 `sdkmanager` 预先安装所需组件：

```powershell
sdkmanager "platforms;android-35" "build-tools;35.0.0"
```

### 构建命令

```powershell
git clone https://github.com/kirimarisadaze/a-dark-room-offline-android.git
cd a-dark-room-offline-android
.\build-android.ps1 -JavaHome 'C:\path\to\jdk-17' -AndroidSdk 'C:\path\to\Android\Sdk'
```

脚本也支持 `JAVA_HOME`、`ANDROID_SDK_ROOT`、`ANDROID_HOME`，可用 `-Python` 指定 Python 可执行文件。若 PowerShell 执行策略阻止脚本，可使用仅对本次进程生效的方式：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\build-android.ps1 -JavaHome 'C:\path\to\jdk-17' -AndroidSdk 'C:\path\to\Android\Sdk'
```

脚本依次生成离线资源、编译 Android 资源与 Java、生成 DEX、对齐、签名并验证。输出：

```text
dist/a-dark-room-offline.apk
dist/a-dark-room-offline.apk.sha256
```

再次验证已有构建：

```powershell
.\build-android.ps1 -VerifyOnly -JavaHome 'C:\path\to\jdk-17' -AndroidSdk 'C:\path\to\Android\Sdk'
```

### 签名与自建版本

首次构建会在 `.local/signing/` 生成独立签名密钥；请私下备份整个目录，后续更新继续使用同一密钥。私钥和密码不在公开仓库或源码压缩包中。

在新电脑直接克隆并生成的密钥与 GitHub Release 的签名不同，因此自建 APK 不能覆盖这里发布的 APK。需要切换时先备份存档，或自行修改包名以便并行安装。不能仅靠相同包名和版本号绕过 Android 的签名检查。

原私钥不绑定电脑。恢复位置、证书指纹比对和云端签名方案的当前状态见 [包名、签名与换电脑](HANDOFF.md#包名签名与换电脑)。

### 打包完整源码

```powershell
python scripts/package-source.py
```

生成 `dist/a-dark-room-offline-source.zip`，排除本地密钥、工具链、中间产物、测试设备、生成资源与 Git 数据。版本号以 `android/app/src/main/AndroidManifest.xml` 为准；根目录 `package.json` 保留上游网页开发工具的元数据。

## 测试与验证范围

Android 界面测试使用断网 Chromium，并将同一虚拟 HTTPS 来源的请求映射到 APK 生成资源，不启动网络服务器。安装测试依赖并准备资源：

```powershell
npm install --no-save --package-lock=false playwright
npx playwright install chromium
python scripts/prepare-android-assets.py
```

运行回归：

```powershell
node scripts/test-offline.mjs
node scripts/test-speed.mjs
node scripts/test-mobile-features.mjs
node scripts/test-ui-details.mjs
node scripts/test-late-game-ui.mjs
node scripts/test-exploration-ui.mjs
node scripts/test-combat-ui.mjs
node scripts/test-map-guide.mjs
node scripts/test-home.mjs
node scripts/test-save-slots.mjs
node scripts/test-rogue.mjs --playthrough
node scripts/test-rogue-survival.mjs
node scripts/test-rogue-storage.mjs
node scripts/test-rogue-issues.mjs
node scripts/test-rogue-storage-ui.mjs
node scripts/test-rogue-survival-ui.mjs
node scripts/test-rogue-playthrough-ui.mjs
node scripts/test-rogue-ui.mjs --soak
node scripts/test-rogue-expansion-ui.mjs
```

也可用 `PLAYWRIGHT_MODULE` 指定已有 Playwright 包的绝对路径。报告与截图保存在 `.local/` 下各脚本对应的目录。

模型层 `test-rogue.mjs --playthrough` 通过合法行动跑完结局与深渊；`test-rogue-playthrough-ui.mjs` 从新局点击真实控件推进，不注入物资、生命或迷雾。两类结果分别报告。`--soak` 为额外长时检查，可去掉以进行常规 UI 回归。

历史验证记录各自注明版本和范围，不代表每次文档整理都重跑了全部游戏流程：

- [功能与界面验证](../android/VALIDATION.md)
- [布局验证](../android/LAYOUT_VALIDATION.md)
- [原生拦截器验证与限制](../android/NATIVE_VALIDATION.md)
- [1.3.2 专项核验](QA-1.3.2.md)

浏览器截图不当作手机实拍；未连 Android 设备时，不声称已完成真机安装、系统文件选择器或 WebView 实机验证。真人通关时长与长期平衡也须另行记录。

## 版本与源码归档

[Release 页面](https://github.com/kirimarisadaze/a-dark-room-offline-android/releases) 提供各公开版本的 APK 与 SHA-256，每版单独说明改动、保存范围和已知问题。当前版本与完整索引见 [版本归档](RELEASES.md)，机器可读清单见 [releases.json](releases.json)。

- `v1.0.12` 起各发布标签均保留完整可构建工程，包括 Android 封装、独立生存模式、界面与测试；当前 Release 附完整源码 ZIP。
- `release-archives` 与 `v1.0.0`–`v1.0.11`：从对应 APK 提取的实际网页源码与资源，以及归档说明、许可和校验信息。未保存的历史原生工程不会用新版源码冒充。
- `1.0.0`、`1.0.1`：从保留的原始构建产物恢复，并用原密钥重新签名；不是当时分发 APK 的逐字节备份。
- `1.0.0`–`1.0.3`：存在已知加载问题，标为历史测试版 / Pre-release，建议安装最新版。

构建日期和本次归档发布日期分别记录；Git 历史从本次公开归档开始。后续版本的发布步骤见 [发布维护说明](RELEASING.md)。

## 目录结构

| 入口 / 目录 | 用途 |
| --- | --- |
| [index.html](../index.html) | WebView 加载的网页入口 |
| [script/](../script/) | 原作逻辑；新增生存模式位于 `script/rogue/` |
| [css/](../css/)、[img/](../img/)、[audio/](../audio/)、[lang/](../lang/)、[lib/](../lib/) | 游戏样式、资源、翻译和保留的上游库 |
| [android/app/src/main/](../android/app/src/main/) | Android 清单、Java 入口、原生主题与图标 |
| [android/web/](../android/web/) | 移动端样式、离线逻辑、主页与存档适配的源文件 |
| [scripts/](../scripts/) | 资源准备、APK / 源码打包、自动化测试 |
| [build-android.ps1](../build-android.ps1) | Windows 构建、签名与校验入口 |
| [docs/](README.md) | 玩家指南、构建、测试、协作、版本记录与截图 |
| [docs/upstream/](upstream/README.md) | 原版设计表、数值笔记、翻译与贡献资料 |
| [tools/](../tools/) | 保留的上游翻译工具 |
| [AGENTS.md](../AGENTS.md)、[AI_README.md](../AI_README.md) | AI 开工规则与用户已确认的长期维护约定 |
| [CONTRIBUTING.md](../CONTRIBUTING.md)、[CHANGELOG.md](../CHANGELOG.md)、[LICENSE.md](../LICENSE.md) | 本项目贡献入口、变更记录与许可 |

网页入口、原作资源目录及构建入口保持原位置。根目录 `package.json`、`dev-server.js` 和 `yarn.lock` 保留上游开发工具与元数据；Android 游戏运行和 APK 构建无需 npm 或网页服务器。

`.local/`、`.tools/`、`dist/` 和生成的 `android/app/src/main/assets/` 不提交 Git。界面源文件改 `android/web/`，运行 [prepare-android-assets.py](../scripts/prepare-android-assets.py) 生成离线资源，不直接维护产物。

## 来源与许可

原作 **A Dark Room**：**Michael Townsend / doublespeak games** 及上游贡献者。基线提交为 [`1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7`](https://github.com/doublespeakgames/adarkroom/commit/1fada4620b6c66bd07bf15a3f1eb8223df8bc1d7)。本项目为非官方移植，与官方商店版本无关联。

原始源码、翻译、音效和第三方库保留真实署名与许可；Android 封装、适配层和构建脚本按 MPL-2.0 提供。详见 [许可全文](../LICENSE.md)、[来源与改动](../android/UPSTREAM.md) 和 [上游 README](UPSTREAM_README.md)。本仓库移植与改造由 AI 根据用户需求实现，该标注不改变上游成果的权利归属。
