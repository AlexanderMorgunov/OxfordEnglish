import { describe, it, expect, vi, beforeEach } from 'vitest';
import { beginCheckout, claimPending, claimPurchase, clearPending, readPending, formatPrice } from './billing';
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

  it('never reaches the server while a local token is still worth retrying', async () => {
    vi.mocked(api.startCheckout).mockResolvedValue(CHECKOUT);
    await beginCheckout('pro_month');
    vi.mocked(api.redeemGrant).mockRejectedValue(invalid());

    expect(await claimPurchase(2, 0)).toBe('pending');
    expect(api.unclaimedGrant).not.toHaveBeenCalled();
  });
});

describe('formatPrice', () => {
  it('drops empty kopecks and keeps real ones', () => {
    expect(formatPrice(19900)).toBe('199 ₽');
    expect(formatPrice(19950)).toBe('199.50 ₽');
  });
});
