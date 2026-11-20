package com.dklabs.deepseeklite;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.drawable.ColorDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import android.webkit.*;
import android.widget.Toast;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import java.io.*;
import java.security.KeyStore;
import java.util.*;
import java.util.concurrent.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;

/** Bundled assets on a private HTTPS origin; API traffic goes directly to DeepSeek. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String ORIGIN = "https://" + HOST;
    private static final String KEY_ALIAS = "jianliao-api-key-v1";
    private static final String PREF_THEME = "theme-preference";
    private static final int LIGHT_BG = 0xFFFFFFFF;
    private static final int DARK_BG = 0xFF19191B;
    private static final int FILE_PICK = 42, AUDIO_PERMISSION = 43, EXPORT_FILE = 44;
    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest microphoneRequest;
    private SharedPreferences preferences;
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private File pendingExport;
    private String pendingExportMessage;
    private AppUpdater updater;
    private NativeAudioRecorder audioRecorder;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        preferences = getSharedPreferences("private-settings", MODE_PRIVATE);
        updater = new AppUpdater(this, state);
        web = new WebView(this);
        audioRecorder = new NativeAudioRecorder(this, event -> {
            if (isAppPage()) web.evaluateJavascript(
                    "window.dispatchEvent(new CustomEvent('jianliao-recorder',{detail:" + event + "}))", null);
        });
        applySystemTheme(isDarkForPreference(preferences.getString(PREF_THEME, "system")));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportMultipleWindows(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        web.addJavascriptInterface(new DeviceBridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if ((ORIGIN + "/index.html").equals(url)) updater.onPageReady();
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!HOST.equals(uri.getHost())) return null;
                String path = uri.getPath();
                if (path == null || path.contains("..") || path.indexOf(92) >= 0) return empty(403);
                if (path.equals("/")) path = "/index.html";
                try {
                    Map<String, String> headers = new HashMap<>();
                    headers.put("X-Content-Type-Options", "nosniff");
                    headers.put("Cache-Control", "no-cache");
                    headers.put("Content-Security-Policy", "frame-src 'none'; object-src 'none'");
                    return new WebResourceResponse(mimeFor(path), "UTF-8", 200, "OK", headers, getAssets().open(path.substring(1)));
                } catch (IOException error) { return empty(404); }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost()) && "https".equals(uri.getScheme())) return false;
                if (request.isForMainFrame() && request.hasGesture()) openExternal(uri);
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try { startActivityForResult(intent, FILE_PICK); }
                catch (Exception error) { fileCallback.onReceiveValue(null); fileCallback = null; toast("无法打开文件选择器"); }
                return true;
            }
            @Override public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> {
                    if (!ORIGIN.equals(request.getOrigin().toString().replaceAll("/$", "")) ||
                            !Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) {
                        request.deny(); return;
                    }
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
                    } else {
                        if (microphoneRequest != null) microphoneRequest.deny();
                        microphoneRequest = request;
                        requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, AUDIO_PERMISSION);
                    }
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) {
                if (microphoneRequest == request) microphoneRequest = null;
            }
            @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean gesture, android.os.Message result) {
                if (!gesture) return false;
                WebView popup = new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView child, WebResourceRequest request) {
                        openExternal(request.getUrl()); child.destroy(); return true;
                    }
                });
                ((WebView.WebViewTransport) result.obj).setWebView(popup);
                result.sendToTarget(); return true;
            }
        });
        setContentView(web);
        web.loadUrl(ORIGIN + "/index.html");
    }

    private WebResourceResponse empty(int code) {
        return new WebResourceResponse("text/plain", "UTF-8", code, "Unavailable", new HashMap<>(), new ByteArrayInputStream(new byte[0]));
    }
    private String mimeFor(String path) {
        if (path.endsWith(".js")) return "application/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".txt") || path.endsWith("LICENSE")) return "text/plain";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".ttf")) return "font/ttf";
        String type = MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(path));
        return type == null ? "application/octet-stream" : type;
    }
    private void openExternal(Uri uri) {
        if (HOST.equals(uri.getHost())) {
            String path = uri.getPath();
            if (!"/LICENSE".equals(path) && !"/THIRD_PARTY_NOTICES.txt".equals(path)) return;
            try (InputStream in = getAssets().open(path.substring(1))) {
                java.io.ByteArrayOutputStream bytes = new java.io.ByteArrayOutputStream();
                byte[] buffer = new byte[4096]; int count;
                while ((count = in.read(buffer)) != -1) bytes.write(buffer, 0, count);
                android.widget.TextView text = new android.widget.TextView(this);
                text.setText(bytes.toString("UTF-8")); text.setTextSize(12); text.setTextIsSelectable(true);
                text.setPadding(32, 16, 32, 16);
                android.widget.ScrollView scroll = new android.widget.ScrollView(this); scroll.addView(text);
                new android.app.AlertDialog.Builder(this).setTitle("开源许可").setView(scroll).setPositiveButton("关闭", null).show();
            } catch (IOException error) { toast("无法读取许可文件"); }
            return;
        }
        if (!"https".equals(uri.getScheme()) && !"http".equals(uri.getScheme())) return;
        try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) { toast("未找到浏览器"); }
    }
    private boolean isDarkForPreference(String preference) {
        if ("dark".equals(preference)) return true;
        if ("light".equals(preference)) return false;
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
    }

    private void applySystemTheme(boolean dark) {
        int bg = dark ? DARK_BG : LIGHT_BG;
        getWindow().setBackgroundDrawable(new ColorDrawable(bg));
        getWindow().setStatusBarColor(bg);
        getWindow().setNavigationBarColor(bg);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        if (controller != null) {
            controller.setAppearanceLightStatusBars(!dark);
            controller.setAppearanceLightNavigationBars(!dark);
        }
        if (web != null) {
            web.setBackgroundColor(bg);
        }
    }

    private void toast(String message) { runOnUiThread(() -> Toast.makeText(this, message, Toast.LENGTH_LONG).show()); }

    private boolean isAppPage() {
        if (isDestroyed() || web == null || web.getUrl() == null) return false;
        Uri uri = Uri.parse(web.getUrl());
        return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost())
                && "/index.html".equals(uri.getPath());
    }

    private javax.crypto.SecretKey deviceKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(KEY_ALIAS)) {
            KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (javax.crypto.SecretKey) store.getKey(KEY_ALIAS, null);
    }

    public class DeviceBridge {
        @JavascriptInterface public void checkForUpdate() { runOnUiThread(() -> updater.check(true)); }
        @JavascriptInterface public void startNativeRecording(String id) {
            runOnUiThread(() -> { if (isAppPage() && !isFinishing()) audioRecorder.start(id); });
        }
        @JavascriptInterface public void stopNativeRecording(String id) {
            runOnUiThread(() -> audioRecorder.stop(id));
        }
        @JavascriptInterface public void cancelNativeRecording(String id) {
            runOnUiThread(() -> audioRecorder.cancel(id));
        }
        @JavascriptInterface public String getAppVersion() { return BuildConfig.VERSION_NAME; }
        @JavascriptInterface public boolean isUpdateConfigured() { return !BuildConfig.UPDATE_MANIFEST_URL.isEmpty(); }
        @JavascriptInterface public synchronized String getApiKey() {
            String saved = preferences.getString("api-key", null);
            if (saved == null) return "";
            try {
                String[] parts = saved.split(":");
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
                cipher.init(Cipher.DECRYPT_MODE, deviceKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
                return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), java.nio.charset.StandardCharsets.UTF_8);
            } catch (Exception error) { toast("无法读取已保存的 API Key，请重新配置"); return ""; }
        }
        @JavascriptInterface public synchronized boolean setApiKey(String key) {
            try {
                if (key == null || key.trim().isEmpty()) return preferences.edit().remove("api-key").commit();
                Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, deviceKey());
                byte[] encrypted = cipher.doFinal(key.trim().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                return preferences.edit().putString("api-key", Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":" + Base64.encodeToString(encrypted, Base64.NO_WRAP)).commit();
            } catch (Exception error) { return false; }
        }
        @JavascriptInterface public void syncTheme(String preference, boolean dark) {
            String normalized = "light".equals(preference) || "dark".equals(preference) ? preference : "system";
            preferences.edit().putString(PREF_THEME, normalized).apply();
            runOnUiThread(() -> {
                if (!isDestroyed()) applySystemTheme(dark);
            });
        }
        @JavascriptInterface public void saveDownload(String name, String base64) {
            io.execute(() -> {
                try {
                    if (base64.length() > 72_000_000) { toast("导出文件过大，请减少附件后重试"); return; }
                    String safeName = new File(name == null || name.trim().isEmpty() ? "export.zip" : name).getName();
                    boolean isMarkdown = safeName.toLowerCase(Locale.ROOT).endsWith(".md");
                    String mime = isMarkdown ? "text/markdown" : "application/zip";
                    String prefix = isMarkdown ? "chat-" : "history-";
                    String suffix = isMarkdown ? ".md" : ".zip";
                    String successToast = isMarkdown ? "对话已导出" : "历史记录已保存";
                    File file = File.createTempFile(prefix, suffix, getCacheDir());
                    try (FileOutputStream stream = new FileOutputStream(file)) { stream.write(Base64.decode(base64, Base64.DEFAULT)); }
                    runOnUiThread(() -> {
                        if (pendingExport != null) { file.delete(); toast("请先完成上一次导出"); return; }
                        pendingExport = file;
                        pendingExportMessage = successToast;
                        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE)
                                .setType(mime).putExtra(Intent.EXTRA_TITLE, safeName);
                        try { startActivityForResult(intent, EXPORT_FILE); }
                        catch (Exception error) { pendingExport.delete(); pendingExport = null; pendingExportMessage = null; toast("无法打开保存位置"); }
                    });
                } catch (Exception error) { toast("导出失败，请重试"); }
            });
        }
    }

    @Override public void onRequestPermissionsResult(int code, String[] permissions, int[] grants) {
        super.onRequestPermissionsResult(code, permissions, grants);
        if (code == AUDIO_PERMISSION && microphoneRequest != null) {
            if (grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED) microphoneRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE});
            else microphoneRequest.deny();
            microphoneRequest = null;
        }
        if (code == NativeAudioRecorder.PERMISSION) {
            audioRecorder.onPermissionResult(grants.length > 0 && grants[0] == PackageManager.PERMISSION_GRANTED);
        }
    }
    @Override protected void onActivityResult(int code, int result, Intent data) {
        super.onActivityResult(code, result, data);
        if (code == AppUpdater.INSTALL_PERMISSION) updater.onPermissionResult();
        if (code == FILE_PICK && fileCallback != null) {
            ArrayList<Uri> uris = new ArrayList<>();
            if (result == RESULT_OK && data != null) {
                if (data.getClipData() != null) for (int i = 0; i < data.getClipData().getItemCount(); i++) uris.add(data.getClipData().getItemAt(i).getUri());
                else if (data.getData() != null) uris.add(data.getData());
            }
            fileCallback.onReceiveValue(uris.isEmpty() ? null : uris.toArray(new Uri[0])); fileCallback = null;
        }
        if (code == EXPORT_FILE && pendingExport != null) {
            File file = pendingExport; pendingExport = null;
            String savedMessage = pendingExportMessage != null ? pendingExportMessage : "历史记录已保存";
            pendingExportMessage = null;
            if (result != RESULT_OK || data == null || data.getData() == null) { file.delete(); return; }
            Uri destination = data.getData();
            io.execute(() -> {
                try (InputStream in = new FileInputStream(file); OutputStream out = getContentResolver().openOutputStream(destination)) {
                    if (out == null) throw new IOException();
                    byte[] buffer = new byte[65536]; int count; while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                    toast(savedMessage);
                } catch (Exception error) { toast("保存失败，请重试"); } finally { file.delete(); }
            });
        }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("window.handleAndroidBack ? window.handleAndroidBack() : false", result -> { if (!"true".equals(result)) super.onBackPressed(); });
    }
    @Override protected void onSaveInstanceState(Bundle state) { updater.saveState(state); super.onSaveInstanceState(state); }
    @Override protected void onPause() { updater.onPause(); super.onPause(); web.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); if (updater != null) updater.onResume(); }
    @Override protected void onStop() { audioRecorder.cancelActive(); super.onStop(); }
    @Override protected void onDestroy() {
        updater.destroy();
        audioRecorder.destroy();
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        if (microphoneRequest != null) microphoneRequest.deny();
        web.removeJavascriptInterface("AndroidBridge"); web.destroy(); io.shutdown(); super.onDestroy();
    }
}
