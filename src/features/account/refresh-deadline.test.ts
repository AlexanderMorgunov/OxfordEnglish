import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
import { refresh } from './api';
import { useAccount } from './store';

const reply = { accountId: 'synthetic-account', deviceId: 'synthetic-device', accessToken: 'synthetic-access', refreshToken: 'synthetic-next', accessExpiresAt: Date.now() + 600_000 };
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

test.each(['headers', 'body'] as const)('shared refresh deadline includes hanging %s', async stage => {
  const fetchMock = vi.fn().mockImplementation(async () => stage === 'headers'
    ? new Promise(() => undefined)
    : { ok: true, json: () => new Promise(() => undefined) });
  vi.stubGlobal('fetch', fetchMock);
  let failure: unknown;
  const waiting = refresh('synthetic-refresh').catch(error => { failure = error; });
  await vi.advanceTimersByTimeAsync(30_001);
  expect(failure).toMatchObject({ code: 'network', status: 0 });
  expect(fetchMock.mock.calls[0]?.[1]?.signal.aborted).toBe(true);
  await waiting;
});

test('shared refresh stays single-flight until deadline and permits recovery afterward', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: reply.accountId, deviceId: reply.deviceId, refreshToken: 'synthetic-refresh', incarnation: 'synthetic-incarnation' }));
  useAccount.setState({ status: 'authenticated', accountId: reply.accountId, accessToken: null, accessExpiresAt: 0 });
  const fetchMock = vi.fn().mockImplementationOnce(() => new Promise(() => undefined)).mockImplementation(async () => Response.json({ ...reply, accessExpiresAt: Date.now() + 600_000 }));
  vi.stubGlobal('fetch', fetchMock);
  const first = useAccount.getState().getAccessToken();
  const second = useAccount.getState().getAccessToken();
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(8_001);
  const third = useAccount.getState().getAccessToken();
  await flush();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(22_001);
  expect(await Promise.all([first, second, third])).toEqual([null, null, null]);
  expect(useAccount.getState().status).toBe('authenticated');
  expect(await useAccount.getState().getAccessToken()).toBe('synthetic-access');
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
