import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.dayenglish.app',
  appName: 'DayEnglish',
  webDir: 'dist',
  android: {
    // The reader keeps books in OPFS and the listen player seeks mp3 by range request; both are
    // evictable if the WebView treats storage as best-effort. Measured before relying on it.
    webContentsDebuggingEnabled: true,
  },
};

export default config;
