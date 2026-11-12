import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { InstallPrompt } from './InstallPrompt';

vi.mock('./install', () => ({
  canInstall: () => true,
  subscribeInstall: () => () => undefined,
  isIOS: () => /iPhone/.test(navigator.userAgent),
  isStandalone: () => false,
  promptInstall: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('Android phone uses the contextual RuStore offer instead of an automatic PWA banner', () => {
  vi.stubGlobal('navigator', { userAgent: 'Android Mobile' });
  render(<InstallPrompt />);
  expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
});
test('native shell never invites a second web app installation', () => {
  vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
  render(<InstallPrompt />);
  expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
});
test('desktop retains the web app installation action', () => {
  vi.stubGlobal('navigator', { userAgent: 'Windows' });
  render(<InstallPrompt />);
  expect(screen.getByRole('button', { name: 'Install' })).toBeVisible();
});
