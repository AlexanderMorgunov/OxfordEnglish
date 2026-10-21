import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(public code: string, public status: number) { super(code); }
  },
  refresh: vi.fn(),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.resetModules();
  localStorage.clear();
});

test('cold start retains a legacy persisted session when refresh is offline', async () => {
  const persisted = { accountId: 'synthetic-account', deviceId: 'synthetic-device', refreshToken: 'synthetic-refresh' };
  localStorage.setItem('oxford-account', JSON.stringify(persisted));
  const api = await import('./api');
  vi.mocked(api.refresh).mockRejectedValue(new api.ApiFailure('network', 0));
  const { useAccount } = await import('./store');
  expect(useAccount.getState().status).toBe('authenticated');
  expect(useAccount.getState().accessToken).toBeNull();
  await useAccount.getState().refresh();
  expect(useAccount.getState().status).toBe('authenticated');
  expect(JSON.parse(localStorage.getItem('oxford-account')!)).toEqual(persisted);
  const { sessionDiagnostics } = await import('./session-diagnostics');
  expect(sessionDiagnostics().map(({ event }) => event)).toEqual(['session_present', 'refresh_network']);
});

test.each(['{}', '{', 'null'])('damaged account storage %s boots anonymously with safe diagnostics', async (raw) => {
  localStorage.setItem('oxford-account', raw);
  const { useAccount } = await import('./store');
  expect(useAccount.getState().status).toBe('anonymous');
  const { sessionDiagnostics } = await import('./session-diagnostics');
  expect(sessionDiagnostics().some(({ event }) => event === 'storage_invalid' || event === 'storage_read_failed')).toBe(true);
  expect(JSON.stringify(sessionDiagnostics())).not.toContain(raw.length > 2 ? raw : 'synthetic-secret');
});

test('a legacy session without device identity retains its refresh credential', async () => {
  localStorage.setItem('oxford-account', JSON.stringify({ accountId: 'synthetic-account', refreshToken: 'synthetic-refresh' }));
  const api = await import('./api');
  vi.mocked(api.refresh).mockResolvedValue({ accountId: 'synthetic-account', deviceId: 'original-device', refreshToken: 'synthetic-next', accessToken: 'synthetic-access', accessExpiresAt: Date.now() + 600_000 });
  const { useAccount } = await import('./store');
  expect(useAccount.getState().status).toBe('authenticated');
  expect(await useAccount.getState().getAccessToken()).toBe('synthetic-access');
  expect(useAccount.getState().deviceId).toBe('original-device');
});
