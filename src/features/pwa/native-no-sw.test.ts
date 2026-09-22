/**
 * No service worker inside the Android shell.
 *
 * There the bundle IS the APK, so a worker has nothing to fetch that is not already local — it would
 * only fill a Cache Storage the WebView may evict, and Workbox precaching under Capacitor has never
 * been shown to work end to end (the one detailed report has every registration property null). It
 * also arms a trap: point `server.hostname` at the production domain and an installed worker starts
 * serving the website in place of the bundle.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const registerSW = vi.fn();
vi.mock('virtual:pwa-register', () => ({ registerSW }));

const setCapacitor = (native: boolean): void => {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => native };
};

beforeEach(() => {
  vi.resetModules();
  registerSW.mockReset();
  delete (globalThis as { Capacitor?: unknown }).Capacitor;
});

describe('initAppUpdate', () => {
  it('registers nothing on Android', async () => {
    setCapacitor(true);
    const { initAppUpdate } = await import('./update');
    initAppUpdate();
    expect(registerSW).not.toHaveBeenCalled();
  });

  it('still registers in a browser', async () => {
    const { initAppUpdate } = await import('./update');
    initAppUpdate();
    expect(registerSW).toHaveBeenCalledTimes(1);
  });

  // A shell with no worker has nothing to ask, and the settings control is hidden there for that
  // reason. Reporting "unavailable" rather than throwing keeps any other caller honest.
  it('reports no registration to check on Android', async () => {
    setCapacitor(true);
    const { initAppUpdate, checkForAppUpdate } = await import('./update');
    initAppUpdate();
    expect(await checkForAppUpdate()).toBe('unavailable');
  });
});
