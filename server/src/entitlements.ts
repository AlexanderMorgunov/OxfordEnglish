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
import { keyedHash } from './indexHash.js';
export { indexKeyConfigured, useEphemeralIndexKey, INDEX_HASH_VERSION } from './indexHash.js';

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
 * Both are budgets in UNITS, not calls: a one-sentence translate costs 1, a chapter-stuffing exercises
 * costs 4 (see `TASKS` in ai.ts). A flat per-call charge made the same advertised budget mean 55 ₽ of
 * tokens for a reader and 129 ₽ for someone generating exercises.
 *
 * The two numbers do NOT move together, because they bound different things. The trial is free and
 * farmable — register, claim, spend — so its budget is the cost of an abusive account. Pro has already
 * been paid for, so its budget is only ever a fairness ceiling.
 *
 * Trial budget is ONE-TIME over the whole trial — it never resets, which is what bounds the cost of
 * farming trials by re-registering. 1 000 units ≈ 12 ₽ worst case: enough for two weeks of real use to
 * be convincing, still too little for a farmed account to be worth the trouble.
 */
export const TRIAL_AI_REQUESTS = 1000;
/**
 * 10 000 units ≈ 60 ₽/mo worst case against a 199 ₽ subscription — and that worst case assumes the
 * budget is exhausted every month with zero cache hits.
 *
 * Sized against the asymmetry, not against the tokens: a subscriber who exhausts the budget costs us
 * ~60 ₽ once, while a subscriber who hits a wall mid-book cancels and costs 199 ₽ every month after. A
 * heavy daily user models at 1 200–2 100 units/mo (docs/monetization-analysis.md §7) because almost
 * every task is cached locally and permanently, so a unit is spent on a genuinely NEW word or sentence
 * rather than on activity. This clears even a doubled heavy user.
 */
export const PRO_AI_REQUESTS = 10000;

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
  if (!row) return FREE;
  // A lapsed trial still reports WHEN it ended. Without that the paywall cannot tell "never tried" from
  // "already used it", so it offers the free trial again and answers a hopeful click with an error.
  // Nothing is unlocked by it: `active` stays false and the AI limit stays 0.
  if (plan === 'free') {
    return row.trialStartedAt == null ? FREE : { ...FREE, trialEndsAt: row.trialStartedAt + TRIAL_MS };
  }
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

/** The pre-v2 forms, kept ONLY so the migration can find the rows it has to rewrite. Never write these. */
export const legacyInstallHash = (installId: string): string => createHash('sha256').update(installId).digest('base64');
export const legacyBindHash = (accountId: string): string =>
  createHash('sha256').update(`grant:${accountId}`).digest('base64');

/** Trial-claims key. `trial_claims` is TTL'd (TRIAL_CLAIM_RETENTION_MS), so the old rows age out on their
 *  own and no migration is needed — at the cost of a retention-length window in which a deleted and
 *  re-registered install could draw a second trial. */
export const installHash = (installId: string): string => keyedHash('install', installId);

/** Binding hash for a grant. Stored instead of the raw accountId so the grants table still cannot be
 *  read as "who paid" — it only answers "does the caller match", which is all redeem needs. */
export const bindHash = (accountId: string): string => keyedHash('grant', accountId);

/**
 * Persistence boundary. Two disjoint record sets, deliberately never joined (design §Privacy):
 *  - entitlement rows, keyed by `accountId`, holding plan/dates/quota and NO payment reference;
 *  - payment grants, keyed by an opaque token, holding the payment reference and NO account id.
 * The client carries the grant token from checkout to `redeem`, which is the only bridge.
 */
/** What `mutate` hands back: the row to persist (omit to leave the stored row untouched) plus whatever
 *  the caller wants to read out of the decision. */
export type Mutation<T> = { row?: EntitlementRow; result: T };

/**
 * A grant is created UNPAID at checkout and only flipped to paid by the signature-verified callback.
 * Minting it on the callback instead would mean a new token per retry — and the acquirer retries until
 * it is acknowledged, so a slow reply would grant the same payment twice.
 *
 * `amountKopecks` is what we asked for. It is re-checked against what the callback says was actually
 * paid: a valid signature proves the acquirer sent the notification, never that the sum is the one we
 * priced.
 */
export type GrantDraft = {
  /** Acquirer-side reference, e.g. `robokassa:<invoice>`. The only value in our database that can be
   *  joined against the payment processor's records — deliberately, so refunds and disputes remain
   *  answerable without us storing who bought anything. */
  paymentRef: string;
  /** The acquirer's numeric invoice id, as a decimal string. Also the parent of any future recurring
   *  charge, which is why it is stored rather than derived. */
  invoiceId: string;
  days: number;
  amountKopecks: number;
  /** The account that started checkout. Hashed by the store, never stored raw: enough to refuse a
   *  leaked token presented by someone else, not enough to read the table as "who paid". */
  boundTo: string;
};

/** `unknown` = no such invoice; `underpaid` = the callback's sum is below what we priced, which is the
 *  one case we refuse to confirm rather than grant something nobody paid for. */
export type GrantPaidResult = 'ok' | 'unknown' | 'underpaid';

export type RedeemResult =
  /** The days were applied by this call. */
  | { status: 'applied'; row: EntitlementRow }
  /** This account had already redeemed this grant; `row` is what it holds now. */
  | { status: 'already'; row: EntitlementRow | null }
  /** Unknown, unpaid, or bound to a different account. */
  | { status: 'invalid' };

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
  /** Mint an UNPAID grant at checkout and return the token to hand the client. */
  createGrant(draft: GrantDraft): Promise<string>;
  /** Confirm the invoice from the payment callback. Idempotent — the acquirer retries the notification
   *  until we acknowledge it, and a second delivery must not produce a second grant. */
  markGrantPaid(invoiceId: string, paidKopecks: number): Promise<GrantPaidResult>;
  /** One-time: returns the granted days, or null if unknown, unpaid, already redeemed, or bound to
   *  another account. */
  redeemGrant(token: string, accountId: string): Promise<number | null>;
  /**
   * Spend a paid grant AND apply its days as ONE atomic step.
   *
   * Doing it in two calls loses money. `redeemGrant` commits `redeemed = true` in its own transaction;
   * if anything goes wrong before the entitlement is written — a recycled container, an unavailable
   * database — the grant is spent, the days were never granted, and NO repair path can see it:
   * redeeming again refuses a spent grant and `findUnclaimedGrant` skips it. The buyer has paid, holds
   * no plan, and every self-service route answers "nothing to claim".
   *
   * A grant this account has already redeemed answers with its current state rather than an error, so a
   * client whose answer was lost repairs itself on the retry instead of being told the payment failed.
   */
  redeemInto(token: string, accountId: string, now: number): Promise<RedeemResult>;
  /**
   * The token of a grant this account has PAID FOR and not yet redeemed, if there is one.
   *
   * Without it, a paid customer whose device lost the token — cleared storage, bought on a phone and
   * opened the laptop — has no way to reach what they bought except a support ticket. The lookup is by
   * `bindHash(accountId)`, the same comparison `redeemGrant` already makes, so it grants no authority
   * that did not exist and reveals nothing to anyone who is not already authenticated as that account.
   */
  findUnclaimedGrant(accountId: string): Promise<string | null>;
  /** Delete-account: drop this account's entitlement. Grants are payment records, not account data. */
  purge(accountId: string): Promise<void>;
}

export class InMemoryEntitlementStore implements EntitlementStore {
  private rows = new Map<string, EntitlementRow>();
  private claims = new Set<string>();
  private claimedAt = new Map<string, number>();
  private grants = new Map<string, Omit<GrantDraft, 'boundTo'> & { boundToHash: string; redeemed: boolean; paid: boolean }>();

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
  async createGrant(draft: GrantDraft) {
    const token = randomBytes(24).toString('base64url');
    this.grants.set(token, { ...draft, boundToHash: bindHash(draft.boundTo), redeemed: false, paid: false });
    return token;
  }
  async markGrantPaid(invoiceId: string, paidKopecks: number): Promise<GrantPaidResult> {
    const g = [...this.grants.values()].find((x) => x.invoiceId === invoiceId);
    if (!g) return 'unknown';
    if (paidKopecks < g.amountKopecks) return 'underpaid';
    g.paid = true;
    return 'ok';
  }
  async findUnclaimedGrant(accountId: string) {
    const want = bindHash(accountId);
    for (const [token, g] of this.grants) if (g.paid && !g.redeemed && g.boundToHash === want) return token;
    return null;
  }
  async redeemGrant(token: string, accountId: string) {
    const g = this.grants.get(token);
    if (!g || g.redeemed || !g.paid) return null;
    if (g.boundToHash !== bindHash(accountId)) return null;
    g.redeemed = true;
    return g.days;
  }
  /** Atomic by construction here, for the same reason `mutate` is: nothing awaits mid-way. */
  async redeemInto(token: string, accountId: string, now: number): Promise<RedeemResult> {
    const g = this.grants.get(token);
    // Ownership is checked before anything is revealed, so `already` can only ever describe the
    // caller's own state.
    if (!g || !g.paid || g.boundToHash !== bindHash(accountId)) return { status: 'invalid' };
    if (g.redeemed) return { status: 'already', row: this.rows.get(accountId) ?? null };
    g.redeemed = true;
    const row = applyPayment(this.rows.get(accountId) ?? null, accountId, now, g.days);
    this.rows.set(accountId, row);
    return { status: 'applied', row };
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
