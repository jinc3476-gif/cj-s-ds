package com.dklabs.deepseeklite;

import android.Manifest;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Arrays;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/** Captures PCM directly in the app process, without delegating microphone ownership to an OEM recognizer. */
final class NativeAudioRecorder {
    static final int PERMISSION = 46;
    private static final int RATE = 16000;
    private static final int MAX_BYTES = RATE * 2 * 120;
    private static final int CHUNK_BYTES = 192 * 1024;

    private final Activity activity;
    private final Consumer<JSONObject> events;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private String activeId;
    private AudioRecord recorder;
    private boolean cancelled;
    private boolean stopping;

    NativeAudioRecorder(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity;
        this.events = events;
    }

    synchronized void start(String id) {
        if (activeId != null) cancel(activeId);
        activeId = id;
        cancelled = false;
        stopping = false;
        if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION);
            return;
        }
        begin(id);
    }

    synchronized void onPermissionResult(boolean granted) {
        String id = activeId;
        if (id == null) return;
        if (granted) begin(id);
        else {
            activeId = null;
            emit(id, "error", "permission", null, false);
        }
    }

    private void begin(String id) {
        worker.execute(() -> capture(id));
    }

    private void capture(String id) {
        AudioRecord input = null;
        ByteArrayOutputStream pcm = new ByteArrayOutputStream();
        boolean limited = false;
        try {
            if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
                throw new SecurityException("Microphone permission was revoked");
            }
            int minimum = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_16BIT);
            if (minimum <= 0) throw new IllegalStateException("Audio input is unavailable");
            input = new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE,
                    AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT,
                    Math.max(minimum, 8192));
            if (input.getState() != AudioRecord.STATE_INITIALIZED) {
                throw new IllegalStateException("Audio input could not be initialized");
            }
            synchronized (this) {
                if (!id.equals(activeId) || cancelled) return;
                recorder = input;
            }
            input.startRecording();
            if (input.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING) {
                throw new IllegalStateException("Audio input did not start");
            }
            emit(id, "recording", null, null, false);
            byte[] buffer = new byte[4096];
            while (true) {
                synchronized (this) {
                    if (!id.equals(activeId) || cancelled) return;
                    if (stopping) break;
                }
                int count = input.read(buffer, 0, Math.min(buffer.length, MAX_BYTES - pcm.size()));
                synchronized (this) {
                    if (!id.equals(activeId) || cancelled) return;
                    if (stopping && count < 0) break;
                }
                if (count < 0) throw new IllegalStateException("Audio input stopped unexpectedly");
                if (count > 0) pcm.write(buffer, 0, count);
                if (pcm.size() >= MAX_BYTES) {
                    limited = true;
                    break;
                }
            }
            byte[] data = wav(pcm.toByteArray());
            synchronized (this) {
                if (!id.equals(activeId) || cancelled) return;
                activeId = null;
            }
            for (int offset = 0; offset < data.length; offset += CHUNK_BYTES) {
                String part = Base64.encodeToString(Arrays.copyOfRange(data, offset,
                        Math.min(data.length, offset + CHUNK_BYTES)), Base64.NO_WRAP);
                emit(id, "data", part, null, false);
            }
            emit(id, "result", null, null, limited);
        } catch (Exception error) {
            synchronized (this) {
                if (!id.equals(activeId) || cancelled) return;
                activeId = null;
            }
            emit(id, "error", "failed", null, false);
        } finally {
            if (input != null) {
                try {
                    if (input.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) input.stop();
                } catch (IllegalStateException ignored) { }
                input.release();
            }
            synchronized (this) {
                if (recorder == input) recorder = null;
            }
        }
    }

    synchronized void stop(String id) {
        if (!id.equals(activeId)) return;
        stopping = true;
        if (recorder != null) {
            try { recorder.stop(); } catch (IllegalStateException ignored) { }
        }
    }

    synchronized void cancel(String id) {
        if (!id.equals(activeId)) return;
        cancelled = true;
        activeId = null;
        if (recorder != null) {
            try { recorder.stop(); } catch (IllegalStateException ignored) { }
        }
        emit(id, "cancelled", null, null, false);
    }

    synchronized void cancelActive() {
        if (activeId != null) cancel(activeId);
    }

    private void emit(String id, String state, String value, String error, boolean limited) {
        JSONObject event = new JSONObject();
        try {
            event.put("id", id);
            event.put("state", state);
            if ("data".equals(state)) event.put("data", value);
            if (error != null) event.put("error", error);
            if (limited) event.put("limited", true);
        } catch (Exception ignored) { return; }
        activity.runOnUiThread(() -> events.accept(event));
    }

    private static byte[] wav(byte[] pcm) {
        ByteBuffer header = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN);
        header.put(new byte[]{'R','I','F','F'});
        header.putInt(36 + pcm.length);
        header.put(new byte[]{'W','A','V','E','f','m','t',' '});
        header.putInt(16);
        header.putShort((short) 1);
        header.putShort((short) 1);
        header.putInt(RATE);
        header.putInt(RATE * 2);
        header.putShort((short) 2);
        header.putShort((short) 16);
        header.put(new byte[]{'d','a','t','a'});
        header.putInt(pcm.length);
        byte[] result = new byte[44 + pcm.length];
        System.arraycopy(header.array(), 0, result, 0, 44);
        System.arraycopy(pcm, 0, result, 44, pcm.length);
        return result;
    }

    void destroy() {
        cancelActive();
        worker.shutdownNow();
    }
}
