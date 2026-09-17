import { vi, test, expect, beforeEach } from 'vitest';
import type { Session } from './contract';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(
      public code: string,
      public status: number,
      message?: string
    ) {
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
  totpRecover: vi.fn(),
  totpRecoverByName: vi.fn(),
}));

import * as api from './api';
import { ApiFailure } from './api';
import { useAccount, PendingRecovery, pendingRecoveryKey } from './store';
import { splitCredential, deriveVerifier } from './keys';

const session = (over: Partial<Session> = {}): Session => ({
  accountId: 'acc-from-server',
  deviceId: useAccount.getState().deviceId,
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  accessExpiresAt: Date.now() + 3_600_000,
  ...over,
});

const sentVerifier = (call: number) => vi.mocked(api.totpRecoverByName).mock.calls[call]![0].verifier;

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  useAccount.setState({ status: 'anonymous', accountId: null, accessToken: null, accessExpiresAt: 0, error: null });
});

test('recovery by name adopts the session and hands back a composite credential', async () => {
  vi.mocked(api.totpRecoverByName).mockResolvedValue(session());
  const composite = await useAccount.getState().recoverWithName('  Саша  ', ' 123456 ');

  expect(vi.mocked(api.totpRecoverByName).mock.calls[0]![0].name).toBe('Саша');
  expect(vi.mocked(api.totpRecoverByName).mock.calls[0]![0].code).toBe('123456');
  // The id comes from the SERVER, never from anything typed: the name resolves to several accounts and
  // only the server knows which one the code actually opened.
  expect(splitCredential(composite).accountId).toBe('acc-from-server');
  expect(useAccount.getState().status).toBe('authenticated');
  expect(useAccount.getState().accountId).toBe('acc-from-server');
});

test('the credential it returns really is the key whose verifier was sent', async () => {
  vi.mocked(api.totpRecoverByName).mockResolvedValue(session());
  const composite = await useAccount.getState().recoverWithName('Саша', '123456');

  expect(await deriveVerifier(splitCredential(composite).key)).toBe(sentVerifier(0));
});

test('a lost answer surfaces as PendingRecovery carrying the key, not a dead end', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValue(new ApiFailure('network', 0));

  // Throwing the key away would be fatal: the server may already have installed it, and the account id
  // — the other half of the credential — lives only in the response that was lost.
  await expect(useAccount.getState().recoverWithName('Саша', '123456')).rejects.toBeInstanceOf(PendingRecovery);
});

test('the retry after a lost answer re-sends the SAME key', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValueOnce(new ApiFailure('network', 0));
  let pending!: PendingRecovery;
  try {
    await useAccount.getState().recoverWithName('Саша', '123456');
  } catch (e) {
    pending = e as PendingRecovery;
  }

  vi.mocked(api.totpRecoverByName).mockResolvedValue(session());
  const composite = await useAccount.getState().recoverWithName('Саша', '654321', pending.key);

  // A second generated key would mean at most one of the two is the real credential, with no way to
  // learn which — so the verifier on the retry must be byte-identical to the one that may have landed.
  expect(sentVerifier(1)).toBe(sentVerifier(0));
  expect(splitCredential(composite).key).toBe(splitCredential(`x.${pending.key}`).key);
});

test('without a pending key each attempt mints a fresh one', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValue(new ApiFailure('network', 0));
  await useAccount.getState().recoverWithName('Саша', '111111').catch(() => undefined);
  await useAccount.getState().recoverWithName('Саша', '222222').catch(() => undefined);

  expect(sentVerifier(1)).not.toBe(sentVerifier(0));
});

test('a lost answer survives a reload, and a success clears it', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValueOnce(new ApiFailure('network', 0));
  await useAccount.getState().recoverWithName('Саша', '123456').catch(() => undefined);

  // React state would not survive the reload that a dropped connection so often comes with, and this is
  // the only copy of a credential the server may already be holding.
  expect(pendingRecoveryKey()).toBeTruthy();

  vi.mocked(api.totpRecoverByName).mockResolvedValue(session());
  await useAccount.getState().recoverWithName('Саша', '654321', pendingRecoveryKey()!);
  expect(pendingRecoveryKey()).toBeNull();
});

test('a wrong code leaves nothing stashed — only a lost answer is ambiguous', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValue(new ApiFailure('totp_invalid', 401));
  await useAccount.getState().recoverWithName('Саша', '000000').catch(() => undefined);

  expect(pendingRecoveryKey()).toBeNull();
});

test('a wrong code stays an ApiFailure — only a lost answer is ambiguous', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValue(new ApiFailure('totp_invalid', 401));

  const err = await useAccount
    .getState()
    .recoverWithName('Саша', '000000')
    .catch((e: unknown) => e);
  expect(err).not.toBeInstanceOf(PendingRecovery);
  expect((err as ApiFailure).code).toBe('totp_invalid');
  expect(useAccount.getState().error).toBe('totp_invalid');
  expect(useAccount.getState().status).toBe('anonymous');
});

test('a throttled name is reported as such, so the UI can point at the id route', async () => {
  vi.mocked(api.totpRecoverByName).mockRejectedValue(new ApiFailure('rate_limited', 429));

  await useAccount.getState().recoverWithName('Саша', '000000').catch(() => undefined);
  expect(useAccount.getState().error).toBe('rate_limited');
});
