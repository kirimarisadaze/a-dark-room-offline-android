package org.adarkroom.offline.tests;

import android.app.Activity;
import android.app.Instrumentation;
import android.os.Bundle;
import android.content.res.AssetManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** AssetManager verification without starting an Activity or constructing WebView. */
public final class AssetProbe extends Instrumentation {
    @Override public void onCreate(Bundle arguments) { super.onCreate(arguments); start(); }
    @Override public void onStart() {
        JSONObject report = new JSONObject();
        boolean passed = true;
        try {
            AssetManager assets = getTargetContext().getAssets();
            report.put("root", new JSONArray(assets.list("")));
            report.put("game", new JSONArray(assets.list("game")));
            JSONArray checks = new JSONArray();
            report.put("checks", checks);
            for (String path : new String[]{"game/index.html", "game/offline.js", "game/mobile.css",
                    "game/lang/zh_cn/strings.js", "game/audio/light-fire.flac"}) {
                JSONObject check = new JSONObject().put("path", path);
                checks.put(check);
                try (InputStream in = assets.open(path)) {
                    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
                    byte[] buffer = new byte[8192]; int length;
                    while ((length = in.read(buffer)) != -1) bytes.write(buffer, 0, length);
                    byte[] content = bytes.toByteArray();
                    check.put("bytes", content.length);
                    StringBuilder hash = new StringBuilder();
                    for (byte value : MessageDigest.getInstance("SHA-256").digest(content))
                        hash.append(String.format("%02x", value & 255));
                    check.put("sha256", hash.toString());
                    if (path.endsWith("index.html")) check.put("head", new String(content, StandardCharsets.UTF_8).substring(0, 160));
                    check.put("passed", content.length > 0);
                    if (content.length == 0) passed = false;
                } catch (Exception ex) {
                    passed = false;
                    check.put("passed", false).put("error", ex.toString());
                }
            }
        } catch (Exception ex) { passed = false; try { report.put("error", ex.toString()); } catch (Exception ignored) {} }
        Bundle result = new Bundle();
        try { report.put("passed", passed); result.putString("report", report.toString()); } catch (Exception ignored) {}
        result.putString("stream", "AssetManager probe " + (passed ? "PASSED" : "FAILED") + "\n");
        finish(passed ? Activity.RESULT_OK : Activity.RESULT_CANCELED, result);
    }
}
