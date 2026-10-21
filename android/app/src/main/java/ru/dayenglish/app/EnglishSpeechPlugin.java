package ru.dayenglish.app;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.RecognitionSupport;
import android.speech.RecognitionSupportCallback;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashMap;
import java.util.Map;

@CapacitorPlugin(name = "EnglishSpeech", permissions = @Permission(alias = "microphone", strings = Manifest.permission.RECORD_AUDIO))
public class EnglishSpeechPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, Runnable> probes = new HashMap<>();
    private SpeechSession sessions;
    private PluginCall permissionCall;
    private String permissionError;
    private boolean background;

    @Override public void load() { sessions = new SpeechSession(main, this::engine); }

    private Intent intent() {
        return new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, "en-US")
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
    }

    private SpeechSession.Engine engine(boolean local, RecognitionListener listener) {
        SpeechRecognizer recognizer = createRecognizer(local);
        try { recognizer.setRecognitionListener(listener); }
        catch (RuntimeException error) { destroy(recognizer); throw error; }
        return new SpeechSession.Engine() {
            @Override public void start() { recognizer.startListening(intent()); }
            @Override public void stop() { recognizer.stopListening(); }
            @Override public void cancel() { recognizer.cancel(); }
            @Override public void destroy() { EnglishSpeechPlugin.destroy(recognizer); }
        };
    }

    protected SpeechRecognizer createRecognizer(boolean local) {
        if (local) {
            if (Build.VERSION.SDK_INT < 31 || !SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext())) throw new IllegalStateException();
            return SpeechRecognizer.createOnDeviceSpeechRecognizer(getContext());
        }
        return SpeechRecognizer.createSpeechRecognizer(getContext());
    }

    private static void destroy(SpeechRecognizer recognizer) {
        try { recognizer.destroy(); } catch (RuntimeException ignored) {}
    }

    private String id(PluginCall call) {
        String id = call.getString("session");
        return id != null && id.matches("[A-Za-z0-9-]{1,100}") ? id : null;
    }

    @PluginMethod public void start(PluginCall call) {
        main.post(() -> {
            String id = id(call);
            String mode = call.getString("mode");
            if (id == null || !("local".equals(mode) || "system".equals(mode))) { call.reject("Invalid dictation request", "failed"); return; }
            if (background) { call.reject("Dictation canceled", "canceled"); return; }
            if (permissionCall != null) { call.reject("Microphone permission pending", "busy"); return; }
            boolean reserved = sessions.reserve(id, "local".equals(mode), new SpeechSession.Sink() {
                @Override public void update(String phase, String preview) {
                    JSObject value = new JSObject(); value.put("session", id);
                    if (phase != null) value.put("phase", phase);
                    if (preview != null) value.put("preview", preview);
                    notifyListeners("update", value);
                }
                @Override public void complete(String text, String error) {
                    // Capacitor must retain its saved call until the permission callback consumes it.
                    if (permissionCall == call) { permissionError = error == null ? "canceled" : error; return; }
                    if (error != null) call.reject("Dictation " + error, error);
                    else { JSObject value = new JSObject(); value.put("text", text); call.resolve(value); }
                }
            });
            if (!reserved) return;
            if (getPermissionState("microphone") == PermissionState.GRANTED) sessions.permitted(id, true);
            else {
                permissionCall = call; permissionError = null;
                requestPermissionForAlias("microphone", call, "microphoneResult");
            }
        });
    }

    @PermissionCallback private void microphoneResult(PluginCall call) {
        if (call == null) return;
        main.post(() -> {
            if (permissionCall != call) return;
            String canceled = permissionError;
            permissionCall = null; permissionError = null;
            if (canceled != null || background) call.reject("Dictation canceled", canceled == null ? "canceled" : canceled);
            else sessions.permitted(id(call), getPermissionState("microphone") == PermissionState.GRANTED);
        });
    }

    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> { String id = id(call); if (id != null) sessions.stop(id); call.resolve(); });
    }
    @PluginMethod public void cancel(PluginCall call) {
        main.post(() -> { String id = id(call); if (id != null) sessions.cancel(id); call.resolve(); });
    }

    @PluginMethod public void probe(PluginCall call) {
        main.post(() -> {
            String id = id(call);
            if (id == null || background) { call.reject("Dictation unavailable", "canceled"); return; }
            boolean system;
            boolean local;
            try {
                system = SpeechRecognizer.isRecognitionAvailable(getContext());
                local = Build.VERSION.SDK_INT >= 31 && SpeechRecognizer.isOnDeviceRecognitionAvailable(getContext());
            } catch (RuntimeException error) { resolveProbe(call, "unavailable", false); return; }
            if (!local || Build.VERSION.SDK_INT < 33) { resolveProbe(call, local ? "unknown" : "unavailable", system); return; }
            SpeechRecognizer recognizer;
            try { recognizer = createRecognizer(true); }
            catch (RuntimeException error) { resolveProbe(call, "unavailable", system); return; }
            Runnable finish = () -> {
                Runnable owned = probes.remove(id);
                if (owned == null) return;
                main.removeCallbacks(owned); destroy(recognizer); resolveProbe(call, "unknown", system);
            };
            probes.put(id, finish); main.postDelayed(finish, 5000);
            try {
                recognizer.checkRecognitionSupport(intent(), main::post, new RecognitionSupportCallback() {
                    @Override public void onSupportResult(RecognitionSupport support) {
                        Runnable owned = probes.remove(id);
                        if (owned == null) return;
                        main.removeCallbacks(owned); destroy(recognizer);
                        boolean installed = support.getInstalledOnDeviceLanguages().stream().anyMatch(lang -> "en-US".equalsIgnoreCase(lang.replace('_', '-')));
                        boolean pending = support.getPendingOnDeviceLanguages().stream().anyMatch(lang -> "en-US".equalsIgnoreCase(lang.replace('_', '-')));
                        boolean supported = support.getSupportedOnDeviceLanguages().stream().anyMatch(lang -> "en-US".equalsIgnoreCase(lang.replace('_', '-')));
                        resolveProbe(call, installed ? "ready" : pending ? "downloading" : supported ? "downloadable" : "unavailable", system);
                    }
                    @Override public void onError(int error) { finish.run(); }
                });
            } catch (RuntimeException error) { finish.run(); }
        });
    }
    private void resolveProbe(PluginCall call, String local, boolean system) {
        JSObject value = new JSObject(); value.put("local", local); value.put("system", system); call.resolve(value);
    }
    @PluginMethod public void cancelProbe(PluginCall call) {
        main.post(() -> { Runnable finish = probes.get(id(call)); if (finish != null) finish.run(); call.resolve(); });
    }

    @Override protected void handleOnResume() { main.post(() -> background = false); }
    @Override protected void handleOnPause() {
        main.post(() -> {
            // Android's own permission overlay pauses the activity without backgrounding it.
            if (permissionCall == null) { background = true; sessions.cancelAll(); }
        });
    }
    @Override protected void handleOnStop() { main.post(() -> { background = true; sessions.cancelAll(); }); }
    @Override protected void handleOnDestroy() {
        main.post(() -> {
            background = true; sessions.cancelAll();
            for (Runnable finish : probes.values().toArray(new Runnable[0])) finish.run();
            if (permissionCall != null) { permissionCall.reject("Dictation canceled", "canceled"); permissionCall = null; }
        });
    }
}
