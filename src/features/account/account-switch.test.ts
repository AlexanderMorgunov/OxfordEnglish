/**
 * H5: account A's local rows must never end up under account B on a shared device.
 *
 * `logout` wipes only when nothing is unsynced, deliberately — an offline logout keeps unpushed work for
 * the next login to the SAME account. The claim that a switch is then caught at adopt time by
 * `maybeSwitchWipe` was false: `clearSession` blanks `accountId`, so its `prev &&` guard could not fire
 * after any logout. A's rows AND its dirty queue survived into B and pushed under B's credentials.
 */
import 'fake-indexeddb/auto';
import { vi, test, expect, beforeEach } from 'vitest';
import type { Session } from './contract';
import type * as SyncEngine from '@/features/sync/engine';

vi.mock('./config', () => ({ API_BASE: 'https://api.test', accountsEnabled: () => true }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(public code: string, public status: number) {
      super(code);
    }
  },
  logout: vi.fn(),
  devicePoll: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('@/features/sync/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncEngine>();
  return { ...actual, wipeSyncedData: vi.fn(actual.wipeSyncedData) };
});

import * as api from './api';
import { wipeSyncedData } from '@/features/sync/engine';
import { useAccount } from './store';
import { db, INSTALL_ROW } from '@/db/db';

const KEY = 'oxford-account';

const session = (accountId: string): Session => ({
  accountId,
  deviceId: useAccount.getState().deviceId,
  accessToken: 'a',
  refreshToken: 'r',
  accessExpiresAt: Date.now() + 3_600_000,
});

function signedInAs(accountId: string) {
  localStorage.setItem(KEY, JSON.stringify({ accountId, deviceId: useAccount.getState().deviceId, refreshToken: 'r' }));
}

async function seedWord(word: string) {
  await db.wordStatus.put({
    word, status: 'known', encounters: 1, firstSeenAt: 9,
    updatedAt: 9, updatedBy: 'installA', statusUpdatedAt: 9,
  });
}

async function seedAccountAData() {
  await db.wordStatus.put({
    word: 'apple', status: 'known', encounters: 1, firstSeenAt: 1,
    updatedAt: 1, updatedBy: 'installA', statusUpdatedAt: 1,
  });
  await db.pending.put({ key: 'wordStatus:apple', store: 'wordStatus', id: 'apple' });
  await db.syncState.put({ account: 'acc-A', cursorSeq: 42 });
}

async function adopt(accountId: string) {
  vi.mocked(api.devicePoll).mockResolvedValue({ status: 'approved', session: session(accountId) });
  await useAccount.getState().pollDeviceLink('req-1');
}

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(api.logout).mockResolvedValue(undefined);
  vi.mocked(api.deleteAccount).mockResolvedValue(undefined);
  await db.open();
  await Promise.all([db.wordStatus.clear(), db.pending.clear(), db.syncState.clear()]);
  await db.syncState.put({ account: INSTALL_ROW, installId: 'install-1' });
});

test('logout with unpushed changes, then signing in as a DIFFERENT account, leaves nothing of A behind', async () => {
  signedInAs('acc-A');
  await seedAccountAData();

  await useAccount.getState().logout();
  expect(await db.wordStatus.count()).toBe(1); // deliberate: an offline logout keeps unpushed work
  expect(await db.pending.count()).toBe(1);

  await adopt('acc-B');
  expect(useAccount.getState().accountId).toBe('acc-B');

  expect(await db.wordStatus.count()).toBe(0);
  // The dirty queue is the sharp end: a surviving entry pushes A's word up under B's credentials.
  expect(await db.pending.count()).toBe(0);
  expect(await db.syncState.get('acc-A')).toBeUndefined();
});

test('logout and back into the SAME account keeps the unpushed work', async () => {
  signedInAs('acc-A');
  await seedAccountAData();

  await useAccount.getState().logout();
  await adopt('acc-A');

  expect(await db.wordStatus.count()).toBe(1);
  expect(await db.pending.count()).toBe(1);
  expect((await db.syncState.get('acc-A'))?.cursorSeq).toBe(42); // no re-reconcile from scratch
});

test('a clean logout followed by a different account keeps this device its identity', async () => {
  signedInAs('acc-A');
  await useAccount.getState().logout(); // nothing pending → wipes here

  await adopt('acc-B'); // and now wipes a second time, which must stay a no-op

  expect((await db.syncState.get(INSTALL_ROW))?.installId).toBe('install-1');
});

test('recovery re-adopts the same account id without wiping the data it exists to save', async () => {
  signedInAs('acc-A');
  await seedAccountAData();
  await useAccount.getState().logout();

  // Both recovery paths funnel through maybeSwitchWipe with the id the SERVER returned; a key rotation
  // keeps the id precisely so it is not read as a switch.
  await adopt('acc-A');

  expect(await db.wordStatus.count()).toBe(1);
});

test('a device that never held an account adopts one without wiping', async () => {
  localStorage.removeItem(KEY);
  await seedAccountAData();

  await adopt('acc-B');

  expect(await db.wordStatus.count()).toBe(1);
});

test('switching account in place, without logging out first, still wipes', async () => {
  signedInAs('acc-A');
  await seedAccountAData();

  await adopt('acc-B');

  expect(await db.wordStatus.count()).toBe(0);
});

/**
 * The regression the first version of this fix introduced. Once a wipe has actually run there is nothing
 * of the old account left to protect the next one from, so a later wipe can only destroy work its owner
 * did while signed out — which belongs to nobody and exists on no server. Both routes below reach that
 * state through buttons the UI offers.
 */
test('deleting the account, studying signed out, then signing up again keeps the anonymous work', async () => {
  signedInAs('acc-A');
  useAccount.setState({ status: 'authenticated', accountId: 'acc-A', accessToken: 'a', accessExpiresAt: Date.now() + 3_600_000 });
  await seedAccountAData();

  await useAccount.getState().deleteAccount();
  expect(await db.wordStatus.count()).toBe(0);

  await seedWord('anon');
  await adopt('acc-NEW');

  expect(await db.wordStatus.count()).toBe(1);
});

test('a clean logout, studying signed out, then a DIFFERENT account keeps the anonymous work', async () => {
  signedInAs('acc-A');
  await useAccount.getState().logout(); // nothing pending → A is wiped here

  await seedWord('anon');
  await adopt('acc-B');

  expect(await db.wordStatus.count()).toBe(1);
});

/**
 * The load-bearing half of the marker's meaning: only a wipe that ACTUALLY RAN may clear it. Clearing it
 * first, or regardless of the outcome, would leave account A's rows on the device with nothing left to
 * flag them — the original H5 hole, reopened from the other end. Scoped to the logout and deletion paths:
 * a wipe that throws inside `maybeSwitchWipe` gets no second chance, since the session it adopts next
 * shadows the marker (queue item 12).
 */
test('a wipe that throws on logout keeps the marker, so the next sign-in still tries', async () => {
  signedInAs('acc-A');
  await seedWord('a-word'); // nothing pending, so logout attempts the wipe
  vi.mocked(wipeSyncedData).mockRejectedValueOnce(new Error('storage'));

  await useAccount.getState().logout();
  expect(await db.wordStatus.count()).toBe(1);

  await adopt('acc-B');
  expect(await db.wordStatus.count()).toBe(0);
});

test('a wipe that throws on account deletion keeps the marker', async () => {
  signedInAs('acc-A');
  useAccount.setState({ status: 'authenticated', accountId: 'acc-A', accessToken: 'a', accessExpiresAt: Date.now() + 3_600_000 });
  await seedWord('a-word');
  vi.mocked(wipeSyncedData).mockRejectedValueOnce(new Error('storage'));

  await useAccount.getState().deleteAccount();
  expect(await db.wordStatus.count()).toBe(1);

  await adopt('acc-NEW');
  expect(await db.wordStatus.count()).toBe(0);
});
