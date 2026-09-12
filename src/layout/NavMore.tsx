import { useEffect, useId, useRef, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '@/shared/lib/cn';
import { PixelImage } from '@/shared/ui';

export type NavMoreItem = { to: string; label: string; icon: string };

/**
 * Secondary destinations behind a disclosure, so the header keeps only the primary ones. A plain
 * disclosure over a link list (not `role="menu"`, which would promise arrow-key menu semantics) —
 * same close contract as the reader widget: outside pointer, Escape, and focus back on the trigger.
 */
export function NavMore({
  items,
  label,
}: {
  items: NavMoreItem[];
  /** Visible trigger text ("more"). */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const { pathname } = useLocation();
  const holdsCurrent = items.some((i) => pathname === i.to || pathname.startsWith(`${i.to}/`));

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      btnRef.current?.focus();
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 font-mono text-xs transition-colors',
          // A section open from inside the panel still marks the trigger, so the user is never
          // left without an active item in the header.
          open || holdsCurrent ? 'bg-surface-2 text-teal' : 'text-muted hover:text-content'
        )}
      >
        <span aria-hidden className="w-4 shrink-0 text-center">
          ≡
        </span>
        {label}
      </button>

      {open && (
        // Anchored to the nav container, not to the trigger: the trigger can wrap to the start of a
        // row, and a panel hung off it would then run past the left edge of the screen.
        <div
          id={panelId}
          className="absolute right-0 top-full z-40 mt-1 flex min-w-40 flex-col rounded-md border border-line bg-surface p-1 shadow-lg"
        >
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 rounded-sm px-3 py-2 font-mono text-xs transition-colors',
                  isActive ? 'bg-surface-2 text-teal' : 'text-muted hover:text-content'
                )
              }
            >
              <PixelImage src={item.icon} alt="" className="h-4 w-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
