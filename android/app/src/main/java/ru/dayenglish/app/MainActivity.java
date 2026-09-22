package ru.dayenglish.app;

import android.os.Bundle;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /**
     * Web contents debugging, in debug builds only.
     *
     * It used to be on through capacitor.config, which has no idea which build type it is in — so a
     * release from the store shipped with the WebView open to anyone who plugged the phone into a
     * computer. The config now says false and this turns it back on where it belongs.
     */
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }
}
