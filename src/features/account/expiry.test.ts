/**
 * When to warn that a subscription is ending, and — harder — when to stay quiet.
 *
 * The first draft of the plan said "stay quiet while a payment is pending". That is wrong twice over,
 * and both ways are covered below: the grant token lives exactly as long as this threshold, and it is
 * never cleared when someone signs out.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { expiryReminder, dismissReminder, readDismissed, REMIND_WITHIN_MS } from './expiry';
import type { Entitlement } from './contract';
import type { PendingPayment } from './billing';

const DAY = 86_400_000;
const NOW = new Date('2026-09-22T09:00:00Z').getTime();

const pro = (paidUntil: number): Entitlement => ({ plan: 'pro', active: true, paidUntil, ai: { used: 0, limit: 10 } });
const token = (paidUntilAtStart: number | null): PendingPayment => ({
  grantToken: 'g',
  invoiceId: '1',
  plan: 'pro_month',
  startedAt: NOW,
  paidUntilAtStart,
});

describe('expiryReminder', () => {
  it('says nothing while the end is still far off', () => {
    expect(expiryReminder(pro(NOW + 10 * DAY), null, null, NOW)).toBeNull();
  });

  it('speaks once the plan is inside the window', () => {
    expect(expiryReminder(pro(NOW + 2 * DAY), null, null, NOW)?.paidUntil).toBe(NOW + 2 * DAY);
  });

  it('includes the threshold itself rather than falling a day short', () => {
    expect(expiryReminder(pro(NOW + REMIND_WITHIN_MS), null, null, NOW)).not.toBeNull();
    expect(expiryReminder(pro(NOW + REMIND_WITHIN_MS + 1), null, null, NOW)).toBeNull();
  });

  // A date, not "3 days left": `paidUntil` is the server's instant and a countdown would run on the
  // device's clock. The last day is the one exception, because "ends on 22 September" said on the 22nd
  // reads as a future event.
  it('names the last day as today', () => {
    expect(expiryReminder(pro(NOW + 4 * 3_600_000), null, null, NOW)?.today).toBe(true);
    expect(expiryReminder(pro(NOW + 2 * DAY), null, null, NOW)?.today).toBe(false);
  });

  // Calendar day, not "under 24 hours left" — the two disagree for most of every day. Anchored at local
  // noon so the assertion means the same thing wherever the test runs.
  it('does not call tomorrow morning today, twenty hours out or not', () => {
    const d = new Date(NOW);
    const noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime();
    expect(expiryReminder(pro(noon + 20 * 3_600_000), null, null, noon)?.today).toBe(false);
    expect(expiryReminder(pro(noon + 8 * 3_600_000), null, null, noon)?.today).toBe(true);
  });

  it('is for people who still have something to lose', () => {
    const expired: Entitlement = { plan: 'free', active: false, paidUntil: NOW - DAY, ai: { used: 0, limit: 0 } };
    const trial: Entitlement = { plan: 'trial', active: true, trialEndsAt: NOW + DAY, ai: { used: 0, limit: 10 } };
    expect(expiryReminder(expired, null, null, NOW)).toBeNull();
    expect(expiryReminder(trial, null, null, NOW)).toBeNull();
    expect(expiryReminder(null, null, null, NOW)).toBeNull();
  });

  describe('the silence rule', () => {
    const e = pro(NOW + 2 * DAY);

    it('stays quiet for a payment that is extending THIS period', () => {
      expect(expiryReminder(e, token(NOW + 2 * DAY), null, NOW)).toBeNull();
    });

    // The token outlives an abandoned checkout for three days on purpose, and the reminder's own window
    // is three days. Reading "a token exists" as "they are dealing with it" would mute the warning for
    // its entire run and then let the plan lapse in silence.
    it('speaks when the token belongs to a period already gone', () => {
      expect(expiryReminder(e, token(NOW - 28 * DAY), null, NOW)).not.toBeNull();
    });

    // Nothing clears the token on sign-out or an account switch, so it can belong to somebody else.
    it('speaks when the token belongs to nothing this account recognises', () => {
      expect(expiryReminder(e, token(null), null, NOW)).not.toBeNull();
    });
  });

  describe('dismissal', () => {
    const e = pro(NOW + 2 * DAY);

    it('stays hidden for the period it was dismissed in', () => {
      expect(expiryReminder(e, null, NOW + 2 * DAY, NOW)).toBeNull();
    });

    // Tied to the date, not to the account alone: otherwise one dismissal would silence every renewal
    // the account ever has.
    it('asks again about the next period', () => {
      expect(expiryReminder(pro(NOW + 32 * DAY), null, NOW + 2 * DAY, NOW + 30 * DAY)).not.toBeNull();
    });
  });
});

describe('the dismissal record', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips for the account that wrote it', () => {
    dismissReminder('acc-1', NOW);
    expect(readDismissed('acc-1')).toBe(NOW);
  });

  it('is not another account’s answer', () => {
    dismissReminder('acc-1', NOW);
    expect(readDismissed('acc-2')).toBeNull();
  });

  it('holds one record, not one per period', () => {
    dismissReminder('acc-1', NOW);
    dismissReminder('acc-1', NOW + 30 * DAY);
    expect(Object.keys(localStorage).filter((k) => k.includes('remindDismissed'))).toHaveLength(1);
    expect(readDismissed('acc-1')).toBe(NOW + 30 * DAY);
  });

  it('survives a corrupted record instead of throwing on every dashboard', () => {
    localStorage.setItem('dayenglish.billing.remindDismissed', '{not json');
    expect(readDismissed('acc-1')).toBeNull();
  });

  it('does nothing without an account', () => {
    dismissReminder(null, NOW);
    expect(readDismissed(null)).toBeNull();
  });
});
