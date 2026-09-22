import { describe, it, expect, vi, beforeEach } from 'vitest';
import { beginCheckout, claimNote, claimPending, claimPurchase, clearPending, readPending, formatPrice } from './billing';
import type { Entitlement } from './contract';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import { ApiFailure } from './api';
import * as api from './api';
import type * as AccountApi from './api';

vi.mock('./api', async (orig) => {
  const actual = await orig<typeof AccountApi>();
  return { ...actual, startCheckout: vi.fn(), redeemGrant: vi.fn(), getEntitlement: vi.fn(), unclaimedGrant: vi.fn() };
});

const CHECKOUT = {
  paymentUrl: 'https://auth.robokassa.ru/Merchant/Index.aspx?InvId=1',
  grantToken: 'grant-token-0123456789',
  invoiceId: '100000000000000001',
  plan: 'pro_month',
  amountKopecks: 19900,
};

const signIn = () => useAccount.setState({ status: 'authenticated', getAccessToken: async () => 'tok' } as never);
const signOut = () => useAccount.setState({ status: 'anonymous', getAccessToken: async () => null } as never);
const invalid = () => new ApiFailure('grant_invalid', 400);

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.startCheckout).mockReset();
  vi.mocked(api.redeemGrant).mockReset();
  vi.mocked(api.unclaimedGrant).mockReset().mockResolvedValue(null);
  vi.mocked(api.getEntitlement).mockReset().mockResolvedValue({ plan: 'pro', active: true, ai: { used: 0, limit: 10000 } });
  useEntitlement.setState({ entitlement: null });
  signIn();
});

describe('beginCheckout', () => {
  it('records the pending payment before handing back the payment URL', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    const url = await beginCheckout('pro_month');
    expect(url).toBe(CHECKOUT.paymentUrl);
    expect(readPending()?.grantToken).toBe(CHECKOUT.grantToken);
  });

  it('records nothing when checkout itself fails', async () => {
    vi.mocked(api.startCheckout).mockRejectedValue(new ApiFailure('billing_unavailable', 503));
    await expect(beginCheckout('pro_month')).rejects.toBeInstanceOf(ApiFailure);
    expect(readPending()).toBeNull();
  });

  it('refuses without a session rather than minting an unclaimable grant', async () => {
    signOut();
    await expect(beginCheckout('pro_month')).rejects.toBeInstanceOf(ApiFailure);
    expect(api.startCheckout).not.toHaveBeenCalled();
  });
});

describe('claimPending', () => {
  it('does nothing at all when no payment is in flight', async () => {
    expect(await claimPending()).toBe('none');
    expect(api.redeemGrant).not.toHaveBeenCalled();
  });

  it('redeems and clears the token once the payment is confirmed', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockResolvedValue({ plan: 'pro', active: true, paidUntil: Date.now(), ai: { used: 0, limit: 10000 } });

    expect(await claimPending()).toBe('granted');
    expect(readPending()).toBeNull();
    expect(useEntitlement.getState().entitlement?.plan).toBe('pro');
  });

  // The browser routinely gets back from the acquirer before their server-to-server callback does, so
  // the first refusal is the normal case. Giving up on it would tell a paying user nothing happened.
  it('keeps retrying while the callback is still in flight', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant)
      .mockRejectedValueOnce(invalid())
      .mockRejectedValueOnce(invalid())
      .mockResolvedValue({ plan: 'pro', active: true, ai: { used: 0, limit: 10000 } });

    expect(await claimPending(5, 0)).toBe('granted');
    expect(api.redeemGrant).toHaveBeenCalledTimes(3);
  });

  it('keeps the token when the retries run out, so a later visit can still claim it', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValue(invalid());

    expect(await claimPending(3, 0)).toBe('pending');
    expect(readPending()?.grantToken).toBe(CHECKOUT.grantToken);
  });

  it('stops early on a failure that says nothing about the payment', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValue(new ApiFailure('unauthorized', 401));

    expect(await claimPending(5, 0)).toBe('pending');
    expect(api.redeemGrant).toHaveBeenCalledTimes(1);
  });

  it('forgets a payment old enough that no callback is still coming', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    const raw = JSON.parse(localStorage.getItem('dayenglish.billing.pending') as string) as { startedAt: number };
    localStorage.setItem(
      'dayenglish.billing.pending',
      JSON.stringify({ ...raw, startedAt: Date.now() - 4 * 86_400_000 })
    );

    expect(readPending()).toBeNull();
    expect(await claimPending()).toBe('none');
  });

  it('survives a corrupted record instead of throwing on every boot', () => {
    localStorage.setItem('dayenglish.billing.pending', '{not json');
    expect(readPending()).toBeNull();
    clearPending();
  });
});

// A grant token lives in ONE device's storage. Buying on a phone and opening a laptop must not leave a
// paying customer with no plan and no self-serve way out.
describe('claimPurchase', () => {
  it('asks the server what this account already paid for when the device has no token', async () => {
    vi.mocked(api.unclaimedGrant).mockResolvedValue('recovered-token-0123456789');
    vi.mocked(api.redeemGrant).mockResolvedValue({ plan: 'pro', active: true, ai: { used: 0, limit: 10000 } });

    expect(await claimPurchase(1, 0)).toBe('granted');
    expect(api.redeemGrant).toHaveBeenCalledWith('tok', 'recovered-token-0123456789');
  });

  it('reports nothing outstanding rather than inventing a failure', async () => {
    vi.mocked(api.unclaimedGrant).mockResolvedValue(null);
    expect(await claimPurchase(1, 0)).toBe('none');
    expect(api.redeemGrant).not.toHaveBeenCalled();
  });

  // This used to stop at `pending` and never ask. That short-circuit disabled the lookup in exactly the
  // cases it was built for: a token overwritten by a second checkout, and a token already spent — both
  // leaving a paid account on "payment pending" for three days while the server held the answer.
  it('still asks the server when the local token is going nowhere', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValueOnce(invalid()).mockRejectedValueOnce(invalid());
    vi.mocked(api.unclaimedGrant).mockResolvedValue('other-token-0123456789');
    vi.mocked(api.redeemGrant).mockResolvedValueOnce({ plan: 'pro', active: true, ai: { used: 0, limit: 10000 } });

    expect(await claimPurchase(2, 0)).toBe('granted');
    expect(api.unclaimedGrant).toHaveBeenCalled();
  });

  it('keeps saying pending when the server has nothing either', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValue(invalid());
    vi.mocked(api.unclaimedGrant).mockResolvedValue(null);

    expect(await claimPurchase(2, 0)).toBe('pending');
  });

  // "No purchase on this account" is a claim about the account. A request that never arrived is no
  // basis for making it.
  it('does not declare an account empty when it could not reach the server', async () => {
    vi.mocked(api.unclaimedGrant).mockRejectedValue(new ApiFailure('network', 0));
    expect(await claimPurchase(1, 0)).toBe('unreachable');
  });
});

// "The payment is not confirmed yet" is a verdict, and it was being handed out by code paths that had
// not asked anyone. Without a session there is nobody to ask; a run that dies on the network learns
// nothing either. Both used to answer "wait a couple of minutes" to someone who had just been charged.
describe('an unasked question is not an answer', () => {
  it('reports no session as "could not check", not as "still pending"', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    signOut();

    expect(await claimPending(3, 0)).toBe('unreachable');
    expect(api.redeemGrant).not.toHaveBeenCalled();
  });

  it('still says pending once the server itself has refused the grant', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValue(invalid());
    let calls = 0;
    useAccount.setState({ status: 'authenticated', getAccessToken: async () => (calls++ === 0 ? 'tok' : null) } as never);

    expect(await claimPending(3, 0)).toBe('pending');
  });

  it('reports silence as silence when every attempt died on the network', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValue(new ApiFailure('network', 0));

    expect(await claimPending(3, 0)).toBe('unreachable');
    expect(api.redeemGrant).toHaveBeenCalledTimes(3);
  });

  it('carries that through claimPurchase instead of promising a confirmation', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    signOut();

    expect(await claimPurchase(2, 0)).toBe('unreachable');
  });
});

describe('claimNote', () => {
  const OCT = new Date('2026-10-22T09:00:00Z').getTime();
  const ent = (o: Partial<Entitlement> = {}): Entitlement => ({ plan: 'pro', active: true, paidUntil: OCT, ai: { used: 0, limit: 10 }, ...o });

  it('tells a renewer their money landed, not that Pro exists', () => {
    const note = claimNote('granted', ent(), true, false);
    expect(note).toContain('now runs until 22 October');
    expect(note).not.toContain('Pro is active');
  });

  it('tells a first-time buyer their plan is on', () => {
    expect(claimNote('granted', ent(), false, false)).toContain('Pro is active until 22 October');
  });

  // One press claims one purchase: the server lookup stops asking after its first success, so somebody
  // who paid twice is one press away from the month they are owed and has no way to know it.
  it('says a second purchase needs a second press', () => {
    expect(claimNote('granted', ent(), true, false)).toContain('press again');
    expect(claimNote('granted', ent(), true, true)).toContain('нажмите ещё раз');
  });

  // Same words to a subscriber and to someone with no plan, and to the subscriber they read as "we have
  // no record of your payment" — the one sentence they are most afraid of.
  it('reads as reassurance to a subscriber and as a fact to everyone else', () => {
    expect(claimNote('none', ent(), true, false)).toContain('Every payment is accounted for');
    expect(claimNote('none', ent({ plan: 'free', active: false, paidUntil: undefined }), false, false)).toContain('no purchase outstanding');
  });

  it('drops the date rather than printing half a sentence without one', () => {
    const note = claimNote('granted', ent({ paidUntil: undefined }), true, false);
    expect(note).toContain('the subscription now runs.');
    expect(note).not.toContain('until');
  });

  it('keeps the two unchanged verdicts apart', () => {
    expect(claimNote('pending', ent(), true, false)).toContain('couple of minutes');
    expect(claimNote('unreachable', ent(), true, false)).toContain('Could not reach the server');
  });

  it('answers in Russian when asked to', () => {
    expect(claimNote('none', ent({ plan: 'free', active: false, paidUntil: undefined }), false, true)).toContain('не числится');
  });
});

describe('formatPrice', () => {
  it('drops empty kopecks and keeps real ones', () => {
    expect(formatPrice(19900)).toBe('199 ₽');
    expect(formatPrice(19950)).toBe('199.50 ₽');
  });
});
