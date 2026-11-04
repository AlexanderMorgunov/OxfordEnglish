import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';

const mocks = vi.hoisted(() => ({ parse: vi.fn(), save: vi.fn(), remove: vi.fn(), upload: vi.fn() }));
vi.mock('./storage', () => ({ opfsAvailable: () => true, saveBookFile: mocks.save, deleteBookFile: mocks.remove }));
vi.mock('./parse', () => ({ detectFormat: () => 'fb2', parseBook: mocks.parse }));
vi.mock('./blobSync', () => ({ uploadBookFile: mocks.upload }));
const { importBook, listBooks } = await import('./service');
const parsed = { title: 'Cancelled story', chapters: [{ id: 'one', text: 'Hello.' }] };

beforeEach(async () => {
  vi.clearAllMocks();
  await db.open();
  await Promise.all([db.books.clear(), db.pending.clear(), db.catalogCache.clear()]);
  mocks.parse.mockResolvedValue(parsed); mocks.save.mockResolvedValue(undefined); mocks.remove.mockResolvedValue(undefined);
});

test.each(['cancel', 'handover'])('a late parse after %s cannot create a book', async kind => {
  let finish = (_value: typeof parsed) => {};
  mocks.parse.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const controller = new AbortController();
  const importing = importBook(new File(['x'], 'story.fb2'), { signal: controller.signal });
  if (kind === 'cancel') controller.abort(); else invalidateDataScope();
  finish(parsed);
  await expect(importing).rejects.toMatchObject({ name: 'AbortError' });
  expect(await db.books.count()).toBe(0);
  expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
});

test('cancelling during file storage removes orphan bytes and never announces commit', async () => {
  const controller = new AbortController();
  mocks.save.mockImplementation(async () => controller.abort());
  const commit = vi.fn();
  await expect(importBook(new File(['x'], 'story.fb2'), { signal: controller.signal, onCommit: commit })).rejects.toMatchObject({ name: 'AbortError' });
  expect(mocks.remove).toHaveBeenCalledOnce(); expect(commit).not.toHaveBeenCalled();
  expect(await db.books.count()).toBe(0);
});

test('a database read failure is an error, not an empty library', async () => {
  const spy = vi.spyOn(db.books, 'toArray').mockRejectedValueOnce(new Error('storage denied'));
  await expect(listBooks()).rejects.toThrow('storage denied'); spy.mockRestore();
});
