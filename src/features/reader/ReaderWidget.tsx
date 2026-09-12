import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import { canSpeak } from '@/shared/lib/audio';
import { useReaderSettings, RATE_STEPS } from './settings';
import { BookmarkList } from './BookmarkList';
import type { Bookmark } from './bookmarks';

/** Where a reader jumps from mid-book. Icon-only so the whole row fits one line of the panel; the
 *  same sprites as the header nav, so the icons are already familiar. Vocabulary keeps `from=reader`,
 *  which is what puts a "back to reading" link on that page. */
const NAV = [
  { to: '/vocabulary?from=reader', icon: '/assets/pixel/nav/vocab.png', ru: 'Словарь', en: 'Vocabulary' },
  { to: '/', icon: '/assets/pixel/nav/today.png', ru: 'Сегодня', en: 'Today' },
  { to: '/grammar', icon: '/assets/pixel/nav/grammar.png', ru: 'Грамматика', en: 'Grammar' },
  { to: '/review', icon: '/assets/pixel/nav/review.png', ru: 'Повторение', en: 'Review' },
  { to: '/library', icon: '/assets/pixel/nav/library.png', ru: 'Библиотека', en: 'Library' },
] as const;

/** Floating quick-access widget for the reader: section nav, one-tap bookmark of the current
 *  spot, and the bookmark list (jump / delete). A disclosure (not a menu), pinned to the bottom-right
 *  corner and dimmed while scrolling so it never fights the prose underneath. */
export function ReaderWidget({
  onBookmarkHere,
  bookmarks,
  progress,
  onJump,
  onDelete,
}: {
  /** Bookmark (or un-bookmark) the top-of-screen sentence. Returns whether it was added, for the toast. */
  onBookmarkHere: () => Promise<{ added: boolean }>;
  bookmarks: Bookmark[];
  /** Position of each bookmark in the book (0–1), by id. */
  progress: Map<string, number>;
  onJump: (bm: Bookmark) => void;
  onDelete: (id: string) => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const rate = useReaderSettings((s) => s.rate);
  const setRate = useReaderSettings((s) => s.setRate);
  const [open, setOpen] = useState(false);
  const [dim, setDim] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  // Fade the collapsed button while the reader scrolls, back to full on pause. Skipped while open.
  useEffect(() => {
    if (open) {
      setDim(false);
      return;
    }
    let t = 0;
    const onScroll = () => {
      setDim(true);
      clearTimeout(t);
      t = window.setTimeout(() => setDim(false), 700);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      clearTimeout(t);
    };
  }, [open]);

  // Disclosure close contract: outside-click and Esc (Esc returns focus to the trigger).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const bookmarkHere = async () => {
    const { added } = await onBookmarkHere();
    setOpen(false);
    setToast(
      added
        ? ru
          ? '🔖 закладка добавлена'
          : '🔖 bookmarked'
        : ru
          ? 'закладка убрана'
          : 'bookmark removed'
    );
    window.setTimeout(() => setToast(null), 1800);
  };

  return (
    <div
      ref={rootRef}
      className="fixed z-30 flex flex-col items-end gap-2"
      style={{
        bottom: 'calc(1rem + env(safe-area-inset-bottom))',
        right: 'calc(1rem + env(safe-area-inset-right))',
      }}
    >
      {toast && (
        <div
          role="status"
          className="rounded-sm border border-line bg-surface px-3 py-1.5 font-mono text-2xs text-content shadow-md"
        >
          {toast}
        </div>
      )}
      {open && (
        <div
          id="reader-widget-panel"
          className="flex w-64 max-w-[80vw] flex-col items-stretch gap-1 rounded-md border border-line bg-surface p-1.5 shadow-lg"
        >
          <nav
            aria-label={ru ? 'Разделы' : 'Sections'}
            className="flex items-center justify-between gap-0.5 px-1 pb-0.5"
          >
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                aria-label={ru ? item.ru : item.en}
                title={ru ? item.ru : item.en}
                // Icon-only, so the label lives in aria-label/title; 44px keeps the tap target usable.
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-sm hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
              >
                <PixelImage src={item.icon} alt="" className="h-5 w-5" />
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => void bookmarkHere()}
            className="flex items-center gap-2 rounded-sm px-3 py-2 text-left font-mono text-xs text-content hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <span className="w-4 shrink-0 text-center">🔖</span>
            {ru ? 'добавить закладку' : 'add bookmark'}
          </button>
          {canSpeak() && (
            <div
              role="group"
              aria-label={ru ? 'Скорость озвучки' : 'Read-aloud speed'}
              className="flex items-center gap-0.5 px-3 py-1"
            >
              <span className="mr-auto font-mono text-2xs text-muted">{ru ? 'скорость' : 'speed'}</span>
              {RATE_STEPS.map((r) => (
                <button
                  key={r}
                  type="button"
                  aria-pressed={rate === r}
                  onClick={() => setRate(r)}
                  className={cn(
                    'min-w-9 rounded-sm px-1.5 py-1.5 font-mono text-2xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
                    rate === r ? 'bg-surface-2 text-teal' : 'text-muted'
                  )}
                >
                  {r}×
                </button>
              ))}
            </div>
          )}
          {bookmarks.length > 0 && (
            <div className="mt-1 border-t border-line pt-1">
              <p className="px-3 py-1 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
                {ru ? 'закладки' : 'bookmarks'} ({bookmarks.length})
              </p>
              <BookmarkList
                bookmarks={bookmarks}
                progress={progress}
                onJump={(bm) => {
                  onJump(bm);
                  setOpen(false);
                }}
                onDelete={onDelete}
                className="max-h-[45vh] overflow-y-auto"
              />

            </div>
          )}
        </div>
      )}
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls="reader-widget-panel"
        aria-label={ru ? 'Быстрые действия' : 'Quick actions'}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex h-11 w-11 items-center justify-center rounded-full border border-line bg-surface shadow-lg transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
          dim && !open ? 'opacity-35 hover:opacity-100' : 'opacity-100'
        )}
      >
        {open ? (
          <span className="text-lg text-muted">×</span>
        ) : (
          <PixelImage src="/assets/pixel/reader-widget.png" alt="" className="h-6 w-6" />
        )}
      </button>
    </div>
  );
}
