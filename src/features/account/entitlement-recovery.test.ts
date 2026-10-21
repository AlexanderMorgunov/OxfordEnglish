import { vi, test, expect, beforeEach, afterEach } from 'vitest';
import type { Entitlement } from './contract';

let token: string | null = 'access-1';
let sessionRevision = 1;
let tokenWait: Promise<string | null> | null = null;

vi.mock('./store', () => ({
  useAccount: { getState: () => ({ getAccessToken: async () => tokenWait ?? token, status: 'authenticated', accountId: 'a', sessionRevision }) },
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
  tokenWait = null;
  sessionRevision = 1;
  useEntitlement.getState().clear();
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


afterEach(() => { useEntitlement.getState().clear(); vi.useRealTimers(); });

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('clear prevents a late entitlement response from restoring the previous account', async () => {
  const reply = deferred<Entitlement>();
  vi.mocked(api.getEntitlement).mockReturnValue(reply.promise);
  const loading = useEntitlement.getState().load();
  await flush();
  useEntitlement.getState().clear();
  reply.resolve(PRO);
  await loading;
  expect(useEntitlement.getState()).toMatchObject({ entitlement: null, loading: false });
});

test('same-account session replacement rejects the previous session response', async () => {
  const reply = deferred<Entitlement>();
  vi.mocked(api.getEntitlement).mockReturnValue(reply.promise);
  const loading = useEntitlement.getState().load();
  await flush();
  sessionRevision += 1;
  reply.resolve(PRO);
  await loading;
  expect(useEntitlement.getState().entitlement).toBeNull();
});

test('parallel metadata readers share one request', async () => {
  const reply = deferred<Entitlement>();
  vi.mocked(api.getEntitlement).mockReturnValue(reply.promise);
  const first = useEntitlement.getState().load();
  const second = useEntitlement.getState().load();
  await flush();
  expect(api.getEntitlement).toHaveBeenCalledTimes(1);
  reply.resolve(PRO);
  await Promise.all([first, second]);
  expect(useEntitlement.getState().entitlement).toEqual(PRO);
});

test('a hanging token wait is bounded and a subsequent metadata load may recover', async () => {
  vi.useFakeTimers();
  tokenWait = new Promise(() => undefined);
  const loading = useEntitlement.getState().load();
  await vi.advanceTimersByTimeAsync(15_001);
  await loading;
  expect(useEntitlement.getState().loading).toBe(false);
  tokenWait = null;
  vi.mocked(api.getEntitlement).mockResolvedValue(PRO);
  await useEntitlement.getState().load();
  expect(useEntitlement.getState().entitlement).toEqual(PRO);
});

test('a hanging response body times out and its late answer is ignored', async () => {
  vi.useFakeTimers();
  const reply = deferred<Entitlement>();
  vi.mocked(api.getEntitlement).mockReturnValue(reply.promise);
  const loading = useEntitlement.getState().load();
  await flush();
  await vi.advanceTimersByTimeAsync(15_001);
  await loading;
  expect(vi.mocked(api.getEntitlement).mock.calls[0]?.[1]?.aborted).toBe(true);
  reply.resolve(PRO);
  await flush();
  expect(useEntitlement.getState().entitlement).toBeNull();
});

test('metadata started before an AI answer cannot undo its newer usage', async () => {
  useEntitlement.setState({ entitlement: PRO });
  const reply = deferred<Entitlement>();
  vi.mocked(api.getEntitlement).mockReturnValue(reply.promise);
  const loading = useEntitlement.getState().load();
  await flush();
  useEntitlement.getState().applyUsage({ ...PRO.ai, used: 20 });
  reply.resolve({ ...PRO, ai: { ...PRO.ai, used: 10 } });
  await loading;
  expect(useEntitlement.getState().entitlement?.ai.used).toBe(20);
});

test('a late answer cannot move quota back to an older billing window', () => {
  useEntitlement.setState({ entitlement: { ...PRO, ai: { ...PRO.ai, resetsAt: 9000 } } });
  useEntitlement.getState().applyUsage({ ...PRO.ai, used: 9999, resetsAt: 5000 });
  expect(useEntitlement.getState().entitlement?.ai.resetsAt).toBe(9000);
});

test('a trial response after clear cannot restore entitlement or error', async () => {
  const reply = deferred<Entitlement>();
  vi.mocked(api.claimTrial).mockReturnValue(reply.promise);
  const claiming = useEntitlement.getState().claimTrial();
  await flush();
  useEntitlement.getState().clear();
  reply.resolve(TRIAL);
  expect(await claiming).toBe('failed');
  expect(useEntitlement.getState()).toMatchObject({ entitlement: null, error: null, loading: false });
});


test('a timed-out trial can reconcile a successful grant and clears its spinner', async () => {
  vi.useFakeTimers();
  vi.mocked(api.claimTrial).mockReturnValue(new Promise(() => undefined));
  vi.mocked(api.getEntitlement).mockResolvedValue(TRIAL);
  const claiming = useEntitlement.getState().claimTrial();
  await flush();
  await vi.advanceTimersByTimeAsync(15_001);
  expect(await claiming).toBe('ok');
  expect(useEntitlement.getState()).toMatchObject({ entitlement: TRIAL, loading: false });
});

test('metadata from before a trial claim cannot overwrite the granted plan', async () => {
  const reply = deferred<Entitlement>();
  vi.mocked(api.getEntitlement).mockReturnValue(reply.promise);
  const loading = useEntitlement.getState().load();
  await flush();
  vi.mocked(api.claimTrial).mockResolvedValue(TRIAL);
  expect(await useEntitlement.getState().claimTrial()).toBe('ok');
  reply.resolve(FREE);
  await loading;
  expect(useEntitlement.getState().entitlement).toEqual(TRIAL);
});
