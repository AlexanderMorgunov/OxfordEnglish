import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAccount } from '@/features/account/store';
import { PurchaseActions } from '@/features/account/PurchaseActions';
import { useBillingCatalog } from '@/features/account/useBillingCatalog';
import { campaignDeadline } from '@/features/account/planCopy';
import { formatPrice } from '@/features/account/billing';
import { suspendReading } from '@/shared/lib/reading-suspension';
import { lockBodyScroll } from '@/shared/lib/scroll-lock';
import { tourOwner } from '@/features/onboarding/memory';
import mark from '@/assets/brand/dayenglish-mark.svg';
import {
  consumeLessonSale,
  hideSale,
  lessonSalePending,
  saleHidden,
} from './memory';

function SaleDialog({ close }: { close: () => void }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const ref = useRef<HTMLDialogElement>(null);
  const leaveButton = useRef<HTMLButtonElement>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const requestClose = () => {
    if (unsaved) setConfirmLeave(true);
    else close();
  };
  useEffect(() => {
    if (confirmLeave) leaveButton.current?.focus();
  }, [confirmLeave]);
  useLayoutEffect(() => {
    const invoker = document.activeElement;
    const releaseScroll = lockBodyScroll();
    const release = suspendReading();
    const element = ref.current;
    element?.showModal();
    element?.querySelector<HTMLElement>('h2')?.focus();
    return () => {
      element?.close();
      releaseScroll();
      release();
      const target =
        invoker instanceof HTMLElement &&
        invoker !== document.body &&
        invoker.isConnected
          ? invoker
          : document.querySelector<HTMLElement>('main');
      target?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <dialog
      ref={ref}
      className="pro-sale-dialog"
      aria-labelledby="sale-title"
      onCancel={(e) => {
        e.preventDefault();
        requestClose();
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Tab') return;
        const controls = [
          ...e.currentTarget.querySelectorAll<HTMLElement>(
            'button,a[href],input,select,textarea,summary,[tabindex]'
          ),
        ].filter(
          (el) =>
            el.tabIndex >= 0 &&
            !el.matches(':disabled') &&
            el.getClientRects().length
        );
        if (
          e.shiftKey &&
          (document.activeElement === controls[0] ||
            document.activeElement?.id === 'sale-title')
        ) {
          e.preventDefault();
          controls.at(-1)?.focus();
        } else if (!e.shiftKey && document.activeElement === controls.at(-1)) {
          e.preventDefault();
          controls[0]?.focus();
        }
      }}
    >
      <header className="pro-sale-top">
        <span>
          <img src={mark} alt="" />
          DayEnglish <small>Pro</small>
        </span>
        <button
          type="button"
          className="pro-sale-close"
          onClick={requestClose}
          aria-label={ru ? 'Закрыть предложение' : 'Close offer'}
        >
          <AppIcon name="close" />
        </button>
      </header>
      <div className="pro-sale-body">
        <div className="pro-sale-heading">
          <div>
            <h2 id="sale-title" tabIndex={-1}>
              {ru
                ? 'Больше возможностей с Pro.'
                : 'More possibilities with Pro.'}
            </h2>
            <p>
              {ru
                ? 'ИИ-помощь в сложных местах и ваши занятия на нескольких устройствах.'
                : 'AI help when you get stuck, and learning across devices.'}
            </p>
          </div>
          <AppIcon name="pro" />
        </div>
        {confirmLeave && (
          <div className="pro-access-note" role="alert">
            <p>
              {ru
                ? 'Резервные коды ещё не сохранены. Вернуться к ним?'
                : 'Your backup codes are not saved yet. Return to them?'}
            </p>
            <button
              type="button"
              className="pro-sale-cta"
              ref={leaveButton}
              onClick={() => setConfirmLeave(false)}
            >
              {ru ? 'Вернуться к кодам' : 'Return to codes'}
            </button>
            <button type="button" className="pro-sale-return" onClick={close}>
              {ru ? 'Выйти без сохранения' : 'Leave without saving'}
            </button>
          </div>
        )}
        <PurchaseActions onRecoveryDraftChange={setUnsaved} />
        <button
          className="pro-sale-return"
          type="button"
          onClick={requestClose}
        >
          {ru ? 'Вернуться к занятиям' : 'Return to learning'}
        </button>
      </div>
    </dialog>,
    document.body
  );
}

export function SalePromotion() {
  const { pathname } = useLocation();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const session = useAccount((s) => s.sessionRevision);
  const accountId = useAccount((s) => s.accountId);
  const previousAccount = useRef(accountId);
  const { catalog } = useBillingCatalog(pathname === '/');
  const campaign =
    catalog.state === 'ready' && catalog.value.available
      ? catalog.value.campaign
      : null;
  const [open, setOpen] = useState(false);
  const [hiddenFor, setHiddenFor] = useState('');
  const owner = tourOwner();
  const id = campaign?.id;
  const hidden = !id || hiddenFor === `${owner}:${id}` || saleHidden(id, owner);
  const dismiss = () => {
    if (id) {
      hideSale(id, owner);
      setHiddenFor(`${owner}:${id}`);
    }
  };
  const show = () => {
    dismiss();
    consumeLessonSale();
    setOpen(true);
  };
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (previousAccount.current && previousAccount.current !== accountId)
      setOpen(false);
    previousAccount.current = accountId;
  }, [accountId]);
  useEffect(() => {
    if (open && id) hideSale(id, tourOwner());
  }, [open, id, session]);
  useEffect(() => {
    if (pathname !== '/' || hidden || !id) return;
    const attempt = () => {
      if (
        document.hidden ||
        !lessonSalePending() ||
        document.querySelector(
          'dialog[open], [role="dialog"], [data-welcome-pending="true"], .ct-popover'
        )
      )
        return;
      hideSale(id);
      consumeLessonSale();
      setHiddenFor(`${owner}:${id}`);
      setOpen(true);
    };
    const timer = window.setInterval(attempt, 1000);
    return () => clearInterval(timer);
  }, [pathname, hidden, id, owner]);
  const year =
    catalog.state === 'ready'
      ? catalog.value.plans.find((p) => p.days === 365)
      : null;
  const month =
    catalog.state === 'ready'
      ? catalog.value.plans.find((p) => p.days === 30)
      : null;
  const quarter =
    catalog.state === 'ready'
      ? catalog.value.plans.find((p) => p.days === 90)
      : null;
  return (
    <>
      {pathname === '/' && !hidden && campaign && year && (
        <aside
          className="pro-sale-banner"
          aria-label={ru ? 'Акция DayEnglish Pro' : 'DayEnglish Pro sale'}
        >
          <AppIcon name="pro" />
          <div>
            <strong>
              {ru ? 'Год с Pro — ' : 'A year with Pro — '}
              {year.regularPriceKopecks != null && (
                <>
                  <s>{formatPrice(year.regularPriceKopecks)}</s>{' '}
                </>
              )}
              {formatPrice(year.priceKopecks)}
            </strong>
            <p>
              {month &&
                `${ru ? '1 месяц' : '1 month'} — ${formatPrice(month.priceKopecks)} · `}
              {quarter &&
                `${ru ? '3 месяца' : '3 months'} — ${formatPrice(quarter.priceKopecks)} · `}
              {ru ? 'до ' : 'until '}
              {campaignDeadline(campaign.endsAt, ru)}
            </p>
          </div>
          <button type="button" className="pro-sale-cta" onClick={show}>
            {ru ? 'Выбрать срок' : 'Choose period'}
          </button>
          <button
            type="button"
            className="pro-sale-close"
            onClick={dismiss}
            aria-label={ru ? 'Скрыть предложение' : 'Hide offer'}
          >
            <AppIcon name="close" />
          </button>
        </aside>
      )}
      {open && <SaleDialog close={() => setOpen(false)} />}
    </>
  );
}
