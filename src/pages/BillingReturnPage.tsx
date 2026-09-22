import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useEntitlement } from '@/features/account/entitlement';
import { claimPurchase, livePending, type ClaimOutcome } from '@/features/account/billing';

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

/**
 * ONE value decides the heading, the wording and the buttons.
 *
 * They used to be worked out separately, and drifted: the heading read "Subscription active" over a
 * paragraph apologising that the bank had not confirmed anything yet, and a state with no paragraph of
 * its own left the page blank under "No payment found". Whatever this page gets wrong now, it will at
 * least say the same wrong thing three times instead of three different ones.
 */
type View = 'checking' | 'active' | 'pending' | 'none' | 'offline';

export function BillingSuccessPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const entitlement = useEntitlement((s) => s.entitlement);
  const [state, setState] = useState<'claiming' | ClaimOutcome>('claiming');
  /**
   * The entitlement outranks the claim outcome. A grant redeemed on another device leaves this one
   * unable to redeem anything — 'pending' forever — while the subscription it is asking about has been
   * live the whole time. Asking the server what the account HAS beats asking what this tab managed to do.
   *
   * Kept in state rather than computed while rendering, because `livePending` forgets a settled token
   * as a side effect, and a render is no place for that.
   */
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    setSettled(entitlement?.plan === 'pro' && !livePending(entitlement.paidUntil));
  }, [entitlement?.plan, entitlement?.paidUntil]);

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

  const view: View =
    state === 'claiming'
      ? 'checking'
      : state === 'granted' || settled
        ? 'active'
        : state === 'unreachable'
          ? 'offline'
          : state === 'pending'
            ? 'pending'
            : 'none';

  const paidUntil =
    entitlement?.paidUntil != null
      ? new Date(entitlement.paidUntil).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;

  const heading: Record<View, string> = {
    checking: ru ? 'Проверяем оплату' : 'Checking your payment',
    active: ru ? 'Подписка активна' : 'Subscription active',
    pending: ru ? 'Платёж ещё подтверждается' : 'The payment is still being confirmed',
    none: ru ? 'Платёж не найден' : 'No payment found',
    offline: ru ? 'Не удалось проверить' : 'Could not check',
  };

  const body: Record<View, string> = {
    checking: ru ? 'Подтверждаем платёж…' : 'Confirming the payment…',
    active: ru
      ? `Спасибо. Pro активен${paidUntil ? ` до ${paidUntil}` : ''} — разборы, упрощение и перевод в контексте уже включены.`
      : `Thank you. Pro is active${paidUntil ? ` until ${paidUntil}` : ''} — explanations, simplification and in-context translation are on.`,
    pending: ru
      ? 'Банк ещё не подтвердил оплату. Обычно это занимает пару минут, и подписка включится сама — можно просто вернуться к занятиям. Если через час ничего не изменится, напишите нам.'
      : 'The bank has not confirmed the payment yet. It usually takes a couple of minutes and the plan switches on by itself — you can just go back to studying. If nothing changes within an hour, get in touch.',
    none: ru
      ? 'Незавершённых платежей за этим аккаунтом не числится. Если деньги списаны, а подписки нет — напишите нам, укажите дату и сумму: платёж найдётся по ним.'
      : 'This account has no payment outstanding. If you were charged and have no plan, get in touch with the date and amount — that is enough to find the payment.',
    // Not a verdict about the payment — a verdict about us. The common cause is no session in THIS
    // browser: a bank app opens the return link in its own, where nobody is signed in. Saying "no
    // payment" there would be a lie told to someone who has just been charged.
    offline: ru
      ? 'Не получилось связаться с сервером или в этом браузере нет входа в аккаунт. Деньги, если они списаны, никуда не делись: откройте приложение, войдите — и подписка подтянется. Можно проверить ещё раз.'
      : 'We could not reach the server, or nobody is signed in to this browser. If you were charged, nothing is lost: open the app, sign in, and the plan follows. You can also check again.',
  };

  const canRetry = view === 'pending' || view === 'offline';
  const canAskForHelp = view === 'pending' || view === 'none' || view === 'offline';

  return (
    <section aria-label={ru ? 'Оплата' : 'Payment'}>
      <Eyebrow>{ru ? 'Оплата' : 'Payment'}</Eyebrow>
      <h1 className="mb-3 mt-1 text-2xl font-bold tracking-tight">{heading[view]}</h1>

      <p role="status" aria-live="polite" className="mb-4 max-w-prose text-muted text-pretty">
        {body[view]}
      </p>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/"
          className="inline-flex items-center rounded-sm border border-teal-dim bg-teal-dim/10 px-3 py-2 font-mono text-xs tracking-[0.02em] transition-colors hover:border-teal"
        >
          {ru ? 'К занятиям' : 'Back to studying'}
        </Link>
        {canRetry && (
          <Button size="sm" variant="ghost" onClick={() => void retry()}>
            {ru ? 'Проверить ещё раз' : 'Check again'}
          </Button>
        )}
        {canAskForHelp && (
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
  const entitlement = useEntitlement((s) => s.entitlement);
  // Through `livePending` like everywhere else, and in an effect because it forgets a settled token as
  // a side effect: a purchase the account has already been given is not a reason to mention payment.
  const [pending, setPending] = useState(false);
  useEffect(() => {
    setPending(livePending(entitlement?.paidUntil) !== null);
  }, [entitlement?.paidUntil]);

  return (
    <section aria-label={ru ? 'Оплата не прошла' : 'Payment not completed'}>
      <Eyebrow>{ru ? 'Оплата' : 'Payment'}</Eyebrow>
      <h1 className="mb-3 mt-1 text-2xl font-bold tracking-tight">{ru ? 'Оплата не прошла' : 'Payment not completed'}</h1>
      <p className="mb-4 max-w-prose text-muted text-pretty">
        {/* Never "you have not been charged" as a flat statement — we do not know that. The acquirer
            tells us a payment did not complete, which is also what a charge we have not heard about
            yet looks like, and contradicting ourselves two sentences later helped nobody. */}
        {ru
          ? 'Банк сообщил, что оплата не завершена. Обычно это значит, что деньги не списаны — можно просто попробовать ещё раз, всё остальное в приложении работает как обычно.'
          : 'The bank reported the payment did not complete. That usually means you were not charged — you can simply try again, and everything else in the app keeps working.'}
        {pending &&
          (ru
            ? ' Если деньги всё же списались, нажмите «Я уже оплатил(а)» в настройках аккаунта.'
            : ' If you were charged after all, use “I have already paid” in account settings.')}
      </p>
      <Link to="/settings" className="text-sm text-teal hover:underline">
        {ru ? 'Настройки аккаунта' : 'Account settings'}
      </Link>
    </section>
  );
}
