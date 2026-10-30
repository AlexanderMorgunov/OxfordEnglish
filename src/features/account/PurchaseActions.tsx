import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { ApiFailure } from './api';
import { useEntitlement, subscriptionState } from './entitlement';
import { captureAccountSessionOwner, useAccount } from './store';
import { beginCheckout, claimNote, claimPurchase, formatPrice, livePending, type PendingPayment } from './billing';
import { useBillingCatalog } from './useBillingCatalog';

export function PurchaseActions() {
  const session = useAccount(s => s.sessionRevision);
  return <PurchaseActionsBody key={session} />;
}

function PurchaseActionsBody() {
  const ru = useUiLang(s => s.lang) === 'ru';
  const entitlement = useEntitlement(s => s.entitlement);
  const { catalog, monthly, canBuy, retry } = useBillingCatalog();
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setPending(livePending(entitlement?.paidUntil)); }, [entitlement?.paidUntil]);
  const state = subscriptionState(entitlement, Date.now());

  const run = async (action: 'buy' | 'check') => {
    if (running.current) return;
    running.current = true; setBusy(true); setNote('');
    const owns = captureAccountSessionOwner();
    try {
      if (action === 'buy') {
        if (!monthly || !canBuy) return;
        const url = await beginCheckout(monthly.code);
        if (owns() && mounted.current) window.location.assign(url);
      } else {
        const outcome = await claimPurchase(3, 2000);
        if (!owns() || !mounted.current) return;
        const after = useEntitlement.getState().entitlement;
        setPending(livePending(after?.paidUntil));
        setNote(claimNote(outcome, after, entitlement?.plan === 'pro', ru));
      }
    } catch (e) {
      if (!owns() || !mounted.current) return;
      setNote(e instanceof ApiFailure && e.code === 'billing_unavailable'
        ? ru ? 'Оплата временно недоступна. Попробуйте позже.' : 'Payments are temporarily unavailable. Please try again later.'
        : ru ? 'Не удалось связаться с сервером. Проверьте соединение и повторите.' : 'Could not reach the server. Check your connection and retry.');
    } finally {
      running.current = false;
      if (mounted.current && owns()) setBusy(false);
    }
  };
  return <div className="space-y-3">
    {pending && <p role="status" className="rounded-sm border border-line bg-surface p-3 text-sm text-muted">{state === 'pro'
      ? ru ? 'Платёж обрабатывается. Срок Pro обновится после подтверждения оплаты.' : 'Your payment is being processed. Your Pro period updates after confirmation.'
      : ru ? 'Платёж обрабатывается. Подписка включится после подтверждения оплаты.' : 'A payment is being processed. The plan starts after payment is confirmed.'}</p>}
    {catalog.state === 'loading' && <p role="status" className="text-sm text-muted">{ru ? 'Проверяем цену…' : 'Checking the price…'}</p>}
    {catalog.state === 'error' && <div role="status" className="space-y-2 text-sm text-muted">
      <p>{ru ? 'Не удалось загрузить цену. Покупка пока недоступна.' : 'Could not load the price. Checkout is not available yet.'}</p>
      <Button variant="ghost" className="min-h-11" onClick={retry}>{ru ? 'Повторить загрузку цены' : 'Retry price'}</Button>
    </div>}
    {catalog.state === 'ready' && !canBuy && <p className="text-sm text-muted">{ru ? 'Оплата временно недоступна.' : 'Payments are temporarily unavailable.'}</p>}
    <div className="flex flex-wrap gap-2">
      {entitlement && canBuy && monthly && <Button className="min-h-11" disabled={busy} onClick={() => void run('buy')}>
        {state === 'pro' || state === 'expired'
          ? ru ? `Продлить — ${formatPrice(monthly.priceKopecks)}` : `Extend — ${formatPrice(monthly.priceKopecks)}`
          : ru ? `Оформить Pro — ${formatPrice(monthly.priceKopecks)}` : `Get Pro — ${formatPrice(monthly.priceKopecks)}`}
      </Button>}
      <Button variant="ghost" className="min-h-11" disabled={busy} onClick={() => void run('check')}>{busy ? ru ? 'Проверяем…' : 'Checking…' : ru ? 'Я уже оплатил(а)' : 'I already paid'}</Button>
    </div>
    {note && <p role="status" className="text-sm text-muted">{note}</p>}
    {canBuy && monthly && <p className="text-xs leading-relaxed text-muted">{ru ? `Оплата за ${monthly.days} дней. Без автоматического продления. Оплачивая, вы принимаете ` : `Payment covers ${monthly.days} days. No automatic renewal. By paying you accept the `}
      <Link to="/terms" className="text-teal underline">{ru ? 'условия и публичную оферту' : 'terms and public offer'}</Link>.
    </p>}
  </div>;
}
