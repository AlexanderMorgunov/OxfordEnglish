import 'fake-indexeddb/auto';
import { db } from '@/db/db';
import type { BookRecord } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { getInstallId } from './meta';
import { patchBook } from './local';

const auth = vi.hoisted(() => ({ enabled: true }));
vi.mock('@/features/account/config', () => ({
  accountsEnabled: () => true,
  API_BASE: 'https://api.test',
}));
vi.mock('@/features/account/store', () => ({
  useAccount: {
    getState: () => ({ status: auth.enabled ? 'authenticated' : 'anonymous' }),
  },
}));
vi.mock('./run', () => ({ nudgeSync: vi.fn() }));
vi.mock('./meta', () => ({ getInstallId: vi.fn(async () => 'progress-test') }));
const original: BookRecord = {
  id: 'book',
  title: 'Original',
  format: 'epub',
  addedAt: 1,
  chapterCount: 5,
  lastChapter: 0,
  updatedAt: 10,
  updatedBy: 'original',
};
beforeEach(async () => {
  auth.enabled = true;
  invalidateDataScope();
  await db.open();
  await Promise.all([db.books.clear(), db.pending.clear()]);
  await db.books.put(original);
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

test('progress cannot recreate the previous owner’s book after deferred install identity', async () => {
  let finish!: (id: string) => void;
  vi.mocked(getInstallId).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const saving = patchBook(original.id, { lastChapter: 3 });
  const rejected = expect(saving).rejects.toThrow('Data owner changed');
  await vi.waitFor(() => expect(getInstallId).toHaveBeenCalledOnce());
  invalidateDataScope();
  const nextOwner = {
    ...original,
    title: 'Next owner',
    lastChapter: 1,
    updatedAt: 20,
  };
  await db.books.put(nextOwner);
  finish('old-install');
  await rejected;
  expect(await db.books.get(original.id)).toEqual(nextOwner);
  expect(await db.pending.count()).toBe(0);
});

test('a scope change while reading the fresh row cannot write progress', async () => {
  const read = db.books.get.bind(db.books);
  vi.spyOn(db.books, 'get').mockImplementationOnce((key) =>
    read(key).then((found) => {
      invalidateDataScope();
      return found;
    })
  );
  await expect(patchBook(original.id, { lastChapter: 3 })).rejects.toThrow(
    'Data owner changed'
  );
  expect(await db.books.get(original.id)).toEqual(original);
  expect(await db.pending.count()).toBe(0);
});

test('handover inside a progress transaction rolls the book and pending entry back', async () => {
  const invalidate = () => {
    invalidateDataScope();
  };
  db.books.hook('updating', invalidate);
  try {
    await expect(patchBook(original.id, { lastChapter: 3 })).rejects.toThrow(
      'Data owner changed'
    );
  } finally {
    db.books.hook('updating').unsubscribe(invalidate);
  }
  expect(await db.books.get(original.id)).toEqual(original);
  expect(await db.pending.count()).toBe(0);
});

test('a queue failure cannot commit progress after reporting failure', async () => {
  vi.spyOn(db.pending, 'put').mockRejectedValueOnce(
    new Error('queue unavailable')
  );
  await expect(patchBook(original.id, { lastChapter: 3 })).rejects.toThrow(
    'queue unavailable'
  );
  expect(await db.books.get(original.id)).toEqual(original);
});

test('concurrent patches read the latest row and preserve each other’s fields', async () => {
  await Promise.all([
    patchBook(original.id, { lastChapter: 3 }),
    patchBook(original.id, { title: 'New title' }),
  ]);
  expect(await db.books.get(original.id)).toMatchObject({
    title: 'New title',
    lastChapter: 3,
  });
  expect(await db.pending.count()).toBe(1);
});

test('ordinary logout preserves a pending same-owner progress change', async () => {
  let finish!: (id: string) => void;
  vi.mocked(getInstallId).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const saving = patchBook(original.id, { lastChapter: 3 });
  auth.enabled = false;
  finish('same-install');
  await saving;
  expect(await db.books.get(original.id)).toMatchObject({
    title: 'Original',
    lastChapter: 3,
  });
  expect(await db.pending.count()).toBe(0);
});

test('a book deleted while install identity resolves stays tombstoned', async () => {
  let finish!: (id: string) => void;
  vi.mocked(getInstallId).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    })
  );
  const saving = patchBook(original.id, { lastChapter: 3 });
  const deleted = { ...original, deletedAt: 30 };
  await db.books.put(deleted);
  finish('same-install');
  await saving;
  expect(await db.books.get(original.id)).toEqual(deleted);
  expect(await db.pending.count()).toBe(0);
});
