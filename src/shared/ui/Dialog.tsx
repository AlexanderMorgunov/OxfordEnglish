import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { lockBodyScroll } from '@/shared/lib/scroll-lock';
import './dialog.css';

export function Dialog({
  title,
  onClose,
  children,
  footer,
  size = 'standard',
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'standard' | 'wide';
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const ru = useUiLang((s) => s.lang) === 'ru';
  useLayoutEffect(() => {
    const dialog = ref.current;
    const invoker = document.activeElement;
    const releaseScroll = lockBodyScroll();
    dialog?.showModal();
    heading.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      releaseScroll();
      if (invoker instanceof HTMLElement && invoker.isConnected)
        invoker.focus({ preventScroll: true });
      else
        document
          .querySelector<HTMLElement>('main')
          ?.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`app-dialog app-dialog--${size}`}
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href], button, input, select, textarea, summary, [tabindex]'
          ),
        ].filter(
          (el) =>
            el.tabIndex >= 0 &&
            !el.matches(':disabled') &&
            el.getClientRects().length > 0
        );
        if (
          event.shiftKey &&
          (document.activeElement === controls[0] ||
            document.activeElement === heading.current)
        ) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === controls.at(-1)
        ) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const b = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < b.left ||
          event.clientX > b.right ||
          event.clientY < b.top ||
          event.clientY > b.bottom
        )
          onClose();
      }}
    >
      <header className="app-dialog-head">
        <h2 id={id} ref={heading} tabIndex={-1}>
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={ru ? 'Закрыть' : 'Close'}
        >
          ×
        </button>
      </header>
      <div className="app-dialog-body">{children}</div>
      {footer && <footer className="app-dialog-footer">{footer}</footer>}
    </dialog>
  );
}
