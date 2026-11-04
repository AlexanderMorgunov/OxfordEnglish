import {
  cloneElement,
  createContext,
  use,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ReactElement, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Popover, usePopoverClose } from '@/shared/ui';
import { PopoverCloseContext } from '@/shared/ui/popover-close';
import { PopoverGroupContext } from '@/shared/ui/popover-group';
import { useUiLang } from '@/features/i18n/uiLang';
import { NAVIGATION_INSETS_EVENT } from '@/shared/lib/navigation-insets';
import { hasSeenSheetSwipeHint, markSheetSwipeHintSeen, useSheetDismiss } from './useSheetDismiss';
import './reader-help.css';

type HelpTrigger = ReactElement<{
  onClick?: (event: React.MouseEvent) => void;
  'aria-expanded'?: boolean;
  'aria-haspopup'?: 'dialog';
  'aria-controls'?: string;
  'data-popover-trigger'?: boolean;
}>;

type HelpProps = {
  targetId?: string;
  trigger: HelpTrigger;
  label: string;
  children: ReactNode;
  variant?: 'default' | 'word';
  footer?: ReactNode;
  className?: string;
  anchorClassName?: string;
  closeLabel?: string;
  showClose?: boolean;
  initiallyOpen?: boolean;
  onDismiss?: () => void;
  returnFocus?: HTMLElement | null;
};

const HelpEnvironment = createContext<{
  wide: boolean;
  target: HTMLElement | null;
}>({ wide: false, target: null });

export function ReaderHelpEnvironment({
  targetId,
  children,
}: {
  targetId?: string;
  children: ReactNode;
}) {
  const [wide, setWide] = useState(
    () => window.matchMedia?.('(min-width: 1200px)').matches ?? false
  );
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!targetId) return;
    setTarget(document.getElementById(targetId));
    const media = window.matchMedia?.('(min-width: 1200px)');
    const change = () => setWide(media?.matches ?? false);
    media?.addEventListener('change', change);
    return () => media?.removeEventListener('change', change);
  }, [targetId]);
  useLayoutEffect(() => {
    if (!target || !wide) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const dock = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reader-dock-height')) || 100;
        const top = target.getBoundingClientRect().top + parseFloat(getComputedStyle(target).paddingTop);
        target.style.setProperty('--reader-help-height', `${Math.max(100, window.innerHeight - top - dock - 16)}px`);
      });
    };
    update();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(target);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener(NAVIGATION_INSETS_EVENT, update);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update);
      window.removeEventListener(NAVIGATION_INSETS_EVENT, update);
      target.style.removeProperty('--reader-help-height');
    };
  }, [target, wide]);
  const value = useMemo(() => ({ wide, target }), [wide, target]);
  return <HelpEnvironment value={value}>{children}</HelpEnvironment>;
}

export function ReaderHelp(props: HelpProps) {
  return props.targetId ? (
    <BookHelp {...props} targetId={props.targetId} />
  ) : (
    props.variant === 'word' ? <Popover {...props} showClose={false} className="rdh-anchored"><HelpContent footer={props.footer}>{props.children}</HelpContent></Popover>
      : <Popover {...props}>{props.children}{props.footer}</Popover>
  );
}

function SheetHeading() {
  const ru = useUiLang(s => s.lang) === 'ru';
  const grip = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!window.matchMedia?.('(any-pointer: coarse)').matches || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches || hasSeenSheetSwipeHint()) return;
    grip.current?.setAttribute('data-swipe-teach', '');
    const timer = window.setTimeout(() => {
      grip.current?.removeAttribute('data-swipe-teach');
      markSheetSwipeHintSeen();
    }, 2500);
    return () => window.clearTimeout(timer);
  }, []);
  return <>
    <span ref={grip} className="rdh-grab" aria-hidden="true"><span /></span>
    <span>{ru ? 'Помощь с чтением' : 'Reading help'}</span>
    <span className="rdh-swipe-note">{ru ? 'Потяните вниз, чтобы закрыть' : 'Pull down to close'}</span>
  </>;
}

function HelpContent({ children, footer, heading }: Pick<HelpProps, 'children' | 'footer'> & { heading?: ReactNode }) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const close = usePopoverClose();
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { body.current?.focus({ preventScroll: true }); }, []);
  return <>
    <div className="rdh-topline"><div>{heading ?? (ru ? 'Помощь с чтением' : 'Reading help')}</div><button type="button" className="rdh-close" aria-label={ru ? 'Закрыть' : 'Close'} onClick={close}>×</button></div>
    <div ref={body} tabIndex={-1} className="rdh-body outline-none">{children}</div>
    {footer && <footer className="rdh-footer">{footer}</footer>}
  </>;
}

function BookHelp({
  trigger,
  label,
  children,
  footer,
  anchorClassName,
  initiallyOpen,
  onDismiss,
  returnFocus,
}: HelpProps) {
  const [open, setOpen] = useState(Boolean(initiallyOpen));
  const { wide, target } = use(HelpEnvironment);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const group = use(PopoverGroupContext);
  const id = useId();
  const close = useCallback(
    (restore = true) => {
      if (dialog.current?.open) dialog.current.close?.();
      setOpen(false);
      onDismiss?.();
      if (restore)
        (
          returnFocus ??
          (anchor.current?.firstElementChild as HTMLElement | null)
        )?.focus({ preventScroll: true });
    },
    [onDismiss, returnFocus]
  );
  useSheetDismiss(dialog, open && (!wide || !target), close);

  useLayoutEffect(() => {
    if (open) return group?.activate(() => close(false));
  }, [open, group, close]);
  useLayoutEffect(() => {
    if (!open) return;
    const el = dialog.current;
    if (!wide || !target) {
      if (el && !el.open) {
        if (typeof el.showModal === 'function') el.showModal();
        else el.setAttribute('open', '');
      }
    } else panel.current?.focus({ preventScroll: true });
    return () => {
      if (el?.open) el.close?.();
    };
  }, [open, wide, target]);
  useEffect(() => {
    if (!open || !wide || !target) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.target instanceof Element && event.target.closest('dialog[open]')) return;
        event.preventDefault();
        close();
      }
    };
    const outside = (event: PointerEvent) => {
      if (
        !panel.current?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        close(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, wide, target, close]);

  const content = (
    <PopoverCloseContext value={() => close()}>
      <HelpContent footer={footer} heading={!wide || !target ? <SheetHeading /> : undefined}>{children}</HelpContent>
    </PopoverCloseContext>
  );
  return (
    <span ref={anchor} className={anchorClassName}>
      {cloneElement(trigger, {
        onClick: (event) => {
          trigger.props.onClick?.(event);
          setOpen((value) => !value);
        },
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-controls': id,
        'data-popover-trigger': true,
      })}
      {open &&
        createPortal(
          wide && target ? (
            <section
              ref={panel}
              id={id}
              role="dialog"
              aria-label={label}
              tabIndex={-1}
              className="rdh-panel"
            >
              {content}
            </section>
          ) : (
            <dialog
              ref={dialog}
              id={id}
              aria-label={label}
              className="rdh-sheet"
              onCancel={(event) => {
                event.preventDefault();
                close();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  close();
                }
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) close();
              }}
            >
              {content}
            </dialog>
          ),
          wide && target ? target : document.body
        )}
    </span>
  );
}

export function ReaderHelpIdle() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { target } = use(HelpEnvironment);
  return (
    target &&
    createPortal(
      <div className="rdh-idle">
        <p>{ru ? 'Пусть история продолжается' : 'Keep the story going'}</p>
        <span>
          {ru
            ? 'Нажмите слово или значок после предложения. Значение появится здесь.'
            : 'Select a word or the action after a sentence. Its meaning will appear here.'}
        </span>
        <small>
          {ru
            ? 'Просмотр ничего не сохраняет.'
            : 'Looking up never saves a card.'}
        </small>
      </div>,
      target
    )
  );
}
