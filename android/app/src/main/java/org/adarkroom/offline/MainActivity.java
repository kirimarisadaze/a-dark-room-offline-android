package org.adarkroom.offline;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.net.Uri;
import android.os.Bundle;
import android.util.Base64;
import android.util.Log;
import android.view.Menu;
import android.view.MenuItem;
import android.view.Surface;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.ConsoleMessage;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceError;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.Collections;
import java.util.Date;
import java.util.Locale;

/** Local assets are served directly from the APK; no socket or HTTP server is opened. */
public final class MainActivity extends Activity implements SensorEventListener {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String START_URL = "https://" + HOST + "/game/index.html";
    private static final String HOME_URL = "https://" + HOST + "/game/home.html";
    private static final String LOG_TAG = "DarkRoomLocal";
    private static final int EXPORT_SAVE = 10;
    private static final int IMPORT_SAVE = 11;
    private static final int MAX_SAVE_BYTES = 2 * 1024 * 1024;
    private WebView webView;
    private String pendingExport;
    private boolean paused;
    private SensorManager sensorManager;
    private Sensor accelerometer;
    private long lastTiltUpdate;
    private String currentPage = HOME_URL;
    private String aboutReturnPage = HOME_URL;
    private boolean localFallbackUsed;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        sensorManager = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
        if (sensorManager != null) accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
        if (savedInstanceState != null) pendingExport = savedInstanceState.getString("pendingExport");
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBlockNetworkLoads(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new LocalAssetsClient());
        webView.setWebChromeClient(new LocalDialogs());
        setContentView(webView);
        loadBundledPage(Uri.parse(HOME_URL));
    }

    /** Bootstrap HTML directly from AssetManager, never through a network navigation. */
    private void loadBundledPage(Uri page) {
        if (!isLocal(page) || !page.getPath().endsWith(".html")) return;
        String path = page.getPath().substring(1);
        if (!safeAssetPath(path)) return;
        try (InputStream in = getAssets().open(path)) {
            String html = readText(in, 2 * 1024 * 1024);
            String bootstrap = "<script>window.ADRNativeLocalApp=true;"
                    + "try{new Function('return 1 ?? 2');if(!window.fetch||!window.Promise||!window.PointerEvent)"
                    + "throw 0;}catch(e){window.__ADR_BOOT_ERROR='当前系统网页组件过旧，需要 Android System WebView 80 或更新版本。';}"
                    + "try{localStorage.setItem('__adr_probe','1');localStorage.removeItem('__adr_probe');}"
                    + "catch(e){window.__ADR_BOOT_ERROR='应用的本地存储不可用，无法保存游戏。';}</script>";
            html = html.replaceFirst("<head>", "<head>" + bootstrap);
            currentPage = page.toString();
            setContentView(webView);
            webView.loadDataWithBaseURL(currentPage, html, "text/html", "UTF-8", currentPage);
            Log.i(LOG_TAG, "Loaded bundled HTML: " + path);
        } catch (Exception error) {
            Log.e(LOG_TAG, "Cannot read bundled HTML: " + path, error);
            showLoadFailure("无法读取安装包内的游戏资源，请重新安装修复版。", false);
        }
    }

    private static boolean safeAssetPath(String path) {
        if (path.contains("\\") || path.contains("\u0000")) return false;
        for (String part : path.split("/")) if (part.equals("..") || part.equals(".")) return false;
        return true;
    }

    private void showLoadFailure(String message, boolean retry) {
        if (isFinishing()) return;
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        int padding = (int) (24 * getResources().getDisplayMetrics().density);
        content.setPadding(padding, padding, padding, padding);
        TextView title = new TextView(this);
        title.setText("小黑屋 · 本地加载");
        title.setTextSize(22);
        content.addView(title);
        TextView description = new TextView(this);
        description.setText(message + "\n\n游戏资源已包含在安装包中，无需打开网站。已有存档不会被清除。");
        description.setTextSize(16);
        description.setPadding(0, padding, 0, padding);
        content.addView(description);
        if (retry) {
            Button button = new Button(this);
            button.setText("重新加载本地游戏");
            button.setOnClickListener(view -> loadBundledPage(Uri.parse(currentPage)));
            content.addView(button);
        }
        setContentView(content);
    }

    private static boolean isLocal(Uri uri) {
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && (uri.getPort() == -1 || uri.getPort() == 443)
                && uri.getUserInfo() == null && uri.getPath() != null
                && uri.getPath().startsWith("/game/");
    }

    private static boolean isBrowserManaged(Uri uri) {
        // loadDataWithBaseURL uses a data: document internally on some WebViews.
        // Returning an HTTP error for it replaces our bundled HTML with an error page.
        String scheme = uri.getScheme();
        return "data".equals(scheme) || "blob".equals(scheme)
                || "about:blank".equals(uri.toString());
    }

    private final class LocalAssetsClient extends WebViewClient {
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            return serve(request.getUrl());
        }
        @Override public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
            return serve(Uri.parse(url));
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return !request.isForMainFrame() || handleNavigation(request.getUrl());
        }
        @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleNavigation(Uri.parse(url));
        }
        @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) recoverLocalPage(request.getUrl(), error.getErrorCode());
        }
        @Override public void onReceivedError(WebView view, int code, String description, String url) {
            if (url != null && url.equals(currentPage)) recoverLocalPage(Uri.parse(url), code);
        }
        @Override public void onPageFinished(WebView view, String url) {
            if (!isLocal(Uri.parse(url))) return;
            currentPage = url;
            view.evaluateJavascript("window.ADRNativeLocalApp=true;window.__ADR_BOOT_ERROR||null", value -> {
                try {
                    Object message = new JSONTokener(value).nextValue();
                    if (message instanceof String) showLoadFailure((String) message, false);
                } catch (Exception ignored) { }
            });
        }
        private void recoverLocalPage(Uri page, int code) {
            Log.e(LOG_TAG, "Main page load failed with code " + code);
            if (isLocal(page) && page.getPath().endsWith(".html") && !localFallbackUsed) {
                localFallbackUsed = true;
                loadBundledPage(page);
            } else {
                showLoadFailure("本地页面加载失败（错误码 " + code + "）。", true);
            }
        }
        private WebResourceResponse serve(Uri uri) {
            if (isBrowserManaged(uri)) return null;
            if (!isLocal(uri)) return error(403, "Forbidden");
            String path = uri.getPath().substring(1);
            if (!safeAssetPath(path)) return error(403, "Forbidden");
            try {
                return new WebResourceResponse(mimeType(path), "UTF-8", 200, "OK",
                        Collections.singletonMap("X-Content-Type-Options", "nosniff"), getAssets().open(path));
            } catch (Exception ignored) {
                Log.e(LOG_TAG, "Missing bundled asset: " + path);
                return error(404, "Not Found");
            }
        }
    }

    private boolean handleNavigation(Uri uri) {
        if (isBrowserManaged(uri)) return false;
        if ("adr-offline".equals(uri.getScheme())) {
            if ("backup".equals(uri.getHost())) exportSave();
            else if ("restore".equals(uri.getHost())) chooseImport();
            else if ("restore-slot".equals(uri.getHost())) chooseImportFile();
            else if ("about".equals(uri.getHost())) showAbout();
            else if ("reload".equals(uri.getHost())) loadBundledPage(Uri.parse(START_URL));
            return true;
        }
        if (isLocal(uri) && uri.getPath().endsWith(".html")) {
            if ("/game/about.html".equals(uri.getPath())) aboutReturnPage = currentPage;
            localFallbackUsed = false;
            loadBundledPage(uri);
        }
        return true;
    }

    private static WebResourceResponse error(int code, String reason) {
        return new WebResourceResponse("text/plain", "UTF-8", code, reason,
                Collections.<String, String>emptyMap(), new ByteArrayInputStream(new byte[0]));
    }

    private static String mimeType(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".flac")) return "audio/flac";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".ogg")) return "audio/ogg";
        return "text/plain";
    }

    @Override public boolean onCreateOptionsMenu(Menu menu) {
        menu.add(0, 1, 0, "立即保存");
        menu.add(0, 2, 1, "备份存档到文件");
        menu.add(0, 3, 2, "从文件恢复存档");
        menu.add(0, 4, 3, "关于与开源许可");
        return true;
    }

    @Override public boolean onOptionsItemSelected(MenuItem item) {
        switch (item.getItemId()) {
            case 1:
                webView.evaluateJavascript("(function(){if(window.OfflineGame){return OfflineGame.save();}return false;})()",
                        value -> toast("true".equals(value) ? "进度已保存在本机" : "游戏尚未准备好，请稍后重试"));
                return true;
            case 2: exportSave(); return true;
            case 3: chooseImport(); return true;
            case 4: showAbout(); return true;
            default: return super.onOptionsItemSelected(item);
        }
    }

    private void chooseImport() {
        if ("/game/home.html".equals(Uri.parse(currentPage).getPath())) {
            webView.evaluateJavascript("window.OfflineHome&&OfflineHome.beginRestore()", null);
            return;
        }
        if (isRoguePage()) {
            webView.evaluateJavascript("!!(window.Rogue&&Rogue.state.current)", ready -> {
                if ("true".equals(ready)) chooseImportFile();
                else webView.evaluateJavascript("Rogue.ui.notice('err.unavailable')", null);
            });
            return;
        }
        chooseImportFile();
    }

    /** Checks the current document's explicit Rogue mode without changing ordinary navigation. */
    private boolean isRoguePage() {
        return "rogue".equals(Uri.parse(currentPage).getQueryParameter("mode"));
    }

    private void chooseImportFile() {
        Intent open = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        open.addCategory(Intent.CATEGORY_OPENABLE);
        open.setType("*/*");
        try { startActivityForResult(open, IMPORT_SAVE); }
        catch (Exception ex) { toast("此设备没有可用的文件选择器"); }
    }

    private void exportSave() {
        webView.evaluateJavascript("(function(){if(window.ROGUE_MODE)return window.Rogue?Rogue.export64():null;"
                + "return window.Engine&&window.State?Engine.export64():null;})()", value -> {
            try {
                Object decoded = new JSONTokener(value).nextValue();
                if (!(decoded instanceof String) || ((String) decoded).isEmpty()) throw new Exception();
                pendingExport = (String) decoded;
                Intent create = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                create.addCategory(Intent.CATEGORY_OPENABLE);
                create.setType("text/plain");
                create.putExtra(Intent.EXTRA_TITLE, "a-dark-room-" + (isRoguePage() ? "rogue-" : "")
                        + new SimpleDateFormat("yyyyMMdd-HHmmss", Locale.ROOT).format(new Date()) + ".adr.txt");
                startActivityForResult(create, EXPORT_SAVE);
            } catch (Exception ex) { toast("无法备份，请等待游戏加载完成并确认文件选择器可用"); }
        });
    }

    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (resultCode != RESULT_OK || data == null || data.getData() == null) {
            if (requestCode == EXPORT_SAVE) pendingExport = null;
            return;
        }
        Uri uri = data.getData();
        if (requestCode == EXPORT_SAVE) {
            try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                if (out == null || pendingExport == null) throw new Exception();
                out.write((pendingExport + "\n").getBytes(StandardCharsets.UTF_8));
                toast("存档备份已保存");
            } catch (Exception ex) { toast("无法写入备份文件，请重新选择位置"); }
            pendingExport = null;
        } else if (requestCode == IMPORT_SAVE) {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                if (in == null) throw new Exception();
                String encoded = readText(in, MAX_SAVE_BYTES).trim();
                String json = encoded.startsWith("{") ? encoded
                        : new String(Base64.decode(encoded.replaceAll("\\s", ""), Base64.DEFAULT), StandardCharsets.UTF_8);
                JSONObject save = new JSONObject(json);
                if (isRoguePage()) {
                    if ((save.optInt("version", -1) != 1 && save.optInt("version", -1) != 2) || !(save.opt("party") instanceof JSONObject)
                            || !(save.opt("regions") instanceof JSONObject) || !save.has("camps")) throw new Exception();
                } else {
                    for (String key : new String[]{"stores", "features", "game", "config"}) {
                        if (!(save.opt(key) instanceof JSONObject)) throw new Exception();
                    }
                }
                String validatedJson = save.toString();
                if (isRoguePage()) {
                    webView.evaluateJavascript("Rogue.confirmRestore(" + JSONObject.quote(validatedJson) + ")", null);
                    return;
                }
                new AlertDialog.Builder(this).setTitle("恢复存档")
                        .setMessage("这会替换当前选中的存档，其他栏位不受影响。建议先备份当前进度。")
                        .setNegativeButton("取消", null)
                        .setPositiveButton("恢复", (dialog, which) -> restoreSave(validatedJson)).show();
            } catch (Exception ex) { toast("存档格式无效或文件过大，当前进度未改动"); }
        }
    }

    private void restoreSave(String json) {
        if (isRoguePage()) {
            webView.evaluateJavascript("!!(window.Rogue&&Rogue.importJSON(" + JSONObject.quote(json) + "))", value -> {
                if (!"true".equals(value)) webView.evaluateJavascript("Rogue.ui.notice(Rogue.save.lastError||'err.corrupt')", null);
            });
            return;
        }
        // Suppress pagehide's save of the old in-memory State while replacing the save.
        String script = "(function(){try{if(window.OfflineGame)OfflineGame.prepareRestore();"
                + "if(!window.SaveSlots)throw 0;SaveSlots.importJSON(" + JSONObject.quote(json)
                + ");return true;}catch(e){if(window.OfflineGame)"
                + "OfflineGame.cancelRestore();return false;}})()";
        webView.evaluateJavascript(script, value -> {
            if ("true".equals(value)) loadBundledPage(Uri.parse(START_URL));
            else toast("无法恢复存档，手机存储可能已满");
        });
    }

    private static String readText(InputStream in, int limit) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192];
        int length;
        while ((length = in.read(buffer)) != -1) {
            if (out.size() + length > limit) throw new Exception("File too large");
            out.write(buffer, 0, length);
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private void showAbout() {
        new AlertDialog.Builder(this).setTitle("小黑屋 · 离线 1.2.1")
                .setMessage("A Dark Room 网页版的独立中文离线封装\n原作：Michael Townsend / doublespeak games 及贡献者\n\n游戏、中文翻译、音效均在安装包中。无需服务器；没有联网权限。进度保存在应用内部，卸载或清除数据前请备份。\n\n上游：github.com/doublespeakgames/adarkroom\n源码基线：1fada4620b6c\n许可：Mozilla Public License 2.0\n\n本封装不属于官方商店版本。")
                .setPositiveButton("关闭", null)
                .setNeutralButton("开源许可", (dialog, which) -> showLicense()).show();
    }

    private void showLicense() {
        try (InputStream in = getAssets().open("game/LICENSE.md")) {
            TextView text = new TextView(this);
            text.setText(readText(in, 128 * 1024));
            int padding = (int) (20 * getResources().getDisplayMetrics().density);
            text.setPadding(padding, padding, padding, padding);
            text.setTextIsSelectable(true);
            ScrollView scroll = new ScrollView(this);
            scroll.addView(text);
            new AlertDialog.Builder(this).setTitle("Mozilla Public License 2.0")
                    .setView(scroll).setPositiveButton("关闭", null).show();
        } catch (Exception ex) { toast("无法读取许可文件"); }
    }

    private final class LocalDialogs extends WebChromeClient {
        @Override public boolean onConsoleMessage(ConsoleMessage message) {
            if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                Log.e(LOG_TAG, "Game JavaScript: " + message.message() + " (line " + message.lineNumber() + ")");
            }
            return true;
        }
        @Override public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
            new AlertDialog.Builder(MainActivity.this).setMessage(message)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm())
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
        @Override public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
            EditText input = new EditText(MainActivity.this);
            input.setText(defaultValue);
            new AlertDialog.Builder(MainActivity.this).setMessage(message).setView(input)
                    .setPositiveButton("确定", (dialog, which) -> result.confirm(input.getText().toString()))
                    .setNegativeButton("取消", (dialog, which) -> result.cancel())
                    .setOnCancelListener(dialog -> result.cancel()).show();
            return true;
        }
    }

    @Override protected void onPause() {
        paused = true;
        if (sensorManager != null) sensorManager.unregisterListener(this);
        if (webView != null) webView.evaluateJavascript("window.OfflineGame&&OfflineGame.pause()", value -> {
            if (paused && webView != null) { webView.onPause(); webView.pauseTimers(); }
        });
        super.onPause();
    }

    @Override protected void onResume() {
        super.onResume();
        paused = false;
        if (sensorManager != null && accelerometer != null) {
            sensorManager.registerListener(this, accelerometer, SensorManager.SENSOR_DELAY_GAME);
        }
        if (webView != null) {
            webView.onResume();
            // Repair jQuery's animation clock before the first resumed timer can finish a flight.
            webView.evaluateJavascript("window.OfflineGame&&OfflineGame.resume()", value -> {
                if (!paused && webView != null) webView.resumeTimers();
            });
        }
    }

    @Override public void onBackPressed() {
        webView.evaluateJavascript("window.OfflineHome?OfflineHome.back():"
                + "(window.OfflineGame&&OfflineGame.back&&OfflineGame.back())", handled -> {
            if (!"true".equals(handled)) {
                String path = Uri.parse(currentPage).getPath();
                if ("/game/home.html".equals(path)) finish();
                else if ("/game/about.html".equals(path)) loadBundledPage(Uri.parse(aboutReturnPage));
                else webView.evaluateJavascript("window.OfflineGame&&OfflineGame.pause()",
                        value -> loadBundledPage(Uri.parse(HOME_URL)));
            }
        });
    }

    @Override protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        if (pendingExport != null) out.putString("pendingExport", pendingExport);
    }

    @Override protected void onDestroy() {
        if (webView != null) {
            webView.resumeTimers();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    private void toast(String message) { Toast.makeText(this, message, Toast.LENGTH_SHORT).show(); }

    @Override public void onSensorChanged(SensorEvent event) {
        if (paused || webView == null || event.sensor.getType() != Sensor.TYPE_ACCELEROMETER
                || event.timestamp - lastTiltUpdate < 100_000_000L) return;
        lastTiltUpdate = event.timestamp;
        float x = event.values[0];
        float y = event.values[1];
        float screenX;
        switch (getWindowManager().getDefaultDisplay().getRotation()) {
            case Surface.ROTATION_90: screenX = -y; break;
            case Surface.ROTATION_180: screenX = -x; break;
            case Surface.ROTATION_270: screenX = y; break;
            default: screenX = x;
        }
        if (!Float.isNaN(screenX) && !Float.isInfinite(screenX)) {
            webView.evaluateJavascript("window.OfflineGame&&OfflineGame.tilt(" + Float.toString(screenX) + ")", null);
        }
    }

    @Override public void onAccuracyChanged(Sensor sensor, int accuracy) { }
}
