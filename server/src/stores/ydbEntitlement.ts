/**
 * EntitlementStore on YDB. Three tables, and the split between them is the PII firewall from
 * docs/backend-v1-design.md §Privacy — `entitlements` carries no payment reference and `payment_grants`
 * carries no account id, so neither query can reconstruct "who paid":
 *   entitlements(account_id PK, trial_started_at?, paid_until?, ai_used, window_started_at)
 *   trial_claims(install_hash PK, claimed_at)            -- hashed, see entitlements.installHash; TTL'd
 *   payment_grants(grant_token PK, payment_ref, invoice_id, amount_kopecks, days, bound_to?,
 *                  paid, redeemed, created_at, paid_at?)  -- INDEX by_invoice(invoice_id)
 * `bound_to` is a hash of the account that started checkout, not the account id — enough to reject a
 * leaked token presented by someone else, not enough to read the table as "who paid". `payment_ref` and
 * `invoice_id` do point outwards, at the acquirer's own records — which is what makes a refund or a
 * dispute answerable at all — but nothing on this side turns them back into an account.
 * See docs/yc-backend-setup.md for the DDL.
 */
import { randomBytes } from 'node:crypto';
import {
  bindHash,
  applyPayment,
  type EntitlementStore,
  type EntitlementRow,
  type Mutation,
  type GrantDraft,
  type GrantPaidResult,
  type RedeemResult,
} from '../entitlements.js';
import { query, withSerializableTx, TypedValues as T, Types, num } from '../ydb.js';
import type { StatsRow } from '../adminStats.js';

/** YDB Timestamp comes back as a Date (or micros); normalize to epoch ms. */
function tsMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Math.floor(v / 1000);
  if (v != null) return Number((v as { toString(): string }).toString());
  return 0;
}
const TOKEN_LIST = Types.list(Types.struct({ grant_token: Types.UTF8 }));

const optTs = (ms: number | undefined) =>
  ms == null ? T.optionalNull(Types.TIMESTAMP) : T.optional(T.timestamp(new Date(ms)));

export class YdbEntitlementStore implements EntitlementStore {
  async get(accountId: string): Promise<EntitlementRow | null> {
    const [rows] = await query(
      'DECLARE $a AS Utf8; SELECT trial_started_at, paid_until, ai_used, window_started_at FROM entitlements WHERE account_id=$a;',
      { $a: T.utf8(accountId) }
    );
    const r = rows[0];
    if (!r) return null;
    return {
      accountId,
      trialStartedAt: r.trial_started_at == null ? undefined : tsMs(r.trial_started_at),
      paidUntil: r.paid_until == null ? undefined : tsMs(r.paid_until),
      aiUsed: num(r.ai_used),
      windowStartedAt: tsMs(r.window_started_at),
    };
  }

  /** Reads the two dates for every row and counts in shared code, rather than counting in YQL. The
   *  policy ("is this a trial") lives in `planOf`, and a second copy here could not be tested: the store
   *  smokes need a live database, so CI never runs this path. Small-table convenience by design. */
  async statsRows(): Promise<StatsRow[]> {
    const [rows] = await query('SELECT trial_started_at, paid_until FROM entitlements;');
    return rows.map((r) => ({
      trialStartedAt: r.trial_started_at == null ? undefined : tsMs(r.trial_started_at),
      paidUntil: r.paid_until == null ? undefined : tsMs(r.paid_until),
    }));
  }

  async put(row: EntitlementRow): Promise<void> {
    await query(
      'DECLARE $a AS Utf8; DECLARE $t AS Timestamp?; DECLARE $p AS Timestamp?; DECLARE $u AS Uint32; DECLARE $w AS Timestamp;' +
        'UPSERT INTO entitlements (account_id, trial_started_at, paid_until, ai_used, window_started_at) VALUES ($a, $t, $p, $u, $w);',
      {
        $a: T.utf8(row.accountId),
        $t: optTs(row.trialStartedAt),
        $p: optTs(row.paidUntil),
        $u: T.uint32(row.aiUsed),
        $w: T.timestamp(new Date(row.windowStartedAt)),
      }
    );
  }

  /** Read and write inside ONE serializable transaction, so concurrent AI calls on the same account are
   *  charged one after another instead of all reading the same pre-charge `ai_used`. */
  async mutate<R>(accountId: string, decide: (row: EntitlementRow | null) => Mutation<R>): Promise<R> {
    return withSerializableTx(async (tx) => {
      const rows = await tx.exec(
        'DECLARE $a AS Utf8; SELECT trial_started_at, paid_until, ai_used, window_started_at FROM entitlements WHERE account_id=$a;',
        { $a: T.utf8(accountId) }
      );
      const r = rows[0]?.[0];
      const current: EntitlementRow | null = r
        ? {
            accountId,
            trialStartedAt: r.trial_started_at == null ? undefined : tsMs(r.trial_started_at),
            paidUntil: r.paid_until == null ? undefined : tsMs(r.paid_until),
            aiUsed: num(r.ai_used),
            windowStartedAt: tsMs(r.window_started_at),
          }
        : null;

      const { row, result } = decide(current);
      await tx.exec(
        row
          ? 'DECLARE $a AS Utf8; DECLARE $t AS Timestamp?; DECLARE $p AS Timestamp?; DECLARE $u AS Uint32; DECLARE $w AS Timestamp;' +
            'UPSERT INTO entitlements (account_id, trial_started_at, paid_until, ai_used, window_started_at) VALUES ($a, $t, $p, $u, $w);'
          : 'SELECT 1;', // nothing to write, but the tx still has to commit
        row
          ? {
              $a: T.utf8(row.accountId),
              $t: optTs(row.trialStartedAt),
              $p: optTs(row.paidUntil),
              $u: T.uint32(row.aiUsed),
              $w: T.timestamp(new Date(row.windowStartedAt)),
            }
          : {},
        true
      );
      return result;
    });
  }

  async trialClaimed(hash: string): Promise<boolean> {
    const [rows] = await query('DECLARE $h AS Utf8; SELECT install_hash FROM trial_claims WHERE install_hash=$h;', { $h: T.utf8(hash) });
    return rows.length > 0;
  }

  async markTrialClaimed(hash: string): Promise<void> {
    await query(
      'DECLARE $h AS Utf8; DECLARE $ts AS Timestamp; UPSERT INTO trial_claims (install_hash, claimed_at) VALUES ($h, $ts);',
      { $h: T.utf8(hash), $ts: T.timestamp(new Date()) }
    );
  }

  /** Created UNPAID: only the signature-verified callback may flip `paid`. See `GrantDraft`. */
  async createGrant(draft: GrantDraft): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await query(
      'DECLARE $g AS Utf8; DECLARE $r AS Utf8; DECLARE $i AS Utf8; DECLARE $k AS Uint32; DECLARE $d AS Uint32; DECLARE $b AS Utf8?; DECLARE $ts AS Timestamp;' +
        'UPSERT INTO payment_grants (grant_token, payment_ref, invoice_id, amount_kopecks, days, bound_to, paid, redeemed, created_at)' +
        ' VALUES ($g, $r, $i, $k, $d, $b, false, false, $ts);',
      {
        $g: T.utf8(token),
        $r: T.utf8(draft.paymentRef),
        $i: T.utf8(draft.invoiceId),
        $k: T.uint32(draft.amountKopecks),
        $d: T.uint32(draft.days),
        $b: T.optional(T.utf8(bindHash(draft.boundTo))),
        $ts: T.timestamp(new Date()),
      }
    );
    return token;
  }

  /**
   * Confirm by invoice — the only identifier the acquirer sends back. Read through the `by_invoice`
   * index, then write by primary key: a global secondary index is its own table, so the row it hands
   * back carries only the indexed column plus the key.
   *
   * Serializable and idempotent: the acquirer retries the notification until it is acknowledged, so a
   * second delivery lands on an already-paid row and must be a no-op that still answers `ok`.
   */
  async markGrantPaid(invoiceId: string, paidKopecks: number): Promise<GrantPaidResult> {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $i AS Utf8; SELECT grant_token FROM payment_grants VIEW by_invoice WHERE invoice_id=$i;',
        { $i: T.utf8(invoiceId) }
      );
      const token = rows[0]?.grant_token;
      if (token == null) return 'unknown';
      const [grantRows] = await tx.exec(
        'DECLARE $g AS Utf8; SELECT amount_kopecks, paid FROM payment_grants WHERE grant_token=$g;',
        { $g: T.utf8(String(token)) }
      );
      const g = grantRows[0];
      if (!g) return 'unknown';
      if (paidKopecks < num(g.amount_kopecks)) return 'underpaid';
      if (g.paid === true) return 'ok';
      await tx.exec(
        'DECLARE $g AS Utf8; DECLARE $ts AS Timestamp; UPSERT INTO payment_grants (grant_token, paid, paid_at) VALUES ($g, true, $ts);',
        { $g: T.utf8(String(token)), $ts: T.timestamp(new Date()) },
        true
      );
      return 'ok';
    });
  }

  /**
   * Paid but unredeemed, for the account that bought it. Read through `by_bound`, then the rows by key:
   * a global secondary index is its own table and carries only the indexed column plus the primary key,
   * so `paid`/`redeemed` have to come from a second read. `AS_TABLE` turns that into ONE query rather
   * than a round-trip per candidate.
   *
   * Not a transaction: the worst case is handing back a token that someone redeemed a moment ago, and
   * `redeemGrant` is serializable, so that attempt simply fails — which is the same answer as not
   * offering the token at all.
   */
  async findUnclaimedGrant(accountId: string): Promise<string | null> {
    // The index carries only `bound_to`, so `paid`/`redeemed`/`created_at` are filtered and ordered
    // below — which means this LIMIT is an ARBITRARY window, not the newest rows. At 50 it was reachable:
    // every checkout tap mints a grant, abandoned ones are never cleaned up, and `payment_grants` has no
    // TTL by design (it is the payment record). Once an account crossed 50 rows, a real purchase could
    // fall outside the window and this endpoint would answer "nothing to claim" to someone who had paid.
    // A proper fix is an index on (bound_to, created_at) so the scan can be ordered and truly bounded;
    // until then the window is wide enough that reaching it takes hundreds of abandoned checkouts.
    const [indexRows] = await query(
      'DECLARE $b AS Utf8; SELECT grant_token FROM payment_grants VIEW by_bound WHERE bound_to=$b LIMIT 1000;',
      { $b: T.utf8(bindHash(accountId)) }
    );
    const tokens = indexRows.map((r) => String(r.grant_token)).filter(Boolean);
    if (tokens.length === 0) return null;

    const [rows] = await query(
      'DECLARE $rows AS List<Struct<grant_token:Utf8>>;' +
        'SELECT g.grant_token AS grant_token, g.paid AS paid, g.redeemed AS redeemed, g.created_at AS created_at' +
        ' FROM AS_TABLE($rows) AS r INNER JOIN payment_grants AS g ON g.grant_token = r.grant_token;',
      { $rows: T.fromNative(TOKEN_LIST, tokens.map((grant_token) => ({ grant_token }))) }
    );
    const open = rows.filter((r) => r.paid === true && r.redeemed !== true);
    // Newest first: a second purchase while an older one is somehow stuck should be what gets applied.
    open.sort((a, b) => tsMs(b.created_at) - tsMs(a.created_at));
    return open.length > 0 ? String(open[0].grant_token) : null;
  }

  /** Serializable: a token replayed from two tabs must grant days exactly once. The partial UPSERT is
   *  YDB's update-named-columns form (same idiom as ydbAuth's refresh revoke) — it leaves payment_ref,
   *  days and created_at intact, which the audit trail depends on. */
  async redeemGrant(token: string, accountId: string): Promise<number | null> {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $g AS Utf8; SELECT days, paid, redeemed, bound_to FROM payment_grants WHERE grant_token=$g;',
        { $g: T.utf8(token) }
      );
      const r = rows[0];
      if (!r || r.redeemed === true) return null;
      // NULL on a row written before billing existed, and unpaid is the safe reading of an unknown.
      if (r.paid !== true) return null;
      if (r.bound_to != null && String(r.bound_to) !== bindHash(accountId)) return null;
      const days = num(r.days);
      await tx.exec('DECLARE $g AS Utf8; UPSERT INTO payment_grants (grant_token, redeemed) VALUES ($g, true);', { $g: T.utf8(token) }, true);
      return days;
    });
  }

  /** The grant flip and the entitlement write share one serializable transaction: either the buyer gets
   *  their days or the grant stays unspent, never the gap between the two. */
  async redeemInto(token: string, accountId: string, now: number): Promise<RedeemResult> {
    return withSerializableTx<RedeemResult>(async (tx) => {
      const [grants] = await tx.exec(
        'DECLARE $g AS Utf8; SELECT days, paid, redeemed, bound_to FROM payment_grants WHERE grant_token=$g;',
        { $g: T.utf8(token) }
      );
      const g = grants[0];
      const mine = g?.bound_to != null && String(g.bound_to) === bindHash(accountId);
      // NULL on a row written before billing existed, and unpaid is the safe reading of an unknown.
      if (!g || g.paid !== true || !mine) {
        await tx.exec('SELECT 1;', {}, true);
        return { status: 'invalid' };
      }

      const [entRows] = await tx.exec(
        'DECLARE $a AS Utf8; SELECT trial_started_at, paid_until, ai_used, window_started_at FROM entitlements WHERE account_id=$a;',
        { $a: T.utf8(accountId) }
      );
      const e = entRows[0];
      const current: EntitlementRow | null = e
        ? {
            accountId,
            trialStartedAt: e.trial_started_at == null ? undefined : tsMs(e.trial_started_at),
            paidUntil: e.paid_until == null ? undefined : tsMs(e.paid_until),
            aiUsed: num(e.ai_used),
            windowStartedAt: tsMs(e.window_started_at),
          }
        : null;

      if (g.redeemed === true) {
        await tx.exec('SELECT 1;', {}, true);
        return { status: 'already', row: current };
      }

      const next = applyPayment(current, accountId, now, num(g.days));
      // Partial UPSERT, as in redeemGrant: payment_ref, days and created_at are the audit trail.
      await tx.exec('DECLARE $g AS Utf8; UPSERT INTO payment_grants (grant_token, redeemed) VALUES ($g, true);', { $g: T.utf8(token) });
      await tx.exec(
        'DECLARE $a AS Utf8; DECLARE $t AS Timestamp?; DECLARE $p AS Timestamp?; DECLARE $u AS Uint32; DECLARE $w AS Timestamp;' +
          'UPSERT INTO entitlements (account_id, trial_started_at, paid_until, ai_used, window_started_at) VALUES ($a, $t, $p, $u, $w);',
        {
          $a: T.utf8(next.accountId),
          $t: optTs(next.trialStartedAt),
          $p: optTs(next.paidUntil),
          $u: T.uint32(next.aiUsed),
          $w: T.timestamp(new Date(next.windowStartedAt)),
        },
        true
      );
      return { status: 'applied', row: next };
    });
  }

  async purge(accountId: string): Promise<void> {
    await query('DECLARE $a AS Utf8; DELETE FROM entitlements WHERE account_id=$a;', { $a: T.utf8(accountId) });
  }
}
