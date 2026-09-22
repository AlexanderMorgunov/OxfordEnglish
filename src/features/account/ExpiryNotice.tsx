import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import { livePending, type PendingPayment } from './billing';
import { dismissReminder, expiryReminder, readDismissed } from './expiry';

const date = (ms: number, ru: boolean): string =>
  new Date(ms).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' });

/**
 * A line on the dashboard when a subscription is about to run out — the only channel there is: no email
 * addresses are collected and the app has no push.
 *
 * A line rather than a dialog, and no price. The dashboard reads no account data today; fetching the
 * price list here would add a request for every visitor and a second road to checkout, which is the
 * last thing a codebase that already loses a month to double payment needs. Renewing happens where it
 * always did.
 */
export function ExpiryNotice({ ru }: { ru: boolean }) {
  const entitlement = useEntitlement((s) => s.entitlement);
  const accountId = useAccount((s) => s.accountId);
  const [pending, setPending] = useState<PendingPayment | null>(null);
  const [dismissed, setDismissed] = useState<number | null>(null);

  // Both read storage, and `livePending` also clears it — neither belongs in render.
  useEffect(() => {
    setPending(livePending(entitlement?.paidUntil));
  }, [entitlement?.paidUntil]);
  useEffect(() => {
    setDismissed(readDismissed(accountId));
  }, [accountId]);

  const reminder = expiryReminder(entitlement, pending, dismissed, Date.now());
  if (!reminder) return null;

  const text = reminder.today
    ? ru
      ? 'Подписка Pro заканчивается сегодня.'
      : 'Your Pro subscription ends today.'
    : ru
      ? `Подписка Pro заканчивается ${date(reminder.paidUntil, ru)}.`
      : `Your Pro subscription ends on ${date(reminder.paidUntil, ru)}.`;

  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-sm border border-line bg-surface px-3 py-2 text-sm text-muted"
    >
      <p className="text-pretty">{text}</p>
      <span className="flex shrink-0 items-center gap-3">
        <Link to="/settings" className="text-teal hover:underline">
          {ru ? 'Продлить' : 'Renew'}
        </Link>
        <button
          type="button"
          className="text-2xs text-faint hover:text-muted"
          onClick={() => {
            dismissReminder(accountId, reminder.paidUntil);
            setDismissed(reminder.paidUntil);
          }}
        >
          {ru ? 'Скрыть' : 'Dismiss'}
        </button>
      </span>
    </div>
  );
}
