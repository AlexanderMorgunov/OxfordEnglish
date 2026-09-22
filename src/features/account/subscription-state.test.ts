/**
 * Who this account is — the one discriminator, as a table.
 *
 * The row that matters most is "trialed, then paid, then the month ran out". The server stamps
 * `trialEndsAt` on anyone who ever had a trial, and the caption read it first, so it told a former
 * SUBSCRIBER that their free trial had ended — wrong, and aimed at the people most worth keeping.
 */
import { describe, it, expect } from 'vitest';
import { subscriptionState } from './entitlement';
import { planLine } from './PlanSection';
import type { Entitlement } from './contract';

const DAY = 86_400_000;
const NOW = new Date('2026-09-22T09:00:00Z').getTime();
const AUG = new Date('2026-08-15T09:00:00Z').getTime();
const OCT = new Date('2026-10-22T09:00:00Z').getTime();

const ent = (o: Partial<Entitlement>): Entitlement => ({ plan: 'free', active: false, ai: { used: 0, limit: 0 }, ...o });

describe('subscriptionState', () => {
  const cases: Array<[string, Entitlement | null, ReturnType<typeof subscriptionState>]> = [
    ['nothing at all', ent({}), 'none'],
    ['a trial running', ent({ plan: 'trial', active: true, trialEndsAt: NOW + 3 * DAY }), 'trial'],
    ['a trial used up, never paid', ent({ trialEndsAt: AUG }), 'trial-over'],
    ['Pro running', ent({ plan: 'pro', active: true, paidUntil: OCT }), 'pro'],
    ['Pro running, with a trial in its past', ent({ plan: 'pro', active: true, paidUntil: OCT, trialEndsAt: AUG }), 'pro'],
    // The whole point of the ordering: both dates are in the past and only one of them is the truth.
    ['trialed, paid, and the month ran out', ent({ paidUntil: AUG, trialEndsAt: AUG - 30 * DAY }), 'expired'],
    ['paid without ever trialing, and it ran out', ent({ paidUntil: AUG }), 'expired'],
    ['no answer from the server', null, 'unknown'],
  ];

  it.each(cases)('%s', (_name, e, expected) => {
    expect(subscriptionState(e, NOW)).toBe(expected);
  });

  // Entitlement is fetched at boot. A PWA living in a phone's memory through midnight would otherwise
  // go on reporting Pro until the first 402 answered a click with a generic paywall.
  it('demotes a plan that ran out while the app stayed open', () => {
    const e = ent({ plan: 'pro', active: true, paidUntil: NOW + DAY });
    expect(subscriptionState(e, NOW)).toBe('pro');
    expect(subscriptionState(e, NOW + 2 * DAY)).toBe('expired');
  });

  // Missing data is not an expiry: the server called this plan active, and there is no date to disagree
  // with. `planLine` has carried an em-dash fallback for exactly this case since before any of it.
  it('leaves a Pro with no date alone', () => {
    expect(subscriptionState(ent({ plan: 'pro', active: true }), NOW)).toBe('pro');
  });

  // The server's own boundary is `now < paidUntil` (`planOf`). A client that disagreed by one
  // millisecond would show Pro to someone the API has already started refusing.
  it('ends the plan at the same instant the server does', () => {
    const e = ent({ plan: 'pro', active: true, paidUntil: NOW });
    expect(subscriptionState(e, NOW - 1)).toBe('pro');
    expect(subscriptionState(e, NOW)).toBe('expired');
  });
});

describe('planLine', () => {
  it('tells a lapsed subscriber about their subscription, not their trial', () => {
    const e = ent({ paidUntil: AUG, trialEndsAt: AUG - 30 * DAY });
    const line = planLine(e, subscriptionState(e, NOW), false);
    expect(line).toBe('Your subscription ended on 15 August');
    expect(line).not.toContain('trial');
  });

  it('still says trial to someone who only ever had one', () => {
    const e = ent({ trialEndsAt: AUG });
    expect(planLine(e, subscriptionState(e, NOW), false)).toBe('Your free trial ended on 15 August');
  });

  it('reports the demotion rather than the plan the server last saw', () => {
    const e = ent({ plan: 'pro', active: true, paidUntil: NOW - DAY });
    expect(planLine(e, subscriptionState(e, NOW), false)).toContain('ended on 21 September');
  });

  it('answers in Russian too', () => {
    const e = ent({ paidUntil: AUG, trialEndsAt: AUG - 30 * DAY });
    expect(planLine(e, subscriptionState(e, NOW), true)).toBe('Подписка закончилась 15 августа');
  });
});
