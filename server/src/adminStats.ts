import { planOf, type EntitlementRow } from './entitlements.js';

/** The only fields the counts need. Narrow on purpose: an admin read that returns whole rows is one
 *  edit away from being a way to enumerate the user base. */
export type StatsRow = Pick<EntitlementRow, 'trialStartedAt' | 'paidUntil'>;

export type AdminStats = {
  /** Accounts that exist right now. Delete-account purges the row, so this is not "ever registered". */
  accounts: number;
  /** Ever started a trial, whether or not it is still running. */
  trialsStarted: number;
  /** In a trial at this moment. */
  trialsActive: number;
  /** Ever had a paid period, expired or not. */
  paidEver: number;
  /** Paid and still inside it. */
  paidActive: number;
};

/**
 * Counted in ONE place, from rows, rather than as SQL in the YDB store and a loop in the in-memory one.
 *
 * "Is this a trial" is policy — it is `planOf`, which knows about `TRIAL_MS` and about paid beating
 * trial. Expressed a second time in YQL it drifts the moment either changes, and the YDB path is exactly
 * the one CI cannot run: the store smokes need a live database, so a divergence would show up as wrong
 * numbers in production and a green suite.
 *
 * The cost is reading the rows instead of asking the database to count them. This is a small-table
 * convenience for a service with hundreds of accounts, not a metrics endpoint; if it ever needs to scale,
 * that is the moment to move the policy into the query and pin it with a test against a real database.
 */
export function computeStats(accounts: number, rows: StatsRow[], now: number): AdminStats {
  let trialsStarted = 0;
  let trialsActive = 0;
  let paidEver = 0;
  let paidActive = 0;
  for (const r of rows) {
    const plan = planOf({ ...r, accountId: '', aiUsed: 0, windowStartedAt: 0 }, now);
    if (r.trialStartedAt != null) trialsStarted += 1;
    if (plan === 'trial') trialsActive += 1;
    if (r.paidUntil != null) paidEver += 1;
    if (plan === 'pro') paidActive += 1;
  }
  return { accounts, trialsStarted, trialsActive, paidEver, paidActive };
}
