import { describe, it, expect } from 'vitest';
import { upsellTarget } from './upsell';
import type { Entitlement } from '@/features/account/contract';

// The client never hardcodes quotas — limits arrive on the entitlement. These are local test fixtures.
const PRO_LIMIT = 10_000;
const TRIAL_LIMIT = 1_000;

const DAY = 86_400_000;

// A RENEWED subscription: the quota window rolls before the paid period ends, so "resets on the 3rd"
// is a promise that can be kept. The default used to put both dates on the same day — which is a first
// month, the one case where the reset never comes because the subscription ends first.
const pro = (used: number, resetsAt: number | undefined = Date.now() + DAY): Entitlement => ({
  plan: 'pro',
  active: true,
  paidUntil: Date.now() + 10 * DAY,
  ai: { used, limit: PRO_LIMIT, resetsAt },
});

/** A first month: `applyPayment` starts the window at payment and the plan runs the same thirty days. */
const firstMonth = (used: number): Entitlement => {
  const until = Date.now() + 30 * DAY;
  return { plan: 'pro', active: true, paidUntil: until, ai: { used, limit: PRO_LIMIT, resetsAt: until } };
};

// The server sets `resetsAt` only for a paid window, so a trial never has one — that absence is the
// whole discriminator between "come back on the 3rd" and "this was one-time".
const trial = (used: number): Entitlement => ({
  plan: 'trial',
  active: true,
  trialEndsAt: Date.now() + 86_400_000,
  ai: { used, limit: TRIAL_LIMIT, resetsAt: undefined },
});

const free: Entitlement = { plan: 'free', active: false, ai: { used: 0, limit: 0 } };

describe('upsellTarget', () => {
  it('sends an anonymous visitor to the plans page', () => {
    expect(upsellTarget('anonymous', null)).toBe('plans');
    expect(upsellTarget('anonymous', pro(0))).toBe('plans'); // no session ⇒ nothing to honour
  });

  it('sends a signed-in account with no plan to the plans page', () => {
    expect(upsellTarget('authenticated', free)).toBe('plans');
  });

  // The bug this function exists to kill: a subscriber who spent the month's budget used to be shown
  // the same "set up AI" prompt a stranger sees.
  it('never shows the plans page to someone whose paid budget is merely spent', () => {
    const t = upsellTarget('authenticated', pro(PRO_LIMIT));
    expect(t).toBe('quota-resets');
    expect(t).not.toBe('plans');
  });

  // The highest-intent person in the funnel: tried it, used all of it, wants more. Their budget will
  // never refill, so promising a reset date would be a lie.
  it('offers the plan when a one-time trial budget is gone', () => {
    expect(upsellTarget('authenticated', trial(TRIAL_LIMIT))).toBe('quota-final');
  });

  // Not the plan name: a 'pro' row that somehow arrives without a reset date is still "this will not
  // refill", and must be treated the same as a spent trial.
  it('distinguishes a spent budget purely by resetsAt, not by the plan name', () => {
    const paidWithoutReset: Entitlement = { ...pro(PRO_LIMIT), ai: { used: PRO_LIMIT, limit: PRO_LIMIT } };
    expect(upsellTarget('authenticated', paidWithoutReset)).toBe('quota-final');
    expect(upsellTarget('authenticated', trial(TRIAL_LIMIT))).toBe('quota-final');
  });

  // Entitlement is deliberately never cached, so a paying subscriber offline or on a cold start has
  // `null` here. Quoting a price at them would repeat the very bug above.
  it('says nothing definite when the plan could not be read', () => {
    const t = upsellTarget('authenticated', null);
    expect(t).toBe('unknown');
    expect(t).not.toBe('plans');
  });

  it('has nothing to say while a plan still has budget', () => {
    expect(upsellTarget('authenticated', pro(0))).toBe('none');
    expect(upsellTarget('authenticated', trial(TRIAL_LIMIT - 1))).toBe('none');
  });

  it('treats an exhausted budget as spent at exactly the limit, not one past it', () => {
    expect(upsellTarget('authenticated', pro(PRO_LIMIT - 1))).toBe('none');
    expect(upsellTarget('authenticated', pro(PRO_LIMIT))).toBe('quota-resets');
  });

  // The month somebody has just paid for. Both dates are the same millisecond, so naming the reset
  // would name the day the subscription ends — and the app would be promising a refill it cannot give.
  it('a first month does not promise a reset, because that date is the expiry', () => {
    expect(upsellTarget('authenticated', firstMonth(PRO_LIMIT))).toBe('quota-until-renewal');
  });

  it('a window ending after the plan is the same case, not a near miss', () => {
    const until = Date.now() + 30 * DAY;
    const past = { plan: 'pro', active: true, paidUntil: until, ai: { used: PRO_LIMIT, limit: PRO_LIMIT, resetsAt: until + DAY } } as Entitlement;
    expect(upsellTarget('authenticated', past)).toBe('quota-until-renewal');
  });

  // Without a paid period there is nothing to outlive — a trial keeps its own wording.
  it('a spent trial is untouched by any of this', () => {
    expect(upsellTarget('authenticated', trial(TRIAL_LIMIT))).toBe('quota-final');
  });
});
