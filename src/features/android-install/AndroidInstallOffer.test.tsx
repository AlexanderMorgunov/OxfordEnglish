import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AndroidInstallOffer } from './AndroidInstallOffer';
import { RUSTORE_URL } from './memory';

const state = vi.hoisted(() => ({
  pending: false,
  saved: true,
  listeners: new Set<() => void>(),
}));
vi.mock('./memory', () => ({
  RUSTORE_URL: 'https://www.rustore.ru/catalog/app/ru.dayenglish.app',
  androidInstallPending: () => state.pending,
  subscribeAndroidInstall: (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  },
  hideAndroidInstall: () => {
    state.pending = false;
    state.listeners.forEach((fn) => fn());
    return state.saved;
  },
}));
beforeEach(() => {
  state.pending = false;
  state.saved = true;
  vi.stubGlobal('navigator', { userAgent: 'Android Mobile' });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.querySelectorAll('[data-fixture]').forEach((el) => el.remove());
});
const queue = () =>
  act(() => {
    state.pending = true;
    state.listeners.forEach((fn) => fn());
  });
const show = () =>
  render(
    <MemoryRouter>
      <AndroidInstallOffer ready />
    </MemoryRouter>
  );

test.each(['dialog', 'welcome', 'tour', 'sale', 'migration', 'navigation'])(
  'defers a completed study while %s is open and shows after it closes',
  async (blocker) => {
    show();
    expect(screen.queryByRole('complementary')).toBeNull();
    const node = document.createElement(
      blocker === 'dialog' ? 'dialog' : 'div'
    );
    node.dataset.fixture = '';
    if (blocker === 'dialog') node.setAttribute('open', '');
    if (blocker === 'welcome')
      node.setAttribute('data-welcome-pending', 'true');
    if (blocker === 'tour') node.className = 'ct-popover';
    if (blocker === 'sale') node.className = 'pro-sale-banner';
    if (blocker === 'migration') node.setAttribute('data-install-blocker', '');
    if (blocker === 'navigation') node.className = 'app-nav-panel';
    document.body.append(node);
    queue();
    expect(screen.queryByRole('complementary')).toBeNull();
    node.remove();
    expect(await screen.findByRole('complementary')).toBeVisible();
    expect(screen.getByRole('link', { name: /Open RuStore/ })).toHaveAttribute(
      'href',
      RUSTORE_URL
    );
    expect(screen.getByRole('link', { name: /Open RuStore/ })).toHaveAttribute(
      'rel',
      'noopener noreferrer'
    );
  }
);

test.each(['desktop', 'ios', 'standalone', 'native'])(
  'never offers installation automatically in %s',
  (environment) => {
    state.pending = true;
    vi.stubGlobal('navigator', {
      userAgent:
        environment === 'ios'
          ? 'iPhone'
          : environment === 'desktop'
            ? 'Windows'
            : 'Android Mobile',
      standalone: environment === 'standalone',
    });
    if (environment === 'native')
      vi.stubGlobal('Capacitor', { isNativePlatform: () => true });
    show();
    expect(screen.queryByRole('complementary')).toBeNull();
  }
);

test('dismisses without navigation, explains blocked storage and preserves focus', async () => {
  state.pending = true;
  state.saved = false;
  show();
  await userEvent.click(screen.getByRole('button', { name: 'Not now' }));
  await waitFor(() => expect(screen.queryByRole('complementary')).toBeNull());
  expect(screen.getByRole('status')).toHaveTextContent('Hidden for this tab');
  expect(screen.getByRole('status')).toHaveFocus();
});
