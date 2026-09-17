/**
 * TotpStore on YDB — one table:
 *   totp(account_id PK, secret_enc, confirmed_at?, last_step?, backup_hashes, fail_count, fail_window_start)
 *
 * `secret_enc` is AES-GCM sealed under a Lockbox key that never reaches this database, so a dump stays as
 * unusable as it is for verifiers and refresh tokens. `backup_hashes` is a newline-joined list of SHA-256
 * hashes: the set is at most ten short strings that are always read and written whole, so a second table
 * would buy nothing. See docs/yc-backend-setup.md for the DDL.
 */
import type { TotpStore, TotpRow } from '../totp.js';
import { query, withSerializableTx, TypedValues as T, Types, num } from '../ydb.js';

function tsMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Math.floor(v / 1000);
  if (v != null) return Number((v as { toString(): string }).toString());
  return 0;
}
const optTs = (ms: number | undefined) =>
  ms == null ? T.optionalNull(Types.TIMESTAMP) : T.optional(T.timestamp(new Date(ms)));
const optU32 = (n: number | undefined) => (n == null ? T.optionalNull(Types.UINT32) : T.optional(T.uint32(n)));
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export class YdbTotpStore implements TotpStore {
  async get(accountId: string): Promise<TotpRow | null> {
    const [rows] = await query(
      'DECLARE $a AS Utf8; SELECT secret_enc, confirmed_at, last_step, backup_hashes, fail_count, fail_window_start, anon_fail_count, anon_fail_window_start FROM totp WHERE account_id=$a;',
      { $a: T.utf8(accountId) }
    );
    const r = rows[0];
    if (!r) return null;
    const joined = str(r.backup_hashes);
    return {
      accountId,
      secretEnc: str(r.secret_enc),
      confirmedAt: r.confirmed_at == null ? undefined : tsMs(r.confirmed_at),
      lastStep: r.last_step == null ? undefined : num(r.last_step),
      backupHashes: joined ? joined.split('\n') : [],
      failCount: num(r.fail_count),
      failWindowStart: tsMs(r.fail_window_start),
      // NULL on rows written before the counters were split; reads as zero, which is the right default.
      anonFailCount: r.anon_fail_count == null ? undefined : num(r.anon_fail_count),
      anonFailWindowStart: r.anon_fail_window_start == null ? undefined : tsMs(r.anon_fail_window_start),
    };
  }

  async put(row: TotpRow): Promise<void> {
    await query(
      'DECLARE $a AS Utf8; DECLARE $s AS Utf8; DECLARE $c AS Timestamp?; DECLARE $l AS Uint32?; DECLARE $b AS Utf8;' +
        'DECLARE $f AS Uint32; DECLARE $w AS Timestamp; DECLARE $af AS Uint32?; DECLARE $aw AS Timestamp?;' +
        'UPSERT INTO totp (account_id, secret_enc, confirmed_at, last_step, backup_hashes, fail_count, fail_window_start, anon_fail_count, anon_fail_window_start)' +
        ' VALUES ($a, $s, $c, $l, $b, $f, $w, $af, $aw);',
      {
        $a: T.utf8(row.accountId),
        $s: T.utf8(row.secretEnc),
        $c: optTs(row.confirmedAt),
        $l: optU32(row.lastStep),
        $b: T.utf8(row.backupHashes.join('\n')),
        $f: T.uint32(row.failCount),
        $w: T.timestamp(new Date(row.failWindowStart)),
        $af: optU32(row.anonFailCount),
        $aw: optTs(row.anonFailWindowStart),
      }
    );
  }

  async remove(accountId: string): Promise<void> {
    await query('DECLARE $a AS Utf8; DELETE FROM totp WHERE account_id=$a;', { $a: T.utf8(accountId) });
  }

  /** Read and write in ONE serializable transaction, so parallel guesses against the same account are
   *  counted one after another. Outside a transaction the lockout counts round-trips, not attempts. */
  async verify<R>(accountId: string, decide: (row: TotpRow | null) => { row?: TotpRow; result: R }): Promise<R> {
    return withSerializableTx(async (tx) => {
      const rows = await tx.exec(
        'DECLARE $a AS Utf8; SELECT secret_enc, confirmed_at, last_step, backup_hashes, fail_count, fail_window_start, anon_fail_count, anon_fail_window_start FROM totp WHERE account_id=$a;',
        { $a: T.utf8(accountId) }
      );
      const r = rows[0]?.[0];
      const joined = r ? str(r.backup_hashes) : '';
      const current: TotpRow | null = r
        ? {
            accountId,
            secretEnc: str(r.secret_enc),
            confirmedAt: r.confirmed_at == null ? undefined : tsMs(r.confirmed_at),
            lastStep: r.last_step == null ? undefined : num(r.last_step),
            backupHashes: joined ? joined.split('\n') : [],
            failCount: num(r.fail_count),
            failWindowStart: tsMs(r.fail_window_start),
            // Reading these back matters as much as writing them: miss it here and the unauthenticated
            // counter is written on every failure and read as zero on every attempt, so `/recover` is
            // never throttled in production — while every smoke passes, because the in-memory store
            // keeps whole objects and never round-trips through columns.
            anonFailCount: r.anon_fail_count == null ? undefined : num(r.anon_fail_count),
            anonFailWindowStart: r.anon_fail_window_start == null ? undefined : tsMs(r.anon_fail_window_start),
          }
        : null;

      const { row, result } = decide(current);
      await tx.exec(
        row
          ? 'DECLARE $a AS Utf8; DECLARE $s AS Utf8; DECLARE $c AS Timestamp?; DECLARE $l AS Uint32?; DECLARE $b AS Utf8;' +
            'DECLARE $f AS Uint32; DECLARE $w AS Timestamp; DECLARE $af AS Uint32?; DECLARE $aw AS Timestamp?;' +
            'UPSERT INTO totp (account_id, secret_enc, confirmed_at, last_step, backup_hashes, fail_count, fail_window_start, anon_fail_count, anon_fail_window_start)' +
            ' VALUES ($a, $s, $c, $l, $b, $f, $w, $af, $aw);'
          : 'SELECT 1;', // nothing to write, but the tx still has to commit
        row
          ? {
              $a: T.utf8(row.accountId),
              $s: T.utf8(row.secretEnc),
              $c: optTs(row.confirmedAt),
              $l: optU32(row.lastStep),
              $b: T.utf8(row.backupHashes.join('\n')),
              $f: T.uint32(row.failCount),
              $w: T.timestamp(new Date(row.failWindowStart)),
        $af: optU32(row.anonFailCount),
        $aw: optTs(row.anonFailWindowStart),
            }
          : {},
        true
      );
      return result;
    });
  }

  /** Read and delete in ONE serializable transaction, so a `confirm` cannot slip in between the check
   *  and the delete and turn cancelling a setup into stripping a live second factor. */
  async removeIfUnconfirmed(accountId: string): Promise<boolean> {
    return withSerializableTx<boolean>(async (tx) => {
      const [rows] = await tx.exec('DECLARE $a AS Utf8; SELECT confirmed_at FROM totp WHERE account_id=$a;', {
        $a: T.utf8(accountId),
      });
      const r = rows[0];
      if (!r || r.confirmed_at != null) {
        await tx.exec('SELECT 1;', {}, true); // commit the (empty) tx
        return false;
      }
      await tx.exec('DECLARE $a AS Utf8; DELETE FROM totp WHERE account_id=$a;', { $a: T.utf8(accountId) }, true);
      return true;
    });
  }
}
