import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import Dexie from 'dexie';
import { invalidateDataScope } from '@/features/account/dataScope';
const run = vi.hoisted(() => vi.fn());
vi.mock('./route', () => ({ runTask: run, aiPathLabel: () => 'managed' }));
const { aiTranslate } = await import('./functions');

beforeEach(async () => { vi.restoreAllMocks(); run.mockReset(); await db.open(); await db.translations.clear(); });

test('ownership change during cache lookup cannot send previous-reader text under the new account', async () => {
  let resolve!: () => void;
  vi.spyOn(db.translations, 'get').mockImplementationOnce(() => new Dexie.Promise<undefined>((done) => { resolve = () => done(undefined); }));
  const request = aiTranslate(null, 'sneaking suspicion', { sentence: 'I had a sneaking suspicion.' });
  invalidateDataScope();
  resolve();
  await expect(request).rejects.toThrow('Data owner changed');
  expect(run).not.toHaveBeenCalled();
});
