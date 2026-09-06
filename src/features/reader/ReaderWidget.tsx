import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';

/** Floating quick-access widget for the reader: vocabulary nav + one-tap bookmark of the current
 *  spot. A disclosure (not a menu — two big tap targets), pinned to the bottom-right corner and
 *  dimmed while scrolling so it never fights the prose underneath. */
export function ReaderWidget({
  onBookmarkHere,
}: {
  /** Bookmark (or un-bookmark) the top-of-screen sentence. Returns whether it was added, for the toast. */
  onBookmarkHere: () => Promise<{ added: boolean }>;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
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
          className="flex flex-col items-stretch gap-1 rounded-md border border-line bg-surface p-1.5 shadow-lg"
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
            {ru ? 'заложить это место' : 'bookmark here'}
          </button>
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
