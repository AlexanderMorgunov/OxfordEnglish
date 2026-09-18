/**
 * The stores behind `db.settings` keep their own localStorage copy, so account state survived into
 * whoever signed in next (queue item 10). The harm that justifies the reset is `bookFileSync`:
 * `blobSync.ts` documents it as an ACCOUNT choice, and left at "on" it starts uploading the next
 * account's books to the next account's cloud without that account ever opting in.
 *
 * WHERE it runs is the whole difficulty, and getting it wrong destroyed more than it protected — see
 * the last two tests.
 */
import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { db, INSTALL_ROW } from '@/db/db';
import { releasePreviousAccountData, wipeSyncedData } from './engine';
import { hydrateSettings } from './settingsBridge';
import { useBookFileSync, useBookUploadIssues } from '@/features/reader/blobSync';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { useReaderSettings } from '@/features/reader/settings';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.settings.clear(), db.pending.clear(), db.activity.clear(), db.reviewLog.clear()]);
  await db.syncState.put({ account: INSTALL_ROW, installId: 'install-THIS' });
});

test('an account-wide choice does not follow the user into the next account', async () => {
  useBookFileSync.setState({ enabled: true });
  localStorage.setItem('oxford-sync-book-files', '1');
  useBookUploadIssues.setState({ issues: { bk1: 'too-large' } });

  await releasePreviousAccountData();

  expect(useBookFileSync.getState().enabled).toBe(false);
  // The store reads localStorage on first run, so leaving the raw value behind would restore "on" at the
  // next reload even though the store says off.
  expect(localStorage.getItem('oxford-sync-book-files')).toBe('0');
  expect(useBookUploadIssues.getState().issues).toEqual({});
});

test('the learner level goes with the account, not the device it was used on', async () => {
  useLearner.setState({ level: 'B1', recommendedUnitId: 'u17', placementDone: true });

  await releasePreviousAccountData();

  expect(useLearner.getState()).toMatchObject({ level: null, recommendedUnitId: null, placementDone: false });
  expect(localStorage.getItem('oxford-learner')).toBe(
    JSON.stringify({ level: null, recommendedUnitId: null, placementDone: false }),
  );
});

test('device preferences are left alone', async () => {
  useUiLang.setState({ lang: 'en' });
  localStorage.setItem('oxford-ui-lang', 'en');
  useReaderSettings.setState({ fontStep: 2 });

  await releasePreviousAccountData();

  // Flipping someone's UI language or reader font because they signed out would be hostile, and neither
  // says anything about whose account it is.
  expect(useUiLang.getState().lang).toBe('en');
  expect(localStorage.getItem('oxford-ui-lang')).toBe('en');
  expect(useReaderSettings.getState().fontStep).toBe(2);
});

test('resetting does not stamp the account being left', async () => {
  useBookFileSync.setState({ enabled: true });
  useLearner.setState({ level: 'B1', recommendedUnitId: 'u17', placementDone: true });

  await releasePreviousAccountData();
  await flush(); // stampSetting is fire-and-forget, so a wrong reset shows up a tick late

  // `setEnabled` and the learner setters stamp, which enqueues a push. Reusing them here would carry the
  // reset to the OTHER devices of the account the user just left.
  expect(await db.settings.count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
});

/**
 * The reset must NOT hang off `wipeSyncedData`, which also runs on an ordinary logout — and the reason
 * it is unrecoverable there rather than merely untidy is the test below this one.
 */
test('a plain logout leaves account settings alone', async () => {
  useLearner.setState({ level: 'B1', recommendedUnitId: 'u17', placementDone: true });
  useBookFileSync.setState({ enabled: true });

  await wipeSyncedData();

  expect(useLearner.getState().level).toBe('B1');
  expect(useBookFileSync.getState().enabled).toBe(true);
});

test('because a later sync could not put it back: hydrate skips what this install wrote', async () => {
  useLearner.setState({ level: null, recommendedUnitId: null, placementDone: false });
  await db.settings.put({
    key: 'learner',
    value: { level: 'B1', recommendedUnitId: 'u17', placementDone: true },
    updatedAt: 10,
    updatedBy: 'install-THIS',
  });

  await hydrateSettings();

  // Not a bug in hydrate: a row this install wrote IS normally already reflected in its store. The wipe
  // preserves the install id and the reset deliberately does not stamp, so on the single-device path —
  // set a level, sign out, sign back into the SAME account — the row returns to Dexie, hydrate skips it,
  // and the level is gone for good. That is why the reset belongs on the account boundary and nowhere
  // else.
  expect(useLearner.getState().level).toBeNull();
});
