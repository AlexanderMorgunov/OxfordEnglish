import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, State } from 'ts-fsrs';
import type { Grade } from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { summarize } from '@/features/stats/accounting';
import * as accountConfig from '@/features/account/config';
import { useAccount } from '@/features/account/store';
import { resolveSrsCard, type Synced } from '@/features/sync/resolve';
import { pushOnce, rowFromEntry, toEnvelope } from '@/features/sync/engine';
import type { SyncedRow, SyncTransport } from '@/features/sync/engine';
import type { SyncPushResponse } from '@/features/account/contract';
import { resolveServer, type Change } from '../../../server/src/sync';
import {
  gradeCardWithReceipt, Rating, replaceReviewRating, reviewCorrectionCard,
} from './service';
import type { ReviewReceipt } from './service';

vi.mock('@/features/sync/run', () => ({ nudgeSync: vi.fn(), triggerSync: vi.fn() }));

const NOW = new Date('2026-10-10T12:00:00Z');
const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));
const original = (over: Partial<SrsCard> = {}): SrsCard => {
  const card = createEmptyCard(new Date(0));
  return { id: 'word:go', front: 'go', back: 'идти', kind: 'word', tags: [],
    card, due: card.due, createdAt: 1, creationId: 'incarnation-a', ...over };
};
const receipt = async (rating: Grade = Rating.Easy): Promise<ReviewReceipt> => {
  const row = original();
  await db.srsCards.put(row);
  const result = await gradeCardWithReceipt(row.id, rating, 0, row);
  if (!result) throw new Error('Missing receipt');
  return result;
};

beforeEach(async () => {
  await db.open();
  await Promise.all([db.srsCards.clear(), db.wordStatus.clear(), db.reviewLog.clear(), db.pending.clear(), db.activity.clear()]);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); invalidateDataScope(); });

test('replacement schedules from the original accepted card and counts one corrected review', async () => {
  const rated = await receipt();
  const beforeActivity = await db.activity.toArray();
  const expected = scheduler.next(rated.before.card, new Date(rated.review.ts), Rating.Again).card;
  vi.setSystemTime(new Date(NOW.getTime() + 90_000));
  const corrected = await replaceReviewRating(rated, Rating.Again, rated.after);
  expect(corrected?.after.card).toEqual(expected);
  expect(corrected?.after.due).toEqual(expected.due);
  expect(corrected?.after.card.reps).toBe(1);
  expect(corrected?.after.updatedAt).toBeGreaterThan(rated.after.updatedAt!);
  const log = await db.reviewLog.toArray();
  expect(log).toHaveLength(1);
  expect(log[0]).toMatchObject({ id: rated.review.id, ts: rated.review.ts, rating: Rating.Again });
  expect(log[0]?.modifiedAt).toBeGreaterThan(rated.review.modifiedAt!);
  expect(summarize([], log, 'week', NOW.getTime())).toMatchObject({ reviews: 1, recalled: 0 });
  expect(await db.activity.toArray()).toEqual(beforeActivity);
});

test.each([State.New, State.Learning, State.Relearning, State.Review])('receipt captures the full accepted schedule in state %s', async state => {
  const card = createEmptyCard(new Date(0));
  if (state !== State.New) Object.assign(card, {
    state, reps: 7, lapses: 2, stability: 5, difficulty: 6, scheduled_days: 4,
    learning_steps: 0, elapsed_days: 4, last_review: new Date('2026-10-01T12:00:00Z'),
  });
  const row = original({ card, due: card.due });
  await db.srsCards.put(row);
  const rated = await gradeCardWithReceipt(row.id, Rating.Easy);
  expect(rated?.before.card).toEqual(card);
  if (!rated) throw new Error('Missing receipt');
  const corrected = await replaceReviewRating(rated, Rating.Hard, rated.after);
  expect(corrected?.after.card).toEqual(scheduler.next(card, NOW, Rating.Hard).card);
  expect(corrected?.after.card.reps).toBe(card.reps + 1);
});

test('a same-rating replacement invalidates an identical-schedule receipt by event version', async () => {
  const rated = await receipt();
  const first = await replaceReviewRating(rated, Rating.Easy, rated.after);
  expect(first?.after.card).toEqual(rated.after.card);
  expect(first?.review.modifiedAt).toBeGreaterThan(rated.review.modifiedAt!);
  expect(await replaceReviewRating(rated, Rating.Again, rated.after)).toBeNull();
  expect(await reviewCorrectionCard(rated)).toBeNull();
  if (!first) throw new Error('Missing correction');
  expect(await replaceReviewRating(first, Rating.Again, first.after)).not.toBeNull();
  expect(await db.reviewLog.count()).toBe(1);
  expect((await db.srsCards.get(rated.after.id))?.card.reps).toBe(1);
});

test('two concurrent corrections from one receipt commit once', async () => {
  const rated = await receipt();
  const results = await Promise.all([
    replaceReviewRating(rated, Rating.Easy, rated.after),
    replaceReviewRating(rated, Rating.Easy, rated.after),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(await db.reviewLog.count()).toBe(1);
});

test('opening correction does not write and a later real grade invalidates the receipt', async () => {
  const rated = await receipt(Rating.Again);
  const snapshot = await db.srsCards.get(rated.after.id);
  const history = await db.reviewLog.toArray();
  expect(await reviewCorrectionCard(rated)).toEqual(snapshot);
  expect(await db.srsCards.get(rated.after.id)).toEqual(snapshot);
  expect(await db.reviewLog.toArray()).toEqual(history);
  vi.setSystemTime(new Date(rated.after.due.getTime() + 1));
  expect(await gradeCardWithReceipt(rated.after.id, Rating.Good)).not.toBeNull();
  expect(await replaceReviewRating(rated, Rating.Easy, rated.after)).toBeNull();
  expect(await reviewCorrectionCard(rated)).toBeNull();
});

test.each(['deleted', 'recreated', 'ignored', 'missing event', 'changed event', 'owner'])('rejects a %s correction target', async cause => {
  const rated = await receipt();
  if (cause === 'deleted') await db.srsCards.update(rated.after.id, { deletedAt: rated.after.updatedAt });
  if (cause === 'recreated') await db.srsCards.put({ ...rated.after, creationId: 'incarnation-b' });
  if (cause === 'ignored') await db.wordStatus.put({ word: 'go', status: 'ignored', firstSeenAt: 1, encounters: 1 });
  if (cause === 'missing event') await db.reviewLog.delete(rated.review.id);
  if (cause === 'changed event') await db.reviewLog.update(rated.review.id, { rating: Rating.Hard });
  if (cause === 'owner') invalidateDataScope();
  const row = await db.srsCards.get(rated.after.id);
  const events = await db.reviewLog.toArray();
  expect(await replaceReviewRating(rated, Rating.Again, rated.after)).toBeNull();
  expect(await reviewCorrectionCard(rated)).toBeNull();
  expect(await db.srsCards.get(rated.after.id)).toEqual(row);
  expect(await db.reviewLog.toArray()).toEqual(events);
});

test('content repairs survive replacement while a stale shown answer cannot be rated', async () => {
  const rated = await receipt();
  await db.srsCards.update(rated.after.id, { back: 'двигаться', partOfSpeech: 'verb', tags: ['reader.vocab'] });
  expect(await replaceReviewRating(rated, Rating.Hard, rated.after)).toBeNull();
  const latest = await reviewCorrectionCard(rated);
  expect(latest?.back).toBe('двигаться');
  if (!latest) throw new Error('Missing fresh target');
  const corrected = await replaceReviewRating(rated, Rating.Hard, latest);
  expect(corrected?.after).toMatchObject({ back: 'двигаться', partOfSpeech: 'verb', tags: ['reader.vocab'] });
});

test('every nested schedule field participates in the correction guard', async () => {
  const rated = await receipt();
  await db.srsCards.put({ ...rated.after, card: { ...rated.after.card, difficulty: rated.after.card.difficulty + 1 } });
  expect(await replaceReviewRating(rated, Rating.Hard, rated.after)).toBeNull();
});

test.each(['storage', 'owner'])('initial grading rolls back card, event and pending writes on %s failure', async reason => {
  vi.spyOn(accountConfig, 'accountsEnabled').mockReturnValue(true);
  vi.spyOn(useAccount, 'getState').mockReturnValue({ ...useAccount.getState(), status: 'authenticated' });
  const row = original();
  await db.srsCards.put(row);
  const add = db.reviewLog.add.bind(db.reviewLog);
  vi.spyOn(db.reviewLog, 'add').mockImplementation((...args) => reason === 'storage'
    ? Dexie.Promise.reject(new Error('No storage'))
    : add(...args).then(key => { invalidateDataScope(); return key; }));
  await expect(gradeCardWithReceipt(row.id, Rating.Good)).rejects.toThrow();
  expect(await db.srsCards.get(row.id)).toEqual(row);
  expect(await db.reviewLog.count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
});

test.each(['storage', 'owner'])('replacement rolls back its card, event and pending writes on %s failure', async reason => {
  vi.spyOn(accountConfig, 'accountsEnabled').mockReturnValue(true);
  vi.spyOn(useAccount, 'getState').mockReturnValue({ ...useAccount.getState(), status: 'authenticated' });
  const rated = await receipt();
  await db.pending.clear();
  const put = db.reviewLog.put.bind(db.reviewLog);
  vi.spyOn(db.reviewLog, 'put').mockImplementation((...args) => reason === 'storage'
    ? Dexie.Promise.reject(new Error('No storage'))
    : put(...args).then(key => { invalidateDataScope(); return key; }));
  await expect(replaceReviewRating(rated, Rating.Again, rated.after)).rejects.toThrow();
  expect(await db.srsCards.get(rated.after.id)).toEqual(rated.after);
  expect(await db.reviewLog.get(rated.review.id)).toEqual(rated.review);
  expect(await db.pending.count()).toBe(0);
});

test('correction across midnight remains in the original review day', async () => {
  const rated = await receipt();
  vi.setSystemTime(new Date(NOW.getTime() + 86_400_000));
  await replaceReviewRating(rated, Rating.Again, rated.after);
  const log = await db.reviewLog.toArray();
  expect(log[0]?.ts).toBe(NOW.getTime());
  expect(summarize([], log, 'day', NOW.getTime())).toMatchObject({ reviews: 1, recalled: 0 });
  expect(summarize([], log, 'day', Date.now())).toMatchObject({ reviews: 0 });
});

test('old grade loses to corrected schedule through real wire adapters and both resolver orders', async () => {
  const rated = await receipt();
  const corrected = await replaceReviewRating(rated, Rating.Again, rated.after);
  if (!corrected) throw new Error('Missing correction');
  const a = rated.after as Synced<SrsCard>;
  const b = corrected.after as Synced<SrsCard>;
  const wire = (row: SrsCard): Change => JSON.parse(JSON.stringify(toEnvelope('srsCards', row as unknown as SyncedRow))) as Change;
  for (const [older, newer] of [[a, b], [b, a]]) {
    expect(resolveSrsCard(older!, newer!).card).toEqual(corrected.after.card);
    const merged = resolveServer(wire(older!), wire(newer!));
    const restored = rowFromEntry(JSON.parse(JSON.stringify({ ...merged, seq: 1 })));
    expect(restored.card).toEqual(corrected.after.card);
    expect(restored.due).toEqual(corrected.after.due);
  }
});

test('a failed or stale grade yields no receipt and cannot grade a recreated same-front card', async () => {
  const row = original();
  await db.srsCards.put({ ...row, creationId: 'incarnation-b' });
  expect(await gradeCardWithReceipt(row.id, Rating.Good, 0, row)).toBeNull();
  expect(await db.reviewLog.count()).toBe(0);
});

test('an in-flight acknowledgement of the old grade preserves correction and its dirty marker', async () => {
  vi.spyOn(accountConfig, 'accountsEnabled').mockReturnValue(true);
  vi.spyOn(useAccount, 'getState').mockReturnValue({ ...useAccount.getState(), status: 'authenticated' });
  const rated = await receipt();
  let respond!: (response: SyncPushResponse) => void;
  const response = new Promise<SyncPushResponse>(resolve => { respond = resolve; });
  const push = vi.fn((_body: Parameters<SyncTransport['push']>[0]) => response);
  const transport: SyncTransport = { push, pull: async () => ({ head: 1, entries: [] }) };
  const pendingPush = pushOnce(transport, 0);
  await vi.waitFor(() => expect(push).toHaveBeenCalledOnce());
  const corrected = await replaceReviewRating(rated, Rating.Again, rated.after);
  if (!corrected) throw new Error('Missing correction');
  respond({ head: 1, applied: [{ ...push.mock.calls[0]![0].changes[0]!, seq: 1 }] });
  await pendingPush;
  expect((await db.srsCards.get(rated.after.id))?.card).toEqual(corrected.after.card);
  expect(await db.pending.get(`srsCards:${rated.after.id}`)).toBeDefined();
});
