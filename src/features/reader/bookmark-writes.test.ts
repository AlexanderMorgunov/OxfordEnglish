import 'fake-indexeddb/auto';
import { db } from '@/db/db';
import type { Bookmark } from '@/db/db';
import {
  captureDataScope,
  invalidateDataScope,
} from '@/features/account/dataScope';
import {
  addBookmark,
  listBookmarks,
  removeBookmark,
  toggleBookmark,
} from './bookmarks';
import { softDeleteBookmark } from '@/features/sync/local';
import { isDeleted } from '@/features/sync/resolve';
import { getInstallId } from '@/features/sync/meta';

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
vi.mock('@/features/sync/run', () => ({ nudgeSync: vi.fn() }));
vi.mock('@/features/sync/meta', () => ({
  getInstallId: vi.fn(async () => 'bookmark-test'),
}));
const spot = {
  bookKey: 'reader.catalog.test',
  page: 0,
  pageId: 'first',
  paragraph: 1,
  sentence: 0,
  snippet: 'The river bank.',
};
const row: Bookmark = {
  ...spot,
  id: 'existing',
  createdAt: 1,
  updatedAt: 10,
  updatedBy: 'other',
};
beforeEach(async () => {
  auth.enabled = true;
  invalidateDataScope();
  await db.open();
  await Promise.all([db.bookmarks.clear(), db.pending.clear()]);
  vi.clearAllMocks();
});
afterEach(() => vi.restoreAllMocks());

test('concurrent adds at the same exact spot return one durable identity and one dirty row', async () => {
  const added = await Promise.all(
    Array.from({ length: 8 }, () => addBookmark(spot))
  );
  expect(new Set(added.map((bookmark) => bookmark.id)).size).toBe(1);
  expect(await db.bookmarks.count()).toBe(1);
  expect(await db.pending.count()).toBe(1);
});

test('concurrent toggles serialize the exact spot and retain a synced tombstone', async () => {
  const results = await Promise.all([
    toggleBookmark(spot),
    toggleBookmark(spot),
  ]);
  expect(results.map((result) => result.added).sort()).toEqual([false, true]);
  expect(await listBookmarks(spot.bookKey, { strict: true })).toEqual([]);
  expect(await db.bookmarks.count()).toBe(1);
  expect(isDeleted((await db.bookmarks.toArray())[0]!)).toBe(true);
  expect(await db.pending.count()).toBe(1);
});

test.each(['add', 'toggle', 'delete'] as const)(
  '%s refuses an owner switch while install identity is pending',
  async (operation) => {
    await db.bookmarks.put(row);
    let finish!: (id: string) => void;
    vi.mocked(getInstallId).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const current = captureDataScope();
    const pending =
      operation === 'add'
        ? addBookmark({ ...spot, sentence: 2 }, current)
        : operation === 'toggle'
          ? toggleBookmark(spot, current)
          : softDeleteBookmark(row.id, current);
    const rejected = expect(pending).rejects.toThrow('Data owner changed');
    invalidateDataScope();
    finish('old-install');
    await rejected;
    expect(await db.bookmarks.toArray()).toEqual([row]);
    expect(await db.pending.count()).toBe(0);
  }
);

test('a dirty queue failure rolls the bookmark back instead of reporting a failed saved row', async () => {
  vi.spyOn(db.pending, 'put').mockRejectedValueOnce(
    new Error('queue unavailable')
  );
  await expect(addBookmark(spot)).rejects.toThrow('queue unavailable');
  expect(await db.bookmarks.count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
});

test('a scope change inside the write transaction rolls both bookmark and dirty entry back', async () => {
  const invalidate = () => {
    invalidateDataScope();
  };
  db.bookmarks.hook('creating', invalidate);
  try {
    await expect(addBookmark(spot)).rejects.toThrow('Data owner changed');
  } finally {
    db.bookmarks.hook('creating').unsubscribe(invalidate);
  }
  expect(await db.bookmarks.count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
});

test('delete wins future-dated edits while leaving the original updatedAt intact', async () => {
  const future = { ...row, updatedAt: Date.now() + 100000 };
  await db.bookmarks.put(future);
  await softDeleteBookmark(row.id);
  const deleted = (await db.bookmarks.get(row.id))!;
  expect(deleted.updatedAt).toBe(future.updatedAt);
  expect(isDeleted(deleted)).toBe(true);
  expect(await db.pending.count()).toBe(1);
});

test('anonymous removal also refuses a stale data scope', async () => {
  auth.enabled = false;
  await db.bookmarks.put(row);
  const current = captureDataScope();
  invalidateDataScope();
  await expect(removeBookmark(row.id, current)).rejects.toThrow(
    'Data owner changed'
  );
  expect(await db.bookmarks.get(row.id)).toEqual(row);
  await removeBookmark(row.id);
  expect(await db.bookmarks.get(row.id)).toBeUndefined();
  expect(await db.pending.count()).toBe(0);
});

test('strict bookmark reads distinguish a failed read from a genuinely empty list', async () => {
  vi.spyOn(db.bookmarks, 'where').mockImplementationOnce(() => {
    throw new Error('read unavailable');
  });
  await expect(listBookmarks(spot.bookKey, { strict: true })).rejects.toThrow(
    'read unavailable'
  );
  expect(await listBookmarks(spot.bookKey, { strict: true })).toEqual([]);
});
