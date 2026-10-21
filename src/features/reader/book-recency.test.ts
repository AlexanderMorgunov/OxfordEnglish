import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { db } from '@/db/db';
import type { BookRecord } from '@/db/db';
import { listBooks } from './service';
import { markBookOpened } from './book-recency';
import { captureDataScope, invalidateDataScope } from '@/features/account/dataScope';
import { applyEntry } from '@/features/sync/engine';

const book = (id: string, addedAt: number): BookRecord => ({
  id, title: id, format: 'epub', addedAt, chapterCount: 5, lastChapter: 2,
  updatedAt: addedAt, updatedBy: 'test-device',
});

beforeEach(async () => {
  await db.open();
  await Promise.all([db.books.clear(), db.settings.clear(), db.pending.clear()]);
});

test('last successful opening takes precedence over import time without changing progress', async () => {
  await db.books.bulkPut([book('older', 1), book('newer', 2), book('unopened', 3)]);
  await db.settings.bulkPut([
    { key: 'book-open:older', value: { openedAt: 200 }, updatedAt: 200, updatedBy: 'a' },
    { key: 'book-open:newer', value: { openedAt: 100 }, updatedAt: 100, updatedBy: 'b' },
  ]);
  const records = await db.books.toArray();
  expect((await listBooks()).map((b) => b.id)).toEqual(['older', 'newer', 'unopened']);
  expect(await db.books.toArray()).toEqual(records);
});

test('legacy and malformed timestamps retain deterministic import fallback and hide tombstones', async () => {
  await db.books.bulkPut([book('b', 3), book('a', 3), { ...book('gone', 5), deletedAt: 6 }]);
  await db.settings.bulkPut([
    { key: 'book-open:a', value: { openedAt: 'bad' } },
    { key: 'book-open:b', value: null },
  ]);
  expect((await listBooks()).map((b) => b.id)).toEqual(['a', 'b']);
});

test('recording an opening does not modify book progress, metadata or deletion state', async () => {
  await db.books.put(book('a', 3));
  const original = await db.books.get('a');
  expect(await markBookOpened('a', 100)).toBe(true);
  expect(await db.books.get('a')).toEqual(original);
  expect((await db.settings.get('book-open:a'))?.value).toEqual({ openedAt: 100 });
  await db.books.update('a', { deletedAt: 4 });
  expect(await markBookOpened('a', 200)).toBe(false);
  expect((await db.settings.get('book-open:a'))?.value).toEqual({ openedAt: 100 });
});

test('a deleted opening does not count as recent activity', async () => {
  await db.books.bulkPut([book('older', 1), book('newer', 2)]);
  await db.settings.put({ key: 'book-open:older', value: { openedAt: 100 }, updatedAt: 100, deletedAt: 101 });
  expect((await listBooks()).map((b) => b.id)).toEqual(['newer', 'older']);
});

test('stale requests cannot create recency under a new owner', async () => {
  const current = captureDataScope();
  invalidateDataScope();
  await db.books.put(book('a', 1));
  expect(await markBookOpened('a', 100, current)).toBe(false);
  expect(await db.settings.count()).toBe(0);
});

test('an incoming recency and concurrent opening preserve the most recent event', async () => {
  await db.books.put(book('a', 1));
  await Promise.all([
    markBookOpened('a', 200),
    applyEntry({ seq: 1, store: 'settings', id: 'book-open:a', updatedAt: 100, updatedBy: 'remote', payload: { key: 'book-open:a', value: { openedAt: 100 }, updatedAt: 100, updatedBy: 'remote' } }),
  ]);
  expect((await db.settings.get('book-open:a'))?.value).toEqual({ openedAt: 200 });
});
