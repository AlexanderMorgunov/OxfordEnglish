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
vi.mock('@/features/reader/storage', () => ({ discardAllBookFiles: vi.fn(async () => undefined) }));
vi.mock('./api', () => ({
  ApiFailure: class ApiFailure extends Error {
    constructor(public code: string, public status: number) {
      super(code);
    }
  },
  logout: vi.fn(),
  devicePoll: vi.fn(),
  refresh: vi.fn(),
  deleteAccount: vi.fn(),
}));

vi.mock('@/features/sync/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncEngine>();
  return {
    ...actual,
    wipeSyncedData: vi.fn(actual.wipeSyncedData),
    releasePreviousAccountData: vi.fn(actual.releasePreviousAccountData),
  };
});

import * as api from './api';
import { releasePreviousAccountData, wipeSyncedData } from '@/features/sync/engine';
import { forgetBookFileOwner } from './store';
import { discardAllBookFiles } from '@/features/reader/storage';
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
  await Promise.all([db.wordStatus.clear(), db.pending.clear(), db.syncState.clear(), db.activity.clear(), db.reviewLog.clear()]);
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

/**
 * Book files are the one thing a logout must NOT take: metadata syncs for everyone, but uploading the
 * file itself is opt-in, so for a free-tier user the copy in OPFS is the only one — and signing back
 * into the same account re-links it by id, so the book simply works again. When a DIFFERENT account
 * takes the device there is no such path, and the book rows are long gone by then, which is why an
 * owner is recorded rather than a list of ids.
 */
test('logging out keeps the book files, and signing back in to the same account keeps them', async () => {
  signedInAs('acc-A');
  await adopt('acc-A'); // records the owner the way a real sign-in does

  await useAccount.getState().logout();
  expect(discardAllBookFiles).not.toHaveBeenCalled();

  await adopt('acc-A');
  expect(discardAllBookFiles).not.toHaveBeenCalled();
});

test('a different account taking the device releases them, even after a clean logout', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');
  await useAccount.getState().logout(); // clean: this clears the wipe marker, but not the file owner

  await adopt('acc-B');

  expect(discardAllBookFiles).toHaveBeenCalled();
});

test('switching in place releases them too', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');

  await adopt('acc-B');

  expect(discardAllBookFiles).toHaveBeenCalled();
});

test('deleting the account releases them, since no sign-in follows to notice', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');
  useAccount.setState({ status: 'authenticated', accountId: 'acc-A', accessToken: 'a', accessExpiresAt: Date.now() + 3_600_000 });

  await useAccount.getState().deleteAccount();

  expect(discardAllBookFiles).toHaveBeenCalled();
});

test('a device that never held an account keeps what an anonymous user imported', async () => {
  localStorage.removeItem(KEY);

  await adopt('acc-B');

  expect(discardAllBookFiles).not.toHaveBeenCalled();
});

test('the previous account history goes with the device, but a logout keeps it', async () => {
  const history = async () => [await db.activity.count(), await db.reviewLog.count()];
  const seedHistory = async () => {
    await db.activity.put({ id: 'd1:i1', day: '2026-09-12', readSec: 60, readWords: 90, wordsSaved: 1, phrasesSaved: 0, learned: 1, books: { 'reader.bk1': { title: 'A private title', sec: 60, words: 90, saved: 1 } } });
    await db.reviewLog.put({ id: 'r1', cardId: 'word:apple', rating: 3, ts: 1 });
  };

  signedInAs('acc-A');
  await adopt('acc-A');
  await seedHistory();

  await useAccount.getState().logout();
  // No server copy exists, so a sign-out must not be the thing that deletes someone's streak.
  expect(await history()).toEqual([1, 1]);

  await adopt('acc-B');
  // `activity` rows carry book TITLES, so leaving them makes the previous person's library legible.
  expect(await history()).toEqual([0, 0]);
});

test('a release that fails keeps the marker, so the next sign-in tries again', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');
  vi.mocked(releasePreviousAccountData).mockRejectedValueOnce(new Error('storage'));

  await adopt('acc-B');

  // Claiming the device on a failed release is how the previous tenant's reading history — book titles
  // included — would have stayed on it with nothing left to notice.
  vi.mocked(releasePreviousAccountData).mockClear();
  await adopt('acc-B');
  expect(releasePreviousAccountData).toHaveBeenCalled();
});

test('a successful release claims the device, so the next sign-in does not redo it', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');

  await adopt('acc-B');
  vi.mocked(releasePreviousAccountData).mockClear();
  await adopt('acc-B');

  expect(releasePreviousAccountData).not.toHaveBeenCalled();
});

/**
 * Losing your key and making a new account is an ordinary way to reach a device that already held one,
 * and it is the same human. Anything imported in between has no server copy at all — so the BOOKS are
 * spared, and only the books. Sparing the reading history and the account-scoped settings along with
 * them would hand the next account a level, a streak and an upload toggle, which is the harm the whole
 * item exists to prevent.
 */
test('books imported while signed out are not collateral of the next account', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');
  await useAccount.getState().logout();

  forgetBookFileOwner(); // what importBook does for a signed-out reader
  vi.mocked(discardAllBookFiles).mockClear();
  vi.mocked(releasePreviousAccountData).mockClear();

  await adopt('acc-B');

  expect(discardAllBookFiles).not.toHaveBeenCalled();
  expect(releasePreviousAccountData).toHaveBeenCalled();
});

test('and only the books: an import under an account changes nothing at all', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');

  forgetBookFileOwner(); // signed in, so the files are already this account's
  vi.mocked(discardAllBookFiles).mockClear();

  await adopt('acc-B');

  expect(discardAllBookFiles).toHaveBeenCalled();
});

/**
 * Every install that is already signed in when this ships has neither marker, and an app boot is
 * refresh() → applySession without passing through maybeSwitchWipe. Unarmed, their first account switch
 * would release nothing at all.
 */
test('an install that was already signed in still releases on its first switch', async () => {
  localStorage.setItem(KEY, JSON.stringify({ accountId: 'acc-A', deviceId: useAccount.getState().deviceId, refreshToken: 'r' }));
  // A boot is refresh() → applySession, which never passes through maybeSwitchWipe. That is the ONLY
  // place the markers can be armed for an install that predates them.
  vi.mocked(api.refresh).mockResolvedValue(session('acc-A'));
  await useAccount.getState().refresh();
  vi.mocked(discardAllBookFiles).mockClear();
  vi.mocked(releasePreviousAccountData).mockClear();

  await adopt('acc-B');

  expect(discardAllBookFiles).toHaveBeenCalled();
  expect(releasePreviousAccountData).toHaveBeenCalled();
});

test('a failed book discard keeps the file marker while the data half still advances', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');
  vi.mocked(discardAllBookFiles).mockRejectedValueOnce(new Error('locked'));

  await adopt('acc-B');

  vi.mocked(discardAllBookFiles).mockClear();
  vi.mocked(releasePreviousAccountData).mockClear();
  await adopt('acc-B');

  // The books are retried; the history and settings are not, because their release did run.
  expect(discardAllBookFiles).toHaveBeenCalled();
  expect(releasePreviousAccountData).not.toHaveBeenCalled();
});

/**
 * A first-ever sign-in is not a handover. Everything studied anonymously — streak, review log, level —
 * exists on no server, and the marker being absent means "nobody owned this device", not "somebody did".
 */
test('signing up for the first time keeps what was studied anonymously', async () => {
  localStorage.removeItem(KEY);

  await adopt('acc-B');

  expect(releasePreviousAccountData).not.toHaveBeenCalled();
  expect(discardAllBookFiles).not.toHaveBeenCalled();
});

/**
 * An install that is signed OUT when this ships has neither marker, because a boot is
 * refresh() → applySession and that returns early with no refresh token. The wipe marker is the only
 * record left of who owned the device, and it is right there in the same read.
 */
test('a device signed out at upgrade still releases the previous account', async () => {
  localStorage.setItem(
    KEY,
    JSON.stringify({ accountId: '', deviceId: useAccount.getState().deviceId, refreshToken: '', lastAccountId: 'acc-A' }),
  );

  await adopt('acc-B');

  expect(releasePreviousAccountData).toHaveBeenCalled();
  // The books are NOT released on that fallback: clearing the file marker is how an anonymous import
  // protects copies that exist nowhere else, and re-arming it from `lastAccountId` would delete them.
  expect(discardAllBookFiles).not.toHaveBeenCalled();
});

test('deleting the account releases both halves even when one of them fails', async () => {
  signedInAs('acc-A');
  await adopt('acc-A');
  useAccount.setState({ status: 'authenticated', accountId: 'acc-A', accessToken: 'a', accessExpiresAt: Date.now() + 3_600_000 });
  vi.mocked(releasePreviousAccountData).mockRejectedValueOnce(new Error('storage'));
  vi.mocked(discardAllBookFiles).mockClear();

  await useAccount.getState().deleteAccount();

  // Run in sequence, a failing first half would skip the second — the coupling the two markers exist to
  // avoid, and this is the one caller that does not go through the switch path.
  expect(discardAllBookFiles).toHaveBeenCalled();
});
