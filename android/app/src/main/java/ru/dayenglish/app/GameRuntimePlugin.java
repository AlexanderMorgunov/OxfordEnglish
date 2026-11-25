package ru.dayenglish.app;

import android.graphics.Color;
import android.net.Uri;
import android.os.SystemClock;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import org.json.JSONException;
import org.json.JSONObject;

@CapacitorPlugin(name = "GameRuntime")
public class GameRuntimePlugin extends Plugin {
    private static final String HOST = "https://dayenglish.ru";
    private static final String SHELL = HOST + "/.well-known/game-runtime";
    private static final String ORIGIN = "https://lumi.games.dayenglish.ru";
    private static final String GAME_ID = "lumi-road-of-lights";
    private static final int MAX_MESSAGE = 1024 * 1024;
    private WebView game;
    private FrameLayout overlay;
    private String session;
    private boolean foreground = true;
    private boolean visible;
    private long messageWindow;
    private int messages;
    private OnBackPressedCallback back;

    @Override public void load() {
        getActivity().runOnUiThread(() -> {
            back = new OnBackPressedCallback(false) {
                @Override public void handleOnBackPressed() { emit("back", null); }
            };
            getActivity().getOnBackPressedDispatcher().addCallback(getActivity(), back);
        });
    }

    static String releaseEntry(String gameId, String releaseId) {
        if (!GAME_ID.equals(gameId) || releaseId == null || !releaseId.matches("[A-Za-z0-9][A-Za-z0-9._-]{0,79}"))
            return null;
        return ORIGIN + "/games/" + GAME_ID + "/releases/" + releaseId + "/index.html";
    }

    @PluginMethod public void open(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String id = call.getString("session");
            String entry = releaseEntry(call.getString("gameId"), call.getString("releaseId"));
            if (id == null || !id.matches("[a-f0-9-]{36}") || entry == null || !entry.equals(call.getString("entryUrl"))) {
                call.reject("Game release is not approved for Android", "invalid_origin");
                return;
            }
            if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
                call.reject("Update Android System WebView to launch games", "webview_update");
                return;
            }
            byte[] shell;
            try (InputStream input = getContext().getAssets().open("game-runtime.html");
                 ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096];
                for (int size; (size = input.read(buffer)) != -1;) bytes.write(buffer, 0, size);
                shell = new String(bytes.toByteArray(), StandardCharsets.UTF_8)
                    .replace("__ORIGIN__", JSONObject.quote(ORIGIN))
                    .replace("__BACK__", JSONObject.quote("en".equals(call.getString("locale")) ? "Back to games" : "К играм"))
                    .replace("__ENTRY__", JSONObject.quote(entry))
                    .getBytes(StandardCharsets.UTF_8);
            } catch (IOException error) {
                call.reject("Game shell unavailable", "unavailable");
                return;
            }
            dispose();
            session = id;
            game = new WebView(getActivity());
            WebSettings settings = game.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setMediaPlaybackRequiresUserGesture(true);
            settings.setSupportMultipleWindows(false);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            android.webkit.CookieManager.getInstance().setAcceptThirdPartyCookies(game, false);
            game.setBackgroundColor(Color.rgb(18, 20, 28));
            WebViewCompat.addWebMessageListener(game, "DayEnglishRelay", Collections.singleton(HOST),
                (view, message, sourceOrigin, mainFrame, reply) -> {
                    if (view != game || !mainFrame || !HOST.equals(sourceOrigin.toString()) || !SHELL.equals(view.getUrl()))
                        return;
                    long now = SystemClock.elapsedRealtime();
                    if (now - messageWindow >= 1000) {
                        messages = 0;
                        messageWindow = now;
                    }
                    if (++messages > 40) return;
                    String data = message.getData();
                    if (data == null || data.length() > MAX_MESSAGE) return;
                    try {
                        JSONObject value = new JSONObject(data);
                        String kind = value.optString("kind");
                        if ("message".equals(kind) && value.optJSONObject("payload") != null)
                            emit(kind, value.getJSONObject("payload").toString());
                        else if ("back".equals(kind) || "loaded".equals(kind)) emit(kind, null);
                    } catch (JSONException ignored) {}
                });
            String releasePrefix = entry.substring(0, entry.lastIndexOf('/') + 1);
            game.setWebViewClient(new WebViewClient() {
                @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    if (request.isForMainFrame() && SHELL.equals(url) && "GET".equals(request.getMethod())) {
                        WebResourceResponse response = new WebResourceResponse("text/html", "UTF-8", new ByteArrayInputStream(shell));
                        response.setResponseHeaders(Collections.singletonMap("Cache-Control", "no-store"));
                        return response;
                    }
                    if (!request.isForMainFrame() && url.startsWith(releasePrefix)) return null;
                    return new WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", Collections.emptyMap(),
                        new ByteArrayInputStream(new byte[0]));
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return request.isForMainFrame() || !entry.equals(request.getUrl().toString());
                }
                @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                    if (!SHELL.equals(url)) fail(view);
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame() || entry.equals(request.getUrl().toString())) fail(view);
                }
                @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                    if (request.isForMainFrame() || entry.equals(request.getUrl().toString())) fail(view);
                }
                @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                    fail(view);
                    return true;
                }
            });
            overlay = new FrameLayout(getActivity());
            overlay.setBackgroundColor(Color.rgb(18, 20, 28));
            ViewCompat.setOnApplyWindowInsetsListener(overlay, (view, insets) -> {
                var edges = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
                view.setPadding(edges.left, edges.top, edges.right, edges.bottom);
                return insets;
            });
            overlay.addView(game, new FrameLayout.LayoutParams(-1, -1));
            ViewGroup content = getActivity().findViewById(android.R.id.content);
            content.addView(overlay, new ViewGroup.LayoutParams(-1, -1));
            ViewCompat.requestApplyInsets(overlay);
            visible = Boolean.TRUE.equals(call.getBoolean("visible", true));
            applyVisibility();
            game.loadUrl(SHELL);
            call.resolve();
        });
    }

    @PluginMethod public void send(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            String data = call.getString("payload");
            if (matches(call) && data != null && data.length() <= MAX_MESSAGE && SHELL.equals(game.getUrl()))
                game.evaluateJavascript("window.deliverToGame?.(" + JSONObject.quote(data) + ")", null);
            call.resolve();
        });
    }

    @PluginMethod public void show(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (matches(call)) {
                visible = Boolean.TRUE.equals(call.getBoolean("visible"));
                applyVisibility();
            }
            call.resolve();
        });
    }

    @PluginMethod public void close(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            if (matches(call)) dispose();
            call.resolve();
        });
    }

    private boolean matches(PluginCall call) {
        return session != null && session.equals(call.getString("session")) && game != null;
    }

    private void applyVisibility() {
        if (overlay != null) overlay.setVisibility(visible && foreground ? View.VISIBLE : View.GONE);
        if (back != null) back.setEnabled(overlay != null);
        getBridge().getWebView().setImportantForAccessibility(
            overlay != null && visible && foreground ? View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS : View.IMPORTANT_FOR_ACCESSIBILITY_AUTO);
    }

    private void emit(String kind, String payload) {
        if (session == null) return;
        JSObject value = new JSObject();
        value.put("session", session);
        value.put("kind", kind);
        if (payload != null) value.put("payload", payload);
        notifyListeners("gameEvent", value);
    }

    private void fail(WebView view) {
        if (game != view) return;
        emit("failed", null);
        dispose();
    }

    private void dispose() {
        WebView old = game;
        game = null;
        session = null;
        if (old != null) {
            WebViewCompat.removeWebMessageListener(old, "DayEnglishRelay");
            old.stopLoading();
            overlay.removeView(old);
            old.destroy();
        }
        if (overlay != null) {
            if (overlay.getParent() instanceof ViewGroup parent) parent.removeView(overlay);
            overlay = null;
        }
        applyVisibility();
    }

    @Override protected void handleOnPause() {
        foreground = false;
        emit("background", null);
        if (game != null) game.onPause();
        applyVisibility();
    }

    @Override protected void handleOnResume() {
        foreground = true;
        visible = false;
        if (game != null) game.onResume();
        emit("foreground", null);
        applyVisibility();
    }

    @Override protected void handleOnDestroy() {
        dispose();
        if (back != null) back.remove();
    }
}
