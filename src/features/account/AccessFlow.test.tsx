import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type { AccessResult } from './access-contract';
vi.mock('./config', () => ({
  API_BASE: 'https://api.test',
  accountsEnabled: () => true,
}));
vi.mock('./access-api', async (original) => ({
  ...(await original<object>()),
  accessCapabilities: vi.fn(),
  accessAvailability: vi.fn(),
  accessOperation: vi.fn(),
  accessReceipt: vi.fn(),
  accessStatus: vi.fn(),
}));
vi.mock('./api', async (original) => ({
  ...(await original<object>()),
  getEntitlement: vi.fn(),
  claimTrial: vi.fn(),
}));
import * as access from './access-api';
import * as api from './api';
import { ApiFailure } from './api';
import { useEntitlement } from './entitlement';
import { AccessFlow } from './AccessFlow';
import { useAccount } from './store';

const account = {
  login: 'reader_one',
  legacyKey: false,
  recovery: false,
  backupRemaining: 0,
  backupTotal: 0,
  codesAcknowledged: true,
  codesRevision: null,
};
const session = {
  accountId: 'fixture-account-access',
  deviceId: 'fixture-device-access',
  accessToken: 'fixture-access',
  refreshToken: 'fixture-refresh',
  accessExpiresAt: Date.now() + 3600000,
};
beforeEach(() => {
  vi.clearAllMocks();
  useEntitlement.getState().clear();
  vi.mocked(api.getEntitlement).mockResolvedValue({
    plan: 'free',
    active: false,
    ai: { used: 0, limit: 0 },
  });
  vi.mocked(api.claimTrial).mockResolvedValue({
    plan: 'trial',
    active: true,
    trialEndsAt: Date.now() + 1209600000,
    ai: { used: 0, limit: 1000 },
  });
  localStorage.clear();
  useAccount.setState({
    status: 'anonymous',
    accountId: null,
    accessToken: null,
    busy: false,
    pendingRecoveryKey: null,
  });
  vi.mocked(access.accessCapabilities).mockResolvedValue({
    enabled: true,
    passwordMin: 15,
    passwordMax: 128,
  });
  vi.mocked(access.accessAvailability).mockImplementation(async (login) => ({
    login,
    available: true,
  }));
  vi.mocked(access.accessStatus).mockResolvedValue(account);
});
const setup = (initial: 'register' | 'login' | 'manage' = 'register') => {
  render(
    <MemoryRouter>
      <AccessFlow initial={initial} />
    </MemoryRouter>
  );
  return userEvent.setup();
};
async function registerForm(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText('Username');
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'reader_one' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'A private reading phrase' },
  });
  await user.click(
    within(screen.getByLabelText('Password').closest('form')!).getByRole(
      'button',
      { name: 'Create account' }
    )
  );
}

test('lost registration response reconciles the same operation without registering twice', async () => {
  vi.mocked(access.accessOperation).mockRejectedValue(
    new ApiFailure('network', 0)
  );
  vi.mocked(access.accessReceipt).mockResolvedValue({
    action: 'register',
    session,
    account,
  });
  const user = setup();
  await registerForm(user);
  await screen.findByRole('heading', { name: 'Check the result' });
  await user.click(screen.getByRole('button', { name: 'Check result' }));
  await screen.findByRole('heading', { name: 'You are signed in' });
  expect(access.accessOperation).toHaveBeenCalledOnce();
  expect(access.accessReceipt).toHaveBeenCalledWith(
    vi.mocked(access.accessOperation).mock.calls[0]![0].operationToken,
    undefined
  );
  expect(useAccount.getState().accountId).toBe(session.accountId);
});

test('ordinary signup starts with an unchecked trial choice and preserves both choices through login and validation', async () => {
  const user = setup();
  const checkbox = await screen.findByRole('checkbox', {
    name: /Start 14 days of Pro free/,
  });
  expect(checkbox).not.toBeChecked();
  await user.click(checkbox);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(
    screen.getByRole('checkbox', { name: /Start 14 days of Pro free/ })
  ).toBeChecked();
  await user.click(
    screen.getByRole('button', { name: 'Create account and try Pro' })
  );
  expect(
    screen.getByRole('checkbox', { name: /Start 14 days of Pro free/ })
  ).toBeChecked();
  await user.click(
    screen.getByRole('checkbox', { name: /Start 14 days of Pro free/ })
  );
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  expect(
    screen.getByRole('checkbox', { name: /Start 14 days of Pro free/ })
  ).not.toBeChecked();
  expect(api.claimTrial).not.toHaveBeenCalled();
});

test('a lost registration reply retains the chosen trial intent and claims only after the same receipt is recovered', async () => {
  vi.mocked(access.accessOperation).mockRejectedValue(
    new ApiFailure('network', 0)
  );
  vi.mocked(access.accessReceipt).mockResolvedValue({
    action: 'register',
    session,
    account,
  });
  const complete = vi.fn();
  render(
    <MemoryRouter>
      <AccessFlow onTrialComplete={complete} />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole('checkbox', { name: /Start 14 days of Pro free/ })
  );
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'reader_one' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'A private reading phrase' },
  });
  await user.click(
    screen.getByRole('button', { name: 'Create account and try Pro' })
  );
  await screen.findByRole('heading', { name: 'Check the result' });
  expect(api.claimTrial).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Check result' }));
  await waitFor(() => expect(complete).toHaveBeenCalledOnce());
  expect(access.accessOperation).toHaveBeenCalledOnce();
  expect(api.claimTrial).toHaveBeenCalledOnce();
  expect(useAccount.getState().accountId).toBe(session.accountId);
});

test('Pro signup has no checkbox and its free action does not claim a trial', async () => {
  vi.mocked(access.accessOperation).mockResolvedValue({
    action: 'register',
    session,
    account,
  });
  render(
    <MemoryRouter>
      <AccessFlow signupIntent="trial" />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  fireEvent.change(await screen.findByLabelText('Username'), {
    target: { value: 'reader_one' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'A private reading phrase' },
  });
  expect(screen.queryByRole('checkbox')).toBeNull();
  await user.click(
    screen.getByRole('button', { name: 'Create account without Pro' })
  );
  await screen.findByRole('heading', { name: 'You are signed in' });
  expect(api.claimTrial).not.toHaveBeenCalled();
});

test('login from a Pro entry never claims a trial despite its default signup intent', async () => {
  vi.mocked(access.accessOperation).mockResolvedValue({
    action: 'login',
    session,
    account,
  });
  render(
    <MemoryRouter>
      <AccessFlow signupIntent="trial" initial="login" />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  fireEvent.change(await screen.findByLabelText('Username'), {
    target: { value: 'reader_one' },
  });
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'A private reading phrase' },
  });
  await user.click(
    within(screen.getByLabelText('Password').closest('form')!).getByRole(
      'button',
      { name: 'Sign in' }
    )
  );
  await screen.findByRole('heading', { name: 'You are signed in' });
  expect(api.claimTrial).not.toHaveBeenCalled();
});
test('a final username conflict keeps the password and marks the username field', async () => {
  vi.mocked(access.accessOperation).mockRejectedValue(
    new ApiFailure('login_taken', 409)
  );
  const user = setup();
  await registerForm(user);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This username is taken'
  );
  expect(screen.getByLabelText('Password')).toHaveValue(
    'A private reading phrase'
  );
  expect(screen.getByLabelText('Username')).toHaveAttribute(
    'aria-invalid',
    'true'
  );
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'reader_two' },
  });
  expect(screen.getByLabelText('Username')).toHaveAttribute(
    'aria-invalid',
    'false'
  );
});
test('an answer for a previous owner cannot sign in after an account handover', async () => {
  vi.mocked(access.accessStatus).mockResolvedValue({
    ...account,
    login: 'other_reader',
  });
  let finish!: (value: AccessResult) => void;
  vi.mocked(access.accessOperation).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const user = setup();
  await registerForm(user);
  await act(async () => {
    await useAccount
      .getState()
      .acceptAccessSession(
        { ...session, accountId: 'another-owner' },
        false,
        () => true
      );
  });
  await act(async () => {
    finish({ action: 'register', session, account });
  });
  expect(useAccount.getState().accountId).toBe('another-owner');
  expect(screen.queryByText('@reader_one')).toBeNull();
  expect(screen.queryByLabelText('Password')).toBeNull();
});
test('backup recovery warns about consumption and does not automatically sign in after reset', async () => {
  vi.mocked(access.accessOperation).mockImplementation(async (request) =>
    request.action === 'recover'
      ? {
          action: 'recover',
          proof: 'p'.repeat(43),
          expiresAt: Date.now() + 300000,
          login: 'reader_one',
        }
      : {
          action: 'reset',
          completed: true,
          accountId: session.accountId,
          login: 'reader_one',
        }
  );
  const user = setup('login');
  await user.click(
    await screen.findByRole('button', { name: 'Forgot password?' })
  );
  await user.click(screen.getByRole('button', { name: 'Backup code' }));
  expect(screen.getByText(/even if you then cancel/)).toBeVisible();
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'reader_one' },
  });
  fireEvent.change(screen.getByLabelText('One-use backup code'), {
    target: { value: 'SYNTHETIC-BACKUP' },
  });
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByRole('heading', { name: 'Choose a new password' });
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'Another private reading phrase' },
  });
  fireEvent.change(screen.getByLabelText('Repeat password'), {
    target: { value: 'Another private reading phrase' },
  });
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await screen.findByRole('heading', { name: 'Password saved' });
  expect(useAccount.getState().status).toBe('anonymous');
  expect(access.accessOperation).toHaveBeenCalledTimes(2);
});
test('unavailable backend never offers a form that cannot register', async () => {
  vi.mocked(access.accessCapabilities).mockResolvedValue({
    enabled: false,
    passwordMin: 15,
    passwordMax: 128,
  });
  setup();
  await screen.findByRole('link', { name: 'Open account settings' });
  expect(screen.queryByLabelText('Password')).toBeNull();
  expect(access.accessOperation).not.toHaveBeenCalled();
});

test('unacknowledged recovery codes guard leaving and the guard clears after saving', async () => {
  await useAccount.getState().acceptAccessSession(session, false, () => true);
  const connected = {
    ...account,
    recovery: true,
    backupRemaining: 8,
    backupTotal: 8,
    codesAcknowledged: false,
    codesRevision: 'fixture-codes-revision',
  };
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
          secret: 'SYNTHETIC-SECRET',
          uri: 'otpauth://totp/DayEnglish?secret=SYNTHETIC',
        },
      };
    return {
      action: request.action,
      account: connected,
      codes: Array.from({ length: 8 }, (_, i) => `SYNTHETIC-CODE-${i}`),
    };
  });
  const dirty = vi.fn();
  render(
    <MemoryRouter>
      <AccessFlow initial="manage" onRecoveryDraftChange={dirty} />
    </MemoryRouter>
  );
  const user = userEvent.setup();
  await user.click(await screen.findByRole('button', { name: 'Set up' }));
  fireEvent.change(screen.getByLabelText('Current password'), {
    target: { value: 'A private reading phrase' },
  });
  await user.click(screen.getByRole('button', { name: 'Verify access' }));
  await user.click(await screen.findByRole('button', { name: 'Start setup' }));
  fireEvent.change(await screen.findByLabelText('Authenticator code'), {
    target: { value: '123456' },
  });
  await user.click(screen.getByRole('button', { name: 'Enable recovery' }));
  await screen.findByRole('heading', { name: 'Save your backup codes' });
  expect(dirty).toHaveBeenLastCalledWith(true);
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  await user.click(
    screen.getByRole('checkbox', {
      name: 'I have saved the codes somewhere safe',
    })
  );
  expect(dirty).toHaveBeenLastCalledWith(false);
  const savedLeaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(savedLeaving);
  expect(savedLeaving.defaultPrevented).toBe(false);
});

test('pagehide clears sensitive drafts and refuses a late registration on return', async () => {
  let finish!: (value: AccessResult) => void;
  vi.mocked(access.accessOperation).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const user = setup();
  await registerForm(user);
  act(() => {
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true })
    );
  });
  act(() => {
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    );
  });
  await act(async () => {
    finish({ action: 'register', session, account });
  });
  expect(useAccount.getState().status).toBe('anonymous');
  expect(screen.getByLabelText('Password')).toHaveValue('');
  expect(screen.queryByText('You are signed in')).toBeNull();
});
test('a stale availability response cannot overwrite a newer username', async () => {
  let old!: (value: { login: string; available: boolean }) => void;
  vi.mocked(access.accessAvailability).mockImplementation((login) =>
    login === 'reader_one'
      ? new Promise((resolve) => {
          old = resolve;
        })
      : Promise.resolve({ login, available: true })
  );
  setup();
  fireEvent.change(await screen.findByLabelText('Username'), {
    target: { value: 'reader_one' },
  });
  await waitFor(() => expect(old).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('Username'), {
    target: { value: 'reader_two' },
  });
  await screen.findByText('Username is available');
  await act(async () => {
    old({ login: 'reader_one', available: false });
  });
  expect(screen.queryByText('Username is taken — choose another')).toBeNull();
});
