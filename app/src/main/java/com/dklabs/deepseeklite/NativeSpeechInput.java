package com.dklabs.deepseeklite;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import org.json.JSONException;
import org.json.JSONObject;
import java.util.List;
import java.util.Locale;
import java.util.function.Consumer;

/** All recognizer operations and callbacks run on the activity's main thread. */
final class NativeSpeechInput {
    static final int PERMISSION = 45;
    private final Activity activity;
    private final Consumer<JSONObject> events;
    private final Handler timer = new Handler(Looper.getMainLooper());
    private volatile boolean available;
    private boolean requestingPermission;
    private Session active;

    NativeSpeechInput(Activity activity, Consumer<JSONObject> events) {
        this.activity = activity;
        this.events = events;
    }

    void refreshAvailability() {
        available = SpeechRecognizer.isRecognitionAvailable(activity);
    }

    boolean available() { return available; }

    void start(String id, String language) {
        if (id == null || id.isEmpty() || id.length() > 128) return;
        cancelActive();
        Session session = new Session(id, language);
        active = session;
        if (!available) {
            session.fail("unavailable");
        } else if (activity.checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            session.listen();
        } else if (!requestingPermission) {
            requestingPermission = true;
            activity.requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, PERMISSION);
        }
    }

    void onPermissionResult(boolean granted) {
        requestingPermission = false;
        if (active == null || active.recognizer != null) return;
        if (granted) active.listen(); else active.fail("permission");
    }

    void stop(String id) {
        Session session = active;
        if (session == null || !session.id.equals(id) || session.finishing) return;
        if (!session.ready) {
            cancelActive();
            return;
        }
        try {
            session.transcribing();
            session.recognizer.stopListening();
        } catch (RuntimeException error) {
            session.fail("failed");
        }
    }

    void cancel(String id) {
        if (active != null && active.id.equals(id)) cancelActive();
    }

    void cancelActive() {
        if (active != null) active.complete("cancelled", null, null);
    }

    private final class Session implements RecognitionListener {
        final String id;
        final String language;
        SpeechRecognizer recognizer;
        boolean ready;
        boolean finishing;

        Session(String id, String language) {
            this.id = id;
            this.language = language == null || language.isEmpty() ? Locale.getDefault().toLanguageTag() : language;
        }

        void listen() {
            try {
                recognizer = SpeechRecognizer.createSpeechRecognizer(activity);
                recognizer.setRecognitionListener(this);
                Intent intent = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                        .putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
                        .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
                recognizer.startListening(intent);
                deadline(15_000, () -> fail("unavailable"));
            } catch (SecurityException error) {
                fail("permission");
            } catch (RuntimeException error) {
                fail("unavailable");
            }
        }

        private void deadline(long ms, Runnable action) {
            timer.removeCallbacksAndMessages(null);
            timer.postDelayed(() -> { if (active == this) action.run(); }, ms);
        }

        @Override public void onReadyForSpeech(Bundle params) {
            if (active != this || finishing || ready) return;
            ready = true;
            emit("recording", null, null);
            deadline(120_000, () -> stop(id));
        }

        void transcribing() {
            if (active != this || finishing) return;
            finishing = true;
            emit("transcribing", null, null);
            deadline(20_000, () -> fail("network"));
        }

        @Override public void onEndOfSpeech() { transcribing(); }
        @Override public void onResults(Bundle results) {
            List<String> matches = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
            String text = matches == null || matches.isEmpty() ? null : matches.get(0);
            if (text == null || text.trim().isEmpty()) fail("empty"); else complete("result", text.trim(), null);
        }

        @Override public void onError(int code) {
            String reason = switch (code) {
                case SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission";
                case SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "empty";
                case SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
                        SpeechRecognizer.ERROR_SERVER -> "network";
                case SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED, SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE,
                        SpeechRecognizer.ERROR_SERVER_DISCONNECTED -> "unavailable";
                case SpeechRecognizer.ERROR_CLIENT -> ready ? "failed" : "unavailable";
                case SpeechRecognizer.ERROR_AUDIO, SpeechRecognizer.ERROR_RECOGNIZER_BUSY,
                        SpeechRecognizer.ERROR_TOO_MANY_REQUESTS, SpeechRecognizer.ERROR_CANNOT_CHECK_SUPPORT,
                        SpeechRecognizer.ERROR_CANNOT_LISTEN_TO_DOWNLOAD_EVENTS -> "failed";
                default -> "failed";
            };
            fail(reason);
        }

        void fail(String reason) { complete("error", null, reason); }

        void complete(String state, String text, String error) {
            if (active != this) return;
            active = null;
            timer.removeCallbacksAndMessages(null);
            if (recognizer != null) recognizer.destroy();
            emit(state, text, error);
        }

        private void emit(String state, String text, String error) {
            try {
                events.accept(new JSONObject().put("id", id).put("state", state).put("text", text).put("error", error));
            } catch (JSONException impossible) { throw new IllegalStateException(impossible); }
        }

        @Override public void onBeginningOfSpeech() { onReadyForSpeech(null); }
        @Override public void onRmsChanged(float rms) {}
        @Override public void onBufferReceived(byte[] buffer) {}
        @Override public void onPartialResults(Bundle partial) {}
        @Override public void onEvent(int event, Bundle params) {}
    }
}
