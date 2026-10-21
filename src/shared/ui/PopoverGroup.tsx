import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import { PopoverGroupContext } from './popover-group';

/** A reading region where a touch dismisses the current lookup before opening another. */
export function PopoverGroup({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef<Element | null>(null);
  const controller = useMemo(() => {
    let active: (() => void) | null = null;
    return {
      activate(close: () => void) {
        active?.();
        active = close;
        return () => { if (active === close) active = null; };
      },
      dismiss() {
        if (!active) return false;
        const close = active;
        active = null;
        close();
        return true;
      },
    };
  }, []);

  return (
    <PopoverGroupContext value={controller}>
      <div
        ref={root}
        onPointerDownCapture={(event) => {
          pending.current = null;
          const target = event.target;
          if (event.pointerType !== 'touch' || !(target instanceof Element) || !root.current?.contains(target)) return;
          const trigger = target.closest('[data-popover-trigger]');
          if (trigger && controller.dismiss()) pending.current = trigger;
        }}
        onPointerCancelCapture={() => { pending.current = null; }}
        onClickCapture={(event) => {
          const trigger = pending.current;
          pending.current = null;
          if (!event.detail || !root.current?.contains(event.target as Node) || !trigger?.contains(event.target as Node)) return;
          // Dismissal happened on pointerdown; consume its click before the next lookup starts.
          event.preventDefault();
          event.stopPropagation();
        }}
      >{children}</div>
    </PopoverGroupContext>
  );
}
