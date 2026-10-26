import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export function WorkbenchDisclosure({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return <details ref={ref} onToggle={event => setOpen(event.currentTarget.open)} className={className}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !ref.current?.open) return;
      event.preventDefault(); event.stopPropagation(); ref.current.open = false; ref.current.querySelector('summary')?.focus();
    }}>
    <summary className="flex min-h-11 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm text-muted hover:bg-surface-2 hover:text-content">{label}<span aria-hidden="true" className="text-xs">⌄</span></summary>
    {open && children}
  </details>;
}
