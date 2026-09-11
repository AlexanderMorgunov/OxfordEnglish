import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import { canSpeak } from '@/shared/lib/audio';
import { useReaderSettings, RATE_STEPS } from './settings';
import type { Bookmark } from './bookmarks';

/** Floating quick-access widget for the reader: vocabulary nav, one-tap bookmark of the current
 *  spot, and the bookmark list (jump / delete). A disclosure (not a menu), pinned to the bottom-right
 *  corner and dimmed while scrolling so it never fights the prose underneath. */
export function ReaderWidget({
  onBookmarkHere,
  bookmarks,
  onJump,
  onDelete,
}: {
  /** Bookmark (or un-bookmark) the top-of-screen sentence. Returns whether it was added, for the toast. */
  onBookmarkHere: () => Promise<{ added: boolean }>;
  bookmarks: Bookmark[];
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
          <Link
            to="/vocabulary?from=reader"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-sm px-3 py-2 font-mono text-xs text-content hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
          >
            <PixelImage src="/assets/pixel/nav/vocab.png" alt="" className="h-4 w-4 shrink-0" />
            {ru ? 'словарь' : 'vocabulary'}
          </Link>
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
              <ul
                className="flex max-h-[45vh] flex-col gap-0.5 overflow-y-auto"
                aria-label={ru ? 'Закладки' : 'Bookmarks'}
              >
                {bookmarks.map((bm) => (
                  <li key={bm.id} className="flex items-start gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onJump(bm);
                        setOpen(false);
                      }}
                      className="min-w-0 flex-1 rounded-sm px-3 py-1.5 text-left hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
                    >
                      <span className="block font-mono text-2xs text-muted">
                        {ru ? 'стр.' : 'p.'} {bm.page + 1}
                        {bm.chapterTitle ? ` · ${bm.chapterTitle}` : ''}
                      </span>
                      <span className="mt-0.5 line-clamp-2 block text-xs text-content">{bm.snippet}</span>
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
                ))}
              </ul>
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
