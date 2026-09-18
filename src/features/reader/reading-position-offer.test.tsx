/**
 * Offering a reading position that arrived from another device.
 *
 * The rule stays last-writer-wins, so what arrives is the last writer's chapter, not the furthest one.
 * The job here is narrower and is a bug fix, not a preference: `BookReaderPage` read the book record once
 * at mount and never again, so a position pulled a second later was invisible and the next page turn
 * wrote over it. Nobody is ever moved automatically — that would be worse than the stale chapter it fixes.
 */
import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { BookView } from './BookView';
import type { ParsedBook } from './parse';

vi.mock('./ChapterStudy', () => ({ ChapterStudy: () => null }));
vi.mock('@/features/account/QuotaNotice', () => ({ QuotaNotice: () => null }));

const book: ParsedBook = {
  title: 'Dracula',
  author: 'Stoker',
  chapters: Array.from({ length: 30 }, (_, i) => ({
    id: `c${i}`,
    title: `Chapter ${i + 1}`,
    text: `Paragraph one of chapter ${i + 1}.\n\nParagraph two of chapter ${i + 1}.`,
  })),
};

const view = (props: { initialChapter?: number; remoteChapter?: number; onChapter?: (i: number) => void } = {}) =>
  render(
    <MemoryRouter>
      <BookView book={book} idPrefix="reader.b1" {...props} />
    </MemoryRouter>
  );

const offerText = /further along on another device/i;
/** The select's <option> list also contains 'Chapter 20', so the offer must be matched by its sentence. */
const offerFor = (n: number) => new RegExp(`further along on another device.*chapter ${n}`, 'i');

beforeEach(() => {
  localStorage.removeItem('reader.b1.progress');
});

test('a chapter ahead of the one on screen is offered', async () => {
  view({ initialChapter: 4, remoteChapter: 19 });
  expect(await screen.findByText(offerFor(20))).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /go there/i })).toBeInTheDocument();
});

test('a chapter behind is never offered — accepting it would be the rollback this prevents', () => {
  view({ initialChapter: 19, remoteChapter: 4 });
  expect(screen.queryByText(offerText)).not.toBeInTheDocument();
});

test('the same chapter is not offered', () => {
  view({ initialChapter: 7, remoteChapter: 7 });
  expect(screen.queryByText(offerText)).not.toBeInTheDocument();
});

test('nothing is offered when no position has arrived', () => {
  view({ initialChapter: 4 });
  expect(screen.queryByText(offerText)).not.toBeInTheDocument();
});

test('the offer never moves the reader on its own', () => {
  view({ initialChapter: 4, remoteChapter: 19 });
  // Still on the chapter the reader opened: the heading is the chapter title.
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chapter 5');
});

test('accepting moves the reader and persists, so the position is not lost again', async () => {
  const onChapter = vi.fn();
  view({ initialChapter: 4, remoteChapter: 19, onChapter });

  await userEvent.click(screen.getByRole('button', { name: /go there/i }));

  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chapter 20');
  expect(onChapter).toHaveBeenCalledWith(19); // go() writes through, so a refresh keeps it
  expect(screen.queryByText(offerText)).not.toBeInTheDocument();
});

test('declining hides the offer for that chapter', async () => {
  view({ initialChapter: 4, remoteChapter: 19 });
  await userEvent.click(screen.getByRole('button', { name: /stay/i }));

  expect(screen.queryByText(offerText)).not.toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chapter 5');
});

test('declining one chapter does not hide a further one later', async () => {
  const { rerender } = view({ initialChapter: 4, remoteChapter: 19 });
  await userEvent.click(screen.getByRole('button', { name: /stay/i }));
  expect(screen.queryByText(offerText)).not.toBeInTheDocument();

  // The other device read on. Dismissal is keyed to the chapter that was refused, not to the book.
  rerender(
    <MemoryRouter>
      <BookView book={book} idPrefix="reader.b1" initialChapter={4} remoteChapter={24} />
    </MemoryRouter>
  );
  expect(await screen.findByText(offerFor(25))).toBeInTheDocument();
});

test('the same chapter arriving again after a refusal stays hidden', async () => {
  const { rerender } = view({ initialChapter: 4, remoteChapter: 19 });
  await userEvent.click(screen.getByRole('button', { name: /stay/i }));

  // Every later sync cycle re-reports the same row; without chapter-keyed dismissal the line would
  // come back every few minutes.
  rerender(
    <MemoryRouter>
      <BookView book={book} idPrefix="reader.b1" initialChapter={4} remoteChapter={19} />
    </MemoryRouter>
  );
  expect(screen.queryByText(offerText)).not.toBeInTheDocument();
});

test('a position past the end is clamped, not rendered as a broken jump', async () => {
  // `chapterCount` on the book row counts UNPAGINATED chapters, so a valid lastChapter can exceed it;
  // the only correct bound is the paginated length, which only BookView knows.
  view({ initialChapter: 0, remoteChapter: 9999 });
  expect(await screen.findByText(offerFor(30))).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /go there/i }));
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chapter 30');
});
