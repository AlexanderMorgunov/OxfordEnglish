import * as api from './api';
import { ApiFailure } from './api';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import type { CheckoutResponse } from './contract';

/**
 * Buying a subscription, from this device's side.
 *
 * Paying means leaving the app entirely — a full navigation to the acquirer and back — so the grant
 * token has to outlive the tab. It is kept in localStorage rather than in a store: an in-memory pending
 * payment would be gone by the time the browser comes back, and the user would have paid for nothing
 * they could claim.
 *
 * The token is worthless on its own. It buys a plan only after the acquirer's server-to-server callback
 * has confirmed the payment, and only for the account that started checkout, so storing it plainly is
 * no worse than storing the fact that a purchase is in flight.
 */

const PENDING_KEY = 'dayenglish.billing.pending';
/** A callback that never arrives is a support case, not something to retry forever — but "forever" is
 *  far shorter than the payment is worth, so the token is kept long enough to survive a bad evening. */
const PENDING_TTL_MS = 3 * 86_400_000;

export type PendingPayment = {
  grantToken: string;
  invoiceId: string;
  plan: string;
  startedAt: number;
  /**
   * How far the subscription was already paid when checkout began, so this device can tell later that
   * the payment landed — even when some OTHER device redeemed it and this token died unspent.
   *
   * "Is the plan active?" cannot answer that: paying to EXTEND an active subscription is a real case,
   * and an active plan beside a genuine payment in flight is the truth, not a contradiction. A
   * `paidUntil` that moved forward is the one signal that means this particular purchase arrived.
   */
  paidUntilAtStart: number | null;
};

export function readPending(): PendingPayment | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingPayment;
    if (typeof p?.grantToken !== 'string' || typeof p.startedAt !== 'number') return null;
    if (Date.now() - p.startedAt > PENDING_TTL_MS) {
      clearPending();
      return null;
    }
    return p;
  } catch {
    return null;
  }
}

export function clearPending(): void {
  try {
    localStorage.removeItem(PENDING_KEY);
  } catch {
    // Private mode or a full quota: the worst case is that the user re-opens the paywall.
  }
}

function savePending(c: CheckoutResponse): void {
  const pending: PendingPayment = {
    grantToken: c.grantToken,
    invoiceId: c.invoiceId,
    plan: c.plan,
    startedAt: Date.now(),
    paidUntilAtStart: useEntitlement.getState().entitlement?.paidUntil ?? null,
  };
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Nothing sensible to do — the checkout still opens, and the success page will say what to do if
    // the token is gone. Failing the purchase over a storage quota would be worse.
  }
}

/**
 * A pending payment this device still has reason to wait for — and it forgets the ones it does not.
 *
 * A token can die unspent: buy on the phone, open the laptop, and the laptop's lookup redeems the
 * grant while the phone's own token stays behind, valid-looking and worthless. Nothing cleared it, so
 * the phone kept saying a payment was being processed under a subscription that was already live, and
 * the laptop said it too. Both of them were reading a receipt instead of asking whether the goods
 * arrived.
 *
 * The entitlement settles it. `paidUntil` moving past where it stood when checkout began means this
 * purchase landed, whoever redeemed it — which an "is the plan active?" test cannot say, because
 * extending an active subscription is a real thing people do.
 */
export function livePending(paidUntil: number | null | undefined): PendingPayment | null {
  const pending = readPending();
  if (!pending) return null;
  // Absent on records written before this field existed, which reads them as a first purchase. That
  // errs towards forgetting: a banner dropped a few minutes early costs nothing — the plan arrives
  // regardless — while a banner that never goes is what makes someone pay a second time.
  const before = pending.paidUntilAtStart;
  const settled = paidUntil != null && (before == null || paidUntil > before);
  if (settled) {
    clearPending();
    return null;
  }
  return pending;
}

/** Open a checkout: returns the acquirer's payment page for the caller to navigate to. The pending
 *  token is written BEFORE anyone navigates, so a fast payment can never outrun our own bookkeeping. */
export async function beginCheckout(plan: string): Promise<string> {
  const token = await useAccount.getState().getAccessToken();
  if (!token) throw new ApiFailure('unauthorized', 401);
  const checkout = await api.startCheckout(token, plan);
  savePending(checkout);
  return checkout.paymentUrl;
}

export type ClaimOutcome =
  /** Paid and applied — the plan is live. */
  | 'granted'
  /** Nothing to claim on this device. */
  | 'none'
  /**
   * Not confirmed yet, and the token is kept for another try. There is deliberately no "failed" here:
   * an unconfirmed grant and a spent one answer `grant_invalid` alike, so the client cannot tell them
   * apart — and guessing "failed" at someone who has just been charged is the worse mistake. Stale
   * records expire on their own (PENDING_TTL_MS).
   */
  | 'pending'
  /** We could not reach the server, so we know nothing — distinct from `none`, which is the server
   *  telling us this account is owed nothing. */
  | 'unreachable';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Try to turn a pending payment into a plan.
 *
 * Retrying is the whole job. The browser returning from the acquirer RACES their server-to-server
 * callback, so the first redeem very often loses — and treating that first refusal as "the payment
 * failed" would tell someone who has just been charged that nothing happened.
 *
 * `grant_invalid` therefore means "not yet" while we are still retrying, and only becomes final when
 * the pending record is older than the window a callback could plausibly still be in flight.
 */
export async function claimPending(attempts = 10, intervalMs = 3000): Promise<ClaimOutcome> {
  const pending = readPending();
  if (!pending) return 'none';

  for (let i = 0; i < attempts; i += 1) {
    const token = await useAccount.getState().getAccessToken();
    if (!token) return 'pending';
    try {
      await api.redeemGrant(token, pending.grantToken);
      clearPending();
      await useEntitlement.getState().load();
      return 'granted';
    } catch (e) {
      // A network failure says nothing about the payment; only the server's own verdict does.
      const code = e instanceof ApiFailure ? e.code : 'network';
      if (code !== 'grant_invalid' && code !== 'network') return 'pending';
    }
    if (i < attempts - 1) await wait(intervalMs);
  }
  return 'pending';
}

/**
 * The user-facing "check my payment": the local token first, and failing that, ask the server what this
 * account has already paid for and not received.
 *
 * The server lookup exists because the token lives in ONE device's localStorage. Buying on a phone and
 * opening the laptop, or clearing site data, would otherwise leave a paying customer with no plan and no
 * way to fix it themselves. It is a separate function from `claimPending` on purpose — app boot should
 * not spend a request on this for every signed-in user.
 */
export async function claimPurchase(attempts = 5, intervalMs = 2000): Promise<ClaimOutcome> {
  const local = await claimPending(attempts, intervalMs);
  if (local === 'granted') return local;
  // Anything short of granted must still ask the server. Returning `pending` here short-circuited the
  // lookup in exactly the two cases it was built for: a token overwritten by a second checkout, and a
  // token already spent — both leaving a paid account on "payment pending" for the full three days
  // while the server held the answer all along.

  const token = await useAccount.getState().getAccessToken();
  if (!token) return local === 'pending' ? 'pending' : 'unreachable';
  try {
    const grantToken = await api.unclaimedGrant(token);
    if (!grantToken) return local === 'pending' ? 'pending' : 'none';
    await api.redeemGrant(token, grantToken);
    // Only when the server handed back OUR token. Clearing whatever is stored looks tidier and throws
    // away a second, still-unconfirmed purchase: start checkout twice, pay both, and the older grant
    // is the one the server returns first — dropping the newer token then leaves its callback with
    // nothing to redeem it. A token that is merely stale is forgotten by `livePending` instead.
    if (readPending()?.grantToken === grantToken) clearPending();
    await useEntitlement.getState().load();
    return 'granted';
  } catch (e) {
    // "No purchase on this account" is a claim about the account, and a failed request is no basis for
    // it. Only the server saying so — an answer that arrived — can mean nothing is owed.
    const code = e instanceof ApiFailure ? e.code : 'network';
    if (code === 'network') return 'unreachable';
    return local === 'pending' ? 'pending' : 'none';
  }
}

/** "199 ₽" — trailing kopecks only when there are any. */
export function formatPrice(kopecks: number): string {
  const rub = kopecks / 100;
  return `${Number.isInteger(rub) ? rub : rub.toFixed(2)} ₽`;
}
