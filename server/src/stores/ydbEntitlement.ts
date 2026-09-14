/**
 * EntitlementStore on YDB. Three tables, and the split between them is the PII firewall from
 * docs/backend-v1-design.md §Privacy — `entitlements` carries no payment reference and `payment_grants`
 * carries no account id, so neither query can reconstruct "who paid":
 *   entitlements(account_id PK, trial_started_at?, paid_until?, ai_used, window_started_at)
 *   trial_claims(install_hash PK, claimed_at)            -- hashed, see entitlements.installHash; TTL'd
 *   payment_grants(grant_token PK, payment_ref, days, bound_to?, redeemed, created_at)
 * `bound_to` is a hash of the account that started checkout, not the account id — enough to reject a
 * leaked token presented by someone else, not enough to read the table as "who paid".
 * See docs/yc-backend-setup.md for the DDL.
 */
import { randomBytes } from 'node:crypto';
import { bindHash, type EntitlementStore, type EntitlementRow } from '../entitlements.js';
import { query, withSerializableTx, TypedValues as T, Types, num } from '../ydb.js';

/** YDB Timestamp comes back as a Date (or micros); normalize to epoch ms. */
function tsMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Math.floor(v / 1000);
  if (v != null) return Number((v as { toString(): string }).toString());
  return 0;
}
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

  async createGrant(paymentRef: string, days: number, boundTo?: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await query(
      'DECLARE $g AS Utf8; DECLARE $r AS Utf8; DECLARE $d AS Uint32; DECLARE $b AS Utf8?; DECLARE $ts AS Timestamp;' +
        'UPSERT INTO payment_grants (grant_token, payment_ref, days, bound_to, redeemed, created_at) VALUES ($g, $r, $d, $b, false, $ts);',
      {
        $g: T.utf8(token),
        $r: T.utf8(paymentRef),
        $d: T.uint32(days),
        $b: boundTo == null ? T.optionalNull(Types.UTF8) : T.optional(T.utf8(bindHash(boundTo))),
        $ts: T.timestamp(new Date()),
      }
    );
    return token;
  }

  /** Serializable: a token replayed from two tabs must grant days exactly once. The partial UPSERT is
   *  YDB's update-named-columns form (same idiom as ydbAuth's refresh revoke) — it leaves payment_ref,
   *  days and created_at intact, which the audit trail depends on. */
  async redeemGrant(token: string, accountId: string): Promise<number | null> {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $g AS Utf8; SELECT days, redeemed, bound_to FROM payment_grants WHERE grant_token=$g;',
        { $g: T.utf8(token) }
      );
      const r = rows[0];
      if (!r || r.redeemed === true) return null;
      if (r.bound_to != null && String(r.bound_to) !== bindHash(accountId)) return null;
      const days = num(r.days);
      await tx.exec('DECLARE $g AS Utf8; UPSERT INTO payment_grants (grant_token, redeemed) VALUES ($g, true);', { $g: T.utf8(token) }, true);
      return days;
    });
  }

  async purge(accountId: string): Promise<void> {
    await query('DECLARE $a AS Utf8; DELETE FROM entitlements WHERE account_id=$a;', { $a: T.utf8(accountId) });
  }
}
