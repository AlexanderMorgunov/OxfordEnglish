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
