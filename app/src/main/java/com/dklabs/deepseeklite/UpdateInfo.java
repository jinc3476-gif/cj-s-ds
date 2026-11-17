package com.dklabs.deepseeklite;

import org.json.JSONObject;
import java.io.IOException;
import java.net.URI;
import java.net.URL;
import java.util.Locale;

/** Public release metadata. All download inputs are validated before network access. */
final class UpdateInfo {
    static final long MAX_APK_BYTES = 512L * 1024 * 1024;
    final String applicationId, versionName, notes, sha256, sourceJson;
    final int versionCode, minSdk;
    final long size;
    final URL apkUrl;

    UpdateInfo(String json, String expectedApplicationId) throws IOException {
        sourceJson = json;
        try {
            JSONObject data = new JSONObject(json);
            if (integer(data, "schemaVersion") != 1) throw new IOException("不支持的更新信息格式");
            applicationId = data.getString("applicationId");
            if (!expectedApplicationId.equals(applicationId)) throw new IOException("更新信息不属于当前应用");
            versionCode = integer(data, "versionCode");
            minSdk = integer(data, "minSdk");
            versionName = data.getString("versionName");
            notes = data.optString("notes", "");
            sha256 = data.getString("sha256").toLowerCase(Locale.ROOT);
            Object rawSize = data.get("size");
            if (!(rawSize instanceof Number) || !rawSize.toString().matches("[0-9]+")) throw new IOException("无效的安装包大小");
            size = ((Number) rawSize).longValue();
            apkUrl = httpsUrl(data.getString("apkUrl"));
            if (versionCode < 1 || minSdk < 1 || versionName.isEmpty() || versionName.length() > 80
                    || notes.length() > 8000 || !sha256.matches("[a-f0-9]{64}")
                    || size < 1 || size > MAX_APK_BYTES) throw new IOException("更新信息不完整或超出限制");
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw new IOException("无法读取更新信息，请稍后重试", error); }
    }

    private static int integer(JSONObject data, String key) throws Exception {
        Object value = data.get(key);
        if (!(value instanceof Number) || !value.toString().matches("[0-9]+")) throw new IOException("无效的版本信息");
        return Math.toIntExact(((Number) value).longValue());
    }

    static URL httpsUrl(String value) throws IOException {
        try {
            URI uri = new URI(value);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                    || uri.getRawUserInfo() != null || uri.getFragment() != null) {
                throw new IOException("更新地址必须使用 HTTPS，且不能包含账号或片段");
            }
            return uri.toURL();
        } catch (IOException error) { throw error; }
        catch (Exception error) { throw new IOException("无效的更新地址", error); }
    }
}
