import { useMemo } from 'react';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import { useReaderSettings } from './settings';
import { formatBookmarkTime, sortBookmarks, type Bookmark } from './bookmarks';

const SORTS = [
  ['recent', { ru: 'новые', en: 'newest' }],
  ['book', { ru: 'по книге', en: 'book order' }],
] as const;

/** Bookmark list shared by the reader's top panel and the floating widget: newest/book-order toggle,
 *  and per row the position in the book, chapter and when it was added. */
export function BookmarkList({
  bookmarks,
  progress,
  onJump,
  onDelete,
  className,
}: {
  bookmarks: Bookmark[];
  /** Position of each bookmark in the book (0–1), by id. */
  progress: Map<string, number>;
  onJump: (bm: Bookmark) => void;
  onDelete: (id: string) => void;
  className?: string;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const sort = useReaderSettings((s) => s.bookmarkSort);
  const setSort = useReaderSettings((s) => s.setBookmarkSort);
  const rows = useMemo(() => sortBookmarks(bookmarks, sort), [bookmarks, sort]);
  const now = Date.now();

  return (
    <div className={className}>
      <div role="group" aria-label={ru ? 'Порядок закладок' : 'Bookmark order'} className="mb-1 flex gap-1 px-1">
        {SORTS.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={sort === mode}
            onClick={() => setSort(mode)}
            className={cn(
              'rounded-sm px-2 py-1 font-mono text-2xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
              sort === mode ? 'bg-surface-2 text-teal' : 'text-muted'
            )}
          >
            {ru ? label.ru : label.en}
          </button>
        ))}
      </div>
      <ul className="flex flex-col gap-0.5" aria-label={ru ? 'Закладки' : 'Bookmarks'}>
        {rows.map((bm) => {
          const at = progress.get(bm.id);
          const meta = [
            at != null ? `${Math.round(at * 100)}%` : null,
            bm.chapterTitle,
            formatBookmarkTime(bm.createdAt, ru, now),
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={bm.id} className="flex items-start gap-1">
              <button
                type="button"
                onClick={() => onJump(bm)}
                className="min-w-0 flex-1 rounded-sm px-2 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                <span className="block font-mono text-2xs tabular-nums text-muted">{meta}</span>
                <span className="mt-0.5 line-clamp-2 block text-sm text-content">{bm.snippet}</span>
              </button>
              <button
                type="button"
                aria-label={ru ? 'Удалить закладку' : 'Delete bookmark'}
                onClick={() => onDelete(bm.id)}
                className="shrink-0 rounded-sm px-2 py-1.5 text-muted hover:text-coral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
