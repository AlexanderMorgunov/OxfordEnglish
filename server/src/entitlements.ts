/**
 * Entitlement core — pure functions over a stored row. No I/O, no clock: `now` is always passed in.
 *
 * Deliberately NOT a JWT claim. Access tokens live an hour (tokens.ts ACCESS_TTL_S) and cannot be
 * revoked before expiry, but entitlement can drop mid-token (refund, chargeback, quota exhausted),
 * so every gate reads the store.
 *
 * PII firewall (docs/backend-v1-design.md §"Privacy"): nothing here may reference a payment record.
 * The accountId-keyed row holds plan/dates/quota only; the payment→grant mapping lives in a separate
 * table that is never joined with this one.
 */

import { randomBytes, createHash } from 'node:crypto';

const DAY_MS = 86_400_000;

export const TRIAL_DAYS = 14;
export const TRIAL_MS = TRIAL_DAYS * DAY_MS;
/** Pro quota renews on a rolling window anchored at the last reset, not on a calendar month. */
export const PRO_WINDOW_MS = 30 * DAY_MS;

/**
 * Both limits are derived from MEASURED token usage (prod, 2026-09-13 — see the table in
 * docs/monetization-analysis.md), not from guesswork. Worst case is ~$0.00014 per call: every task's
 * tokens at PEAK deepseek-flash pricing with a full cache miss. Real cost runs well under that, because
 * the cross-user cache serves a large share at zero upstream cost.
 *
 * Both are budgets in UNITS, not calls: a one-sentence translate costs 1, a page-stuffing bookqa or a
 * chapter-stuffing exercises costs 4 (see `TASKS` in ai.ts). A flat per-call charge made the same
 * advertised budget mean 55 ₽ of tokens for a reader and 129 ₽ for someone generating exercises.
 *
 * Trial budget is ONE-TIME over the whole trial — it never resets, which is what bounds the cost of
 * farming trials by re-registering. 500 units ≈ 6 ₽ worst case, so a farmed trial is not worth chasing.
 */
export const TRIAL_AI_REQUESTS = 500;
/** 5 000 units ≈ 55 ₽/mo against a 199 ₽ subscription, now genuinely a ceiling rather than an average,
 *  since the weights stop an exercises-heavy mix from costing multiples of it. A heavy reader tapping
 *  translate on most sentences lands near 3 000 units/mo, so this clears that with room. */
export const PRO_AI_REQUESTS = 5000;

/** Retention bound for a trial claim: once the trial it could block has expired plus a margin, the row
 *  can only deny a trial that is already over, so it is dead weight — and keeping a device-derived value
 *  after delete-account would sit badly with the 152-ФЗ erasure the account route implements. */
export const TRIAL_CLAIM_RETENTION_MS = TRIAL_MS + 30 * DAY_MS;

export type Plan = 'free' | 'trial' | 'pro';

/** Stored shape. `windowStartedAt` anchors the Pro quota window; for a trial it is the trial start. */
export type EntitlementRow = {
  accountId: string;
  trialStartedAt?: number;
  paidUntil?: number;
  aiUsed: number;
  windowStartedAt: number;
};

export type Entitlement = {
  plan: Plan;
  /** May use paid features at all (ignores quota — check `ai.used < ai.limit` separately). */
  active: boolean;
  trialEndsAt?: number;
  paidUntil?: number;
  ai: { used: number; limit: number; resetsAt?: number };
};

export const FREE: Entitlement = { plan: 'free', active: false, ai: { used: 0, limit: 0 } };

export function planOf(row: EntitlementRow | null | undefined, now: number): Plan {
  if (!row) return 'free';
  if (row.paidUntil != null && now < row.paidUntil) return 'pro';
  if (row.trialStartedAt != null && now < row.trialStartedAt + TRIAL_MS) return 'trial';
  return 'free';
}

/** True once a Pro window has rolled over. Never true for a trial: its budget is one-time. */
function windowExpired(row: EntitlementRow, plan: Plan, now: number): boolean {
  return plan === 'pro' && now - row.windowStartedAt >= PRO_WINDOW_MS;
}

const aiLimit = (plan: Plan): number =>
  plan === 'pro' ? PRO_AI_REQUESTS : plan === 'trial' ? TRIAL_AI_REQUESTS : 0;

export function evaluate(row: EntitlementRow | null | undefined, now: number): Entitlement {
  const plan = planOf(row, now);
  if (!row || plan === 'free') return FREE;
  const rolled = windowExpired(row, plan, now);
  return {
    plan,
    active: true,
    trialEndsAt: row.trialStartedAt != null ? row.trialStartedAt + TRIAL_MS : undefined,
    paidUntil: row.paidUntil,
    ai: {
      used: rolled ? 0 : row.aiUsed,
      limit: aiLimit(plan),
      resetsAt: plan === 'pro' ? (rolled ? now : row.windowStartedAt) + PRO_WINDOW_MS : undefined,
    },
  };
}

/** Start the trial. Idempotent: a row that already has a trial (or a payment) is returned unchanged,
 *  so a replayed claim can never extend the window. */
export function grantTrial(row: EntitlementRow | null | undefined, accountId: string, now: number): EntitlementRow {
  if (row?.trialStartedAt != null) return row;
  return { ...(row ?? { accountId, aiUsed: 0 }), accountId, trialStartedAt: now, windowStartedAt: now, aiUsed: row?.aiUsed ?? 0 };
}

/** Apply a paid grant. Extends from the later of now and the current `paidUntil` so back-to-back
 *  renewals stack instead of truncating an unexpired period. */
export function applyPayment(
  row: EntitlementRow | null | undefined,
  accountId: string,
  now: number,
  days: number
): EntitlementRow {
  const base = Math.max(now, row?.paidUntil ?? 0);
  const wasPro = planOf(row, now) === 'pro';
  return {
    ...(row ?? { accountId, aiUsed: 0, windowStartedAt: now }),
    accountId,
    paidUntil: base + days * DAY_MS,
    // Entering Pro from free/trial starts a fresh quota window; renewing mid-window keeps it.
    windowStartedAt: wasPro ? (row?.windowStartedAt ?? now) : now,
    aiUsed: wasPro ? (row?.aiUsed ?? 0) : 0,
  };
}

export type ConsumeResult =
  | { allowed: true; row: EntitlementRow; entitlement: Entitlement }
  | { allowed: false; reason: 'no_plan' | 'quota_exceeded'; entitlement: Entitlement };

/** Charge `cost` AI requests against the quota, rolling the Pro window first if it has elapsed. */
export function consumeAi(
  row: EntitlementRow | null | undefined,
  now: number,
  cost = 1
): ConsumeResult {
  const plan = planOf(row, now);
  const entitlement = evaluate(row, now);
  if (!row || plan === 'free') return { allowed: false, reason: 'no_plan', entitlement };
  const rolled = windowExpired(row, plan, now);
  const used = rolled ? 0 : row.aiUsed;
  if (used + cost > aiLimit(plan)) return { allowed: false, reason: 'quota_exceeded', entitlement };
  const next: EntitlementRow = {
    ...row,
    aiUsed: used + cost,
    windowStartedAt: rolled ? now : row.windowStartedAt,
  };
  return { allowed: true, row: next, entitlement: evaluate(next, now) };
}

/** Give back a charge whose work failed (an upstream error). Pure: callers MUST apply it through
 *  `EntitlementStore.mutate`, which serializes the read and the write — applied outside a transaction a
 *  refund can read a pre-charge balance and write back a value that erases a concurrent successful
 *  charge. Never goes below zero, and never revives a window that has since rolled. */
export function refundAi(row: EntitlementRow | null | undefined, cost = 1): EntitlementRow | null {
  if (!row) return null;
  return { ...row, aiUsed: Math.max(0, row.aiUsed - cost) };
}

/** The raw install id is also stamped into synced rows as `updatedBy`, so storing it here would let the
 *  trial-claims table be joined against a user's content. Hash it — we only ever test equality. */
export const installHash = (installId: string): string =>
  createHash('sha256').update(installId).digest('base64');

/** Binding hash for a grant. Stored instead of the raw accountId so the grants table still cannot be
 *  read as "who paid" — it only answers "does the caller match", which is all redeem needs. */
export const bindHash = (accountId: string): string =>
  createHash('sha256').update(`grant:${accountId}`).digest('base64');

/**
 * Persistence boundary. Two disjoint record sets, deliberately never joined (design §Privacy):
 *  - entitlement rows, keyed by `accountId`, holding plan/dates/quota and NO payment reference;
 *  - payment grants, keyed by an opaque token, holding the payment reference and NO account id.
 * The client carries the grant token from checkout to `redeem`, which is the only bridge.
 */
/** What `mutate` hands back: the row to persist (omit to leave the stored row untouched) plus whatever
 *  the caller wants to read out of the decision. */
export type Mutation<T> = { row?: EntitlementRow; result: T };

export interface EntitlementStore {
  get(accountId: string): Promise<EntitlementRow | null>;
  put(row: EntitlementRow): Promise<void>;
  /**
   * Read, decide and write as ONE atomic step. `decide` is the pure policy (`consumeAi` / `refundAi`);
   * the store guarantees nothing else writes this account's row in between.
   *
   * A plain get→put is not good enough for spending money: concurrent AI calls all read the same
   * `aiUsed`, all pass the limit check, and all write `used + cost`, so N calls are charged once and the
   * budget stops bounding what we pay upstream. The same lost update lets a refund erase a successful
   * charge. Both disappear once the pair is serialized.
   */
  mutate<T>(accountId: string, decide: (row: EntitlementRow | null) => Mutation<T>): Promise<T>;
  trialClaimed(hash: string): Promise<boolean>;
  markTrialClaimed(hash: string): Promise<void>;
  /** Called by the billing callback once a payment is confirmed; returns the token to hand the client.
   *  `boundTo` is the account that started checkout — always pass it, so a leaked token (URL, logs,
   *  shared screen) cannot be spent by whoever presents it first. */
  createGrant(paymentRef: string, days: number, boundTo?: string): Promise<string>;
  /** One-time: returns the granted days, or null if unknown, already redeemed, or bound to another account. */
  redeemGrant(token: string, accountId: string): Promise<number | null>;
  /** Delete-account: drop this account's entitlement. Grants are payment records, not account data. */
  purge(accountId: string): Promise<void>;
}

export class InMemoryEntitlementStore implements EntitlementStore {
  private rows = new Map<string, EntitlementRow>();
  private claims = new Set<string>();
  private claimedAt = new Map<string, number>();
  private grants = new Map<string, { paymentRef: string; days: number; redeemed: boolean; boundTo?: string }>();

  async get(accountId: string) {
    return this.rows.get(accountId) ?? null;
  }
  async put(row: EntitlementRow) {
    this.rows.set(row.accountId, row);
  }
  /** Atomic by construction here: nothing awaits between the read and the write, so the event loop
   *  cannot interleave another charge. */
  async mutate<T>(accountId: string, decide: (row: EntitlementRow | null) => Mutation<T>): Promise<T> {
    const { row, result } = decide(this.rows.get(accountId) ?? null);
    if (row) this.rows.set(row.accountId, row);
    return result;
  }
  async trialClaimed(hash: string) {
    return this.claims.has(hash);
  }
  async markTrialClaimed(hash: string) {
    this.claims.add(hash);
    this.claimedAt.set(hash, Date.now());
  }
  async createGrant(paymentRef: string, days: number, boundTo?: string) {
    const token = randomBytes(24).toString('base64url');
    this.grants.set(token, { paymentRef, days, redeemed: false, boundTo: boundTo && bindHash(boundTo) });
    return token;
  }
  async redeemGrant(token: string, accountId: string) {
    const g = this.grants.get(token);
    if (!g || g.redeemed) return null;
    if (g.boundTo != null && g.boundTo !== bindHash(accountId)) return null;
    g.redeemed = true;
    return g.days;
  }
  async purge(accountId: string) {
    this.rows.delete(accountId);
  }
  /** Retention sweep for trial claims (TTL in YDB; explicit here so the in-memory store can be tested). */
  async sweepTrialClaims(now: number) {
    for (const [hash, at] of this.claimedAt) if (now - at >= TRIAL_CLAIM_RETENTION_MS) {
      this.claims.delete(hash);
      this.claimedAt.delete(hash);
    }
  }
}
