import { afterEach, expect, test, vi } from 'vitest';
import { installEnvironment } from './environment';

afterEach(() => vi.unstubAllGlobals());

test.each([
  [
    'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile Safari/537.36',
    'android',
  ],
  ['Mozilla/5.0 (Linux; Android 14) Chrome/130 Safari/537.36', 'other'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari', 'ios'],
  ['Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari', 'other'],
])(
  'classifies %s without assuming installation status',
  (userAgent, expected) => {
    vi.stubGlobal('navigator', { userAgent });
    expect(installEnvironment()).toBe(expected);
  }
);

test('native and standalone override an Android phone user agent', () => {
  vi.stubGlobal('navigator', { userAgent: 'Android Mobile', standalone: true });
  expect(installEnvironment()).toBe('standalone');
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
  expect(installEnvironment()).toBe('native');
});
