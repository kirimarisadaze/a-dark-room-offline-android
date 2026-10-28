package org.adarkroom.offline.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.SystemClock;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.File;
import java.io.FileOutputStream;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/** Standalone platform Instrumentation; deliberately outside the production APK. */
public final class OfflineSmoke extends Instrumentation {
    private static final String READY = "!!(window.Engine && window.Room && window.OfflineGame && "
            + "window.State && window.$SM && Room.panel && document.getElementById('lightButton') "
            + "&& document.readyState === 'complete' && window.ADRNativeLocalApp === true)";
    private Activity activity;
    private WebView webView;
    private String originalSave;
    private String originalStorage;
    private final JSONObject report = new JSONObject();
    private final JSONArray checks = new JSONArray();
    private boolean passed = true;

    @Override public void onCreate(Bundle arguments) {
        super.onCreate(arguments);
        start();
    }

    @Override public void onStart() {
        long started = SystemClock.elapsedRealtime();
        try {
            report.put("runner", getClass().getName());
            report.put("sdk", android.os.Build.VERSION.SDK_INT);
            report.put("targetPackage", "org.adarkroom.offline");
            report.put("checks", checks);
            step("native-startup", () -> {
                Intent intent = new Intent(Intent.ACTION_MAIN);
                intent.setClassName("org.adarkroom.offline", "org.adarkroom.offline.MainActivity");
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                activity = startActivitySync(intent);
                assertTrue(activity != null, "Activity did not start");
                runOnMainSync(() -> webView = findWebView(activity.getWindow().getDecorView()));
                assertTrue(webView != null, "Activity contains no WebView");
                waitFor("!!window.OfflineHome", 45000);
                assertTrue(Boolean.TRUE.equals(js("typeof window.Engine === 'undefined'")),
                        "Title screen must not start the game");
                js("document.getElementById('offline-home-start').click();true");
                js("document.getElementById('offline-mode-normal').click();true");
                waitFor(READY, 45000);
                JSONObject metadata = (JSONObject) js("({href:location.href,origin:location.origin,"
                        + "baseURI:document.baseURI,userAgent:navigator.userAgent,"
                        + "title:document.title,fire:$SM.get('game.fire.value')})");
                report.put("page", metadata);
                assertTrue("https://appassets.androidplatform.net".equals(metadata.getString("origin")),
                        "Unexpected localStorage origin: " + metadata);
                assertIndexUrl(metadata.getString("href"));
                originalSave = (String) js("(function(){Engine.saveGame();return localStorage.gameState;})()");
                originalStorage = (String) js("(function(){var all={};Object.keys(localStorage).forEach("
                        + "function(k){all[k]=localStorage.getItem(k);});return JSON.stringify(all);})()");
                return metadata;
            });
            step("no-internet-permission", () -> {
                int permission = getTargetContext().getPackageManager().checkPermission(
                        "android.permission.INTERNET", "org.adarkroom.offline");
                assertTrue(permission == PackageManager.PERMISSION_DENIED, "Target has INTERNET permission");
                return "permission denied";
            });
            step("local-script-and-audio-response", () -> {
                js("(function(){window.__smokeAssets=null;Promise.all(["
                        + "fetch('script/room.js').then(function(r){return r.text();}),"
                        + "fetch('audio/light-fire.flac').then(function(r){return r.arrayBuffer();})"
                        + "]).then(function(r){window.__smokeAssets={scriptBytes:r[0].length,"
                        + "hasRoom:r[0].indexOf('var Room')>=0,audioBytes:r[1].byteLength};},"
                        + "function(e){window.__smokeAssets={error:String(e)};});return true;})()");
                waitFor("window.__smokeAssets !== null", 15000);
                JSONObject assets = (JSONObject) js("window.__smokeAssets");
                assertTrue(assets.optBoolean("hasRoom") && assets.optInt("audioBytes") > 100,
                        "Local script/audio request failed: " + assets);
                return assets;
            });
            step("light-fire-dom-action", () -> {
                JSONObject result = (JSONObject) js("(function(){Engine.travelTo(Room);"
                        + "$SM.set('stores.wood',100);$SM.set('game.fire',Room.FireEnum.Dead);"
                        + "var button=$('#lightButton');Button.clearCooldown(button);"
                        + "Button.setDisabled(button,false);button.show();button.trigger('click');"
                        + "return {fire:$SM.get('game.fire.value'),wood:$SM.get('stores.wood')};})()");
                assertTrue(result.optInt("fire") > 0 && result.optInt("wood") == 95,
                        "Click did not light fire: " + result);
                return result;
            });
            step("save-and-webview-reload", () -> {
                assertTrue(Boolean.TRUE.equals(js("(function(){State.config.nativeSmokePersist='saved';"
                        + "window.__smokeOldPage=true;return OfflineGame.save();})()")), "Save returned false");
                runOnMainSync(() -> webView.reload());
                waitFor("typeof window.__smokeOldPage === 'undefined' && (" + READY + ")", 45000);
                JSONObject result = (JSONObject) js("({marker:State.config.nativeSmokePersist,"
                        + "fire:$SM.get('game.fire.value'),href:location.href})");
                assertTrue("saved".equals(result.optString("marker")) && result.optInt("fire") > 0,
                        "Progress did not survive reload: " + result);
                assertIndexUrl(result.optString("href"));
                return result;
            });
            step("offline-native-reload", () -> {
                js("(function(){window.__smokeOldPage=true;OfflineGame.reload();return true;})()");
                waitFor("typeof window.__smokeOldPage === 'undefined' && (" + READY + ")", 45000);
                JSONObject result = (JSONObject) js("({marker:State.config.nativeSmokePersist,href:location.href})");
                assertTrue("saved".equals(result.optString("marker")), "Native reload lost saved marker: " + result);
                assertIndexUrl(result.optString("href"));
                return result;
            });
            step("native-about-navigation-and-return", () -> {
                js("(function(){var a=document.createElement('a');a.href='adr-offline://about';"
                        + "document.body.appendChild(a);a.click();a.remove();return true;})()");
                long deadline = SystemClock.elapsedRealtime() + 10000;
                boolean about = false;
                while (SystemClock.elapsedRealtime() < deadline) {
                    AccessibilityNodeInfo root = getUiAutomation().getRootInActiveWindow();
                    about = containsText(root, "独立中文离线") || containsText(root, "本封装")
                            || containsText(root, "无需服务器");
                    if (root != null) root.recycle();
                    if (about) break;
                    SystemClock.sleep(200);
                }
                assertTrue(about, "Native about dialog did not appear");
                sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor(READY, 10000);
                return js("({href:location.href,marker:State.config.nativeSmokePersist})");
            });
            step("bundled-about-and-return-link", () -> {
                js("(function(){OfflineGame.save();var a=document.createElement('a');a.href='about.html';"
                        + "document.body.appendChild(a);a.click();a.remove();return true;})()");
                waitFor("location.pathname.endsWith('/about.html') && document.title.indexOf('关于')>=0", 20000);
                JSONObject about = (JSONObject) js("({href:location.href,text:document.body.innerText.slice(0,120)})");
                js("(function(){document.querySelector('a[href=\"index.html\"]').click();return true;})()");
                waitFor(READY, 45000);
                assertIndexUrl((String) js("location.href"));
                return about;
            });
            step("bundled-about-and-android-back", () -> {
                js("(function(){var a=document.createElement('a');a.href='about.html';"
                        + "document.body.appendChild(a);a.click();a.remove();return true;})()");
                waitFor("location.pathname.endsWith('/about.html')", 20000);
                sendKeyDownUpSync(KeyEvent.KEYCODE_BACK);
                waitFor(READY, 45000);
                assertIndexUrl((String) js("location.href"));
                return "Android back returned to local game";
            });
            step("native-restore-transaction", () -> {
                JSONObject restored = new JSONObject((String) js("JSON.stringify(State)"));
                restored.getJSONObject("config").put("nativeSmokeRestore", "restored");
                restored.getJSONObject("stores").put("wood", 4321);
                js("(window.__smokeOldPage=true)");
                restoreThroughActivity(restored.toString());
                waitFor("typeof window.__smokeOldPage === 'undefined' && (" + READY + ")", 45000);
                JSONObject result = (JSONObject) js("({marker:State.config.nativeSmokeRestore,"
                        + "wood:$SM.get('stores.wood'),stored:JSON.parse(localStorage.gameState).config.nativeSmokeRestore})");
                assertTrue("restored".equals(result.optString("marker"))
                        && "restored".equals(result.optString("stored")), "Restore overwritten on reload: " + result);
                return result;
            });
            step("web-import-transaction", () -> {
                js("(function(){var imported=JSON.parse(JSON.stringify(State));"
                        + "imported.config.nativeSmokeImport='imported';window.__smokeOldPage=true;"
                        + "Engine.import64(Base64.encode(JSON.stringify(imported)));return true;})()");
                waitFor("typeof window.__smokeOldPage === 'undefined' && (" + READY + ")", 45000);
                assertTrue("imported".equals(js("State.config.nativeSmokeImport")), "Web import marker lost");
                assertIndexUrl((String) js("location.href"));
                return "Base64 import persisted across native reload";
            });
            step("web-delete-and-restart-transaction", () -> {
                // Runs only on this task's dedicated emulator; original progress is restored in finally.
                js("(function(){window.__smokeOldPage=true;Engine.deleteSave();return true;})()");
                waitFor("typeof window.__smokeOldPage === 'undefined' && (" + READY + ")", 45000);
                JSONObject result = (JSONObject) js("({fire:$SM.get('game.fire.value'),"
                        + "hasMarker:!!State.config.nativeSmokeImport,href:location.href})");
                assertTrue(!result.optBoolean("hasMarker") && result.optInt("fire") == 0,
                        "Restart retained old progress: " + result);
                assertIndexUrl(result.optString("href"));
                return result;
            });
            step("external-request-and-navigation-blocked", () -> {
                Method navigation = activity.getClass().getDeclaredMethod("handleNavigation", Uri.class);
                navigation.setAccessible(true);
                assertTrue(Boolean.TRUE.equals(navigation.invoke(activity, Uri.parse("https://example.com/adr-native-smoke"))),
                        "Native navigation filter allowed external URL");
                js("(function(){window.__smokeExternal=null;fetch('https://example.com/adr-native-smoke')"
                        + ".then(function(r){window.__smokeExternal={blocked:r.status===403,status:r.status};},"
                        + "function(e){window.__smokeExternal={blocked:true,error:String(e)};});return true;})()");
                waitFor("window.__smokeExternal !== null", 10000);
                JSONObject external = (JSONObject) js("window.__smokeExternal");
                assertTrue(external.optBoolean("blocked"), "External fetch unexpectedly succeeded: " + external);
                js("(function(){var a=document.createElement('a');a.href='https://example.com/adr-native-smoke';"
                        + "document.body.appendChild(a);a.click();a.remove();return true;})()");
                SystemClock.sleep(500);
                waitFor(READY, 10000);
                assertTrue("https://appassets.androidplatform.net".equals(js("location.origin")),
                        "External navigation replaced game");
                return external;
            });
        } catch (Throwable failure) {
            passed = false;
            try { report.put("failure", failure.toString()); } catch (Exception ignored) {}
        } finally {
            if (originalSave != null && webView != null) {
                try {
                    step("restore-original-progress", () -> {
                        js("(window.__smokeOldPage=true)");
                        restoreThroughActivity(originalSave);
                        waitFor("typeof window.__smokeOldPage === 'undefined' && (" + READY + ")", 45000);
                        JSONObject expectedConfig = new JSONObject(originalSave).getJSONObject("config");
                        JSONObject actualConfig = (JSONObject) js("State.config");
                        for (String key : new String[]{"nativeSmokePersist", "nativeSmokeRestore", "nativeSmokeImport"}) {
                            assertTrue(String.valueOf(expectedConfig.opt(key)).equals(String.valueOf(actualConfig.opt(key))),
                                    "Test marker remains in progress: " + key);
                        }
                        js("(function(){var original=" + originalStorage + ";Object.keys(localStorage).forEach(function(k){"
                                + "if(k!=='gameState'&&!Object.prototype.hasOwnProperty.call(original,k))localStorage.removeItem(k);});"
                                + "Object.keys(original).forEach(function(k){if(k!=='gameState')localStorage.setItem(k,original[k]);});"
                                + "return true;})()");
                        return "Original captured progress restored; no app data cleared";
                    });
                } catch (Throwable restoreFailure) {
                    passed = false;
                    try { report.put("restoreFailure", restoreFailure.toString()); } catch (Exception ignored) {}
                }
            }
            Bundle result = new Bundle();
            try {
                report.put("passed", passed);
                report.put("elapsedMs", SystemClock.elapsedRealtime() - started);
                File output = new File(getTargetContext().getFilesDir(), "native-smoke-report.json");
                try (FileOutputStream stream = new FileOutputStream(output)) {
                    stream.write(report.toString(2).getBytes(StandardCharsets.UTF_8));
                }
                result.putString("report", report.toString());
                result.putString("reportPath", output.getAbsolutePath());
            } catch (Exception ex) { result.putString("reportError", ex.toString()); }
            result.putString("stream", "\nNative smoke tests " + (passed ? "PASSED" : "FAILED") + "\n");
            finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
        }
    }

    private interface Check { Object run() throws Exception; }
    private void step(String name, Check check) throws Exception {
        long start = SystemClock.elapsedRealtime();
        JSONObject result = new JSONObject().put("name", name);
        checks.put(result);
        try {
            result.put("detail", check.run());
            result.put("passed", true);
        } catch (Throwable ex) {
            passed = false;
            result.put("passed", false).put("error", ex.toString());
            if (ex instanceof Exception) throw (Exception) ex;
            throw new Exception(ex);
        } finally {
            result.put("elapsedMs", SystemClock.elapsedRealtime() - start);
            Bundle status = new Bundle();
            status.putString("stream", name + ": " + result.optBoolean("passed") + "\n");
            sendStatus(0, status);
        }
    }

    private Object js(String expression) throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        AtomicReference<String> value = new AtomicReference<>();
        String script = "(function(){try{return JSON.stringify({ok:true,value:(" + expression
                + ")});}catch(e){return JSON.stringify({ok:false,error:String(e),stack:e.stack});}})()";
        runOnMainSync(() -> webView.evaluateJavascript(script, result -> { value.set(result); done.countDown(); }));
        assertTrue(done.await(12, TimeUnit.SECONDS), "JavaScript callback timed out: " + expression);
        Object decoded = new JSONTokener(value.get()).nextValue();
        assertTrue(decoded instanceof String, "JavaScript returned no result: " + value.get());
        JSONObject envelope = new JSONObject((String) decoded);
        assertTrue(envelope.optBoolean("ok"), "JavaScript failed: " + envelope);
        return envelope.opt("value");
    }

    private void waitFor(String condition, long timeoutMs) throws Exception {
        long deadline = SystemClock.elapsedRealtime() + timeoutMs;
        while (SystemClock.elapsedRealtime() < deadline) {
            if (Boolean.TRUE.equals(js(condition))) return;
            SystemClock.sleep(150);
        }
        throw new Exception("Timed out waiting for " + condition + "; page="
                + js("({href:location.href,title:document.title,text:document.body?document.body.innerText.slice(0,600):'',"
                + "engine:typeof Engine,room:typeof Room,offline:typeof OfflineGame})"));
    }

    private void restoreThroughActivity(String json) throws Exception {
        Method restore = activity.getClass().getDeclaredMethod("restoreSave", String.class);
        restore.setAccessible(true);
        AtomicReference<Exception> error = new AtomicReference<>();
        runOnMainSync(() -> { try { restore.invoke(activity, json); } catch (Exception ex) { error.set(ex); } });
        if (error.get() != null) throw error.get();
    }

    private static WebView findWebView(View view) {
        if (view instanceof WebView) return (WebView) view;
        if (view instanceof ViewGroup) for (int i = 0; i < ((ViewGroup) view).getChildCount(); i++) {
            WebView found = findWebView(((ViewGroup) view).getChildAt(i));
            if (found != null) return found;
        }
        return null;
    }

    private static boolean containsText(AccessibilityNodeInfo node, String needle) {
        if (node == null) return false;
        if (node.getText() != null && node.getText().toString().contains(needle)) return true;
        for (int i = 0; i < node.getChildCount(); i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            boolean found = containsText(child, needle);
            if (child != null) child.recycle();
            if (found) return true;
        }
        return false;
    }

    private static void assertTrue(boolean condition, String message) throws Exception {
        if (!condition) throw new Exception(message);
    }

    private static void assertIndexUrl(String href) throws Exception {
        assertTrue("https://appassets.androidplatform.net/game/index.html".equals(href),
                "Index URL must remain complete for audio and reload: " + href);
    }
}
