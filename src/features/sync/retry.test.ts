import { vi, test, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/db/db', () => ({ db: { pending: { count: async () => 0 }, books: { toArray: async () => [] } } }));
vi.mock('@/features/account/config', () => ({ accountsEnabled: () => true }));
vi.mock('@/features/account/store', () => ({
  useAccount: {
    getState: () => ({ status: 'authenticated', accountId: 'acc-1', getAccessToken: async () => 'tok' }),
    subscribe: () => () => undefined,
  },
}));
vi.mock('@/features/account/entitlement', () => ({ useEntitlement: { getState: () => ({ load: async () => undefined, clear: () => undefined }) } }));
vi.mock('@/features/account/billing', () => ({ claimPending: async () => 'none' }));
vi.mock('@/features/account/api', () => ({
  ApiFailure: class extends Error {},
  syncPush: vi.fn(),
  syncPull: vi.fn(),
}));
vi.mock('@/features/reader/blobSync', () => ({ syncAllBookFiles: vi.fn(async () => undefined) }));
vi.mock('./settingsBridge', () => ({ hydrateSettings: vi.fn(async () => undefined) }));
vi.mock('./engine', () => ({ syncWith: vi.fn() }));

import { syncWith } from './engine';
import { triggerSync } from './run';
import { useSyncStatus } from './status';

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(syncWith).mockReset();
});

afterEach(() => vi.useRealTimers());

/**
 * The status line has always said "we'll retry later". Nothing did: the triggers were app open, the
 * `online` event, signing in, and a local write — and on a VPN `navigator.onLine` stays true, so `online`
 * never fires. A failed cycle sat in `error` until the user reloaded the page by hand.
 */
test('a failed cycle comes back on its own', async () => {
  vi.mocked(syncWith).mockRejectedValueOnce(new Error('no route to host'));
  await triggerSync();
  expect(useSyncStatus.getState().phase).toBe('error');
  expect(syncWith).toHaveBeenCalledTimes(1);

  vi.mocked(syncWith).mockResolvedValue({ pushBlocked: false });
  await vi.advanceTimersByTimeAsync(15_000);

  expect(syncWith).toHaveBeenCalledTimes(2);
  expect(useSyncStatus.getState().phase).toBe('idle');
});

test('a cycle that worked schedules nothing', async () => {
  vi.mocked(syncWith).mockResolvedValue({ pushBlocked: false });
  await triggerSync();
  expect(syncWith).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(600_000);
  expect(syncWith).toHaveBeenCalledTimes(1);
});

test('a refused upload still records that the download half ran', async () => {
  // `lastSyncedAt` is deliberately frozen while pushes are refused for want of a plan — the settings line
  // must not claim a sync completed when nothing the user wrote is landing. But `pullLoop` runs either
  // way, so anything asking "might another device's data have arrived?" needs its own clock. Sharing
  // `lastSyncedAt` made the answer permanently "no" for a lapsed-Pro account, which is exactly the
  // account whose other device holds a position it cannot push.
  useSyncStatus.setState({ lastSyncedAt: null, lastPulledAt: null });

  vi.mocked(syncWith).mockResolvedValue({ pushBlocked: true });
  await triggerSync();

  expect(useSyncStatus.getState().phase).toBe('paused');
  expect(useSyncStatus.getState().lastSyncedAt).toBeNull();
  expect(useSyncStatus.getState().lastPulledAt).not.toBeNull();
});

test('a failed cycle records neither clock', async () => {
  useSyncStatus.setState({ lastSyncedAt: null, lastPulledAt: null });

  vi.mocked(syncWith).mockRejectedValueOnce(new Error('offline'));
  await triggerSync();

  expect(useSyncStatus.getState().lastPulledAt).toBeNull();
  expect(useSyncStatus.getState().lastSyncedAt).toBeNull();
});
