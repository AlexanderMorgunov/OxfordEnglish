/**
 * Book files are released wholesale when the device passes to a different account, so the marker naming
 * the previous tenant must stop standing for all of them the moment this device holds a file that is not
 * theirs. Importing while signed OUT is exactly that, and those bytes have no server copy at all.
 *
 * Without this, losing your recovery key and making a new account — the ordinary way `createAccount` is
 * reached on a device that already held one, by the same human — deleted every book imported in between.
 */
import 'fake-indexeddb/auto';
import { vi, test, expect, beforeEach } from 'vitest';

vi.mock('./storage', () => ({
  saveBookFile: vi.fn(async () => undefined),
  getBookFile: vi.fn(async () => new File([''], 'x')),
  deleteBookFile: vi.fn(async () => undefined),
  opfsAvailable: () => true,
}));
vi.mock('./parse', () => ({
  detectFormat: () => 'epub',
  parseBook: async () => ({ title: 'T', author: 'A', chapters: [{ title: 'c', blocks: [] }] }),
}));
vi.mock('./blobSync', () => ({
  uploadBookFile: vi.fn(async () => 'ok'),
  downloadBookFileIfMissing: vi.fn(async () => undefined),
  deleteRemoteBookFile: vi.fn(async () => undefined),
  useBookUploadIssues: { getState: () => ({ note: () => undefined, prune: () => undefined }) },
}));

import { db } from '@/db/db';
import { importBook } from './service';

const KEY = 'oxford-account';
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? '{}') as { fileOwner?: string };

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.books.clear(), db.pending.clear()]);
});

test('importing while signed out stops the previous tenant owning this device', async () => {
  localStorage.setItem(KEY, JSON.stringify({ accountId: '', deviceId: 'd1', refreshToken: '', fileOwner: 'acc-A' }));

  await importBook(new File(['x'], 'book.epub'));

  expect(stored().fileOwner).toBeUndefined();
});

test('importing while signed in leaves ownership alone', async () => {
  localStorage.setItem(KEY, JSON.stringify({ accountId: 'acc-A', deviceId: 'd1', refreshToken: 'r', fileOwner: 'acc-A' }));

  await importBook(new File(['x'], 'book.epub'));

  // The file belongs to the account that is signed in, which already owns the device.
  expect(stored().fileOwner).toBe('acc-A');
});
