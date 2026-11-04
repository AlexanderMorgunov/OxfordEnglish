import 'fake-indexeddb/auto';
import { afterEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import {
  flushPending,
  loadActivity,
  stashPending,
  statsSince,
} from '@/features/stats/activity';
import { checkpointHistory, loadAttempts, vocabSize } from './queries';

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem('oxford-stats-pending');
});

test('strict progress queries expose failures while legacy callers retain their fallback', async () => {
  vi.spyOn(db.attempts, 'toArray').mockRejectedValue(
    new Error('attempts unavailable')
  );
  vi.spyOn(db.wordStatus, 'toArray').mockRejectedValue(
    new Error('vocabulary unavailable')
  );
  vi.spyOn(db.checkpoints, 'orderBy').mockImplementation(() => {
    throw new Error('checkpoints unavailable');
  });
  expect(await loadAttempts()).toEqual([]);
  expect(await vocabSize()).toBe(0);
  expect(await checkpointHistory()).toEqual([]);
  await expect(loadAttempts({ strict: true })).rejects.toThrow(
    'attempts unavailable'
  );
  await expect(vocabSize({ strict: true })).rejects.toThrow(
    'vocabulary unavailable'
  );
  await expect(checkpointHistory({ strict: true })).rejects.toThrow(
    'checkpoints unavailable'
  );
});

test('reading and its first date distinguish unavailable storage from an empty history', async () => {
  vi.spyOn(db.activity, 'where').mockImplementation(() => {
    throw new Error('reading unavailable');
  });
  vi.spyOn(db.activity, 'orderBy').mockImplementation(() => {
    throw new Error('date unavailable');
  });
  expect(await loadActivity('2026-10-01')).toEqual({ rows: [], reviews: [] });
  expect(await statsSince()).toBeNull();
  await expect(loadActivity('2026-10-01', { strict: true })).rejects.toThrow(
    'reading unavailable'
  );
  await expect(statsSince({ strict: true })).rejects.toThrow(
    'date unavailable'
  );
});

test('pending reading ticks stop at account handover instead of crediting the new owner', async () => {
  const get = db.activity.get.bind(db.activity);
  const read = vi.spyOn(db.activity, 'get').mockImplementationOnce(() => {
    invalidateDataScope();
    return get('missing');
  });
  const write = vi.spyOn(db.activity, 'put');
  stashPending({ ts: Date.now(), sec: 10, words: 2 });
  stashPending({ ts: Date.now(), sec: 20, words: 3 });
  await flushPending();
  expect(read).toHaveBeenCalledTimes(1);
  expect(write).not.toHaveBeenCalled();
});
