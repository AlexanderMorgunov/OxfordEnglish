import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type * as AccountApi from './api';
import type { Entitlement } from './contract';
import type { AccessResult } from './access-contract';
import 'fake-indexeddb/auto';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', async original => ({ ...(await original<typeof AccountApi>()),
  billingPlans: vi.fn(), getEntitlement: vi.fn(), claimTrial: vi.fn(), register: vi.fn(), login: vi.fn(),
}));
vi.mock('./access-api', async original => ({ ...await original<object>(), accessCapabilities: vi.fn(), accessOperation: vi.fn(), accessStatus: vi.fn(), accessAvailability: vi.fn() }));
import * as access from './access-api';
import * as api from './api';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import { useAiStore } from '@/features/ai/store';
import { useProActivation } from './proActivation';
import { ProActivationDialog } from './ProActivationDialog';

const accessAccount = { login: 'fixture_reader', legacyKey: false, recovery: false, backupRemaining: 0, backupTotal: 0, codesAcknowledged: true, codesRevision: null };
const free: Entitlement = { plan: 'free', active: false, ai: { used: 0, limit: 0 } };
const trial: Entitlement = { plan: 'trial', active: true, trialEndsAt: Date.now() + 86400000, ai: { used: 0, limit: 100 } };
const session = (accountId = 'fixture-account') => ({ accountId, deviceId: 'fixture-device', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', accessExpiresAt: Date.now() + 3600000 });
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(access.accessCapabilities).mockResolvedValue({ enabled: true, passwordMin: 15, passwordMax: 128 });
  vi.mocked(access.accessStatus).mockResolvedValue(accessAccount);
  vi.mocked(access.accessAvailability).mockImplementation(async login => ({ login, available: true }));
  vi.mocked(access.accessOperation).mockResolvedValue({ action: 'register', session: session(), account: accessAccount });
  localStorage.clear(); sessionStorage.clear();
  useAccount.getState().confirmRecoveryKey();
  useAccount.setState({ status: 'anonymous', accountId: null, accessToken: null, busy: false, error: null });
  useEntitlement.getState().clear();
  useAiStore.setState({ config: null });
  useProActivation.getState().close();
  vi.mocked(api.billingPlans).mockResolvedValue({ available: true, plans: [{ code: 'pro_month', days: 30, priceKopecks: 39900, title: 'Pro' }] });
  vi.mocked(api.getEntitlement).mockResolvedValue(free);
  vi.mocked(api.claimTrial).mockResolvedValue(trial);
  vi.mocked(api.register).mockImplementation(async body => session(body.accountId));
  vi.mocked(api.login).mockResolvedValue(session());
});

function setup(source: 'lesson' | 'reader' | 'text' | 'pro' = 'lesson') {
  render(<MemoryRouter initialEntries={['/lesson']}>
    <button onClick={e => useProActivation.getState().open({ source, excerpt: 'Put on your coat.', answer: 'coat' }, '/lesson', e.currentTarget)}>Explain this answer</button>
    <ProActivationDialog />
  </MemoryRouter>);
  return userEvent.setup();
}
function authenticated(entitlement: Entitlement | null) {
  localStorage.setItem('oxford-account', JSON.stringify(session()));
  useAccount.setState({ ...session(), status: 'authenticated' });
  useEntitlement.setState({ entitlement });
  if (entitlement) vi.mocked(api.getEntitlement).mockResolvedValue(entitlement);
}
async function open(user: ReturnType<typeof userEvent.setup>) { await user.click(screen.getByRole('button', { name: 'Explain this answer' })); }

test('explicit Pro signup creates and activates once, then returns to the original task', async () => {
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await screen.findByLabelText('Username');
  expect(screen.getByRole('dialog', { name: 'Create your account' })).toBeVisible();
  expect(screen.getAllByRole('heading')).toHaveLength(1);
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'fixture_reader' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'A private fixture phrase' } });
  await user.click(within(screen.getByLabelText('Password').closest('form')!).getByRole('button', { name: 'Create account and try Pro' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.claimTrial).toHaveBeenCalledOnce();
  expect(access.accessOperation).toHaveBeenCalledOnce();
});

test('closing during registration cannot install a late session or start a trial', async () => {
  let finish!: (value: AccessResult) => void;
  vi.mocked(access.accessOperation).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await screen.findByLabelText('Username');
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'fixture_reader' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'A private fixture phrase' } });
  await user.click(within(screen.getByLabelText('Password').closest('form')!).getByRole('button', { name: 'Create account and try Pro' }));
  await waitFor(() => expect(access.accessOperation).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Close Pro setup' }));
  await act(async () => { finish({ action: 'register', session: session(), account: accessAccount }); });
  expect(useAccount.getState().status).toBe('anonymous');
  expect(api.claimTrial).not.toHaveBeenCalled();
});

test('username login errors cannot create an account or start a trial', async () => {
  vi.mocked(access.accessOperation).mockRejectedValue(new api.ApiFailure('invalid_credentials', 401));
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(await screen.findByRole('button', { name: 'Sign in' }));
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'fixture_reader' } });
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'An incorrect private phrase' } });
  await user.click(within(screen.getByLabelText('Password').closest('form')!).getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in');
  expect(vi.mocked(access.accessOperation).mock.calls.every(([request]) => request.action === 'login')).toBe(true);
  expect(api.register).not.toHaveBeenCalled();
  expect(api.claimTrial).not.toHaveBeenCalled();
});
test('existing Pro without a personal key returns to the task without an upsell', async () => {
  authenticated({ ...trial, plan: 'pro', paidUntil: Date.now() + 86400000 });
  const user = setup(); await open(user);
  expect(screen.getByRole('heading', { name: 'You are ready to continue' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /try 14 days/i })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Back to your exercise' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

test.each(['pro', 'trial'] as const)('a stale active %s that expired offers renewal, not a ready state or another trial', async plan => {
  authenticated({ ...trial, plan, trialEndsAt: Date.now() - 1000, ...(plan === 'pro' ? { paidUntil: Date.now() - 1000 } : {}) });
  const user = setup(); await open(user);
  expect(screen.queryByRole('heading', { name: 'You are ready to continue' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try 14 days' })).toBeNull();
  expect(screen.getByRole('heading', { name: plan === 'pro' ? 'Your subscription has ended' : 'Your free trial has ended' })).toBeVisible();
  expect(await screen.findByRole('button', { name: plan === 'pro' ? /Extend.*399/ : /Continue to payment.*399/ })).toBeEnabled();
});

test('Pro management can renew an active subscription without sending the user back to a task', async () => {
  authenticated({ ...trial, plan: 'pro', paidUntil: Date.now() + 2 * 86400000 });
  const user = setup('pro'); await open(user);
  expect(screen.getByRole('heading', { name: 'Your subscription' })).toBeVisible();
  expect(await screen.findByRole('button', { name: /Extend.*399/ })).toBeEnabled();
  expect(screen.queryByRole('link', { name: /own.*key/i })).toBeNull();
});

test('unknown entitlement offers retry and payment recovery, without guessing a free plan', async () => {
  authenticated(null); vi.mocked(api.getEntitlement).mockRejectedValue(new api.ApiFailure('network', 0));
  const user = setup(); await open(user);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Check subscription' })).toBeEnabled());
  expect(screen.queryByRole('button', { name: /try 14 days|get pro/i })).toBeNull();
  expect(screen.getByRole('button', { name: 'I already paid' })).toBeVisible();
  vi.mocked(api.getEntitlement).mockResolvedValue(trial);
  await user.click(screen.getByRole('button', { name: 'Check subscription' }));
  await screen.findByRole('heading', { name: 'You are ready to continue' });
});

test('an expired trial offers the server price and recovers a failed catalog', async () => {
  authenticated({ ...free, trialEndsAt: Date.now() - 1 });
  vi.mocked(api.billingPlans).mockRejectedValue(new Error('offline'));
  const user = setup(); await open(user);
  await screen.findByRole('button', { name: 'Retry price' });
  expect(screen.queryByRole('button', { name: /try 14 days/i })).toBeNull();
  vi.mocked(api.billingPlans).mockResolvedValue({ available: true, plans: [{ code: 'pro_month', days: 30, priceKopecks: 39900, title: 'Pro' }] });
  await user.click(screen.getByRole('button', { name: 'Retry price' }));
  expect(await screen.findByRole('button', { name: /Continue to payment.*399/ })).toBeEnabled();
});

test.each(['lesson', 'reader', 'text', 'pro'] as const)('an expired trial keeps the %s example and saved task with a purchase offer', async source => {
  authenticated({ ...free, trialEndsAt: Date.now() - 1 });
  const user = setup(source); await open(user);
  expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeVisible();
  expect(screen.getByRole('figure')).toBeVisible();
  await user.click(screen.getByText(source === 'lesson' ? 'Your exercise is saved' : 'Your text is saved'));
  expect(screen.getByText('Put on your coat.')).toBeVisible();
  expect(await screen.findByRole('button', { name: /Continue to payment.*399/ })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /Try 14 days|Start 14 days free/ })).toBeNull();
  expect(api.claimTrial).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Continue free' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Explain this answer' })).toHaveFocus();
});

test('a personal AI key avoids the task upsell but does not prevent trying Pro for sync', async () => {
  useAiStore.setState({ config: { provider: 'deepseek', apiKey: 'fixture-only', model: 'deepseek-chat' } });
  const user = setup('pro'); await open(user);
  expect(screen.getByRole('button', { name: 'Try 14 days' })).toBeEnabled();
});

test('reopening after a device trial denial does not offer it again after a plan refresh', async () => {
  authenticated(free);
  useEntitlement.setState({ error: 'trial_already_claimed' });
  const user = setup(); await open(user);
  await waitFor(() => expect(api.getEntitlement).toHaveBeenCalledOnce());
  await waitFor(() => expect(useEntitlement.getState().loading).toBe(false));
  expect(screen.queryByRole('button', { name: 'Try 14 days' })).toBeNull();
  expect(await screen.findByRole('button', { name: /Continue to payment.*399/ })).toBeEnabled();
});

test('a trial denial immediately returns to the contextual purchase offer', async () => {
  authenticated(free);
  vi.mocked(api.claimTrial).mockRejectedValue(new api.ApiFailure('trial_already_claimed', 409));
  const user = setup('text'); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(screen.getByRole('button', { name: 'Start 14 days free' }));
  expect(await screen.findByRole('button', { name: /Continue to payment.*399/ })).toBeEnabled();
  expect(screen.queryByRole('heading', { name: 'Start your free trial' })).toBeNull();
  expect(screen.getByRole('figure')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('The free trial has already been used on this device.');
  expect(screen.queryByRole('button', { name: /Try 14 days|Start 14 days free/ })).toBeNull();
  expect(api.claimTrial).toHaveBeenCalledOnce();
});
