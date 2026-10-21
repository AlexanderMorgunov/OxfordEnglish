import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Session } from './contract';
import type * as SyncEngine from '@/features/sync/engine';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(public code: string, public status: number) { super(code); }
  },
  refresh: vi.fn(), logout: vi.fn(), devicePoll: vi.fn(), deleteAccount: vi.fn(), totpRotateKey: vi.fn(),
}));
vi.mock('@/features/sync/engine', async (original) => {
  const actual = await original<typeof SyncEngine>();
  return { ...actual, wipeSyncedData: vi.fn(actual.wipeSyncedData) };
});

import * as api from './api';
import { useAccount } from './store';
import { db } from '@/db/db';
import { wipeSyncedData } from '@/features/sync/engine';
import { sessionDiagnostics, sessionRejectionReason } from './session-diagnostics';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function session(accountId: string, refreshToken: string): Session {
  return { accountId, deviceId: 'synthetic-device', refreshToken, accessToken: `access-${refreshToken}`, accessExpiresAt: Date.now() + 600_000 };
}

async function adopt(accountId: string, refreshToken: string) {
  vi.mocked(api.devicePoll).mockResolvedValue({ status: 'approved', session: session(accountId, refreshToken) });
  await useAccount.getState().pollDeviceLink('synthetic-request');
}

async function seedWord(word: string) {
  await db.wordStatus.put({ word, status: 'known', encounters: 1, firstSeenAt: 1 });
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  localStorage.clear();
  useAccount.setState({ status: 'anonymous', accountId: null, accessToken: null, accessExpiresAt: 0 });
  await db.open();
  await Promise.all([db.wordStatus.clear(), db.pending.clear(), db.syncState.clear()]);
  vi.mocked(api.logout).mockResolvedValue(undefined);
  await adopt('account-A', 'refresh-A');
});

test.each(['logout', 'delete'] as const)('queued %s cannot adopt another tab replacement as its operation owner', async action => {
  const locked = deferred<void>();
  const entered = deferred<void>();
  vi.stubGlobal('navigator', { ...navigator, locks: {
    request: async (_name: string, run: () => unknown) => { entered.resolve(); await locked.promise; return run(); },
  } });
  const operation = (action === 'logout' ? useAccount.getState().logout() : useAccount.getState().deleteAccount()).then(() => null, error => error);
  await entered.promise;
  const previous = JSON.parse(localStorage.getItem('oxford-account')!);
  localStorage.setItem('oxford-account', JSON.stringify({ ...previous, incarnation: 'synthetic-new-incarnation', refreshToken: 'synthetic-other-tab-refresh' }));
  await seedWord('new-tab-learning');
  vi.mocked(wipeSyncedData).mockClear();
  locked.resolve();
  const outcome = await operation;
  if (action === 'delete') expect(outcome).toBeInstanceOf(api.ApiFailure);
  expect(api.logout).not.toHaveBeenCalled();
  expect(api.deleteAccount).not.toHaveBeenCalled();
  expect(wipeSyncedData).not.toHaveBeenCalled();
  expect(await db.wordStatus.get('new-tab-learning')).toBeDefined();
});

test('legacy deletion backfills incarnation before its first own refresh without abandoning cleanup', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'account-A', deviceId: 'synthetic-device', refreshToken: 'refresh-A' }));
  useAccount.setState({ accessToken: null, accessExpiresAt: 0 });
  vi.mocked(api.refresh).mockResolvedValue(session('account-A', 'refresh-next'));
  vi.mocked(api.deleteAccount).mockResolvedValue(undefined);
  await seedWord('legacy-learning');
  await useAccount.getState().deleteAccount();
  expect(api.deleteAccount).toHaveBeenCalledWith('access-refresh-next');
  expect(useAccount.getState().status).toBe('anonymous');
  expect(await db.wordStatus.count()).toBe(0);
});

test('stale key rotation does not clear another tab replacement error or busy state', async () => {
  useAccount.setState({ accessToken: null, accessExpiresAt: 0 });
  const refreshing = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValue(refreshing.promise);
  const rotating = useAccount.getState().rotateRecoveryKey('synthetic-code', true).catch(error => error);
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  const previous = JSON.parse(localStorage.getItem('oxford-account')!);
  localStorage.setItem('oxford-account', JSON.stringify({ ...previous, incarnation: 'synthetic-other-tab-session', refreshToken: 'synthetic-other-tab-refresh' }));
  useAccount.setState({ error: 'new-session-error', busy: true });
  refreshing.resolve(session('account-A', 'retired-response'));
  expect(await rotating).toBeInstanceOf(api.ApiFailure);
  expect(api.totpRotateKey).not.toHaveBeenCalled();
  expect(useAccount.getState().error).toBe('new-session-error');
  expect(useAccount.getState().busy).toBe(true);
});

test('late successful rotation never delivers the old account credential to a new owner', async () => {
  const rotated = deferred<void>();
  vi.mocked(api.totpRotateKey).mockReturnValue(rotated.promise);
  const delivered = useAccount.getState().rotateRecoveryKey('synthetic-code', true).then(() => true, () => false);
  await vi.waitFor(() => expect(api.totpRotateKey).toHaveBeenCalledOnce());
  await adopt('account-B', 'refresh-B');
  useAccount.setState({ error: 'new-session-error', busy: true });
  rotated.resolve();
  expect(await delivered).toBe(false);
  expect(useAccount.getState().accountId).toBe('account-B');
  expect(useAccount.getState().error).toBe('new-session-error');
  expect(useAccount.getState().busy).toBe(true);
});

test.each(['account-A', 'account-B'])('late refresh success cannot replace a new %s session', async (account) => {
  const old = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValue(old.promise);
  const running = useAccount.getState().refresh();
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  await adopt(account, 'refresh-new');
  old.resolve(session('account-A', 'refresh-old-result'));
  await running;
  expect(useAccount.getState().accountId).toBe(account);
  expect(useAccount.getState().accessToken).toBe('access-refresh-new');
  expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('refresh-new');
});

test.each(['account-A', 'account-B'])('late rejected refresh cannot clear a new %s session', async (account) => {
  const old = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValue(old.promise);
  const running = useAccount.getState().refresh();
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  await adopt(account, 'refresh-new');
  old.reject(new api.ApiFailure('refresh_invalid', 401));
  await running;
  expect(useAccount.getState().status).toBe('authenticated');
  expect(useAccount.getState().accessToken).toBe('access-refresh-new');
});

test('old refresh completion cannot release a newer single-flight refresh', async () => {
  const old = deferred<Session>();
  const newer = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValueOnce(old.promise).mockReturnValue(newer.promise);
  const first = useAccount.getState().refresh();
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  await adopt('account-B', 'refresh-B');
  const second = useAccount.getState().refresh();
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledTimes(2));
  old.resolve(session('account-A', 'refresh-old-result'));
  await first;
  const third = useAccount.getState().refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.refresh).toHaveBeenCalledTimes(2);
  newer.resolve(session('account-B', 'refresh-B-next'));
  await Promise.all([second, third]);
  expect(useAccount.getState().accountId).toBe('account-B');
});

test('late remote logout cannot clear a replacement session or its data', async () => {
  const revoked = deferred<void>();
  vi.mocked(api.logout).mockReturnValue(revoked.promise);
  const logout = useAccount.getState().logout();
  await adopt('account-B', 'refresh-B');
  await seedWord('belongs-to-B');
  revoked.resolve();
  await logout;
  expect(useAccount.getState().accountId).toBe('account-B');
  expect(await db.wordStatus.get('belongs-to-B')).toBeDefined();
});

test('session adoption waits for already-started logout cleanup, including pending count', async () => {
  const counted = deferred<number>();
  const reached = deferred<void>();
  vi.spyOn(db.pending, 'count').mockImplementationOnce(() => {
    reached.resolve();
    return Dexie.Promise.resolve(counted.promise);
  });
  const logout = useAccount.getState().logout();
  await reached.promise;
  let adopted = false;
  const linking = adopt('account-A', 'refresh-new').then(() => { adopted = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(adopted).toBe(false);
  counted.resolve(0);
  await Promise.all([logout, linking]);
  await seedWord('belongs-to-B');
  expect(useAccount.getState().accessToken).toBe('access-refresh-new');
  expect(await db.wordStatus.get('belongs-to-B')).toBeDefined();
  expect(JSON.parse(localStorage.getItem('oxford-account')!).lastAccountId).toBeUndefined();
});

test('network and unrelated API errors retain the current session', async () => {
  for (const code of ['network', 'bad_request', 'unavailable']) {
    vi.mocked(api.refresh).mockRejectedValue(new api.ApiFailure(code, 503));
    await useAccount.getState().refresh();
    expect(useAccount.getState().status).toBe('authenticated');
    expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('refresh-A');
  }
  vi.mocked(api.refresh).mockRejectedValue(new api.ApiFailure('refresh_invalid', 503));
  await useAccount.getState().refresh();
  expect(useAccount.getState().status).toBe('authenticated');
  vi.mocked(api.refresh).mockRejectedValue(new Error('synthetic-private-response'));
  await useAccount.getState().refresh();
  expect(useAccount.getState().status).toBe('authenticated');
  expect(JSON.stringify(sessionDiagnostics())).not.toContain('synthetic-private-response');
});

test('credential write failure records only the safe storage event', async () => {
  const original = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
    if (key === 'oxford-account') throw new Error('synthetic-private-storage-error');
    original.call(this, key, value);
  });
  vi.mocked(api.refresh).mockResolvedValue(session('account-A', 'refresh-next'));
  await useAccount.getState().refresh();
  expect(sessionDiagnostics().some(({ event }) => event === 'storage_write_failed')).toBe(true);
  expect(JSON.stringify(sessionDiagnostics())).not.toContain('synthetic-private-storage-error');
});

test('new credentials cannot commit while the old logout wipe is still running', async () => {
  const wiping = deferred<void>();
  const released = deferred<void>();
  const actual = await vi.importActual<typeof SyncEngine>('@/features/sync/engine');
  vi.mocked(wipeSyncedData).mockImplementationOnce(async () => {
    wiping.resolve();
    await released.promise;
    await actual.wipeSyncedData();
  });
  const logout = useAccount.getState().logout();
  await wiping.promise;
  let adopted = false;
  const linking = adopt('account-A', 'refresh-new').then(() => { adopted = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(adopted).toBe(false);
  released.resolve();
  await Promise.all([logout, linking]);
  expect(useAccount.getState().accessToken).toBe('access-refresh-new');
  await seedWord('new-session-data');
  expect(await db.wordStatus.get('new-session-data')).toBeDefined();
});

test.each(['refresh_invalid', 'refresh_reused'])('current %s signs out without deleting learning data and records a safe reason', async (code) => {
  await seedWord('local-learning');
  vi.mocked(api.refresh).mockRejectedValue(new api.ApiFailure(code, 401));
  await useAccount.getState().refresh();
  expect(useAccount.getState().status).toBe('anonymous');
  expect(await db.wordStatus.get('local-learning')).toBeDefined();
  expect(sessionRejectionReason()).toBe(code);
  const encoded = JSON.stringify(sessionDiagnostics());
  expect(encoded).not.toContain('account-A');
  expect(encoded).not.toContain('refresh-A');
  expect(encoded).not.toContain('synthetic-device');
});

test('late account deletion cannot clear a newly linked session or its local rows', async () => {
  const deleted = deferred<void>();
  vi.mocked(api.deleteAccount).mockReturnValue(deleted.promise);
  const deleting = useAccount.getState().deleteAccount().catch(error => error);
  await vi.waitFor(() => expect(api.deleteAccount).toHaveBeenCalledOnce());
  await adopt('account-B', 'refresh-B');
  useAccount.setState({ error: 'new-session-error', busy: true });
  await seedWord('belongs-to-B');
  deleted.resolve();
  expect(await deleting).toBeInstanceOf(api.ApiFailure);
  expect(useAccount.getState().accountId).toBe('account-B');
  expect(useAccount.getState().error).toBe('new-session-error');
  expect(useAccount.getState().busy).toBe(true);
  expect(await db.wordStatus.get('belongs-to-B')).toBeDefined();
});

test.each(['delete', 'rotate'] as const)('a delayed access refresh cannot send another account token to %s', async action => {
  useAccount.setState({ accessExpiresAt: Date.now() - 1 });
  const refreshing = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValue(refreshing.promise);
  const operation = (action === 'delete'
    ? useAccount.getState().deleteAccount()
    : useAccount.getState().rotateRecoveryKey('synthetic-code', true)).catch(error => error);
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  await adopt('account-B', 'refresh-B');
  await seedWord('belongs-to-B');
  refreshing.resolve(session('account-A', 'refresh-old-result'));
  await operation;
  expect(api.deleteAccount).not.toHaveBeenCalled();
  expect(api.totpRotateKey).not.toHaveBeenCalled();
  expect(useAccount.getState().accountId).toBe('account-B');
  expect(useAccount.getState().busy).toBe(false);
  expect(await db.wordStatus.get('belongs-to-B')).toBeDefined();
});

test('access-token refresh for the same session still permits deliberate account deletion', async () => {
  useAccount.setState({ accessExpiresAt: Date.now() - 1 });
  vi.mocked(api.refresh).mockResolvedValue(session('account-A', 'refresh-next'));
  vi.mocked(api.deleteAccount).mockResolvedValue(undefined);
  await useAccount.getState().deleteAccount();
  expect(api.deleteAccount).toHaveBeenCalledWith('access-refresh-next');
  expect(useAccount.getState().status).toBe('anonymous');
});

test.each(['expired', 'absent'] as const)('offline %s access prevents deletion and preserves the session and local learning data', async access => {
  await seedWord('local-learning');
  await db.activity.put({ id: 'synthetic-day', day: '2026-10-10', readSec: 1, readWords: 1, wordsSaved: 0, phrasesSaved: 0, learned: 0, books: {} });
  useAccount.setState({ accessToken: access === 'absent' ? null : 'synthetic-expired-access', accessExpiresAt: Date.now() - 1 });
  vi.mocked(api.refresh).mockRejectedValue(new api.ApiFailure('network', 0));
  vi.mocked(wipeSyncedData).mockClear();
  await expect(useAccount.getState().deleteAccount()).rejects.toThrow();
  expect(api.deleteAccount).not.toHaveBeenCalled();
  expect(wipeSyncedData).not.toHaveBeenCalled();
  expect(useAccount.getState().accountId).toBe('account-A');
  expect(await db.wordStatus.get('local-learning')).toBeDefined();
  expect(await db.activity.get('synthetic-day')).toBeDefined();
});

test.each(['account-A', 'account-B'])('access-token caller does not receive replacement %s credentials after awaiting refresh', async account => {
  useAccount.setState({ accessToken: null, accessExpiresAt: 0 });
  const refreshing = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValue(refreshing.promise);
  const access = useAccount.getState().getAccessToken();
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  await adopt(account, 'replacement-refresh');
  refreshing.resolve(session('account-A', 'retired-response'));
  expect(await access).toBeNull();
  expect(useAccount.getState().accessToken).toBe('access-replacement-refresh');
});

test('successful account deletion still cleans up after ordinary refresh rotation of the same incarnation', async () => {
  await seedWord('old-account-learning');
  const deleted = deferred<void>();
  vi.mocked(api.deleteAccount).mockReturnValue(deleted.promise);
  const deleting = useAccount.getState().deleteAccount();
  await vi.waitFor(() => expect(api.deleteAccount).toHaveBeenCalledOnce());
  const before = JSON.parse(localStorage.getItem('oxford-account')!).incarnation;
  vi.mocked(api.refresh).mockResolvedValue(session('account-A', 'refresh-rotated'));
  await useAccount.getState().refresh();
  expect(JSON.parse(localStorage.getItem('oxford-account')!).incarnation).toBe(before);
  deleted.resolve(); await deleting;
  expect(useAccount.getState().status).toBe('anonymous');
  expect(await db.wordStatus.count()).toBe(0);
});

test.each(['success', 'rejection'] as const)('old refresh %s remains guarded by exact token after same-incarnation rotation', async result => {
  const refreshing = deferred<Session>();
  vi.mocked(api.refresh).mockReturnValue(refreshing.promise);
  const refresh = useAccount.getState().refresh();
  await vi.waitFor(() => expect(api.refresh).toHaveBeenCalledOnce());
  const before = JSON.parse(localStorage.getItem('oxford-account')!);
  localStorage.setItem('oxford-account', JSON.stringify({ ...before, refreshToken: 'synthetic-other-tab-rotation' }));
  if (result === 'success') refreshing.resolve(session('account-A', 'retired-response'));
  else refreshing.reject(new api.ApiFailure('refresh_invalid', 401));
  await refresh;
  expect(useAccount.getState().status).toBe('authenticated');
  expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('synthetic-other-tab-rotation');
});

test('another tab replacing the same account incarnation prevents an old delete cleanup', async () => {
  const deleted = deferred<void>();
  vi.mocked(api.deleteAccount).mockReturnValue(deleted.promise);
  const deleting = useAccount.getState().deleteAccount().catch(error => error);
  await vi.waitFor(() => expect(api.deleteAccount).toHaveBeenCalledOnce());
  const previous = JSON.parse(localStorage.getItem('oxford-account')!);
  localStorage.setItem('oxford-account', JSON.stringify({ ...previous, incarnation: 'synthetic-new-incarnation', refreshToken: 'synthetic-other-tab-refresh' }));
  await seedWord('new-tab-learning');
  vi.mocked(wipeSyncedData).mockClear();
  deleted.resolve(); expect(await deleting).toBeInstanceOf(api.ApiFailure);
  expect(wipeSyncedData).not.toHaveBeenCalled();
  expect(await db.wordStatus.get('new-tab-learning')).toBeDefined();
  expect(JSON.parse(localStorage.getItem('oxford-account')!).incarnation).toBe('synthetic-new-incarnation');
});
