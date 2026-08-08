import {
  cloneElement,
  useEffect,
  useId,
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
  const panelId = useId();

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
