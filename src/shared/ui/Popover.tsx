import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/shared/lib/cn';
import { PopoverCloseContext } from './popover-close';

type PopoverProps = {
  trigger: ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: boolean;
    'aria-controls'?: string;
  }>;
  children: ReactNode;
  /** Accessible name for the popover dialog (e.g. the word being looked up). */
  label?: string;
  /** Render an explicit × close button in the panel corner. */
  showClose?: boolean;
  className?: string;
};

const MARGIN = 8;

/** Anchored popover for word/example look-ups (DESIGN_DOC §5.2). The panel is portaled to
 *  document.body and positioned `fixed`, clamped to the viewport — so a word near the right edge
 *  can never open it off-screen or widen the document (which produced a horizontal scrollbar). */
export function Popover({ trigger, children, label, showClose, className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  // Restore focus to the trigger so a keyboard user who Tabbed into the panel (or hit ×/Escape)
  // isn't dropped onto <body>. Skip it for outside-click dismissal, which moves focus elsewhere.
  const close = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) (rootRef.current?.firstElementChild as HTMLElement | null)?.focus();
  }, []);

  const reposition = () => {
    const anchor = rootRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const a = anchor.getBoundingClientRect();
    const vw = window.visualViewport?.width ?? window.innerWidth;
    const vh = window.visualViewport?.height ?? window.innerHeight;
    const pw = panel.offsetWidth;
    const ph = panel.offsetHeight;
    let left = Math.min(a.left, vw - pw - MARGIN);
    left = Math.max(MARGIN, left);
    let top = a.bottom + 6;
    if (top + ph > vh - MARGIN) {
      const above = a.top - 6 - ph;
      top = above >= MARGIN ? above : Math.max(MARGIN, vh - ph - MARGIN);
    }
    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  };

  // Position on open and keep it clamped as the panel resizes (its translation loads async) or the
  // page scrolls/resizes. Layout effect runs before paint, so there's no visible jump.
  useLayoutEffect(() => {
    if (!open) return;
    reposition();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(reposition) : null;
    if (panelRef.current) ro?.observe(panelRef.current);
    window.addEventListener('scroll', reposition, { passive: true, capture: true });
    window.addEventListener('resize', reposition);
    return () => {
      ro?.disconnect();
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // The panel is portaled out of the trigger's subtree, so check both.
      if (!rootRef.current?.contains(t) && !panelRef.current?.contains(t)) close(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const triggerEl = cloneElement(trigger, {
    onClick: (e: React.MouseEvent) => {
      trigger.props.onClick?.(e);
      setOpen((v) => !v);
    },
    'aria-expanded': open,
    'aria-haspopup': true,
    'aria-controls': panelId,
  });

  return (
    <span ref={rootRef} className="relative inline-block">
      {triggerEl}
      {open &&
        createPortal(
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={label ?? 'Lookup'}
            className={cn(
              'fixed left-0 top-0 z-50 block w-max max-w-[16rem]',
              'rounded-md border border-line bg-surface-2 p-3 text-left',
              'shadow-[0_1px_2px_rgba(0,0,0,0.35),0_10px_28px_rgba(0,0,0,0.45)]',
              showClose && 'pr-9',
              className
            )}
          >
            {showClose && (
              <button
                type="button"
                aria-label="Close"
                onClick={() => close()}
                className="absolute right-0 top-0 flex h-9 w-9 items-center justify-center font-mono text-xl leading-none text-muted hover:text-content"
              >
                ×
              </button>
            )}
            <PopoverCloseContext value={() => close()}>{children}</PopoverCloseContext>
          </div>,
          document.body
        )}
    </span>
  );
}
