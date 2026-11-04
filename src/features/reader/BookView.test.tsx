import 'fake-indexeddb/auto';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { installDialogMock } from '@/test/dialog';
import { BookView } from './BookView';
import type { ParsedBook } from './parse';

vi.mock('./ChapterStudy', () => ({
  ChapterStudy: () => <p>Chapter exercises fixture</p>,
}));
vi.mock('./ChapterVocabulary', () => ({
  ChapterVocabulary: () => <p>Chapter words fixture</p>,
}));
vi.mock('@/features/account/QuotaNotice', () => ({ QuotaNotice: () => null }));
const book: ParsedBook = {
  title: 'A real reading session',
  chapters: [
    {
      id: 'one',
      title: 'Chapter One',
      text: 'A quiet garden. It was a good day.',
    },
    { id: 'two', title: 'Chapter Two', text: 'Another chapter starts here.' },
  ],
};
const view = (props: Partial<Parameters<typeof BookView>[0]> = {}) =>
  render(
    <MemoryRouter>
      <BookView book={book} idPrefix="reader.integration" {...props} />
    </MemoryRouter>
  );
beforeEach(async () => {
  vi.restoreAllMocks();
  installDialogMock();
  invalidateDataScope();
  localStorage.clear();
  await db.open();
  await db.bookmarks.clear();
});

test('empty books have an actionable state instead of dereferencing a missing chapter', () => {
  view({ book: { title: 'Empty', chapters: [] } });
  expect(
    screen.getByRole('heading', { name: 'This book has no text' })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Back to library' })).toHaveAttribute(
    'href',
    '/library'
  );
});
test('non-finite chapter positions cannot produce a broken selection or remote offer', () => {
  view({ initialChapter: Number.NaN, remoteChapter: Number.POSITIVE_INFINITY });
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Chapter One'
  );
  expect(screen.queryByText(/further along on another device/)).toBeNull();
});
test('choosing the current chapter closes contents without writing it again', async () => {
  const onChapter = vi.fn();
  view({ onChapter });
  await userEvent.click(
    within(screen.getByRole('banner')).getByRole('button', {
      name: 'Contents',
    })
  );
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', {
      name: /Chapter One/,
    })
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(onChapter).not.toHaveBeenCalled();
});
test('failed chapter persistence keeps reading usable and retries the actual selected chapter', async () => {
  const onChapter = vi
    .fn()
    .mockRejectedValueOnce(new Error('Full'))
    .mockResolvedValue(undefined);
  view({ onChapter });
  await userEvent.click(
    within(
      screen.getByRole('navigation', { name: 'Chapter navigation' })
    ).getByRole('button', { name: 'Next chapter' })
  );
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Chapter Two'
  );
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('could not be saved');
  await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(onChapter.mock.calls.map((args) => args[0])).toEqual([1, 1]);
});
test('bookmark read errors remain unknown and can be retried in the list dialog', async () => {
  const read = vi.spyOn(db.bookmarks, 'where').mockImplementationOnce(() => {
    throw new Error('Read failed');
  });
  view();
  await userEvent.click(
    within(screen.getByRole('banner')).getByRole('button', {
      name: 'Bookmarks',
    })
  );
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('could not be loaded');
  read.mockRestore();
  await userEvent.click(within(alert).getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(/No bookmarks yet/)).toBeInTheDocument();
});
test('owner changes fence a pending chapter result and do not replace the new session', async () => {
  let finish!: () => void;
  const onChapter = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  view({ onChapter });
  await userEvent.click(
    within(
      screen.getByRole('navigation', { name: 'Chapter navigation' })
    ).getByRole('button', { name: 'Next chapter' })
  );
  await waitFor(() => expect(onChapter).toHaveBeenCalledOnce());
  await act(async () => {
    invalidateDataScope();
    finish();
  });
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Chapter One'
  );
  expect(screen.queryByRole('alert')).toBeNull();
});
