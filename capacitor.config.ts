import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.dayenglish.app',
  appName: 'DayEnglish',
  webDir: 'dist',
  android: {
    // Off here, and switched back on for debug builds in MainActivity. This setting cannot tell which
    // build type it is in, so leaving it true shipped a store release whose WebView was open to
    // anyone with a USB cable.
    webContentsDebuggingEnabled: false,
  },
};

export default config;
