import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const html = readFileSync(new NodeURL('../../../public/packs/native-app-bootstrap-v1.html', import.meta.url), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error('Missing native bootstrap script');
const start = () => new Function(script)();
const state = () => Reflect.get(window, '__dayEnglishNativeBoot');

beforeEach(() => {
  Object.defineProperty(window, 'androidBridge', { configurable: true, value: { postMessage: vi.fn() } });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'androidBridge');
  Reflect.deleteProperty(window, '__dayEnglishNativeBoot');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

test('native boot waits for old registrations to unregister without clearing user storage or caches', async () => {
  let finish!: (value: boolean) => void;
  const unregister = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  const getRegistrations = vi.fn().mockResolvedValue([{ unregister }]);
  const deleteCache = vi.fn(), clearStorage = vi.spyOn(Storage.prototype, 'clear');
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations } });
  vi.stubGlobal('caches', { delete: deleteCache });
  localStorage.setItem('native-bootstrap-retained', 'saved');
  start(); await vi.waitFor(() => expect(unregister).toHaveBeenCalledOnce());
  expect(state()).toBe('pending');
  finish(true); await vi.waitFor(() => expect(state()).toBe('ready'));
  expect(getRegistrations).toHaveBeenCalledOnce();
  expect(deleteCache).not.toHaveBeenCalled(); expect(clearStorage).not.toHaveBeenCalled();
  expect(localStorage.getItem('native-bootstrap-retained')).toBe('saved');
});

test('a browser page cannot retire its PWA registration through the native bootstrap asset', async () => {
  Reflect.deleteProperty(window, 'androidBridge');
  const getRegistrations = vi.fn();
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations } });
  start(); await vi.waitFor(() => expect(state()).toBe('failed'));
  expect(getRegistrations).not.toHaveBeenCalled();
});

test('missing service worker support finishes and host failures are reported without erasing data', async () => {
  vi.stubGlobal('navigator', {});
  start(); await vi.waitFor(() => expect(state()).toBe('ready'));
  vi.stubGlobal('navigator', { serviceWorker: { getRegistrations: vi.fn().mockRejectedValue(new Error('Host unavailable')) } });
  start(); await vi.waitFor(() => expect(state()).toBe('failed'));
});
