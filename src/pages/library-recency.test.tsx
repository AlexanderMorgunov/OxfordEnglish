import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { applyEntry } from '@/features/sync/engine';
import { LibraryPage } from './LibraryPage';

vi.mock('@/features/reader/storage', () => ({ opfsAvailable: () => false }));
vi.mock('@/features/reader/RecommendedShelf', () => ({ RecommendedShelf: () => <h2>Recommended reading</h2> }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/stats/useReadingTracker', () => ({ readProgress: () => null }));

beforeEach(async () => {
  await db.open();
  await Promise.all([db.books.clear(), db.settings.clear(), db.pending.clear()]);
  await db.books.bulkPut(['older', 'newer'].map((id, i) => ({ id, title: id, format: 'epub', addedAt: i + 1, chapterCount: 2, lastChapter: 0 })));
});

const order = () => screen.getAllByRole('link').map((link) => link.textContent).filter((text) => /older|newer/.test(text ?? ''));

test('personal books precede recommendations and react to incoming recency without remounting', async () => {
  render(<LibraryPage />, { wrapper: MemoryRouter });
  await screen.findByRole('link', { name: /older/ });
  expect(order()).toEqual(['newerepub · 2 ch.', 'olderepub · 2 ch.']);
  expect(screen.getByRole('heading', { name: 'My books' }).compareDocumentPosition(screen.getByRole('heading', { name: 'Recommended reading' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await applyEntry({ seq: 1, store: 'settings', id: 'book-open:older', updatedAt: 100, updatedBy: 'remote', payload: { key: 'book-open:older', value: { openedAt: 100 }, updatedAt: 100, updatedBy: 'remote' } });
  await waitFor(() => expect(order()).toEqual(['olderepub · 2 ch.', 'newerepub · 2 ch.']));
});
