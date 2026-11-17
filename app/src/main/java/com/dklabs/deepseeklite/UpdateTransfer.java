package com.dklabs.deepseeklite;

import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

/** A single cancellable transfer. No API key, WebView cookies, or account headers. */
final class UpdateTransfer {
    interface ConnectionFactory { HttpURLConnection open(URL url) throws IOException; }
    interface Progress { void accept(long bytes, long total); }
    private final ConnectionFactory connections;
    private volatile boolean cancelled;
    private volatile HttpURLConnection connection;

    UpdateTransfer() { this(url -> (HttpURLConnection) url.openConnection()); }
    UpdateTransfer(ConnectionFactory factory) { connections = factory; }

    void cancel() {
        cancelled = true;
        HttpURLConnection active = connection;
        if (active != null) active.disconnect();
    }

    void checkCancelled() throws InterruptedIOException {
        if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedIOException("更新已取消");
    }

    private HttpURLConnection open(URL initial) throws IOException {
        URL url = initial;
        for (int redirects = 0; redirects <= 5; redirects++) {
            checkCancelled();
            UpdateInfo.httpsUrl(url.toString());
            HttpURLConnection next = connections.open(url);
            connection = next;
            next.setConnectTimeout(15000);
            next.setReadTimeout(30000);
            next.setInstanceFollowRedirects(false);
            next.setUseCaches(false);
            next.setRequestProperty("Accept-Encoding", "identity");
            next.setRequestProperty("Cache-Control", "no-cache");
            checkCancelled();
            int code = next.getResponseCode();
            if (code == 200) return next;
            String location = next.getHeaderField("Location");
            next.disconnect();
            if ((code == 301 || code == 302 || code == 303 || code == 307 || code == 308) && location != null) {
                url = UpdateInfo.httpsUrl(new URL(url, location).toString());
                continue;
            }
            throw new IOException("更新服务器暂时不可用（HTTP " + code + "）");
        }
        throw new IOException("更新地址重定向次数过多");
    }

    String manifest(URL url) throws IOException {
        try {
            HttpURLConnection response = open(url);
            try (InputStream in = response.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = in.read(buffer)) != -1) {
                    checkCancelled();
                    if (out.size() + count > 65536) throw new IOException("更新信息文件过大");
                    out.write(buffer, 0, count);
                }
                checkCancelled();
                return out.toString(StandardCharsets.UTF_8.name());
            }
        } finally { close(); }
    }

    void download(UpdateInfo info, File destination, Progress progress) throws Exception {
        boolean complete = false;
        try {
            HttpURLConnection response = open(info.apkUrl);
            long length = response.getContentLengthLong();
            if (length >= 0 && length != info.size) throw new IOException("安装包大小与发布信息不一致");
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream in = response.getInputStream(); FileOutputStream out = new FileOutputStream(destination)) {
                byte[] buffer = new byte[65536]; int count; long total = 0, lastProgress = 0;
                while ((count = in.read(buffer)) != -1) {
                    checkCancelled();
                    total += count;
                    if (total > info.size) throw new IOException("安装包超过声明大小");
                    out.write(buffer, 0, count); digest.update(buffer, 0, count);
                    long now = System.nanoTime();
                    if (now - lastProgress > 200_000_000L) { progress.accept(total, info.size); lastProgress = now; }
                }
                checkCancelled();
                if (total != info.size || !hex(digest.digest()).equals(info.sha256)) {
                    throw new IOException("安装包校验失败，请重新下载");
                }
                out.getFD().sync();
                progress.accept(total, info.size);
            }
            complete = true;
        } finally {
            close();
            if (!complete) destination.delete();
        }
    }

    void verifyFile(UpdateInfo info, File file) throws Exception {
        if (!file.isFile() || file.length() != info.size) throw new IOException("安装包已失效，请重新下载");
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(file)) {
            byte[] buffer = new byte[65536]; int count;
            while ((count = in.read(buffer)) != -1) { checkCancelled(); digest.update(buffer, 0, count); }
        }
        if (!hex(digest.digest()).equals(info.sha256)) throw new IOException("安装包校验失败，请重新下载");
    }

    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }

    private void close() {
        HttpURLConnection active = connection;
        connection = null;
        if (active != null) active.disconnect();
    }
}
