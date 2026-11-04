import { useId, useLayoutEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AppIcon } from '@/shared/ui/AppIcon';
import { suspendReading } from '@/shared/lib/reading-suspension';
import { lockBodyScroll } from '@/shared/lib/scroll-lock';
import mark from '@/assets/brand/dayenglish-mark.svg';

export function WelcomeDialog({
  title,
  step,
  ru,
  children,
  footer,
  close,
  returnToTask,
}: {
  title: string;
  step: string;
  ru: boolean;
  children: ReactNode;
  footer: ReactNode;
  close: () => void;
  returnToTask: () => boolean;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const invoker = document.activeElement,
      position = { top: scrollY, left: scrollX };
    const release = suspendReading();
    const releaseScroll = lockBodyScroll();
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      releaseScroll();
      if (returnToTask()) window.scrollTo({ ...position, behavior: 'instant' });
      release();
      if (returnToTask()) {
        const target =
          invoker instanceof HTMLElement &&
          invoker !== document.body &&
          invoker.isConnected
            ? invoker
            : document.querySelector<HTMLElement>('main');
        target?.focus({ preventScroll: true });
      }
    };
  }, [returnToTask]);
  useLayoutEffect(() => {
    if (body.current) body.current.scrollTop = 0;
    dialog.current
      ?.querySelector<HTMLElement>('[data-welcome-title]')
      ?.focus({ preventScroll: true });
  }, [title, step]);
  return createPortal(
    <dialog
      ref={dialog}
      className="first-entry-dialog"
      aria-labelledby={id}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const controls = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            'a[href],button,input,select,textarea,summary,[tabindex]'
          ),
        ].filter(
          (el) =>
            el.tabIndex >= 0 &&
            !el.matches(':disabled') &&
            el.getClientRects().length
        );
        const current = document.activeElement;
        if (
          event.shiftKey &&
          (current === controls[0] ||
            current?.hasAttribute('data-welcome-title'))
        ) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (!event.shiftKey && current === controls.at(-1)) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }}
    >
      <header className="fw-top">
        <span className="fw-brand">
          <img src={mark} alt="" />
          DayEnglish
        </span>
        <span className="fw-progress" aria-hidden="true">
          <i />
          <i data-active={step !== 'intro'} />
        </span>
        <button
          type="button"
          className="fw-close"
          onClick={close}
          aria-label={ru ? 'Закрыть знакомство' : 'Close welcome'}
        >
          <AppIcon name="close" />
        </button>
      </header>
      <div ref={body} className="fw-body">
        <p className="fw-step-label">
          {step === 'intro'
            ? ru
              ? 'Знакомство · 1 из 2'
              : 'Welcome · 1 of 2'
            : step === 'setup'
              ? ru
                ? 'Оформление и возможности · 2 из 2'
                : 'Appearance and features · 2 of 2'
              : ''}
        </p>
        <h2
          id={id}
          data-welcome-title
          tabIndex={-1}
          className={step === 'intro' ? 'fw-intro-title' : 'fw-title'}
        >
          {title}
        </h2>
        {children}
      </div>
      <footer className="fw-footer">{footer}</footer>
    </dialog>,
    document.body
  );
}
