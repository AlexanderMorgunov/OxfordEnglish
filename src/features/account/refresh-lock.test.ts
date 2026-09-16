import { vi, test, expect, beforeEach } from 'vitest';
import type { Session } from './contract';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(
      public code: string,
      public status: number
    ) {
      super(code);
    }
  },
  refresh: vi.fn(),
  logout: vi.fn(),
}));

import * as api from './api';
import { useAccount } from './store';

const KEY = 'oxford-account';

const stored = (refreshToken: string) =>
  localStorage.setItem(KEY, JSON.stringify({ accountId: 'acc-1', deviceId: 'dev-1', refreshToken }));

const session = (refreshToken: string): Session => ({
  accountId: 'acc-1',
  deviceId: 'dev-1',
  accessToken: 'access-new',
  accessExpiresAt: Date.now() + 3_600_000,
  refreshToken,
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.refresh).mockReset();
});

/**
 * The refresh token used to be read before the cross-tab lock was taken, so a tab that queued behind
 * another tab's rotation woke up holding a token that rotation had already retired. Sending it reads to
 * the server as a replayed token — i.e. as theft — and revokes the whole family, signing every tab out
 * with nothing actually stolen.
 *
 * The lock is faked here as "something else rotates the stored token while we wait", which is exactly
 * what the winning tab does.
 */
test('the token is read after the lock is taken, not before', async () => {
  stored('refresh-old');
  vi.stubGlobal('navigator', {
    ...navigator,
    locks: {
      request: async (_name: string, run: () => Promise<void>) => {
        stored('refresh-rotated'); // the other tab got there first
        return run();
      },
    },
  });
  vi.mocked(api.refresh).mockResolvedValue(session('refresh-next'));

  useAccount.setState({ status: 'authenticated', accountId: 'acc-1' });
  await useAccount.getState().refresh();

  expect(api.refresh).toHaveBeenCalledWith('refresh-rotated');
  vi.unstubAllGlobals();
});

test('a refresh with nothing stored sends nothing at all', async () => {
  await useAccount.getState().refresh();
  expect(api.refresh).not.toHaveBeenCalled();
});
