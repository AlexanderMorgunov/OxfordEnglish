import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Eyebrow } from '@/shared/ui';
import * as api from './api';
import { ApiFailure } from './api';
import { useEntitlement } from './entitlement';
import { beginCheckout, claimPurchase, readPending, formatPrice, type PendingPayment } from './billing';
import type { BillingPlan, Entitlement } from './contract';

/**
 * Settings → Account → the plan, and the one place a subscription can be bought.
 *
 * The paywall states the price the SERVER quotes — nothing here hardcodes an amount — and hides itself
 * entirely when payments are switched off, so a build without acquirer credentials shows a plan and no
 * dead button.
 */

const date = (ms: number, ru: boolean): string =>
  new Date(ms).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' });

function planLine(e: Entitlement, ru: boolean): string {
  if (e.plan === 'pro') {
    return ru
      ? `Pro — активна до ${e.paidUntil ? date(e.paidUntil, ru) : '—'}`
      : `Pro — active until ${e.paidUntil ? date(e.paidUntil, ru) : '—'}`;
  }
  if (e.plan === 'trial') {
    return ru
      ? `Пробный период — до ${e.trialEndsAt ? date(e.trialEndsAt, ru) : '—'}`
      : `Free trial — until ${e.trialEndsAt ? date(e.trialEndsAt, ru) : '—'}`;
  }
  // `trialEndsAt` on a free plan means the trial has been used and has run out (server `evaluate`).
  if (e.trialEndsAt) return ru ? `Пробный период закончился ${date(e.trialEndsAt, ru)}` : `Your free trial ended on ${date(e.trialEndsAt, ru)}`;
  return ru ? 'Бесплатный план' : 'Free plan';
}

const PRO_PITCH_RU = 'Pro открывает разборы, упрощение текста и перевод в контексте предложения — на нашем ключе, без настройки.';
const PRO_PITCH_EN = 'Pro unlocks explanations, text simplification and in-context translation — on our key, with nothing to set up.';

export function PlanSection({ ru }: { ru: boolean }) {
  const entitlement = useEntitlement((s) => s.entitlement);
  const claimTrial = useEntitlement((s) => s.claimTrial);
  const [plans, setPlans] = useState<{ available: boolean; plans: BillingPlan[] } | null>(null);
  const [pending, setPending] = useState<PendingPayment | null>(() => readPending());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .billingPlans()
      .then((p) => alive && setPlans(p))
      // Offline or billing down: the section still shows the plan, just without a buy button.
      .catch(() => alive && setPlans({ available: false, plans: [] }));
    return () => {
      alive = false;
    };
  }, []);

  if (!entitlement) return null;

  const monthly = plans?.plans.find((p) => p.code === 'pro_month');
  const canBuy = !!plans?.available && !!monthly;
  const offerTrial = entitlement.plan === 'free' && !entitlement.trialEndsAt;

  const onTrial = async () => {
    setBusy(true);
    setNote(null);
    const ok = await claimTrial();
    if (!ok) setNote(ru ? 'Пробный период уже использован на этом устройстве.' : 'The free trial has already been used on this device.');
    setBusy(false);
  };

  const onBuy = async () => {
    if (!monthly) return;
    setBusy(true);
    setNote(null);
    try {
      // A full navigation, not a popup: mobile browsers block popups opened after an await, and the
      // payment page must be the thing the user is actually looking at.
      window.location.assign(await beginCheckout(monthly.code));
    } catch (e) {
      setBusy(false);
      setNote(
        e instanceof ApiFailure && e.code === 'billing_unavailable'
          ? ru
            ? 'Оплата временно недоступна. Попробуйте позже.'
            : 'Payments are temporarily unavailable. Please try again later.'
          : ru
            ? 'Не удалось открыть оплату. Проверьте соединение.'
            : 'Could not open checkout. Check your connection.'
      );
    }
  };

  const onCheckPayment = async () => {
    setBusy(true);
    setNote(null);
    const outcome = await claimPurchase(3, 2000);
    setPending(readPending());
    if (outcome === 'pending') {
      setNote(ru ? 'Платёж ещё не подтверждён. Обычно это занимает пару минут.' : 'The payment is not confirmed yet. This usually takes a couple of minutes.');
    }
    if (outcome === 'none') {
      setNote(
        ru
          ? 'Неоплаченных или неполученных покупок за этим аккаунтом не числится.'
          : 'This account has no purchase outstanding.'
      );
    }
    setBusy(false);
  };

  return (
    <section className="mt-5 border-t border-line pt-4">
      <Eyebrow>{ru ? 'Подписка' : 'Subscription'}</Eyebrow>
      <p className="mt-1 text-sm text-content">{planLine(entitlement, ru)}</p>

      {entitlement.active && entitlement.ai.limit > 0 && (
        <p className="mt-1 text-2xs text-muted">
          {ru
            ? `ИИ-запросы: ${entitlement.ai.used} из ${entitlement.ai.limit}`
            : `AI requests: ${entitlement.ai.used} of ${entitlement.ai.limit}`}
        </p>
      )}

      {entitlement.plan !== 'pro' && <p className="mt-2 text-sm text-muted text-pretty">{ru ? PRO_PITCH_RU : PRO_PITCH_EN}</p>}

      {pending && (
        <p role="status" className="mt-3 rounded-sm border border-line bg-surface px-3 py-2 text-sm text-muted text-pretty">
          {ru
            ? 'Платёж обрабатывается. Подписка включится автоматически, как только банк подтвердит оплату.'
            : 'A payment is being processed. The plan switches on automatically once the bank confirms it.'}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {offerTrial && (
          <Button size="sm" disabled={busy} onClick={() => void onTrial()}>
            {ru ? 'Попробовать 14 дней бесплатно' : 'Try 14 days free'}
          </Button>
        )}
        {canBuy && (
          <Button size="sm" variant={offerTrial ? 'ghost' : 'primary'} disabled={busy} onClick={() => void onBuy()}>
            {entitlement.plan === 'pro'
              ? ru
                ? `Продлить — ${formatPrice(monthly.priceKopecks)}`
                : `Extend — ${formatPrice(monthly.priceKopecks)}`
              : ru
                ? `Оформить Pro — ${formatPrice(monthly.priceKopecks)}/мес`
                : `Get Pro — ${formatPrice(monthly.priceKopecks)}/mo`}
          </Button>
        )}
        {/* Not only when this device knows about a payment: the token lives in one device's storage,
            so "I paid on my phone" is exactly the case that needs a button here. */}
        {entitlement.plan !== 'pro' && canBuy && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onCheckPayment()}>
            {ru ? 'Я уже оплатил(а)' : 'I already paid'}
          </Button>
        )}
      </div>

      {note && (
        <p role="status" className="mt-2 text-2xs text-muted text-pretty">
          {note}
        </p>
      )}

      {/* The offer has to be reachable AT the moment of purchase, not only from a settings menu — it is
          the contract the payment accepts, and the acquirer requires it to be published. */}
      {canBuy && (
        <p className="mt-3 text-2xs text-muted text-pretty">
          {ru ? 'Оплачивая, вы принимаете ' : 'By paying you accept the '}
          <Link to="/terms" className="text-teal hover:underline">
            {ru ? 'условия и публичную оферту' : 'terms and public offer'}
          </Link>
          {ru ? '. Подписка не продлевается автоматически.' : '. The subscription does not renew automatically.'}
        </p>
      )}
    </section>
  );
}
