package ru.dayenglish.app;

import android.os.Bundle;
import android.os.Handler;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import java.util.ArrayList;
import java.util.LinkedHashSet;

final class SpeechSession {
    interface Engine {
        void start();
        void stop();
        void cancel();
        void destroy();
    }
    interface Factory { Engine create(boolean local, RecognitionListener listener); }
    interface Sink {
        void update(String phase, String preview);
        void complete(String text, String error);
    }
    private static final class Session {
        final String id;
        final boolean local;
        final Sink sink;
        Engine engine;
        int phase;
        Runnable deadline;
        Session(String id, boolean local, Sink sink) { this.id = id; this.local = local; this.sink = sink; }
    }
    private final Handler handler;
    private final Factory factory;
    private final LinkedHashSet<String> abandoned = new LinkedHashSet<>();
    private Session active;

    SpeechSession(Handler handler, Factory factory) { this.handler = handler; this.factory = factory; }

    boolean reserve(String id, boolean local, Sink sink) {
        if (abandoned.contains(id)) { sink.complete(null, "canceled"); return false; }
        if (active != null) { sink.complete(null, "busy"); return false; }
        Session session = new Session(id, local, sink);
        active = session;
        deadline(session, 40_000, () -> finish(session, null, "timeout"));
        return true;
    }

    void permitted(String id, boolean granted) {
        Session session = active;
        if (session == null || !session.id.equals(id) || session.phase != 0) return;
        if (!granted) { finish(session, null, "permission"); return; }
        session.phase = 1;
        try {
            session.engine = factory.create(session.local, listener(session));
            session.engine.start();
        } catch (SecurityException error) { finish(session, null, "permission"); }
        catch (RuntimeException error) { finish(session, null, "failed"); }
    }

    void stop(String id) {
        Session session = active;
        if (session == null || !session.id.equals(id)) return;
        if (session.phase < 2) { cancel(id); return; }
        if (session.phase == 3) return;
        finishing(session);
        try { session.engine.stop(); } catch (RuntimeException error) { finish(session, null, "failed"); }
    }

    void cancel(String id) {
        remember(id);
        if (active != null && active.id.equals(id)) finish(active, null, "canceled");
    }

    void cancelAll() { if (active != null) cancel(active.id); }

    private void remember(String id) {
        abandoned.add(id);
        if (abandoned.size() > 128) abandoned.remove(abandoned.iterator().next());
    }

    private void deadline(Session session, long ms, Runnable action) {
        if (session.deadline != null) handler.removeCallbacks(session.deadline);
        session.deadline = () -> { if (active == session) action.run(); };
        handler.postDelayed(session.deadline, ms);
    }

    private void finishing(Session session) {
        if (active != session || session.phase == 3) return;
        session.phase = 3;
        session.sink.update("finishing", null);
        deadline(session, 5000, () -> finish(session, null, "timeout"));
    }

    private void finish(Session session, String text, String error) {
        if (active != session) return;
        active = null; remember(session.id);
        if (session.deadline != null) handler.removeCallbacks(session.deadline);
        if (session.engine != null) {
            if (error != null) try { session.engine.cancel(); } catch (RuntimeException ignored) {}
            try { session.engine.destroy(); } catch (RuntimeException ignored) {}
        }
        session.sink.complete(text, error);
    }

    static String first(Bundle results) {
        ArrayList<String> values = results == null ? null : results.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
        return values == null || values.isEmpty() || values.get(0) == null ? "" : values.get(0).trim();
    }

    static String errorCode(int error) {
        if (error == SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) return "permission";
        if (error == SpeechRecognizer.ERROR_NO_MATCH || error == SpeechRecognizer.ERROR_SPEECH_TIMEOUT) return "empty";
        if (error == SpeechRecognizer.ERROR_LANGUAGE_NOT_SUPPORTED || error == SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE) return "language";
        if (error == SpeechRecognizer.ERROR_NETWORK || error == SpeechRecognizer.ERROR_NETWORK_TIMEOUT || error == SpeechRecognizer.ERROR_SERVER || error == SpeechRecognizer.ERROR_SERVER_DISCONNECTED) return "network";
        if (error == SpeechRecognizer.ERROR_RECOGNIZER_BUSY) return "busy";
        return "failed";
    }

    private RecognitionListener listener(Session session) {
        return new RecognitionListener() {
            @Override public void onReadyForSpeech(Bundle params) {
                if (active != session || session.phase != 1) return;
                session.phase = 2; session.sink.update("listening", null);
                deadline(session, 30_000, () -> stop(session.id));
            }
            @Override public void onPartialResults(Bundle results) {
                if (active == session) session.sink.update(null, first(results));
            }
            @Override public void onResults(Bundle results) {
                String text = first(results);
                finish(session, text, text.isEmpty() ? "empty" : null);
            }
            @Override public void onError(int error) { finish(session, null, errorCode(error)); }
            @Override public void onEndOfSpeech() { finishing(session); }
            @Override public void onBeginningOfSpeech() {}
            @Override public void onRmsChanged(float rms) {}
            @Override public void onBufferReceived(byte[] buffer) {}
            @Override public void onEvent(int event, Bundle params) {}
        };
    }
}
