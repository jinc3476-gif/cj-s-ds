package com.dklabs.deepseeklite;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.storage.StorageManager;
import android.provider.Settings;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.IOException;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Native update flow; all UI and state transitions run on the activity thread. */
final class AppUpdater {
    static final int INSTALL_PERMISSION = 45;
    private final Activity activity;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final File directory;
    private volatile boolean destroyed;
    private boolean busy, resumed, started;
    private UpdateTransfer transfer;
    private AlertDialog dialog;
    private Runnable deferred;
    private UpdateInfo ready;

    AppUpdater(Activity activity, Bundle saved) {
        this.activity = activity;
        directory = new File(activity.getCacheDir(), "updates");
        if (saved != null && saved.getString("update-ready") != null) {
            try { ready = new UpdateInfo(saved.getString("update-ready"), activity.getPackageName()); }
            catch (IOException ignored) { /* A new check can recover invalid saved state. */ }
        }
    }

    void saveState(Bundle state) {
        if (ready != null) state.putString("update-ready", ready.sourceJson);
    }

    void onResume() {
        resumed = true;
        if (deferred != null) { Runnable action = deferred; deferred = null; action.run(); }
    }

    void onPause() { resumed = false; }

    void onPageReady() {
        if (started) return;
        started = true;
        if (ready != null) showReady(ready);
        else check(false);
    }

    void check(boolean manual) {
        if (destroyed) return;
        if (busy || dialog != null) {
            if (manual) toast("请先完成当前更新操作");
            return;
        }
        if (BuildConfig.UPDATE_MANIFEST_URL.isEmpty()) {
            if (manual) showMessage("检查更新", "当前版本：" + BuildConfig.VERSION_NAME + "\n更新服务尚未启用，接入发布地址后即可使用。");
            return;
        }
        busy = true;
        UpdateTransfer task = new UpdateTransfer(); transfer = task;
        if (manual) showProgress("正在检查更新", "正在连接更新服务…", task, false);
        worker.execute(() -> {
            try {
                UpdateInfo info = new UpdateInfo(task.manifest(UpdateInfo.httpsUrl(BuildConfig.UPDATE_MANIFEST_URL)), activity.getPackageName());
                finish(task, () -> {
                    if (info.versionCode <= BuildConfig.VERSION_CODE) {
                        if (manual) showMessage("检查更新", "已是最新版本（" + BuildConfig.VERSION_NAME + "）");
                    } else if (info.minSdk > Build.VERSION.SDK_INT) {
                        if (manual) showMessage("暂时无法更新", "新版需要更高的 Android 系统版本，请先升级手机系统。");
                    } else offer(info);
                });
            } catch (Exception error) { fail(task, error, manual, () -> check(true)); }
        });
    }

    private void offer(UpdateInfo info) {
        show(new AlertDialog.Builder(activity)
                .setTitle("发现新版本 " + info.versionName)
                .setMessage("当前版本：" + BuildConfig.VERSION_NAME + "\n下载大小：" + megabytes(info.size) + " MB\n\n"
                        + (info.notes.isEmpty() ? "功能改进与问题修复。" : info.notes))
                .setNegativeButton("稍后再说", null)
                .setPositiveButton("下载更新", (d, which) -> download(info)).create());
    }

    private void download(UpdateInfo info) {
        dismiss(); busy = true; ready = null;
        UpdateTransfer task = new UpdateTransfer(); transfer = task;
        ProgressView progress = showProgress("下载新版本 " + info.versionName, "准备下载…", task, true);
        worker.execute(() -> {
            File partial = null;
            try {
                if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法创建下载目录");
                File apk = apkFile(info);
                if (apk.exists()) {
                    try { task.verifyFile(info, apk); }
                    catch (IOException error) { task.checkCancelled(); if (!apk.delete()) throw error; }
                }
                if (!apk.exists()) {
                    StorageManager storage = activity.getSystemService(StorageManager.class);
                    long required = info.size + 10L * 1024 * 1024;
                    java.util.UUID volume = storage.getUuidForPath(directory);
                    if (storage.getAllocatableBytes(volume) < required) throw new IOException("手机存储空间不足，请清理后重试");
                    storage.allocateBytes(volume, required);
                    partial = File.createTempFile("download-", ".part", directory);
                    task.download(info, partial, (bytes, total) -> activity.runOnUiThread(() -> {
                        if (destroyed || transfer != task || !resumed) return;
                        progress.bar.setProgress((int) (bytes * 100 / total));
                        progress.text.setText(activity.getString(R.string.update_download_progress, megabytes(bytes), megabytes(total)));
                    }));
                    verifyPackage(info, partial);
                    task.checkCancelled();
                    if (!partial.renameTo(apk)) throw new IOException("无法保存安装包，请重试");
                } else verifyPackage(info, apk);
                finish(task, () -> { ready = info; showReady(info); });
            } catch (Exception error) { fail(task, error, true, () -> download(info)); }
            finally { if (partial != null) partial.delete(); }
        });
    }

    private void showReady(UpdateInfo info) {
        ready = info;
        show(new AlertDialog.Builder(activity).setTitle("新版已下载")
                .setMessage("简聊 " + info.versionName + " 已准备好。点击安装后，请在系统界面确认更新。")
                .setNegativeButton("稍后安装", null)
                .setPositiveButton("安装新版", (d, which) -> install(info)).create());
    }

    private void install(UpdateInfo info) {
        dismiss();
        if (!activity.getPackageManager().canRequestPackageInstalls()) {
            ready = info;
            show(new AlertDialog.Builder(activity).setTitle("允许安装更新")
                    .setMessage("请在接下来的系统设置中允许“简聊”安装应用，然后返回继续安装。")
                    .setNegativeButton("取消", null)
                    .setPositiveButton("前往设置", (d, which) -> {
                        try {
                            activity.startActivityForResult(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                    Uri.parse("package:" + activity.getPackageName())), INSTALL_PERMISSION);
                        } catch (Exception error) { showMessage("无法打开设置", "请在手机设置中允许简聊安装未知应用，然后重新检查更新。"); }
                    }).create());
            return;
        }
        // Recheck the private cached APK after returning from settings, before granting a URI.
        busy = true;
        UpdateTransfer task = new UpdateTransfer(); transfer = task;
        showProgress("正在校验安装包", "校验通过后将打开系统安装界面…", task, false);
        worker.execute(() -> {
            try {
                File apk = apkFile(info);
                task.verifyFile(info, apk); verifyPackage(info, apk); task.checkCancelled();
                finish(task, () -> {
                    try {
                        Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".updates", apk);
                        Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive")
                                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                        intent.setClipData(ClipData.newRawUri("简聊更新", uri));
                        activity.startActivity(intent);
                    } catch (Exception error) { showMessage("无法开始安装", "请检查系统安装权限，再通过“检查更新”重试。"); }
                });
            } catch (Exception error) { fail(task, error, true, () -> download(info)); }
        });
    }

    void onPermissionResult() {
        // Android's settings activity does not reliably return RESULT_OK. Query the permission.
        dismiss();
        if (ready == null) { showMessage("检查更新", "请重新检查更新以继续安装。"); return; }
        if (activity.getPackageManager().canRequestPackageInstalls()) install(ready);
        else showMessage("尚未允许安装", "你可以稍后通过“检查更新”重新安装，已下载的安装包会保留。");
    }

    @SuppressWarnings("deprecation")
    private void verifyPackage(UpdateInfo info, File file) throws Exception {
        PackageManager pm = activity.getPackageManager();
        int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo candidate = pm.getPackageArchiveInfo(file.getAbsolutePath(), flags);
        PackageInfo installed = pm.getPackageInfo(activity.getPackageName(), flags);
        if (candidate == null || !activity.getPackageName().equals(candidate.packageName)) throw new IOException("安装包不属于简聊，已停止更新");
        long code = Build.VERSION.SDK_INT >= 28 ? candidate.getLongVersionCode() : candidate.versionCode;
        long current = Build.VERSION.SDK_INT >= 28 ? installed.getLongVersionCode() : installed.versionCode;
        if (code != info.versionCode || code <= current || !info.versionName.equals(candidate.versionName)) throw new IOException("安装包版本与更新信息不一致");
        if (candidate.applicationInfo == null || candidate.applicationInfo.minSdkVersion > Build.VERSION.SDK_INT) throw new IOException("此安装包不支持当前 Android 系统");
        Set<String> expected = signatures(installed), actual = signatures(candidate);
        if (expected.isEmpty() || !expected.equals(actual)) throw new IOException("安装包签名与当前应用不一致，已停止更新");
    }

    @SuppressWarnings("deprecation")
    private Set<String> signatures(PackageInfo info) throws Exception {
        Signature[] signatures = Build.VERSION.SDK_INT >= 28
                ? (info.signingInfo == null ? null : info.signingInfo.getApkContentsSigners()) : info.signatures;
        Set<String> result = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) {
            result.add(UpdateTransfer.hex(java.security.MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        }
        return result;
    }

    private void finish(UpdateTransfer task, Runnable action) {
        activity.runOnUiThread(() -> {
            if (destroyed || transfer != task) return;
            busy = false; transfer = null; dismiss();
            try { task.checkCancelled(); } catch (IOException ignored) { return; }
            if (resumed) action.run(); else deferred = action;
        });
    }

    private void fail(UpdateTransfer task, Exception error, boolean visible, Runnable retry) {
        finish(task, () -> {
            if (!visible) return; // Automatic checks must not interrupt chats on network failure.
            String message = error instanceof IOException ? error.getMessage() : "更新失败，请检查网络后重试";
            show(new AlertDialog.Builder(activity).setTitle("更新未完成").setMessage(message)
                    .setNegativeButton("关闭", null).setPositiveButton("重试", (d, which) -> { dismiss(); retry.run(); }).create());
        });
    }

    private static final class ProgressView {
        final ProgressBar bar; final TextView text;
        ProgressView(ProgressBar bar, TextView text) { this.bar = bar; this.text = text; }
    }

    private ProgressView showProgress(String title, String message, UpdateTransfer task, boolean determinate) {
        int padding = (int) (24 * activity.getResources().getDisplayMetrics().density);
        LinearLayout layout = new LinearLayout(activity); layout.setOrientation(LinearLayout.VERTICAL);
        layout.setPadding(padding, padding / 2, padding, padding / 2);
        TextView text = new TextView(activity); text.setText(message); layout.addView(text);
        ProgressBar bar = new ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100); bar.setIndeterminate(!determinate); layout.addView(bar);
        AlertDialog progress = new AlertDialog.Builder(activity).setTitle(title).setView(layout)
                .setNegativeButton("取消", (d, which) -> task.cancel()).create();
        progress.setOnCancelListener(d -> task.cancel());
        show(progress);
        progress.setCanceledOnTouchOutside(false);
        return new ProgressView(bar, text);
    }

    private void showMessage(String title, String message) {
        show(new AlertDialog.Builder(activity).setTitle(title).setMessage(message).setPositiveButton("知道了", null).create());
    }

    private void show(AlertDialog next) {
        if (destroyed || activity.isFinishing()) return;
        dismiss(); dialog = next;
        next.setOnDismissListener(d -> { if (dialog == next) dialog = null; });
        next.show();
    }

    private void dismiss() { if (dialog != null) { AlertDialog old = dialog; dialog = null; old.dismiss(); } }
    private void toast(String text) { Toast.makeText(activity, text, Toast.LENGTH_SHORT).show(); }
    private File apkFile(UpdateInfo info) { return new File(directory, info.sha256 + ".apk"); }
    private static String megabytes(long bytes) { return String.format(Locale.ROOT, "%.1f", bytes / (1024.0 * 1024)); }

    void destroy() {
        destroyed = true; deferred = null;
        if (transfer != null) transfer.cancel();
        worker.shutdownNow(); dismiss();
    }
}
