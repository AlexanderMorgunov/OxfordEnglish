import { vi, test, expect, beforeEach } from 'vitest';
import type { Session } from './contract';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(public code: string, public status: number, message?: string) {
      super(message ?? code);
    }
  },
  register: vi.fn(),
  login: vi.fn(),
  refresh: vi.fn(),
  logout: vi.fn(),
  listDevices: vi.fn(),
  deviceStart: vi.fn(),
  devicePoll: vi.fn(),
  deviceApprove: vi.fn(),
  deviceRevoke: vi.fn(),
}));

import * as api from './api';
import { useAccount } from './store';

const session = (over: Partial<Session> = {}): Session => ({
  accountId: 'acc-1',
  deviceId: useAccount.getState().deviceId,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: Date.now() + 3_600_000,
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useAccount.setState({ status: 'anonymous', accountId: null, accessToken: null, accessExpiresAt: 0, error: null });
});

test('createAccount registers with derived credentials, returns the key, and persists the session', async () => {
  vi.mocked(api.register).mockResolvedValue(session({ created: true }));
  const key = await useAccount.getState().createAccount();

  expect(key).toMatch(/^[0-9A-Z-]+$/); // a formatted recovery key
  expect(api.register).toHaveBeenCalledTimes(1);
  const arg = vi.mocked(api.register).mock.calls[0]![0];
  expect(arg.accountId).toEqual(expect.any(String));
  expect(arg.verifier).toEqual(expect.any(String));
  expect(arg.accountId).not.toBe(arg.verifier); // distinct derivations, never the raw key

  expect(useAccount.getState().status).toBe('authenticated');
  expect(useAccount.getState().accountId).toBe('acc-1');
  expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('refresh-1');
  // Access token is kept in memory, never persisted.
  expect(localStorage.getItem('oxford-account')).not.toContain('access-1');
});

test('getAccessToken single-flights refresh: two concurrent callers → one refresh call', async () => {
  // Authenticated with an already-expired access token + a persisted refresh token.
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'acc-1', deviceId: 'd', refreshToken: 'refresh-1' }));
  useAccount.setState({ status: 'authenticated', accountId: 'acc-1', accessToken: 'stale', accessExpiresAt: Date.now() - 1000 });

  let resolve!: (s: Session) => void;
  vi.mocked(api.refresh).mockReturnValue(new Promise<Session>((r) => { resolve = r; }));

  const p = Promise.all([useAccount.getState().getAccessToken(), useAccount.getState().getAccessToken()]);
  resolve(session({ accessToken: 'fresh', refreshToken: 'refresh-2' }));
  const [a, b] = await p;

  expect(api.refresh).toHaveBeenCalledTimes(1); // single-flight
  expect(a).toBe('fresh');
  expect(b).toBe('fresh');
  expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('refresh-2'); // rotated
});

test('a reused refresh token drops the session to anonymous (local data untouched)', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'acc-1', deviceId: 'd', refreshToken: 'refresh-1' }));
  useAccount.setState({ status: 'authenticated', accountId: 'acc-1', accessToken: 'x', accessExpiresAt: Date.now() - 1 });
  vi.mocked(api.refresh).mockRejectedValue(new api.ApiFailure('refresh_reused', 401));

  await useAccount.getState().refresh();

  expect(useAccount.getState().status).toBe('anonymous');
  expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('');
});

test('logout revokes server-side and clears the session', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'acc-1', deviceId: 'd', refreshToken: 'refresh-1' }));
  useAccount.setState({ status: 'authenticated', accountId: 'acc-1', accessToken: 'x', accessExpiresAt: Date.now() + 1000 });
  vi.mocked(api.logout).mockResolvedValue(undefined);

  await useAccount.getState().logout();

  expect(api.logout).toHaveBeenCalledWith('refresh-1');
  expect(useAccount.getState().status).toBe('anonymous');
  expect(useAccount.getState().accountId).toBeNull();
});

test('pollDeviceLink adopts the session on approval (this device becomes signed in)', async () => {
  vi.mocked(api.devicePoll).mockResolvedValue({ status: 'approved', session: session({ accessToken: 'linked', refreshToken: 'refresh-linked' }) });

  const status = await useAccount.getState().pollDeviceLink('req-1');

  expect(status).toBe('approved');
  expect(useAccount.getState().status).toBe('authenticated');
  expect(useAccount.getState().accessToken).toBe('linked');
  expect(JSON.parse(localStorage.getItem('oxford-account')!).refreshToken).toBe('refresh-linked');
});

test('pollDeviceLink while pending leaves the device anonymous', async () => {
  vi.mocked(api.devicePoll).mockResolvedValue({ status: 'pending' });

  const status = await useAccount.getState().pollDeviceLink('req-1');

  expect(status).toBe('pending');
  expect(useAccount.getState().status).toBe('anonymous');
});

test('approveDevice sends the code with a fresh access token and returns the new device name', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'acc-1', deviceId: 'd', refreshToken: 'refresh-1' }));
  useAccount.setState({ status: 'authenticated', accountId: 'acc-1', accessToken: 'access-1', accessExpiresAt: Date.now() + 3_600_000 });
  vi.mocked(api.deviceApprove).mockResolvedValue({ deviceName: 'New Phone' });

  const name = await useAccount.getState().approveDevice('  CODE1234  ');

  expect(name).toBe('New Phone');
  expect(api.deviceApprove).toHaveBeenCalledWith('access-1', 'CODE1234'); // trimmed
});

test('revokeDevice calls the API with a fresh access token', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'acc-1', deviceId: 'd', refreshToken: 'refresh-1' }));
  useAccount.setState({ status: 'authenticated', accountId: 'acc-1', accessToken: 'access-1', accessExpiresAt: Date.now() + 3_600_000 });
  vi.mocked(api.deviceRevoke).mockResolvedValue(undefined);

  await useAccount.getState().revokeDevice('device-x');

  expect(api.deviceRevoke).toHaveBeenCalledWith('access-1', 'device-x');
});
