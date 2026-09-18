/**
 * Switching account in place abandons whatever cycle was running for the old one — the switch wipe
 * invalidates it. Something has to start a cycle for the NEW account.
 *
 * Two halves, both needed and neither sufficient: the account subscription fires a trigger on an
 * in-place switch, and `triggerSync` remembers a trigger that arrives while a cycle is running instead
 * of dropping it. Zustand notifies subscribers synchronously from `applySession`, so that trigger always
 * lands mid-cycle. Signing in from anonymous was already covered by the branch above it.
 */
import { vi, test, expect, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  state: { status: 'authenticated', accountId: 'acc-A', getAccessToken: async () => 'tok' },
  listeners: new Set<(s: unknown) => void>(),
}));

vi.mock('@/db/db', () => ({ db: { pending: { count: async () => 0 }, books: { toArray: async () => [] } } }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true }));
vi.mock('@/features/account/store', () => ({
  useAccount: {
    getState: () => h.state,
    subscribe: (fn: (s: unknown) => void) => {
      h.listeners.add(fn);
      return () => h.listeners.delete(fn);
    },
  },
}));
vi.mock('@/features/account/entitlement', () => ({
  useEntitlement: { getState: () => ({ load: async () => undefined, clear: () => undefined }) },
}));
vi.mock('@/features/account/billing', () => ({ claimPending: async () => 'none' }));
vi.mock('@/features/account/api', () => ({ ApiFailure: class extends Error {}, syncPush: vi.fn(), syncPull: vi.fn() }));
vi.mock('@/features/reader/blobSync', () => ({ syncAllBookFiles: vi.fn(async () => undefined) }));
vi.mock('./settingsBridge', () => ({ hydrateSettings: vi.fn(async () => undefined) }));
vi.mock('./engine', () => ({ syncWith: vi.fn() }));

import { syncWith } from './engine';
import { initSync } from './run';
import { useSyncStatus } from './status';

const settled = () => new Promise((r) => setTimeout(r, 0));
const accounts = () => vi.mocked(syncWith).mock.calls.map((c) => c[0]);

beforeEach(() => {
  h.listeners.clear();
  h.state.status = 'authenticated';
  h.state.accountId = 'acc-A';
  vi.mocked(syncWith).mockReset();
  vi.mocked(syncWith).mockResolvedValue({ pushBlocked: false });
});

/**
 * The switch has to be fired while a cycle for the old account is STILL RUNNING. That is not an awkward
 * corner to be waited out — it is the precondition for the whole feature: the guard only has something
 * to abandon if a cycle was in flight when the wipe landed. Draining the first cycle first would green
 * light a path that does not work.
 */
test('switching account in place while a cycle is running still syncs the new account', async () => {
  let releaseA: (v: { pushBlocked: boolean; stale: boolean }) => void = () => undefined;
  vi.mocked(syncWith).mockImplementationOnce(
    () => new Promise((resolve) => { releaseA = resolve; }),
  );

  initSync();
  await vi.waitFor(() => expect(accounts()).toEqual(['acc-A']));

  h.state.accountId = 'acc-B';
  h.listeners.forEach((fn) => fn(h.state)); // the switch wipe has invalidated A's cycle by now

  releaseA({ pushBlocked: false, stale: true });

  await vi.waitFor(() => expect(accounts()).toContain('acc-B'));
});

/**
 * The status is a statement about one account's sync on this device. Carried over it lies twice: the
 * settings line claims "synced N minutes ago" for an account that has never contacted the server, and
 * `lastPulledAt` — which the reader uses to decide whether another device's reading position is worth
 * offering — claims a download just landed.
 */
test('switching account clears the status of the account that left', async () => {
  initSync();
  await vi.waitFor(() => expect(accounts()).toEqual(['acc-A']));
  // Drained on purpose, and only here: this test is about the RESET, so it takes the branch where the
  // follow-up trigger actually reaches `setSyncStatus`. The mid-cycle case — where the trigger is
  // remembered instead — is the test above, and that one must not be drained.
  await settled();
  useSyncStatus.setState({ lastSyncedAt: 1_000, lastPulledAt: 1_000, pending: 3 });

  h.state.accountId = 'acc-B';
  h.listeners.forEach((fn) => fn(h.state));

  expect(useSyncStatus.getState().lastSyncedAt).toBeNull();
  expect(useSyncStatus.getState().lastPulledAt).toBeNull();
  expect(useSyncStatus.getState().pending).toBe(0);
  // The reset has to land BEFORE the follow-up trigger, which stamps `syncing` on its way in. Reversed,
  // the line reads "ready to sync" while a cycle is running.
  expect(useSyncStatus.getState().phase).toBe('syncing');
});

test('signing out clears it too, which is the path a different account actually takes', async () => {
  initSync();
  await vi.waitFor(() => expect(accounts()).toEqual(['acc-A']));
  useSyncStatus.setState({ lastSyncedAt: 1_000, lastPulledAt: 1_000, pending: 3 });

  h.state.status = 'anonymous';
  h.state.accountId = null as unknown as string;
  h.listeners.forEach((fn) => fn(h.state));

  expect(useSyncStatus.getState().lastSyncedAt).toBeNull();
  expect(useSyncStatus.getState().lastPulledAt).toBeNull();
});
