import { subscriptionState } from './entitlement';
import type { Entitlement } from './contract';
import type { PendingPayment } from './billing';

/**
 * The end of a subscription, before it happens.
 *
 * Nothing renews itself here, so expiry is not an edge case — it is guaranteed to arrive for every
 * person who has ever paid. Until now the only notice of it was a date on one line in settings, which
 * you had to go and look at.
 */

/** One threshold, no escalation. A second, louder reminder buys nothing from someone who read the
 *  first one and decided to let it lapse. */
export const REMIND_WITHIN_MS = 3 * 86_400_000;

const DISMISS_KEY = 'dayenglish.billing.remindDismissed';

export type ExpiryReminder = { paidUntil: number; today: boolean };

/**
 * Whether to say anything, and what date to say it about. Every input is an argument: this decides,
 * it does not look things up.
 *
 * `pending` must be what `livePending` returns rather than the stored record. A token whose payment has
 * already landed is exactly the thing `livePending` forgets, and silencing the reminder on a dead token
 * is the same mistake that once left a paid subscription reading "checking your payment".
 */
export function expiryReminder(
  e: Entitlement | null,
  pending: PendingPayment | null,
  dismissedFor: number | null,
  now: number
): ExpiryReminder | null {
  // Only someone who still has something to lose. An expired plan needs a different sentence, and a
  // trial running out is not this feature.
  if (subscriptionState(e, now) !== 'pro') return null;
  const paidUntil = e?.paidUntil;
  if (paidUntil == null || paidUntil - now > REMIND_WITHIN_MS) return null;
  if (dismissedFor === paidUntil) return null;
  // Silent only for a payment that belongs to THIS period of THIS account. "Any payment in flight"
  // fails twice over: the token lives three days and so does this threshold, so someone who opened
  // checkout and changed their mind at the bank would be silenced for the whole run-up — `BillingFailPage`
  // deliberately keeps the token — and a token is never cleared on sign-out, so one account's abandoned
  // checkout would mute the warning for the next account on the same device.
  if (pending != null && pending.paidUntilAtStart === paidUntil) return null;
  // Calendar day in the device's timezone, not "less than 24 hours left": a duration test says "today"
  // at eleven the previous night. The cost is that someone near a date line can be told "today" about
  // what the server still calls tomorrow — their day is the one they live in.
  return { paidUntil, today: new Date(paidUntil).toDateString() === new Date(now).toDateString() };
}

/**
 * One record, overwritten — not one key per period. Keyed per period it would leave an entry behind on
 * every renewal with nothing to ever collect them. The dismissal is tied to the account AND the date,
 * so the next period asks again instead of inheriting the last refusal.
 *
 * Deliberately not synced: writing to sync is a paid feature, and someone whose plan is ending is about
 * to lose it. Seeing the reminder again on a second device is the cheaper failure.
 */
export function readDismissed(accountId: string | null): number | null {
  if (!accountId) return null;
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as { accountId?: string; paidUntil?: number };
    return d?.accountId === accountId && typeof d.paidUntil === 'number' ? d.paidUntil : null;
  } catch {
    return null;
  }
}

export function dismissReminder(accountId: string | null, paidUntil: number): void {
  if (!accountId) return;
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ accountId, paidUntil }));
  } catch {
    // Private mode or a full quota: the reminder simply shows again next time.
  }
}
