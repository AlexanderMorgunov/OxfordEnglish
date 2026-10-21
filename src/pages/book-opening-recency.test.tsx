import 'fake-indexeddb/auto';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import type { ParsedBook } from '@/features/reader/parse';
import type * as ReaderService from '@/features/reader/service';
import { invalidateDataScope } from '@/features/account/dataScope';
import { BookReaderPage } from './BookReaderPage';

const mocks = vi.hoisted(() => ({ openBook: vi.fn() }));
vi.mock('@/features/reader/service', async (original) => ({
  ...await original<typeof ReaderService>(),
  openBook: mocks.openBook,
}));
vi.mock('@/features/reader/storage', () => ({ opfsAvailable: () => true }));
vi.mock('@/features/reader/BookView', () => ({ BookView: () => <p>Book text ready</p> }));

const parsed: ParsedBook = { title: 'Sample', chapters: [{ id: 'chapter', text: 'Sample text.' }] };

beforeEach(async () => {
  mocks.openBook.mockReset();
  await db.open();
  await Promise.all([db.books.clear(), db.settings.clear(), db.pending.clear()]);
  await db.books.put({ id: 'sample', title: 'Sample', format: 'epub', addedAt: 1, chapterCount: 3, lastChapter: 2 });
});

function reader() {
  return render(<MemoryRouter initialEntries={['/library/sample']}><Routes><Route path="/library/:bookId" element={<BookReaderPage />} /></Routes></MemoryRouter>);
}

test('a successfully displayed book records opening without changing progress', async () => {
  mocks.openBook.mockResolvedValue(parsed);
  const original = await db.books.get('sample');
  reader();
  expect(await screen.findByText('Book text ready')).toBeInTheDocument();
  await waitFor(async () => expect(await db.settings.get('book-open:sample')).toBeDefined());
  expect(await db.books.get('sample')).toEqual(original);
});

test('a failed opening never records recent activity', async () => {
  mocks.openBook.mockRejectedValue(new Error('Unreadable'));
  reader();
  expect(await screen.findByRole('heading', { name: 'The book file is unreadable' })).toBeInTheDocument();
  expect(await db.settings.get('book-open:sample')).toBeUndefined();
});

test.each(['unmount', 'owner change'])('a late parse after %s never records an opening', async (reason) => {
  let complete!: (book: ParsedBook) => void;
  mocks.openBook.mockImplementation(() => new Promise<ParsedBook>((resolve) => { complete = resolve; }));
  const view = reader();
  await waitFor(() => expect(mocks.openBook).toHaveBeenCalledOnce());
  if (reason === 'unmount') view.unmount();
  else await act(async () => { await db.books.clear(); invalidateDataScope(); });
  await act(async () => { complete(parsed); await Promise.resolve(); });
  expect(await db.settings.get('book-open:sample')).toBeUndefined();
  expect(screen.queryByText('Book text ready')).not.toBeInTheDocument();
});

test('completed private book state is discarded when the data owner changes', async () => {
  mocks.openBook.mockResolvedValue(parsed);
  reader();
  expect(await screen.findByText('Book text ready')).toBeInTheDocument();
  await act(async () => { await db.books.clear(); invalidateDataScope(); });
  expect(screen.queryByText('Book text ready')).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { name: 'Book not found' })).toBeInTheDocument();
});
