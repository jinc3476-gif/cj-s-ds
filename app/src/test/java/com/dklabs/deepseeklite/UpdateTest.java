package com.dklabs.deepseeklite;

import org.json.JSONObject;
import org.junit.Test;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.Assert.*;

public class UpdateTest {
    private static final String APP = "com.dklabs.jianliao";
    private static final byte[] APK = "synthetic apk bytes for transfer tests".getBytes(StandardCharsets.UTF_8);

    private JSONObject metadata() throws Exception {
        return new JSONObject().put("schemaVersion", 1).put("applicationId", APP).put("versionCode", 3)
                .put("versionName", "0.1.2").put("minSdk", 26).put("size", APK.length)
                .put("apkUrl", "https://updates.example.test/app.apk").put("notes", "修复问题")
                .put("sha256", UpdateTransfer.hex(MessageDigest.getInstance("SHA-256").digest(APK)));
    }

    private UpdateInfo info() throws Exception { return new UpdateInfo(metadata().toString(), APP); }

    @Test public void validReleaseIsParsed() throws Exception {
        UpdateInfo info = info();
        assertEquals(3, info.versionCode); assertEquals(26, info.minSdk);
        assertEquals("修复问题", info.notes); assertEquals(APK.length, info.size);
    }

    @Test public void rejectsWrongAppMissingHashAndInvalidNumbers() throws Exception {
        for (Object[] change : new Object[][] {
                {"applicationId", "other.app"}, {"schemaVersion", 2}, {"sha256", "bad"},
                {"versionCode", 2.5}, {"versionCode", "3"}, {"versionCode", 2147483648L},
                {"minSdk", 0}, {"size", -1}, {"size", UpdateInfo.MAX_APK_BYTES + 1},
                {"versionName", ""}, {"notes", "x".repeat(8001)} }) {
            JSONObject value = metadata().put((String) change[0], change[1]);
            assertThrows(IOException.class, () -> new UpdateInfo(value.toString(), APP));
        }
        JSONObject missing = metadata(); missing.remove("sha256");
        assertThrows(IOException.class, () -> new UpdateInfo(missing.toString(), APP));
        assertThrows(IOException.class, () -> new UpdateInfo("<html>not JSON</html>", APP));
    }

    @Test public void rejectsInsecureOrCredentialedUrls() {
        for (String url : new String[]{"http://example.test/a", "file:///a", "https://user:pass@example.test/a",
                "https://example.test/a#fragment", "https:///a", "javascript:alert(1)"}) {
            assertThrows(IOException.class, () -> UpdateInfo.httpsUrl(url));
        }
    }

    private static final class Response extends HttpURLConnection {
        final byte[] body;
        String redirect;
        long length;
        int status = 200;
        Response(URL url, byte[] bytes) { super(url); body = bytes; length = bytes.length; }
        @Override public int getResponseCode() { return status; }
        @Override public String getHeaderField(String name) { return "Location".equals(name) ? redirect : null; }
        @Override public long getContentLengthLong() { return length; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(body); }
        @Override public void disconnect() {}
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }

    @Test public void downloadValidatesHashAndReportsProgressWithoutCredentials() throws Exception {
        File destination = Files.createTempFile("update-test-", ".apk").toFile();
        AtomicInteger progress = new AtomicInteger();
        Response response = new Response(info().apkUrl, APK);
        UpdateTransfer task = new UpdateTransfer(url -> response);
        try {
            task.download(info(), destination, (bytes, total) -> progress.set((int) (bytes * 100 / total)));
            assertArrayEquals(APK, Files.readAllBytes(destination.toPath())); assertEquals(100, progress.get());
            assertNull(response.getRequestProperty("Authorization")); assertNull(response.getRequestProperty("Cookie"));
            assertFalse(response.getInstanceFollowRedirects());
            task.verifyFile(info(), destination);
        } finally { destination.delete(); }
    }

    @Test public void corruptAndTruncatedDownloadsAreDeleted() throws Exception {
        byte[] corrupt = APK.clone(); corrupt[0] ^= 1;
        for (byte[] body : new byte[][] { corrupt, new byte[2], new byte[APK.length + 10] }) {
            File destination = Files.createTempFile("update-test-", ".apk").toFile();
            UpdateTransfer task = new UpdateTransfer(url -> { Response r = new Response(url, body); r.length = -1; return r; });
            assertThrows(IOException.class, () -> task.download(info(), destination, (a, b) -> {}));
            assertFalse(destination.exists());
        }
    }

    @Test public void rejectsWrongContentLength() throws Exception {
        File destination = Files.createTempFile("update-test-", ".apk").toFile();
        UpdateTransfer task = new UpdateTransfer(url -> new Response(url, new byte[1]));
        assertThrows(IOException.class, () -> task.download(info(), destination, (a, b) -> {}));
        assertFalse(destination.exists());
    }

    @Test public void cancellationStopsDownloadAndDeletesPartialFile() throws Exception {
        File destination = Files.createTempFile("update-test-", ".apk").toFile();
        UpdateTransfer task = new UpdateTransfer(url -> new Response(url, APK));
        assertThrows(InterruptedIOException.class, () -> task.download(info(), destination, (a, b) -> task.cancel()));
        assertFalse(destination.exists());
    }

    @Test public void followsHttpsRedirectAndRejectsDowngrade() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        UpdateTransfer safe = new UpdateTransfer(url -> {
            Response r = new Response(url, "{}".getBytes(StandardCharsets.UTF_8));
            if (calls.getAndIncrement() == 0) { r.status = 302; r.redirect = "https://cdn.example.test/latest.json"; }
            return r;
        });
        assertEquals("{}", safe.manifest(info().apkUrl)); assertEquals(2, calls.get());
        UpdateTransfer unsafe = new UpdateTransfer(url -> {
            Response r = new Response(url, APK); r.status = 302; r.redirect = "http://insecure.example.test/app.apk"; return r;
        });
        assertThrows(IOException.class, () -> unsafe.manifest(info().apkUrl));
    }

    @Test public void redirectLoopAndServerErrorsAreBounded() throws Exception {
        AtomicInteger calls = new AtomicInteger();
        UpdateTransfer loop = new UpdateTransfer(url -> {
            calls.incrementAndGet(); Response r = new Response(url, APK); r.status = 307; r.redirect = "/again"; return r;
        });
        assertThrows(IOException.class, () -> loop.manifest(info().apkUrl)); assertEquals(6, calls.get());
        UpdateTransfer unavailable = new UpdateTransfer(url -> {
            Response r = new Response(url, APK); r.status = 503; return r;
        });
        assertThrows(IOException.class, () -> unavailable.manifest(info().apkUrl));
    }

    @Test public void oversizedManifestAndModifiedCachedApkAreRejected() throws Exception {
        UpdateTransfer task = new UpdateTransfer(url -> new Response(url, new byte[65537]));
        assertThrows(IOException.class, () -> task.manifest(info().apkUrl));
        File file = Files.createTempFile("update-test-", ".apk").toFile();
        try {
            Files.write(file.toPath(), new byte[APK.length]);
            assertThrows(IOException.class, () -> task.verifyFile(info(), file));
        } finally { file.delete(); }
    }
}
