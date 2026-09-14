import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useEntitlement } from '@/features/account/entitlement';
import { claimPurchase, readPending, type ClaimOutcome } from '@/features/account/billing';

/**
 * Where the acquirer sends the payer back to.
 *
 * Nothing is granted by arriving here — this page only redeems a token the payment callback has already
 * confirmed. That distinction is the whole security of the flow: the return URL is signed with a
 * password the payer's own address bar has seen, while the callback is not.
 *
 * It also has to survive losing the race. The browser regularly gets back before the server-to-server
 * notification does, so the first attempt failing is the NORMAL case, not an error, and saying "payment
 * failed" to someone who has just been charged is the one outcome worth engineering against.
 */
export function BillingSuccessPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const entitlement = useEntitlement((s) => s.entitlement);
  const [state, setState] = useState<'claiming' | ClaimOutcome>('claiming');

  useEffect(() => {
    let alive = true;
    void claimPurchase(10, 3000).then((outcome) => alive && setState(outcome));
    return () => {
      alive = false;
    };
  }, []);

  const retry = async () => {
    setState('claiming');
    setState(await claimPurchase(3, 2000));
  };

  const paidUntil =
    entitlement?.paidUntil != null
      ? new Date(entitlement.paidUntil).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

  return (
    <section aria-label={ru ? 'Оплата' : 'Payment'}>
      <Eyebrow>{ru ? 'Оплата' : 'Payment'}</Eyebrow>
      <h1 className="mb-3 mt-1 text-2xl font-bold tracking-tight">
        {state === 'granted' ? (ru ? 'Подписка активна' : 'Subscription active') : ru ? 'Проверяем оплату' : 'Checking your payment'}
      </h1>

      <p role="status" aria-live="polite" className="mb-4 max-w-prose text-muted text-pretty">
        {state === 'claiming' && (ru ? 'Подтверждаем платёж…' : 'Confirming the payment…')}
        {state === 'granted' &&
          (ru
            ? `Спасибо. Pro активен${paidUntil ? ` до ${paidUntil}` : ''} — разборы, упрощение и перевод в контексте уже включены.`
            : `Thank you. Pro is active${paidUntil ? ` until ${paidUntil}` : ''} — explanations, simplification and in-context translation are on.`)}
        {state === 'pending' &&
          (ru
            ? 'Банк ещё не подтвердил оплату. Обычно это занимает пару минут, и подписка включится сама — можно просто вернуться к занятиям. Если через час ничего не изменится, напишите нам.'
            : 'The bank has not confirmed the payment yet. It usually takes a couple of minutes and the plan switches on by itself — you can just go back to studying. If nothing changes within an hour, get in touch.')}
        {state === 'none' &&
          (ru
            ? 'Незавершённых платежей за этим аккаунтом не числится. Если деньги списаны, а подписки нет — напишите нам, укажите дату и сумму: платёж найдётся по ним.'
            : 'This account has no payment outstanding. If you were charged and have no plan, get in touch with the date and amount — that is enough to find the payment.')}
      </p>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/"
          className="inline-flex items-center rounded-sm border border-teal-dim bg-teal-dim/10 px-3 py-2 font-mono text-xs tracking-[0.02em] transition-colors hover:border-teal"
        >
          {ru ? 'К занятиям' : 'Back to studying'}
        </Link>
        {state === 'pending' && (
          <Button size="sm" variant="ghost" onClick={() => void retry()}>
            {ru ? 'Проверить ещё раз' : 'Check again'}
          </Button>
        )}
        {(state === 'pending' || state === 'none') && (
          <Link to="/support" className="self-center text-sm text-teal hover:underline">
            {ru ? 'Поддержка' : 'Support'}
          </Link>
        )}
      </div>
    </section>
  );
}

/** The acquirer's FailURL. A cancelled or declined payment leaves the pending token alone on purpose:
 *  a decline at the bank and a payment we have simply not heard about yet look identical from here. */
export function BillingFailPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const pending = readPending();
  return (
    <section aria-label={ru ? 'Оплата не прошла' : 'Payment not completed'}>
      <Eyebrow>{ru ? 'Оплата' : 'Payment'}</Eyebrow>
      <h1 className="mb-3 mt-1 text-2xl font-bold tracking-tight">{ru ? 'Оплата не прошла' : 'Payment not completed'}</h1>
      <p className="mb-4 max-w-prose text-muted text-pretty">
        {ru
          ? 'Платёж отменён или отклонён банком. Деньги не списаны. Можно попробовать ещё раз — всё остальное в приложении продолжает работать как обычно.'
          : 'The payment was cancelled or declined. You have not been charged. You can try again — everything else in the app keeps working as usual.'}
        {pending &&
          (ru
            ? ' Если деньги всё же списались, откройте «Проверить оплату» в настройках аккаунта.'
            : ' If you were charged after all, use “Check payment” in account settings.')}
      </p>
      <Link to="/settings" className="text-sm text-teal hover:underline">
        {ru ? 'Настройки аккаунта' : 'Account settings'}
      </Link>
    </section>
  );
}
