import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { LibraryPage } from './LibraryPage';
import { ErrorBoundary } from '@/shared/ui/ErrorBoundary';

vi.mock('@/features/reader/service', () => ({ listBooks: async () => [{ id: 'sample', title: 'Retained book', format: 'fb2', addedAt: 1, chapterCount: 1 }], importBook: vi.fn(), removeBook: vi.fn() }));
vi.mock('@/features/reader/RecommendedShelf', () => ({ RecommendedShelf: () => null }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/stats/useReadingTracker', () => ({ readProgress: () => null }));

const original = Object.getOwnPropertyDescriptor(navigator, 'storage');
afterEach(() => {
  if (original) Object.defineProperty(navigator, 'storage', original);
  else Reflect.deleteProperty(navigator, 'storage');
});

test.each(['sync', 'async'])('durability %s failure leaves Library and retained books usable', async mode => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: {
    getDirectory: () => undefined,
    persisted: () => { if (mode === 'sync') throw new DOMException('denied', 'SecurityError'); return Promise.reject(new Error('denied')); },
  } });
  render(<MemoryRouter><ErrorBoundary resetKey="/library"><LibraryPage /></ErrorBoundary></MemoryRouter>);
  expect(await screen.findByRole('link', { name: /Retained book/ })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Could not open this page' })).not.toBeInTheDocument();
});
