import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { ApiFailure } from './api';
import { useEntitlement, subscriptionState } from './entitlement';
import { captureAccountSessionOwner, useAccount } from './store';
import { beginCheckout, claimNote, claimPurchase, clearPending, formatPrice, livePending, pendingJournalUnreadable, type PendingPayment } from './billing';
import { useBillingCatalog } from './useBillingCatalog';
import { PlanChoices } from './PlanChoices';
import { campaignDeadline, planLabel } from './planCopy';
import { AccessFlow } from './AccessFlow';
import { AppIcon } from '@/shared/ui/AppIcon';

export function PurchaseActions({ initialPlan = 'pro_year', catalogSource, onRecoveryDraftChange, beforeCheckout, onCancelAccess }: { initialPlan?: string; catalogSource?: ReturnType<typeof useBillingCatalog>; onRecoveryDraftChange?: (unsaved: boolean) => void; beforeCheckout?: () => boolean; onCancelAccess?: () => void }) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const session = useAccount(s => s.sessionRevision);
  const status = useAccount(s => s.status);
  const entitlement = useEntitlement(s => s.entitlement);
  const ownCatalog = useBillingCatalog(!catalogSource);
  const { catalog, canBuy, retry } = catalogSource ?? ownCatalog;
  const [selected, setSelected] = useState(initialPlan);
  const [auth, setAuth] = useState(false);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [changed, setChanged] = useState(false);
  const running = useRef(false);
  const mounted = useRef(true);
  const state = subscriptionState(entitlement, Date.now());
  const journalBlocked = pendingJournalUnreadable();
  const checkout = (url: string) => {
    if (beforeCheckout && !beforeCheckout()) {
      setPending(livePending(useEntitlement.getState().entitlement?.paidUntil));
      setNote(ru ? 'Не удалось сохранить выбранное слово. Заказ сохранён, оплата не открывалась. Разрешите хранение данных и вернитесь к оплате заказа.' : 'Could not save the selected word. Your order is kept and checkout was not opened. Allow storage and return to order checkout.');
      return;
    }
    window.location.assign(url);
  };
  const plan = catalog.state === 'ready' ? catalog.value.plans.find(p => p.code === selected) ?? catalog.value.plans[0] : undefined;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setPending(livePending(entitlement?.paidUntil)); }, [entitlement?.paidUntil, session]);
  useEffect(() => { setNote(''); setBusy(false); }, [session]);
  const run = async (action: 'buy' | 'check') => {
    if (running.current) return;
    if (action === 'buy' && status !== 'authenticated') { setAuth(true); return; }
    running.current = true; setBusy(true); setNote('');
    const owns = captureAccountSessionOwner();
    try {
      if (action === 'buy') {
        const existing = livePending(entitlement?.paidUntil);
        if (existing) { setPending(existing); return; }
        if (!plan || !canBuy) return;
        const url = await beginCheckout(plan.code, plan.priceKopecks);
        if (owns() && mounted.current) checkout(url);
      } else {
        const outcome = await claimPurchase(3, 2000);
        if (!owns() || !mounted.current) return;
        if (outcome === 'granted' && pendingJournalUnreadable()) clearPending();
        const after = useEntitlement.getState().entitlement;
        setPending(livePending(after?.paidUntil));
        setNote(claimNote(outcome, after, entitlement?.plan === 'pro', ru));
      }
    } catch (e) {
      if (!owns() || !mounted.current) return;
      const code = e instanceof ApiFailure ? e.code : '';
      if (code === 'billing_price_changed') { setChanged(true); retry(); }
      setNote(code === 'billing_price_changed'
        ? ru ? 'Цена изменилась. Проверьте новую сумму и подтвердите оплату ещё раз.' : 'The price changed. Review the new total and confirm again.'
        : code === 'billing_storage_unavailable' || code === 'billing_journal_unavailable'
          ? ru ? 'Не удалось сохранить заказ на устройстве. Разрешите хранение данных и повторите. Оплата не открывалась.' : 'Could not save the order on this device. Allow storage and retry. Checkout was not opened.'
          : code === 'billing_unavailable'
            ? ru ? 'Оплата временно недоступна. Попробуйте позже.' : 'Payments are temporarily unavailable. Please try later.'
            : ru ? 'Не удалось связаться с сервером. Проверьте соединение и повторите.' : 'Could not reach the server. Check your connection and retry.');
    } finally {
      running.current = false;
      if (mounted.current && owns()) setBusy(false);
    }
  };
  if (auth) return <div className="space-y-3"><AccessFlow signupIntent="account" onRecoveryDraftChange={onRecoveryDraftChange} onContinue={() => { setAuth(false); retry(); }} onCancel={onCancelAccess ?? (() => setAuth(false))} /><p className="text-sm text-muted">{ru ? 'После входа вы вернётесь к выбранному сроку. Оплата — отдельным шагом.' : 'After signing in, return to your selected period. Payment is a separate step.'}</p></div>;
  return <div className="pro-purchase space-y-4">
    {catalog.state === 'loading' && <p role="status">{ru ? 'Проверяем актуальную цену…' : 'Checking prices…'}</p>}
    {catalog.state === 'error' && <div role="status"><p>{ru ? 'Не удалось загрузить цены. Покупка пока недоступна.' : 'Could not load prices. Checkout is unavailable.'}</p><Button variant="ghost" onClick={retry}>{ru ? 'Повторить загрузку цены' : 'Retry price'}</Button></div>}
    {catalog.state === 'ready' && <>
      {!pending && catalog.value.campaign && <p className="pro-campaign-date">{catalog.value.campaign.title} · {ru ? 'до ' : 'until '}{campaignDeadline(catalog.value.campaign.endsAt, ru)}</p>}
      {!pending && !journalBlocked && <PlanChoices value={catalog.value} selected={plan?.code ?? selected} select={code => { setSelected(code); setChanged(false); }} ru={ru} disabled={busy || !canBuy} />}
      {!canBuy && <p role="status">{ru ? 'Оплата временно недоступна.' : 'Payments are temporarily unavailable.'}</p>}
    </>}
    {journalBlocked && <p role="alert" className="pro-access-note">{ru ? 'Не удалось прочитать запись заказа. Сначала проверьте оплату в своём аккаунте. Если она не найдена, ' : 'Could not read the order record. Check payment in your account first. If it cannot be found, '}<Link className="text-teal underline" to="/support">{ru ? 'напишите в поддержку' : 'contact support'}</Link>.</p>}
    {!pending && <div className="pro-sale-benefits"><span><AppIcon name="pro" />{ru ? 'Объяснения и подсказки ИИ' : 'AI explanations and hints'}</span><span><AppIcon name="progress" />{ru ? 'Синхронизация занятий' : 'Learning across devices'}</span></div>}
    {state === 'pro' && <p className="pro-access-note">{ru ? 'Оплаченные дни добавятся к текущему сроку Pro после подтверждения платежа.' : 'Paid days are added to your current Pro period after payment confirmation.'}</p>}
    {state === 'trial' && <p className="pro-access-note">{ru ? 'Платный срок начнётся после оплаты. Остаток пробного периода не прибавляется.' : 'The paid period starts after payment. Remaining trial days are not added.'}</p>}
    {pending ? <div className="pro-access-note" role="status"><strong>{ru ? 'Платёж ещё не подтверждён' : 'Payment is not confirmed yet'}</strong><p>{ru ? 'Проверьте существующий заказ. Не оплачивайте повторно.' : 'Check your existing order. Do not pay again.'}</p>{pending.amountKopecks != null && <p>{formatPrice(pending.amountKopecks)} {ru ? 'всего' : 'total'}</p>}</div> : plan && <div className="pro-selection-summary" aria-live="polite"><span>{planLabel(plan.days, ru)} Pro · {plan.days} {ru ? 'дней' : 'days'}</span><strong>{formatPrice(plan.priceKopecks)} {ru ? 'всего' : 'total'}</strong></div>}
    <div className="pro-purchase-actions">
      {pending?.paymentUrl && pending.paymentUrl.startsWith('https://auth.robokassa.ru/Merchant/Index.aspx?') && <Button disabled={busy} onClick={() => { if (pending.paymentUrl) checkout(pending.paymentUrl); }}>{ru ? 'Вернуться к оплате заказа' : 'Return to order checkout'}</Button>}
      {!pending && !journalBlocked && canBuy && plan && (status === 'anonymous' || !!entitlement) && <Button className="min-h-12" disabled={busy} onClick={() => { setChanged(false); void run('buy'); }}>{busy ? ru ? 'Готовим оплату…' : 'Preparing checkout…' : status !== 'authenticated' ? ru ? 'Войти и выбрать оплату' : 'Sign in and choose payment' : `${changed ? ru ? 'Подтвердить новую цену' : 'Confirm new price' : state === 'pro' || state === 'expired' ? ru ? 'Продлить Pro' : 'Extend Pro' : ru ? 'Перейти к оплате' : 'Continue to payment'} · ${formatPrice(plan.priceKopecks)}`}</Button>}
      {status === 'authenticated' && <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void run('check')}>{pending ? ru ? 'Проверить оплату' : 'Check payment' : ru ? 'Я уже оплатил(а)' : 'I already paid'}</Button>}
    </div>
    {note && <p role="status" className="text-sm text-muted">{note}</p>}
    <details className="pro-sale-conditions"><summary>{ru ? 'Условия предложения' : 'Offer terms'}</summary><p>{ru ? 'Одна оплата за весь выбранный срок: 30, 90 или 365 дней. Без автоматических списаний. После окончания останется бесплатный режим. У помощи ИИ есть лимит использования.' : 'One payment for the entire period: 30, 90 or 365 days. No automatic charges. Free learning remains after expiry. AI use is limited.'}</p><Link to="/terms" className="text-teal underline">{ru ? 'Условия и публичная оферта' : 'Terms and public offer'}</Link></details>
  </div>;
}
