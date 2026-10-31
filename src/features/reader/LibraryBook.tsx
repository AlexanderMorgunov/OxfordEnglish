import { Link, useLocation } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import type { ReactNode } from 'react';

export type ShelfBook = {
  id: string;
  title: string;
  author?: string;
  href: string;
  format?: string;
  level?: string;
  progress: number | null;
  opened: boolean;
  local: boolean | undefined;
  chapterCount?: number;
  lastChapter?: number;
  markedFinished?: boolean;
  addedAt?: number;
};
const COLORS = [
  ['#e6d5b7', '#302617'],
  ['#bad3c8', '#173a32'],
  ['#c9d0e7', '#283047'],
  ['#ebc9c3', '#4d2832'],
  ['#e5d8a6', '#3c3418'],
];
export function BookCover({ book }: { book: ShelfBook }) {
  const hash = Array.from(book.title).reduce(
    (sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0,
    0
  );
  const colors = COLORS[hash % COLORS.length]!;
  return (
    <div
      className="library-cover"
      aria-hidden="true"
      style={{ background: colors[0], color: colors[1] }}
    >
      <span>{book.title}</span>
      <PixelImage
        src="/assets/pixel/nav/library.png"
        alt=""
        className="library-cover-art"
      />
      <small>{book.author}</small>
    </div>
  );
}
export function BookAvailability({ book }: { book: ShelfBook }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  return (
    <span
      className={`library-availability ${book.local ? 'text-teal' : 'text-muted'}`}
    >
      {book.local
        ? ru
          ? '✓ На устройстве'
          : '✓ On this device'
        : book.local === false
          ? ru
            ? 'Файл не на устройстве'
            : 'File not on this device'
          : ru
            ? 'Проверяем файл…'
            : 'Checking file…'}
    </span>
  );
}
export function BookProgress({ book }: { book: ShelfBook }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const progress = book.progress;
  return (
    <div className="library-book-progress">
      {progress !== null && (
        <div className="library-progress" aria-hidden="true">
          <span
            style={{ width: `${Math.min(100, Math.max(0, progress * 100))}%` }}
          />
        </div>
      )}
      <p className="library-progress-label">
        <span>
          {progress !== null
            ? `${ru ? 'Прочитано' : 'Read'} ${progress < 1 ? Math.min(99, Math.round(progress * 100)) : 100}%`
            : book.opened
              ? ru
                ? 'Сохранено место'
                : 'Reading position saved'
              : ru
                ? 'Ещё не начата'
                : 'Not started'}
        </span>
        {book.chapterCount !== undefined && (
          <span>
            {book.lastChapter !== undefined &&
            book.lastChapter < book.chapterCount &&
            book.opened
              ? `${ru ? 'Глава' : 'Chapter'} ${book.lastChapter + 1} / ${book.chapterCount}`
              : `${book.chapterCount} ${ru ? 'глав' : 'ch.'}`}
          </span>
        )}
      </p>
    </div>
  );
}
export function LibraryBook({
  book,
  onDetails,
  onOpen,
  children,
}: {
  book: ShelfBook;
  onDetails: (opener: HTMLElement) => void;
  onOpen: () => void;
  children?: ReactNode;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const location = useLocation();
  const content = (
    <>
      <BookCover book={book} />
      <div className="library-book-copy">
        <h3>{book.title}</h3>
        {book.author && <p>{book.author}</p>}
        <p>
          {book.level && <span className="library-level">{book.level}</span>}
          {book.format?.toUpperCase()}
        </p>
      </div>
    </>
  );
  return (
    <article className="library-book" data-library-id={book.id}>
      {book.level ? (
        <button
          type="button"
          className="library-book-main"
          aria-label={(ru ? 'Подробнее: ' : 'Details: ') + book.title}
          onClick={(event) => onDetails(event.currentTarget)}
        >
          {content}
        </button>
      ) : (
        <Link
          className="library-book-main"
          to={book.href}
          state={{ libraryReturn: location.pathname }}
          onClick={onOpen}
          aria-label={`${ru ? 'Читать' : 'Read'}: ${book.title}`}
        >
          {content}
        </Link>
      )}
      <BookProgress book={book} />
      <div className="library-book-actions">
        <BookAvailability book={book} />
        <button
          type="button"
          className="library-more"
          onClick={(e) => onDetails(e.currentTarget)}
          aria-label={`${ru ? 'О книге' : 'About'} ${book.title}`}
        >
          ···
        </button>
      </div>
      {children}
    </article>
  );
}
