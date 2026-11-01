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
import { Popover } from '@/shared/ui';
import { PopoverCloseContext } from '@/shared/ui/popover-close';
import { PopoverGroupContext } from '@/shared/ui/popover-group';
import { useUiLang } from '@/features/i18n/uiLang';
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
  const value = useMemo(() => ({ wide, target }), [wide, target]);
  return <HelpEnvironment value={value}>{children}</HelpEnvironment>;
}

export function ReaderHelp(props: HelpProps) {
  return props.targetId ? (
    <BookHelp {...props} targetId={props.targetId} />
  ) : (
    <Popover {...props} />
  );
}

function BookHelp({
  trigger,
  label,
  children,
  anchorClassName,
  initiallyOpen,
  onDismiss,
  returnFocus,
}: HelpProps) {
  const ru = useUiLang((s) => s.lang) === 'ru';
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
      <div className="rdh-topline">
        <span>{ru ? 'Помощь с чтением' : 'Reading help'}</span>
        <button
          type="button"
          className="rdh-close"
          aria-label={ru ? 'Закрыть' : 'Close'}
          onClick={() => close()}
        >
          ×
        </button>
      </div>
      <div className="rdh-body">{children}</div>
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
