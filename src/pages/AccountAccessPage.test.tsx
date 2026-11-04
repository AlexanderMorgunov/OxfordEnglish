import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AppLayout } from '@/layout/AppLayout';
import { AccountAccessPage } from './AccountAccessPage';
import { useAccount } from '@/features/account/store';
import * as access from '@/features/account/access-api';

vi.mock('@/features/account/config', () => ({
  API_BASE: 'https://api.test',
  accountsEnabled: () => true,
}));
vi.mock('@/features/account/access-api', async (original) => ({
  ...(await original<object>()),
  accessCapabilities: vi.fn(),
  accessStatus: vi.fn(),
  accessOperation: vi.fn(),
}));
vi.mock('@/features/account/api', async (original) => ({
  ...(await original<object>()),
  getEntitlement: vi.fn(async () => ({
    plan: 'free',
    active: false,
    ai: { used: 0, limit: 0 },
  })),
}));

const account = {
  login: 'reader_one',
  legacyKey: false,
  recovery: false,
  backupRemaining: 0,
  backupTotal: 0,
  codesAcknowledged: true,
  codesRevision: null,
};
const routers: ReturnType<typeof createMemoryRouter>[] = [];

beforeEach(async () => {
  vi.clearAllMocks();
  const BrowserRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends BrowserRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, { ...init, signal: undefined });
      }
    }
  );
  localStorage.clear();
  localStorage.setItem('dayenglish.first-entry.v2', 'seen');
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  Element.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  await useAccount.getState().acceptAccessSession(
    {
      accountId: 'fixture-route-account',
      deviceId: 'fixture-route-device',
      accessToken: 'fixture-access',
      refreshToken: 'fixture-refresh',
      accessExpiresAt: Date.now() + 3600000,
    },
    false,
    () => true
  );
  vi.mocked(access.accessCapabilities).mockResolvedValue({
    enabled: true,
    passwordMin: 15,
    passwordMax: 128,
  });
  vi.mocked(access.accessStatus).mockResolvedValue(account);
  vi.mocked(access.accessOperation).mockImplementation(async (request) => {
    if (request.action === 'reauth')
      return {
        action: request.action,
        proof: 'p'.repeat(43),
        expiresAt: Date.now() + 300000,
      };
    if (request.action === 'enroll')
      return {
        action: request.action,
        enrollment: {
          id: 'e'.repeat(43),
          secret: 'SYNTHETIC',
          uri: 'otpauth://totp/QA?secret=SYNTHETIC',
        },
      };
    return {
      action: request.action,
      account: {
        ...account,
        recovery: true,
        backupRemaining: 8,
        backupTotal: 8,
        codesAcknowledged: request.action === 'acknowledge',
        codesRevision: 'fixture-revision',
      },
      codes: Array.from({ length: 8 }, (_, i) => `SYNTHETIC-${i}`),
    };
  });
});

afterEach(() => {
  cleanup();
  for (const router of routers.splice(0)) router.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function codes() {
  const router = createMemoryRouter(
    [
      {
        element: <AppLayout />,
        children: [
          { path: '/account/:mode', element: <AccountAccessPage /> },
          {
            path: '/settings/account',
            element: <h1>Account settings destination</h1>,
          },
          { path: '/terms', element: <h1>Terms destination</h1> },
          { path: '/before', element: <h1>Previous destination</h1> },
        ],
      },
    ],
    { initialEntries: ['/before', '/account/manage'], initialIndex: 1 }
  );
  routers.push(router);
  render(<RouterProvider router={router} />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Set up' }));
  await user.type(
    screen.getByLabelText('Current password'),
    'A synthetic recovery phrase'
  );
  await user.click(screen.getByRole('button', { name: 'Verify access' }));
  await user.click(await screen.findByRole('button', { name: 'Start setup' }));
  await user.type(await screen.findByLabelText('Authenticator code'), '123456');
  await user.click(screen.getByRole('button', { name: 'Enable recovery' }));
  await screen.findByRole('heading', {
    name: 'Save your backup codes',
  });
  return { router, user };
}

test('unsaved codes survive cancelled page-link and footer navigation, then allow explicit departure', async () => {
  const { router, user } = await codes();
  await user.click(screen.getByRole('link', { name: /Back to learning/ }));
  let dialog = await screen.findByRole('dialog', {
    name: 'Save your backup codes',
  });
  expect(router.state.location.pathname).toBe('/account/manage');
  expect(document.querySelectorAll('.access-backup-grid li')).toHaveLength(8);
  await user.click(
    within(dialog).getByRole('button', { name: 'Stay and save' })
  );
  await user.click(screen.getByRole('link', { name: 'Offer and contacts' }));
  dialog = await screen.findByRole('dialog', {
    name: 'Save your backup codes',
  });
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(router.state.location.pathname).toBe('/account/manage');
  expect(document.querySelectorAll('.access-backup-grid li')).toHaveLength(8);
  await user.click(screen.getByRole('link', { name: 'Offer and contacts' }));
  dialog = await screen.findByRole('dialog', {
    name: 'Save your backup codes',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Leave without saving' })
  );
  await screen.findByRole('heading', { name: 'Terms destination' });
}, 15000);

test('history Back keeps the code view until departure is confirmed', async () => {
  const { router, user } = await codes();
  await act(() => router.navigate(-1));
  let dialog = await screen.findByRole('dialog', {
    name: 'Save your backup codes',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Stay and save' })
  );
  expect(router.state.location.pathname).toBe('/account/manage');
  await act(() => router.navigate(-1));
  dialog = await screen.findByRole('dialog', {
    name: 'Save your backup codes',
  });
  await user.click(
    within(dialog).getByRole('button', { name: 'Leave without saving' })
  );
  await screen.findByRole('heading', { name: 'Previous destination' });
}, 15000);

test('acknowledged codes release the navigation guard', async () => {
  const { user } = await codes();
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I have saved the codes somewhere safe',
    })
  );
  await user.click(screen.getByRole('button', { name: 'Done' }));
  await screen.findByText('Authenticator connected', { exact: true });
  await user.click(screen.getByRole('link', { name: /Back to learning/ }));
  await screen.findByRole('heading', { name: 'Account settings destination' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}, 15000);

test('switching account clears the old code view and any pending navigation confirmation', async () => {
  const { router, user } = await codes();
  await user.click(screen.getByRole('link', { name: /Back to learning/ }));
  await screen.findByRole('dialog', { name: 'Save your backup codes' });
  await act(async () => {
    await useAccount.getState().acceptAccessSession(
      {
        accountId: 'fixture-other-account',
        deviceId: 'fixture-other-device',
        accessToken: 'fixture-other-access',
        refreshToken: 'fixture-other-refresh',
        accessExpiresAt: Date.now() + 3600000,
      },
      false,
      () => true
    );
  });
  await waitFor(() => {
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelectorAll('.access-backup-grid li')).toHaveLength(0);
  });
  expect(router.state.location.pathname).toBe('/account/manage');
  await user.click(screen.getByRole('link', { name: 'Offer and contacts' }));
  await screen.findByRole('heading', { name: 'Terms destination' });
}, 15000);
