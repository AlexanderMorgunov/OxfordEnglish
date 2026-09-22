/**
 * The receipt that outlived the purchase.
 *
 * A grant token lives in one device's localStorage, but it can be redeemed from anywhere — the server
 * lookup exists precisely so buying on a phone and opening a laptop still works. That leaves the other
 * device holding a token that looks valid and is worthless, and nothing ever cleared it: settings said
 * "a payment is being processed" underneath "Pro — active until 22 October", and the return page sat on
 * "checking your payment" for a subscription that had been live for minutes.
 *
 * Told that, a person who has just been charged concludes the payment failed and pays again. So the
 * rule these tests pin is: the entitlement is the truth, and a local token is only a reason to wait
 * while the entitlement has not moved.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { beginCheckout, claimPurchase, livePending, readPending } from './billing';
import { useAccount } from './store';
import { useEntitlement } from './entitlement';
import * as api from './api';
import { ApiFailure } from './api';
import type * as AccountApi from './api';
import type { Entitlement } from './contract';

vi.mock('./api', async (orig) => {
  const actual = await orig<typeof AccountApi>();
  return { ...actual, startCheckout: vi.fn(), redeemGrant: vi.fn(), getEntitlement: vi.fn(), unclaimedGrant: vi.fn() };
});

const DAY = 86_400_000;
const CHECKOUT = {
  paymentUrl: 'https://auth.robokassa.ru/Merchant/Index.aspx?InvId=1',
  grantToken: 'grant-token-0123456789',
  invoiceId: '100000000000000001',
  plan: 'pro_month',
  amountKopecks: 19900,
};

const ent = (over: Partial<Entitlement> = {}): Entitlement => ({
  plan: 'pro',
  active: true,
  ai: { used: 0, limit: 10000 },
  ...over,
});

beforeEach(() => {
  localStorage.clear();
  vi.mocked(api.startCheckout).mockReset().mockResolvedValue(CHECKOUT);
  vi.mocked(api.redeemGrant).mockReset();
  vi.mocked(api.unclaimedGrant).mockReset().mockResolvedValue(null);
  vi.mocked(api.getEntitlement).mockReset().mockResolvedValue(ent());
  useEntitlement.setState({ entitlement: null });
  useAccount.setState({ status: 'authenticated', getAccessToken: async () => 'tok' } as never);
});

describe('checkout remembers how far the plan was already paid', () => {
  it('records nothing paid when there is no plan yet', async () => {
    useEntitlement.setState({ entitlement: ent({ plan: 'free', active: false }) });

    await beginCheckout('pro_month');

    expect(readPending()?.paidUntilAtStart).toBeNull();
  });

  it('records the current end date when extending', async () => {
    const until = Date.now() + 5 * DAY;
    useEntitlement.setState({ entitlement: ent({ paidUntil: until }) });

    await beginCheckout('pro_month');

    expect(readPending()?.paidUntilAtStart).toBe(until);
  });
});

describe('livePending', () => {
  it('keeps waiting while the plan has not moved', async () => {
    const until = Date.now() + 5 * DAY;
    useEntitlement.setState({ entitlement: ent({ paidUntil: until }) });
    await beginCheckout('pro_month');

    // Exactly where it was: this purchase has not landed, whoever else might be redeeming it.
    expect(livePending(until)).not.toBeNull();
  });

  it('forgets the token once the plan has moved past where it started', async () => {
    const until = Date.now() + 5 * DAY;
    useEntitlement.setState({ entitlement: ent({ paidUntil: until }) });
    await beginCheckout('pro_month');

    expect(livePending(until + 30 * DAY)).toBeNull();
    // And it is gone for good, not merely hidden from this caller.
    expect(readPending()).toBeNull();
  });

  it('an extension in flight is NOT a contradiction — an active plan alone must not hide it', async () => {
    // The trap in the obvious fix: "plan === pro, so stop saying a payment is pending". Paying to
    // extend is ordinary, and suppressing the notice on that basis hides a real payment in flight.
    const until = Date.now() + 5 * DAY;
    useEntitlement.setState({ entitlement: ent({ paidUntil: until }) });
    await beginCheckout('pro_month');

    expect(livePending(until)).not.toBeNull();
  });

  it('a first purchase clears as soon as any paid period exists', async () => {
    useEntitlement.setState({ entitlement: ent({ plan: 'free', active: false }) });
    await beginCheckout('pro_month');

    expect(livePending(Date.now() + 30 * DAY)).toBeNull();
  });

  it('says nothing when the entitlement is unknown, rather than guessing', async () => {
    await beginCheckout('pro_month');

    expect(livePending(undefined)).not.toBeNull();
    expect(livePending(null)).not.toBeNull();
  });
});

describe('claimPurchase via the server lookup', () => {
  it('drops the local token when the server hands back that very token', async () => {
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValueOnce(new ApiFailure('grant_invalid', 400));
    vi.mocked(api.unclaimedGrant).mockResolvedValue(CHECKOUT.grantToken);
    vi.mocked(api.redeemGrant).mockResolvedValueOnce(undefined as never);

    const outcome = await claimPurchase(1, 0);

    expect(outcome).toBe('granted');
    // Left behind, this is what put "a payment is being processed" under an active subscription.
    expect(readPending()).toBeNull();
  });

  it('keeps a DIFFERENT token — paying twice must not lose the second purchase', async () => {
    // Checkout twice and pay both. The server returns the older grant first; throwing away whatever
    // happens to be in storage would drop the newer one, and its callback would arrive to find
    // nothing left to redeem it. That is a paid month nobody receives.
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValueOnce(new ApiFailure('grant_invalid', 400));
    vi.mocked(api.unclaimedGrant).mockResolvedValue('an-older-grant');
    vi.mocked(api.redeemGrant).mockResolvedValueOnce(undefined as never);

    expect(await claimPurchase(1, 0)).toBe('granted');

    expect(readPending()?.grantToken).toBe(CHECKOUT.grantToken);
  });
});
