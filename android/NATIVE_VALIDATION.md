# 原生离线验证

`android/tests` 是独立的 Android Platform Instrumentation 测试程序，不依赖 JUnit 或 Gradle，不进入游戏主 APK。测试程序与游戏使用本项目相同的本地签名。测试 APK 只输出至 `.local/native-tests/offline-smoke-tests.apk`，不作为游戏安装包交付。

## 当前验证状态

1.0.4 已在 Android 7.0 API24 ARM 专用模拟器上完成 `InterceptionProbe` 的11项原生检查。该测试直接创建已安装主包的真实 `LocalAssetsClient`，旧版1.0.3对 `data:` / `blob:` / `about:blank` 返回403，新版1.0.4交回 WebView 处理，三项本地 HTML/JS/音频均返回200，缺失资源404，外网、越界路径及外部文件仍返回403。所有11项通过。测试不构造图形 WebView，因此不等于完整游戏启动验证。

测试代码已经完成 Java 编译、D8 转换、APK 打包与签名验证，即 `BuildOnly` 已通过。专用 ARM 模拟器已安装 WebView 100；1.0.4 的完整运行测试在其 GPU 初始化阶段失败（No suitable EGL configs、SharedImageStub 无法创建，随后 JavaScript 回调超时），不能表述为完整运行通过。只有脚本实际输出通过并生成 `passed: true` 的 `native-report.json` 后，才能确认该次运行通过。

此前离线 Chromium 页面测试覆盖了网页界面，但不覆盖 Android WebView 启动、原生资源拦截与重载路径。用户设备的 WebView 版本和具体加载错误尚未取得。最初查询的外部模拟器使用 Android 6/WebView 44，并存在独立 EGL/GPU 崩溃；该现象不能直接当作用户反馈的根因。

## 用法

在项目根目录运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-android.ps1 -BuildOnly
```

运行完整测试：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-android.ps1
```

脚本会以 `install -r` 安装当前 `dist/a-dark-room-offline.apk` 和测试 APK，随后运行：

```text
adb -s emulator-5582 shell am instrument -w -r org.adarkroom.offline.tests/org.adarkroom.offline.tests.OfflineSmoke
```

脚本硬性限制完整运行只使用本项目专用 `emulator-5582`；不会操作 `emulator-5556` 或其他设备，也不执行 `pm clear`。可传入 `-JavaHome`、`-AndroidSdk`、`-TargetApk` 指定工具和主包路径。

测试会捕获初始游戏存档及 localStorage 偏好，在测试期间验证恢复、导入、重开事务，并在 `finally` 尝试还原。应始终使用专用测试模拟器，不能拿用户日常游戏设备代替。若进程在还原前被杀，完整还原无法保证，因此请保留模拟器快照或独立测试数据。

## 检查内容

- Engine、Room、OfflineGame 初始化完成，原生标记 `ADRNativeLocalApp === true`。
- 页面完整地址为 `https://appassets.androidplatform.net/game/index.html`；HTTPS 仅是应用内虚拟资源来源，HTML 由 AssetManager 直接读取。完整路径用于音频相对路径解析。
- 主应用没有 INTERNET 权限，本地 JavaScript 与音频 fetch 可读取安装包资源。
- 点击生火按钮改变火势和木材数量。
- 保存后调用 `WebView.reload()` 和 `OfflineGame.reload()`，进度与原生标记保持。
- 原生关于对话框关闭、本地 about.html 返回链接和 Android 返回键。
- 通过 Activity 实际恢复方法执行恢复事务，旧页面的保存不会覆盖新存档。
- Base64 网页导入及重开事务能重新初始化。
- 外网 fetch 和外部导航被拒绝。
- 测试结束恢复初始进度和偏好。

测试结果位于 `.local/native-tests/native-report.json`，原始 Instrumentation 输出位于同目录 `instrumentation.txt`。首次完整运行尚未完成时，这些文件可能不存在，或者保留先前失败结果；不能把 APK 编译成功当作运行结果。

## 资源打包专项验证

1.0.2 安装包的原始 ZIP 名称包含 Windows 反斜杠，例如 `assets/game\index.html`，导致 Android `AssetManager.open("game/index.html")` 找不到该资源。在 Windows 上 Python 的 `ZipInfo.filename` 会把反斜杠标准化，因此必须检查 `ZipInfo.orig_filename`。证据保留于 `.local/asset-review/broken-1.0.2-paths.json`。

新构建通过 `scripts/assemble-android-apk.py pack` 显式写入 POSIX 路径，再经签名与对齐。独立执行以下命令会检查原始 ZIP 路径、全部146项资源内容、首页完整HTML和关键脚本/中文/音效：

```powershell
python scripts/assemble-android-apk.py verify dist/a-dark-room-offline.apk
```

还可运行不创建 Activity 或 WebView 的原生 `AssetProbe`：

```text
adb -s emulator-5582 install -r .local/native-tests/offline-smoke-tests.apk
adb -s emulator-5582 shell am instrument -w -r org.adarkroom.offline.tests/org.adarkroom.offline.tests.AssetProbe
```

该程序只通过目标应用的 AssetManager 读取首页、适配脚本、样式、中文和音效，报告字节数、SHA-256及异常，不修改存档。其通过仅证明资源可读取，不能代替完整游戏运行验证。

## 内部启动文档拦截回归

```text
adb -s emulator-5582 shell am instrument -w -r org.adarkroom.offline.tests/org.adarkroom.offline.tests.InterceptionProbe
```

`0` 表示返回 null，由 WebView 处理内部文档；其他数值为实际 HTTP 状态。对照结果位于 `.local/native-startup/v103-interceptor.txt` 和 `v104-interceptor.txt`，新版结构化结果随交付包提供 `dist/interceptor-report.json`。测试没有创建 Activity、启动图形组件或改动存档。
