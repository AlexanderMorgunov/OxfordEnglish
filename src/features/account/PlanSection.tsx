import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Eyebrow } from '@/shared/ui';
import * as api from './api';
import { ApiFailure } from './api';
import { useEntitlement, type TrialClaim } from './entitlement';
import { beginCheckout, claimPurchase, livePending, formatPrice, type PendingPayment } from './billing';
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

/** One sentence per outcome. This used to be a single line for every failure, which told people the
 *  trial was already used even when the request had never left the device. */
function trialNote(outcome: Exclude<TrialClaim, 'ok'>, ru: boolean): string {
  if (outcome === 'already-claimed') {
    return ru ? 'Пробный период уже использован на этом устройстве.' : 'The free trial has already been used on this device.';
  }
  if (outcome === 'network') {
    return ru
      ? 'Не удалось связаться с сервером. Если подписка всё же оформилась, она появится здесь сама.'
      : 'Could not reach the server. If the trial did start, it will show up here on its own.';
  }
  return ru ? 'Не получилось начать пробный период. Попробуйте ещё раз.' : 'Could not start the free trial. Please try again.';
}

const PRO_PITCH_RU = 'Pro открывает разборы, упрощение текста и перевод в контексте предложения — на нашем ключе, без настройки.';
const PRO_PITCH_EN = 'Pro unlocks explanations, text simplification and in-context translation — on our key, with nothing to set up.';

export function PlanSection({ ru }: { ru: boolean }) {
  const entitlement = useEntitlement((s) => s.entitlement);
  const claimTrial = useEntitlement((s) => s.claimTrial);
  const [plans, setPlans] = useState<{ available: boolean; plans: BillingPlan[] } | null>(null);
  // Re-derived from the entitlement rather than read once: a grant redeemed on another device leaves
  // this one holding a token that is valid-looking and dead, and believing it put "a payment is being
  // processed" under a subscription that was already live.
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    setPending(livePending(entitlement?.paidUntil));
  }, [entitlement?.paidUntil]);

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

  // Entitlement is deliberately never cached (see entitlement.ts), so `null` is an ordinary state for a
  // PAYING subscriber offline or on a cold start. Vanishing the whole block there left them with no
  // plan, no expiry and no way to re-check a payment. Show a placeholder — never a stale "pro", which
  // would promise a feature the server then refuses.
  if (!entitlement) {
    return (
      <section className="mt-5 border-t border-line pt-4">
        <Eyebrow>{ru ? 'Подписка' : 'Subscription'}</Eyebrow>
        <p role="status" className="mt-1 text-sm text-muted text-pretty">
          {ru
            ? 'Не удалось проверить план — нет связи с сервером. Появится, как только связь вернётся.'
            : 'Could not check your plan — no connection to the server. It will appear once the connection is back.'}
        </p>
        <p className="mt-2 text-2xs text-muted">
          <Link to="/pro" className="text-teal hover:underline">
            {ru ? 'Что входит в Pro' : "What's in Pro"}
          </Link>
        </p>
      </section>
    );
  }

  const monthly = plans?.plans.find((p) => p.code === 'pro_month');
  const canBuy = !!plans?.available && !!monthly;
  const offerTrial = entitlement.plan === 'free' && !entitlement.trialEndsAt;

  const onTrial = async () => {
    setBusy(true);
    setNote(null);
    const outcome = await claimTrial();
    if (outcome !== 'ok') setNote(trialNote(outcome, ru));
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
    setPending(livePending(useEntitlement.getState().entitlement?.paidUntil));
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
    // Saying "nothing outstanding" here would be a statement about the account made without an answer
    // from the server — the one thing that could actually say it.
    if (outcome === 'unreachable') {
      setNote(
        ru
          ? 'Не удалось связаться с сервером — проверить покупку сейчас нельзя. Попробуйте ещё раз, когда появится связь.'
          : 'Could not reach the server, so the purchase cannot be checked right now. Try again once you are back online.'
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

      {canBuy && entitlement.plan !== 'pro' && (
        <p className="mt-3 text-2xs text-muted text-pretty">
          {ru
            ? 'Подписка — единственный доход проекта: она оплачивает серверы и ключ ИИ и позволяет остальному оставаться бесплатным.'
            : 'The subscription is the project’s only income: it pays for the servers and the AI key, and keeps everything else free.'}{' '}
          <Link to="/pro" className="text-teal hover:underline">
            {ru ? 'Подробнее' : 'More'}
          </Link>
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
