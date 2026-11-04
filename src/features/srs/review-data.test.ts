import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { Dexie } from 'dexie';
import { db } from '@/db/db';
import type { SrsCard } from '@/db/db';
import {
  captureDataScope,
  invalidateDataScope,
} from '@/features/account/dataScope';
import { isDeleted } from '@/features/sync/resolve';
import { readReviewData, removeLegacyCards } from './review-data';
import { editCardAnswer } from '@/features/vocab/manage';
import {
  sessionCards,
  startReviewSession,
  useReviewSession,
} from './review-session';

const card = (id: string, overrides: Partial<SrsCard> = {}): SrsCard => {
  const schedule = createEmptyCard(new Date(0));
  return {
    id,
    kind: 'word',
    front: id,
    back: 'ответ',
    card: schedule,
    due: schedule.due,
    tags: [],
    creationId: id,
    ...overrides,
  };
};
beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.srsCards.clear(),
    db.wordStatus.clear(),
    db.pending.clear(),
  ]);
  useReviewSession.setState({ session: null });
});
afterEach(() => vi.restoreAllMocks());
test('strict reads distinguish unavailable storage from an empty queue', async () => {
  vi.spyOn(db.srsCards, 'toArray').mockRejectedValueOnce(
    new Error('read unavailable')
  );
  await expect(readReviewData()).rejects.toThrow('read unavailable');
  expect((await readReviewData()).due).toEqual([]);
});
test('counts agree with live due cards and expose a future review separately', async () => {
  await db.srsCards.bulkPut([
    card('a'),
    card('hidden'),
    card('deleted', { deletedAt: 2, updatedAt: 1 }),
    card('later', { due: new Date(Date.now() + 86400000) }),
    card('err', { fromError: true }),
  ]);
  await db.wordStatus.put({
    word: 'hidden',
    status: 'ignored',
    firstSeenAt: 1,
    encounters: 1,
  });
  const data = await readReviewData();
  expect(data.due.map((row) => row.id)).toEqual(['a', 'err']);
  expect(data.errors).toBe(1);
  expect(data.nextDue).not.toBeNull();
});
test('bulk removal is legacy-only, soft, and atomic when a later write fails', async () => {
  await db.srsCards.bulkPut([
    card('err1', { fromError: true }),
    card('err2', { fromError: true }),
    card('word'),
  ]);
  const before = await db.srsCards.toArray(),
    original = db.srsCards.put.bind(db.srsCards);
  vi.spyOn(db.srsCards, 'put').mockImplementation((row) =>
    row.id === 'err2' ? Dexie.Promise.reject(new Error('full')) : original(row)
  );
  await expect(removeLegacyCards(['err1', 'word', 'err2'])).rejects.toThrow(
    'full'
  );
  expect(await db.srsCards.toArray()).toEqual(before);
  vi.restoreAllMocks();
  expect(await removeLegacyCards(['err1', 'word', 'err2'])).toEqual([
    'err1',
    'err2',
  ]);
  expect(isDeleted((await db.srsCards.get('word'))!)).toBe(false);
});
test('stale owners cannot remove cards or keep a previous session', async () => {
  const row = card('err', { fromError: true });
  await db.srsCards.put(row);
  startReviewSession([row]);
  const current = captureDataScope();
  invalidateDataScope();
  expect(useReviewSession.getState().session).toBeNull();
  await expect(removeLegacyCards(['err'], current)).rejects.toThrow(
    'Data owner changed'
  );
  expect(await db.srsCards.get('err')).toEqual(row);
});
test('fixed membership excludes new cards and same-id recreated cards without changing order', () => {
  const one = card('one'),
    two = card('two');
  startReviewSession([one, two]);
  const session = useReviewSession.getState().session!;
  expect(
    sessionCards(session, [two, card('new'), one]).map((row) => row.id)
  ).toEqual(['one', 'two']);
  expect(
    sessionCards(session, [{ ...one, creationId: 'another' }, two]).map(
      (row) => row.id
    )
  ).toEqual(['two']);
});

test('an old editor cannot overwrite a recreated same-id card with identical text', async () => {
  const source = card('word:journey');
  await db.srsCards.put({ ...source, creationId: 'new-incarnation' });
  expect(await editCardAnswer(source, 'старый ответ', '')).toBe(false);
  expect((await db.srsCards.get(source.id))?.back).toBe('ответ');
});
