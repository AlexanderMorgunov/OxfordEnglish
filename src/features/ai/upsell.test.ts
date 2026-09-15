import { describe, it, expect } from 'vitest';
import { upsellTarget } from './upsell';
import type { Entitlement } from '@/features/account/contract';

// The client never hardcodes quotas — limits arrive on the entitlement. These are local test fixtures.
const PRO_LIMIT = 10_000;
const TRIAL_LIMIT = 1_000;

const pro = (used: number, resetsAt: number | undefined = Date.now() + 86_400_000): Entitlement => ({
  plan: 'pro',
  active: true,
  paidUntil: Date.now() + 86_400_000,
  ai: { used, limit: PRO_LIMIT, resetsAt },
});

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
});
