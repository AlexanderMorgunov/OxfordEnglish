import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import { subscribeDataScope } from '@/features/account/dataScope';
import { useReaderSettings } from './settings';
import { formatBookmarkTime, sortBookmarks } from './bookmarks';
import type { Bookmark } from './bookmarks';
import { ReaderIcon } from './ReaderIcon';
import './reader-chapter.css';

export function BookmarkList({
  bookmarks,
  progress,
  onJump,
  onDelete,
  deletingIds,
  deleteError,
  className,
}: {
  bookmarks: Bookmark[];
  progress: Map<string, number>;
  onJump: (bm: Bookmark) => void;
  onDelete: (id: string) => void | Promise<void>;
  deletingIds?: ReadonlySet<string>;
  deleteError?: string;
  className?: string;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const sort = useReaderSettings((s) => s.bookmarkSort);
  const setSort = useReaderSettings((s) => s.setBookmarkSort);
  const rows = useMemo(() => sortBookmarks(bookmarks, sort), [bookmarks, sort]);
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const pendingRef = useRef(new Set<string>());
  const [failed, setFailed] = useState(false);
  const lifetime = useRef({ revision: 0 }).current;
  const sortId = useId();
  const now = Date.now();
  useEffect(() => {
    const unsubscribe = subscribeDataScope(() => {
      lifetime.revision++;
      pendingRef.current.clear();
      setPending(new Set());
      setFailed(false);
    });
    return () => {
      lifetime.revision++;
      unsubscribe();
    };
  }, [lifetime]);

  const remove = async (id: string) => {
    if (pendingRef.current.has(id) || deletingIds?.has(id)) return;
    const generation = lifetime.revision;
    pendingRef.current.add(id);
    setPending(new Set(pendingRef.current));
    setFailed(false);
    try {
      await onDelete(id);
    } catch {
      if (lifetime.revision === generation) setFailed(true);
    } finally {
      if (lifetime.revision === generation) {
        pendingRef.current.delete(id);
        setPending(new Set(pendingRef.current));
      }
    }
  };

  return (
    <div className={cn('rds-bookmarks', className)}>
      <div className="rds-bookmark-sort">
        <label htmlFor={sortId}>{ru ? 'Порядок' : 'Order'}</label>
        <select
          id={sortId}
          value={sort}
          aria-label={ru ? 'Порядок закладок' : 'Bookmark order'}
          onChange={(event) =>
            setSort(event.target.value === 'book' ? 'book' : 'recent')
          }
        >
          <option value="recent">
            {ru ? 'Сначала новые' : 'Newest first'}
          </option>
          <option value="book">{ru ? 'По книге' : 'Book order'}</option>
        </select>
      </div>
      {(failed || deleteError) && (
        <p role="alert" className="rds-chapter-error">
          {deleteError ||
            (ru
              ? 'Не удалось удалить закладку. Она остаётся в списке; попробуйте ещё раз.'
              : 'Could not delete the bookmark. It remains in the list; please retry.')}
        </p>
      )}
      {!rows.length && (
        <p className="rds-chapter-empty">
          {ru
            ? 'Закладок пока нет. Добавьте место, к которому хотите вернуться.'
            : 'No bookmarks yet. Save a place you want to return to.'}
        </p>
      )}
      <ul
        className="rds-bookmark-list"
        aria-label={ru ? 'Закладки' : 'Bookmarks'}
      >
        {rows.map((bm) => {
          const at = progress.get(bm.id);
          const position = `${ru ? 'абзац' : 'paragraph'} ${bm.paragraph + 1}${bm.sentence == null ? '' : ` · ${ru ? 'предложение' : 'sentence'} ${bm.sentence + 1}`}`;
          const meta = [
            bm.chapterTitle,
            position,
            at != null ? `${Math.round(at * 100)}%` : null,
            formatBookmarkTime(bm.createdAt, ru, now),
          ]
            .filter(Boolean)
            .join(' · ');
          const busy = pending.has(bm.id) || deletingIds?.has(bm.id);
          return (
            <li key={bm.id}>
              <button
                type="button"
                onClick={() => onJump(bm)}
                className="rds-bookmark-jump"
              >
                <small>{meta}</small>
                <span lang="en">{bm.snippet}</span>
              </button>
              <button
                type="button"
                aria-label={`${ru ? 'Удалить закладку' : 'Delete bookmark'}: ${bm.chapterTitle || ''}, ${position}`}
                aria-busy={busy || undefined}
                disabled={busy}
                onClick={() => void remove(bm.id)}
                className="rds-chapter-icon rds-bookmark-delete"
              >
                <ReaderIcon name="trash" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
