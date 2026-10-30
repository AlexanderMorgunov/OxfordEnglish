package ru.dayenglish.app;

import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebView;

final class BundledAppLoader {
    private final WebView webView;
    private final String appUrl;
    private final Runnable poll = this::check;
    private final Runnable timeout = () -> finish(true);
    private boolean finished;

    BundledAppLoader(WebView webView, String appUrl) {
        this.webView = webView;
        this.appUrl = appUrl;
    }

    void start(String origin) {
        webView.stopLoading();
        // Historic workers exclude /packs/ from their cached SPA navigation fallback.
        webView.loadUrl(origin + "/packs/native-app-bootstrap-v1.html?boot=" + SystemClock.uptimeMillis());
        webView.postDelayed(poll, 50);
        webView.postDelayed(timeout, 5000);
    }

    private void check() {
        if (finished) return;
        webView.evaluateJavascript("window.__dayEnglishNativeBoot", value -> {
            if (finished) return;
            if ("\"ready\"".equals(value)) finish(false);
            else if ("\"failed\"".equals(value)) finish(true);
            else webView.postDelayed(poll, 50);
        });
    }

    private void finish(boolean failed) {
        if (finished) return;
        cancel();
        if (failed) Log.w("DayEnglish", "Native worker cleanup could not complete");
        webView.loadUrl(appUrl);
    }

    void cancel() {
        finished = true;
        webView.removeCallbacks(poll);
        webView.removeCallbacks(timeout);
    }
}
