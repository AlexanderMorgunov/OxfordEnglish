import {
  cloneElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { cn } from '@/shared/lib/cn';

type PopoverProps = {
  trigger: ReactElement<{
    onClick?: (e: React.MouseEvent) => void;
    'aria-expanded'?: boolean;
    'aria-haspopup'?: boolean;
    'aria-controls'?: string;
  }>;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
};

/** Anchored popover for word/example look-ups (DESIGN_DOC §5.2). */
export function Popover({
  trigger,
  children,
  align = 'start',
  className,
}: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const panelId = useId();

  // Keep the panel inside the viewport: a word near the right edge would otherwise open its
  // fixed-width panel off-screen. Measure the natural position and shift it horizontally. The
  // panel grows after open (its translation loads async), so re-clamp on every resize, not once.
  useLayoutEffect(() => {
    if (!open) return;
    const el = panelRef.current;
    if (!el) return;
    const clamp = () => {
      el.style.transform = 'none';
      const rect = el.getBoundingClientRect();
      const margin = 8;
      let dx = 0;
      if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
      if (rect.left + dx < margin) dx = margin - rect.left;
      el.style.transform = dx ? `translateX(${dx}px)` : 'none';
    };
    clamp();
    const ro = new ResizeObserver(clamp);
    ro.observe(el);
    window.addEventListener('resize', clamp);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', clamp);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

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
      {open && (
        <span
          ref={panelRef}
          id={panelId}
          role="dialog"
          className={cn(
            'absolute top-[calc(100%+6px)] z-10 block w-max max-w-[16rem]',
            'rounded-md border border-line bg-surface-2 p-3 text-left',
            'shadow-[0_1px_2px_rgba(0,0,0,0.35),0_10px_28px_rgba(0,0,0,0.45)]',
            align === 'end' ? 'right-0' : 'left-0',
            className
          )}
        >
          {children}
        </span>
      )}
    </span>
  );
}
