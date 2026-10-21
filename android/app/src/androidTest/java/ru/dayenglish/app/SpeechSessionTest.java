package ru.dayenglish.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.speech.RecognitionListener;
import android.speech.SpeechRecognizer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class SpeechSessionTest {
    private static class FakeEngine implements SpeechSession.Engine {
        RecognitionListener listener;
        int starts, stops, cancels, destroys;
        boolean failStart;
        @Override public void start() { starts++; if (failStart) throw new IllegalStateException(); }
        @Override public void stop() { stops++; }
        @Override public void cancel() { cancels++; }
        @Override public void destroy() { destroys++; }
    }
    private static class Result implements SpeechSession.Sink {
        String text, error, phase, preview;
        int completions;
        final CountDownLatch done = new CountDownLatch(1);
        @Override public void update(String phase, String preview) { if (phase != null) this.phase = phase; if (preview != null) this.preview = preview; }
        @Override public void complete(String text, String error) { this.text = text; this.error = error; completions++; done.countDown(); }
    }
    private void main(Runnable task) { InstrumentationRegistry.getInstrumentation().runOnMainSync(task); }
    private Bundle results(String... alternatives) {
        Bundle bundle = new Bundle(); bundle.putStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION, new ArrayList<>(Arrays.asList(alternatives))); return bundle;
    }
    @Test public void canceledPermissionAndReorderedStartCannotActivateMicrophone() {
        main(() -> {
            FakeEngine engine = new FakeEngine();
            SpeechSession sessions = new SpeechSession(new Handler(Looper.getMainLooper()), (local, listener) -> { engine.listener = listener; return engine; });
            Result canceled = new Result(); assertTrue(sessions.reserve("permission", true, canceled));
            sessions.cancel("permission"); sessions.permitted("permission", true);
            assertEquals(0, engine.starts); assertEquals("canceled", canceled.error);
            sessions.cancel("reordered"); Result reordered = new Result(); assertFalse(sessions.reserve("reordered", true, reordered));
            sessions.permitted("reordered", true); assertEquals(0, engine.starts); assertEquals("canceled", reordered.error);
            Result denied = new Result(); assertTrue(sessions.reserve("denied", false, denied)); sessions.permitted("denied", false);
            assertEquals("permission", denied.error); assertEquals(0, engine.starts);
        });
    }
    @Test public void stopRetainsEngineUntilFinalAndTakesOnlyFirstAlternative() {
        main(() -> {
            FakeEngine engine = new FakeEngine();
            SpeechSession sessions = new SpeechSession(new Handler(Looper.getMainLooper()), (local, listener) -> { assertTrue(local); engine.listener = listener; return engine; });
            Result result = new Result(); sessions.reserve("first", true, result); sessions.permitted("first", true); engine.listener.onReadyForSpeech(new Bundle());
            engine.listener.onPartialResults(results("Take car", "Other hypothesis")); assertEquals("Take car", result.preview); assertNull(result.text);
            sessions.stop("first"); assertEquals(1, engine.stops); assertEquals(0, engine.destroys); assertEquals("finishing", result.phase);
            Result busy = new Result(); assertFalse(sessions.reserve("other", false, busy)); assertEquals("busy", busy.error);
            engine.listener.onResults(results("Take care.", "Take a car.")); assertEquals("Take care.", result.text); assertEquals(1, engine.destroys);
            assertEquals(1, result.completions); assertNull(result.error);
        });
    }
    @Test public void backgroundCancelDestroysAndOldCallbacksCannotAffectNewSession() {
        main(() -> {
            ArrayList<FakeEngine> engines = new ArrayList<>();
            SpeechSession sessions = new SpeechSession(new Handler(Looper.getMainLooper()), (local, listener) -> { FakeEngine engine = new FakeEngine(); engine.listener = listener; engines.add(engine); return engine; });
            Result first = new Result(); sessions.reserve("one", true, first); sessions.permitted("one", true); sessions.cancelAll();
            assertEquals(1, engines.get(0).cancels); assertEquals(1, engines.get(0).destroys);
            Result second = new Result(); sessions.reserve("two", false, second); sessions.permitted("two", true);
            engines.get(0).listener.onReadyForSpeech(new Bundle()); engines.get(0).listener.onPartialResults(results("Old private")); engines.get(0).listener.onResults(results("Old final")); engines.get(0).listener.onError(SpeechRecognizer.ERROR_NETWORK);
            assertNull(second.text); assertNull(second.phase); assertNull(second.preview); assertEquals(0, second.completions);
            engines.get(1).listener.onResults(results("New final")); assertEquals("New final", second.text);
        });
    }
    @Test public void startingStopCancelsAndProviderStartFailureDestroys() {
        main(() -> {
            FakeEngine engine = new FakeEngine(); engine.failStart = true;
            SpeechSession sessions = new SpeechSession(new Handler(Looper.getMainLooper()), (local, listener) -> { engine.listener = listener; return engine; });
            Result pending = new Result(); sessions.reserve("pending", true, pending); sessions.stop("pending"); sessions.permitted("pending", true);
            assertEquals("canceled", pending.error); assertEquals(0, engine.starts);
            Result failure = new Result(); sessions.reserve("fail", true, failure); sessions.permitted("fail", true);
            assertEquals("failed", failure.error); assertEquals(1, engine.destroys); assertEquals(1, engine.cancels);
        });
    }
    @Test public void finalDeadlineCancelsProviderThatNeverReturnsAndDiscardsPartial() throws Exception {
        FakeEngine engine = new FakeEngine(); Result result = new Result();
        main(() -> {
            SpeechSession sessions = new SpeechSession(new Handler(Looper.getMainLooper()), (local, listener) -> { engine.listener = listener; return engine; });
            sessions.reserve("timeout", true, result); sessions.permitted("timeout", true); engine.listener.onReadyForSpeech(new Bundle());
            engine.listener.onPartialResults(results("Unconfirmed")); engine.listener.onEndOfSpeech();
        });
        assertTrue(result.done.await(7, TimeUnit.SECONDS)); assertEquals("timeout", result.error); assertNull(result.text);
        assertEquals(1, engine.cancels); assertEquals(1, engine.destroys);
    }
    @Test public void languageAndPermissionErrorsRemainSpecificAndEmptyNeverUsesAlternative() {
        assertEquals("language", SpeechSession.errorCode(SpeechRecognizer.ERROR_LANGUAGE_UNAVAILABLE));
        assertEquals("permission", SpeechSession.errorCode(SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS));
        assertEquals("", SpeechSession.first(results("", "Alternative")));
    }
}
