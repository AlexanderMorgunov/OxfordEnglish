import { vi, test, expect, beforeEach } from 'vitest';
import type { Entitlement } from './contract';

let token: string | null = 'access-1';

vi.mock('./store', () => ({
  useAccount: { getState: () => ({ getAccessToken: async () => token, status: 'authenticated' }) },
}));
vi.mock('@/features/sync/meta', () => ({ getInstallId: async () => 'install-1' }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(
      public code: string,
      public status: number
    ) {
      super(code);
    }
  },
  getEntitlement: vi.fn(),
  claimTrial: vi.fn(),
}));

import * as api from './api';
import { ApiFailure } from './api';
import { useEntitlement } from './entitlement';

const PRO: Entitlement = { plan: 'pro', active: true, ai: { used: 10, limit: 10000, resetsAt: 5_000 } };
const TRIAL: Entitlement = { plan: 'trial', active: true, ai: { used: 0, limit: 50 } };
const FREE: Entitlement = { plan: 'free', active: false, ai: { used: 0, limit: 0 } };

const fail = (code: string, status = 0) => new ApiFailure(code, status);

beforeEach(() => {
  token = 'access-1';
  vi.mocked(api.getEntitlement).mockReset();
  vi.mocked(api.claimTrial).mockReset();
  useEntitlement.setState({ entitlement: null, error: null, loading: false });
});

// `getAccessToken` returns null whenever a refresh fails, which on a bad connection it does silently.
// Treating that as "no plan" downgraded a paying subscriber mid-session and locked the reader's lenses.
test('a plan already known survives a moment when no token can be had', async () => {
  useEntitlement.setState({ entitlement: PRO });
  token = null;
  await useEntitlement.getState().load();
  expect(useEntitlement.getState().entitlement).toBe(PRO);
});

test('the trial the server did grant is found even though the answer was lost', async () => {
  vi.mocked(api.claimTrial).mockRejectedValue(fail('network'));
  vi.mocked(api.getEntitlement).mockResolvedValue(TRIAL);
  expect(await useEntitlement.getState().claimTrial()).toBe('ok');
  expect(useEntitlement.getState().entitlement?.active).toBe(true);
  expect(useEntitlement.getState().error).toBeNull();
});

// The retry that used to make things worse: the server answers 409 because the account already holds
// the trial, which is the same thing as success for the person pressing the button.
test('a repeat claim rejected as already-claimed still ends up unlocked', async () => {
  vi.mocked(api.claimTrial).mockRejectedValue(fail('trial_already_claimed', 409));
  vi.mocked(api.getEntitlement).mockResolvedValue(TRIAL);
  expect(await useEntitlement.getState().claimTrial()).toBe('ok');
});

test('already-claimed is only reported when the account really has no trial', async () => {
  vi.mocked(api.claimTrial).mockRejectedValue(fail('trial_already_claimed', 409));
  vi.mocked(api.getEntitlement).mockResolvedValue(FREE);
  expect(await useEntitlement.getState().claimTrial()).toBe('already-claimed');
});

test('an unreachable server is reported as such, not as a used-up trial', async () => {
  vi.mocked(api.claimTrial).mockRejectedValue(fail('network'));
  vi.mocked(api.getEntitlement).mockRejectedValue(fail('network'));
  expect(await useEntitlement.getState().claimTrial()).toBe('network');
});

test('with no token nothing is sent, and it is not called a used-up trial either', async () => {
  token = null;
  expect(await useEntitlement.getState().claimTrial()).toBe('network');
  expect(api.claimTrial).not.toHaveBeenCalled();
});

// The proxy computes usage when the request reaches it, so an answer can outlive the plan it was
// computed against. Applied blindly, a reply from a spent trial landing after a purchase told a fresh
// subscriber their trial was over.
test('usage computed under another plan is discarded, not shown to someone who just paid', () => {
  useEntitlement.setState({ entitlement: PRO });
  useEntitlement.getState().applyUsage({ used: 50, limit: 50 });
  expect(useEntitlement.getState().entitlement?.ai).toEqual(PRO.ai);
});

test('a new billing window may reset the counter downwards', () => {
  useEntitlement.setState({ entitlement: { ...PRO, ai: { used: 300, limit: 10000, resetsAt: 5_000 } } });
  useEntitlement.getState().applyUsage({ used: 0, limit: 10000, resetsAt: 9_000 });
  expect(useEntitlement.getState().entitlement?.ai.used).toBe(0);
  expect(useEntitlement.getState().entitlement?.ai.resetsAt).toBe(9_000);
});

test('two calls resolving out of order never move the counter backwards', () => {
  useEntitlement.setState({ entitlement: { ...PRO, ai: { used: 11, limit: 10000, resetsAt: 5_000 } } });
  useEntitlement.getState().applyUsage({ used: 10, limit: 10000, resetsAt: 5_000 });
  expect(useEntitlement.getState().entitlement?.ai.used).toBe(11);
});

test('an ordinary usage update still applies', () => {
  useEntitlement.setState({ entitlement: PRO });
  useEntitlement.getState().applyUsage({ used: 12, limit: 10000, resetsAt: 5_000 });
  expect(useEntitlement.getState().entitlement?.ai.used).toBe(12);
});
