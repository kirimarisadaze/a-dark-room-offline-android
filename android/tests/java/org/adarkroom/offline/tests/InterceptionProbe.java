package org.adarkroom.offline.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Context;
import android.content.ContextWrapper;
import android.os.Bundle;
import android.webkit.WebResourceResponse;
import android.webkit.WebViewClient;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.lang.reflect.Constructor;
import java.lang.reflect.Method;
import java.util.concurrent.atomic.AtomicReference;

/** Exercise the installed app's real interceptor without creating a GPU-backed WebView. */
public final class InterceptionProbe extends Instrumentation {
    @Override public void onCreate(Bundle args) { super.onCreate(args); start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject();
        JSONArray checks = new JSONArray();
        boolean passed = true;
        try {
            report.put("checks", checks);
            AtomicReference<WebViewClient> client = new AtomicReference<>();
            AtomicReference<Exception> creationError = new AtomicReference<>();
            runOnMainSync(() -> {
                try {
                    Class<?> main = getTargetContext().getClassLoader().loadClass("org.adarkroom.offline.MainActivity");
                    Object activity = main.newInstance();
                    Method attach = ContextWrapper.class.getDeclaredMethod("attachBaseContext", Context.class);
                    attach.setAccessible(true);
                    attach.invoke(activity, getTargetContext());
                    Class<?> localClient = getTargetContext().getClassLoader().loadClass(
                            "org.adarkroom.offline.MainActivity$LocalAssetsClient");
                    Constructor<?> constructor = localClient.getDeclaredConstructor(main);
                    constructor.setAccessible(true);
                    client.set((WebViewClient) constructor.newInstance(activity));
                } catch (Exception error) { creationError.set(error); }
            });
            if (creationError.get() != null) throw creationError.get();
            String[] urls = {
                "data:text/html;charset=utf-8;base64,PCFET0NUWVBFIGh0bWw+",
                "data:text/html,<html></html>",
                "blob:https://appassets.androidplatform.net/local-audio",
                "about:blank",
                "https://appassets.androidplatform.net/game/home.html",
                "https://appassets.androidplatform.net/game/home.js",
                "https://appassets.androidplatform.net/game/home.css",
                "https://appassets.androidplatform.net/game/index.html",
                "https://appassets.androidplatform.net/game/offline.js",
                "https://appassets.androidplatform.net/game/audio/light-fire.flac",
                "https://appassets.androidplatform.net/game/missing-resource.js",
                "https://example.com/game/index.html",
                "https://appassets.androidplatform.net/game/../index.html",
                "file:///sdcard/index.html"
            };
            int[] expected = {0, 0, 0, 0, 200, 200, 200, 200, 200, 200, 404, 403, 403, 403};
            for (int i = 0; i < urls.length; i++) {
                WebResourceResponse response = client.get().shouldInterceptRequest(null, urls[i]);
                int status = response == null ? 0 : response.getStatusCode();
                JSONObject check = new JSONObject().put("url", urls[i]).put("expected", expected[i])
                        .put("actual", status).put("passed", status == expected[i]);
                checks.put(check);
                if (status != expected[i]) passed = false;
                if (response != null) {
                    try (InputStream in = response.getData()) {
                        if (status == 200 && in.read() == -1) {
                            check.put("passed", false).put("error", "Empty bundled resource");
                            passed = false;
                        }
                    }
                }
            }
        } catch (Exception error) {
            passed = false;
            try { report.put("error", error.toString()); } catch (Exception ignored) { }
        }
        Bundle result = new Bundle();
        try { report.put("passed", passed); result.putString("report", report.toString()); } catch (Exception ignored) { }
        result.putString("stream", "Installed interceptor probe " + (passed ? "PASSED" : "FAILED") + "\n");
        finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }
}
