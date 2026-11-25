import { afterEach, expect, it, vi } from 'vitest';
import { useAccount } from '@/features/account/store';
import {
  connectGameAvailability,
  gameAccessAllowed,
  refreshGameAvailability,
  useGameAvailability,
} from './availability';

vi.mock('@/features/account/config', () => ({
  API_BASE: 'https://api.test',
  accountsEnabled: () => true,
}));
const tab = vi.hoisted(() => ({ revision: 0, check: undefined as (() => void) | undefined }));
const platform = vi.hoisted(() => ({ native: false }));
vi.mock('@/shared/lib/platform', () => ({ isNativePlatform: () => platform.native }));
vi.mock('@capacitor/app', () => ({
  App: { addListener: async () => ({ remove: async () => {} }) },
}));
vi.mock('@/features/account/store', async () => {
  const { create } = await import('zustand');
  return {
    captureAccountSessionOwner: () => {
      const revision = tab.revision;
      return () => revision === tab.revision;
    },
    subscribeAccountSessionStorage: (check: () => void) => {
      tab.check = check;
      return () => { tab.check = undefined; };
    },
    useAccount: create<{
      accountId: string | null;
      status: 'authenticated' | 'anonymous';
      sessionRevision: number;
      getAccessToken: () => Promise<string | null>;
    }>((_, get) => ({
      accountId: null,
      status: 'anonymous',
      sessionRevision: 0,
      getAccessToken: async () => get().accountId,
    })),
  };
});

const response = (allowed: boolean, validForMs = 30_000, androidAllowed?: boolean) => Response.json({
  version: 1,
  validForMs,
  features: { games_catalog: { allowed, androidAllowed, revision: 1 } },
});
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  platform.native = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
  useAccount.setState({ accountId: null, status: 'anonymous', sessionRevision: 0 });
});

it('keeps a web-only rollout hidden on Android and revokes access when Android is disabled', async () => {
  platform.native = true;
  vi.stubGlobal('fetch', vi.fn()
    .mockResolvedValueOnce(response(true))
    .mockResolvedValueOnce(response(true, 30_000, true))
    .mockResolvedValueOnce(response(true, 30_000, false)));
  dispose = connectGameAvailability();
  await refreshGameAvailability();
  expect(gameAccessAllowed()).toBe(false);
  await refreshGameAvailability();
  expect(gameAccessAllowed()).toBe(true);
  const epoch = useGameAvailability.getState().epoch;
  await refreshGameAvailability();
  expect(useGameAvailability.getState()).toMatchObject({ access: 'denied', epoch: epoch + 1 });
  expect(gameAccessAllowed()).toBe(false);
});

it('ignores a late tester response after logout and checks the guest separately', async () => {
  useAccount.setState({ accountId: 'tester', status: 'authenticated', sessionRevision: 1 });
  let finishTester!: (value: Response) => void;
  let testerRequested!: () => void;
  const started = new Promise<void>((resolve) => { testerRequested = resolve; });
  const lateTester = new Promise<Response>((resolve) => { finishTester = resolve; });
  const fetchMock = vi.fn((_url, init: RequestInit) => {
    if (new Headers(init.headers).has('authorization')) {
      testerRequested();
      return lateTester;
    }
    return Promise.resolve(response(false));
  });
  vi.stubGlobal('fetch', fetchMock);
  dispose = connectGameAvailability();
  const initial = refreshGameAvailability();
  await started;
  useAccount.setState({ accountId: null, status: 'anonymous', sessionRevision: 2 });
  await refreshGameAvailability();
  finishTester(response(true));
  await initial;
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(useGameAvailability.getState().access).toBe('denied');
  expect(gameAccessAllowed()).toBe(false);
});

it('deduplicates checks, expires a permission on network failure and recovers on retry', async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(response(true, 1000))
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce(response(true));
  vi.stubGlobal('fetch', fetchMock);
  dispose = connectGameAvailability();
  await Promise.all([refreshGameAvailability(), refreshGameAvailability()]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(gameAccessAllowed()).toBe(true);
  const epoch = useGameAvailability.getState().epoch;
  await refreshGameAvailability();
  await vi.advanceTimersByTimeAsync(1001);
  expect(useGameAvailability.getState()).toMatchObject({ access: 'suspended', epoch });
  expect(gameAccessAllowed()).toBe(false);
  await refreshGameAvailability();
  expect(useGameAvailability.getState()).toMatchObject({ access: 'allowed', epoch });
});

it('closes current access when the persisted session changes in another tab', async () => {
  useAccount.setState({ accountId: 'tester', status: 'authenticated', sessionRevision: 1 });
  const fetchMock = vi.fn().mockResolvedValueOnce(response(true));
  vi.stubGlobal('fetch', fetchMock);
  dispose = connectGameAvailability();
  await refreshGameAvailability();
  expect(gameAccessAllowed()).toBe(true);
  const epoch = useGameAvailability.getState().epoch;
  tab.revision++;
  tab.check?.();
  expect(gameAccessAllowed()).toBe(false);
  expect(useGameAvailability.getState()).toMatchObject({ access: 'session-changed', epoch: epoch + 1 });
  await refreshGameAvailability();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
