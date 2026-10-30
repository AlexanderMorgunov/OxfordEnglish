import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type * as AccountApi from './api';
import type { Entitlement } from './contract';
import 'fake-indexeddb/auto';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', async original => ({ ...(await original<typeof AccountApi>()),
  billingPlans: vi.fn(), getEntitlement: vi.fn(), claimTrial: vi.fn(), register: vi.fn(), login: vi.fn(),
}));
import * as api from './api';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import { useAiStore } from '@/features/ai/store';
import { useProActivation } from './proActivation';
import { ProActivationDialog } from './ProActivationDialog';

const free: Entitlement = { plan: 'free', active: false, ai: { used: 0, limit: 0 } };
const trial: Entitlement = { plan: 'trial', active: true, trialEndsAt: Date.now() + 86400000, ai: { used: 0, limit: 100 } };
const session = (accountId = 'fixture-account') => ({ accountId, deviceId: 'fixture-device', accessToken: 'fixture-access', refreshToken: 'fixture-refresh', accessExpiresAt: Date.now() + 3600000 });
beforeEach(() => {
  vi.clearAllMocks();
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

test('cancel and reopen keep the created key; only an explicit second confirmation starts the trial', async () => {
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await screen.findByRole('heading', { name: 'Save your key' });
  const key = useAccount.getState().pendingRecoveryKey;
  expect(screen.getByRole('button', { name: 'Continue to trial' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Close Pro setup' }));
  await open(user);
  await screen.findByRole('heading', { name: 'Save your key' });
  expect(useAccount.getState().pendingRecoveryKey === key).toBe(true);
  expect(api.register).toHaveBeenCalledOnce();
  expect(api.claimTrial).not.toHaveBeenCalled();
  await user.click(screen.getByLabelText('I have saved the key somewhere safe'));
  await user.click(screen.getByRole('button', { name: 'Continue to trial' }));
  expect(api.claimTrial).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Start 14 days free' }));
  await screen.findByRole('heading', { name: 'You are ready to continue' });
  expect(api.claimTrial).toHaveBeenCalledOnce();
  expect(useAccount.getState().pendingRecoveryKey).toBeNull();
});

test('closing during registration retains the result for reopening', async () => {
  let finish: (value: ReturnType<typeof session>) => void = () => undefined;
  vi.mocked(api.register).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(screen.getByRole('button', { name: 'Create account' }));
  await waitFor(() => expect(api.register).toHaveBeenCalledOnce());
  await user.click(screen.getByRole('button', { name: 'Close Pro setup' }));
  await act(async () => { finish(session()); });
  await open(user);
  await screen.findByRole('heading', { name: 'Save your key' });
  expect(api.claimTrial).not.toHaveBeenCalled();
});

test('a login retry cannot create an account', async () => {
  vi.mocked(api.login).mockRejectedValue(new api.ApiFailure('network', 0));
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(screen.getByRole('button', { name: 'I already have an account' }));
  await user.type(screen.getByLabelText('Recovery key'), '0000-0000-0000-0000-0000-0000-00');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await screen.findByRole('alert');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  await waitFor(() => expect(api.login).toHaveBeenCalledTimes(2));
  expect(api.register).not.toHaveBeenCalled();
});

test('a malformed recovery key is explained at the field without a network request', async () => {
  const user = setup(); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(screen.getByRole('button', { name: 'I already have an account' }));
  const input = screen.getByLabelText('Recovery key');
  await user.type(input, 'invalid-key');
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('This key is incomplete or malformed. Paste the full key from your saved file.');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(api.login).not.toHaveBeenCalled();
  await user.clear(input);
  expect(input).toHaveAttribute('aria-invalid', 'false');
  expect(screen.queryByRole('alert')).toBeNull();
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
  expect(await screen.findByRole('button', { name: plan === 'pro' ? /Extend.*399/ : /Get Pro.*399/ })).toBeEnabled();
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
  expect(await screen.findByRole('button', { name: /Get Pro.*399/ })).toBeEnabled();
});

test.each(['lesson', 'reader', 'text', 'pro'] as const)('an expired trial keeps the %s example and saved task with a purchase offer', async source => {
  authenticated({ ...free, trialEndsAt: Date.now() - 1 });
  const user = setup(source); await open(user);
  expect(screen.getByRole('heading', { name: 'Your free trial has ended' })).toBeVisible();
  expect(screen.getByRole('figure')).toBeVisible();
  await user.click(screen.getByText(source === 'lesson' ? 'Your exercise is saved' : 'Your text is saved'));
  expect(screen.getByText('Put on your coat.')).toBeVisible();
  expect(await screen.findByRole('button', { name: /Get Pro.*399/ })).toBeEnabled();
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
  expect(await screen.findByRole('button', { name: /Get Pro.*399/ })).toBeEnabled();
});

test('a trial denial immediately returns to the contextual purchase offer', async () => {
  authenticated(free);
  vi.mocked(api.claimTrial).mockRejectedValue(new api.ApiFailure('trial_already_claimed', 409));
  const user = setup('text'); await open(user);
  await user.click(screen.getByRole('button', { name: 'Try 14 days' }));
  await user.click(screen.getByRole('button', { name: 'Start 14 days free' }));
  expect(await screen.findByRole('button', { name: /Get Pro.*399/ })).toBeEnabled();
  expect(screen.queryByRole('heading', { name: 'Start your free trial' })).toBeNull();
  expect(screen.getByRole('figure')).toBeVisible();
  expect(screen.getByRole('alert')).toHaveTextContent('The free trial has already been used on this device.');
  expect(screen.queryByRole('button', { name: /Try 14 days|Start 14 days free/ })).toBeNull();
  expect(api.claimTrial).toHaveBeenCalledOnce();
});
