package ru.dayenglish.app;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.speech.SpeechRecognizer;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.PluginCall;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class EnglishSpeechPluginTest {
    private static class Call extends PluginCall {
        final CountDownLatch done = new CountDownLatch(1);
        String error;
        JSObject result;
        Call(String id) { super(null, "EnglishSpeech", id, "start", new JSObject().put("session", id).put("mode", "local")); }
        @Override public void resolve() { done.countDown(); }
        @Override public void resolve(JSObject value) { result = value; done.countDown(); }
        @Override public void reject(String message, String code) { error = code; done.countDown(); }
        void await() throws Exception { assertTrue(done.await(3, TimeUnit.SECONDS)); }
    }
    private static class Plugin extends EnglishSpeechPlugin {
        int creates;
        @Override public Context getContext() { return InstrumentationRegistry.getInstrumentation().getTargetContext(); }
        @Override public PermissionState getPermissionState(String alias) { return PermissionState.GRANTED; }
        @Override protected SpeechRecognizer createRecognizer(boolean local) { creates++; throw new IllegalStateException("Provider disappeared"); }
    }
    private static class Engine implements SpeechSession.Engine {
        int starts, destroys;
        @Override public void start() { starts++; }
        @Override public void stop() {}
        @Override public void cancel() {}
        @Override public void destroy() { destroys++; }
    }
    private void main(Runnable task) { InstrumentationRegistry.getInstrumentation().runOnMainSync(task); }
    private void flush() { main(() -> {}); }
    private void set(Plugin plugin, String name, Object value) throws Exception {
        Field field = EnglishSpeechPlugin.class.getDeclaredField(name); field.setAccessible(true); field.set(plugin, value);
    }
    private void permissionResult(Plugin plugin, Call call) throws Exception {
        Method method = EnglishSpeechPlugin.class.getDeclaredMethod("microphoneResult", PluginCall.class); method.setAccessible(true); method.invoke(plugin, call); flush();
    }
    private SpeechSession sessions(Plugin plugin, Engine engine) throws Exception {
        SpeechSession sessions = new SpeechSession(new Handler(Looper.getMainLooper()), (local, listener) -> engine);
        set(plugin, "sessions", sessions); return sessions;
    }
    @Test public void canceledSavedPermissionCallSurvivesUntilLateGrantAndNextStartWorks() throws Exception {
        Plugin plugin = new Plugin(); Engine engine = new Engine(); SpeechSession sessions = sessions(plugin, engine); Call pending = new Call("permission");
        set(plugin, "permissionCall", pending);
        main(() -> sessions.reserve("permission", true, new SpeechSession.Sink() {
            @Override public void update(String phase, String preview) {}
            @Override public void complete(String text, String error) { try { set(plugin, "permissionError", error); } catch (Exception failure) { throw new RuntimeException(failure); } }
        }));
        plugin.handleOnPause(); flush(); Call cancel = new Call("permission"); plugin.cancel(cancel); cancel.await(); assertEquals(0, engine.starts); assertEquals(1L, pending.done.getCount());
        Call busy = new Call("pending-two"); plugin.start(busy); busy.await(); assertEquals("busy", busy.error);
        permissionResult(plugin, pending); pending.await(); assertEquals("canceled", pending.error); assertEquals(0, engine.starts);
        plugin.handleOnResume(); flush(); Call next = new Call("next"); plugin.start(next); flush(); assertEquals(1, engine.starts);
        Call end = new Call("next"); plugin.cancel(end); end.await(); next.await(); assertEquals("canceled", next.error); assertEquals(1, engine.destroys);
    }
    @Test public void permissionOverlayPauseAllowsExplicitGrantButActualStopCancelsIt() throws Exception {
        Plugin plugin = new Plugin(); Engine engine = new Engine(); SpeechSession sessions = sessions(plugin, engine); Call pending = new Call("overlay"); set(plugin, "permissionCall", pending);
        main(() -> sessions.reserve("overlay", true, new SpeechSession.Sink() { public void update(String phase, String preview) {} public void complete(String text, String error) {} }));
        plugin.handleOnPause(); flush(); permissionResult(plugin, pending); assertEquals(1, engine.starts);
        plugin.handleOnStop(); flush(); assertEquals(1, engine.destroys);
    }
    @Test public void providerCreationRaceReturnsUsefulCapabilityInsteadOfCrashingMainThread() throws Exception {
        Plugin plugin = new Plugin(); Call call = new Call("probe"); plugin.probe(call); call.await();
        assertNull(call.error); assertEquals("unavailable", call.result.getString("local"));
        assertEquals(1, plugin.creates);
    }
}
