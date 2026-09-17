/**
 * RecoveryNameStore on YDB — two tables:
 *   recovery_names(name_hash, account_id) PK, created_at  ·  VIEW by_account(account_id)
 *   recovery_name_attempts(name_hash PK, fail_count, fail_window_start)
 *
 * The key is the composite (name_hash, account_id) because names are deliberately not unique, so the
 * forward lookup is a primary-key prefix read. Finding an account's OWN name is the reverse direction
 * and needs the index — never a scan, or setting a name would read the whole table.
 *
 * See docs/yc-backend-setup.md for the DDL and src/recoveryName.ts for why any of this exists.
 */
import {
  type RecoveryNameStore,
  type NameAttempts,
  type SetNameResult,
  NAME_CANDIDATE_CAP,
} from '../recoveryName.js';
import { query, withSerializableTx, TypedValues as T, num } from '../ydb.js';

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

function tsMs(v: unknown): number {
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Math.floor(v / 1000);
  if (v != null) return Number((v as { toString(): string }).toString());
  return 0;
}

const OWN_NAME =
  'DECLARE $a AS Utf8; SELECT name_hash FROM recovery_names VIEW by_account WHERE account_id=$a;';

export class YdbRecoveryNameStore implements RecoveryNameStore {
  /**
   * One transaction, because all three steps have to agree: the account's old row must go, the cap must
   * hold, and the new row must appear. Two accounts racing onto the same crowded name would otherwise
   * both read `holders = CAP - 1` and both insert.
   *
   * The old row is DELETEd rather than overwritten — the account id is only half the primary key, so an
   * UPSERT alone would add a second row and leave the account findable under every name it has ever had.
   */
  async setName(accountId: string, hash: string, now: number): Promise<SetNameResult> {
    return withSerializableTx<SetNameResult>(async (tx) => {
      const [mine] = await tx.exec(OWN_NAME, { $a: T.utf8(accountId) });
      const current = mine?.map((r) => str(r.name_hash)) ?? [];
      if (current.length === 1 && current[0] === hash) {
        await tx.exec('SELECT 1;', {}, true);
        return 'ok';
      }

      // LIMIT CAP+1 is all the answer needs: the question is "are there already this many", and the
      // table could in principle hold far more rows under one hash if the cap ever changed downward.
      const [holderRows] = await tx.exec(
        `DECLARE $h AS Utf8; SELECT account_id FROM recovery_names WHERE name_hash=$h LIMIT ${NAME_CANDIDATE_CAP + 1};`,
        { $h: T.utf8(hash) }
      );
      const holders = (holderRows ?? []).map((r) => str(r.account_id)).filter((id) => id !== accountId);
      if (holders.length >= NAME_CANDIDATE_CAP) {
        await tx.exec('SELECT 1;', {}, true);
        return 'crowded';
      }

      for (const old of current) {
        await tx.exec(
          'DECLARE $h AS Utf8; DECLARE $a AS Utf8; DELETE FROM recovery_names WHERE name_hash=$h AND account_id=$a;',
          { $h: T.utf8(old), $a: T.utf8(accountId) }
        );
      }
      await tx.exec(
        'DECLARE $h AS Utf8; DECLARE $a AS Utf8; DECLARE $c AS Timestamp;' +
          ' UPSERT INTO recovery_names (name_hash, account_id, created_at) VALUES ($h, $a, $c);',
        { $h: T.utf8(hash), $a: T.utf8(accountId), $c: T.timestamp(new Date(now)) },
        true
      );
      return 'ok';
    });
  }

  async clearName(accountId: string): Promise<void> {
    const [rows] = await query(OWN_NAME, { $a: T.utf8(accountId) });
    for (const r of rows ?? []) {
      await query(
        'DECLARE $h AS Utf8; DECLARE $a AS Utf8; DELETE FROM recovery_names WHERE name_hash=$h AND account_id=$a;',
        { $h: T.utf8(str(r.name_hash)), $a: T.utf8(accountId) }
      );
    }
  }

  async hasName(accountId: string): Promise<boolean> {
    const [rows] = await query(OWN_NAME, { $a: T.utf8(accountId) });
    return (rows?.length ?? 0) > 0;
  }

  async candidates(hash: string): Promise<string[]> {
    const [rows] = await query(
      `DECLARE $h AS Utf8; SELECT account_id FROM recovery_names WHERE name_hash=$h LIMIT ${NAME_CANDIDATE_CAP};`,
      { $h: T.utf8(hash) }
    );
    return (rows ?? []).map((r) => str(r.account_id));
  }

  /** Read and write in ONE serializable transaction, for the same reason `YdbTotpStore.verify` is: a
   *  counter updated outside a transaction advances once per round-trip, not once per attempt. */
  async bumpAttempts<T2>(
    hash: string,
    decide: (a: NameAttempts | null) => { row?: NameAttempts; result: T2 }
  ): Promise<T2> {
    return withSerializableTx(async (tx) => {
      const [rows] = await tx.exec(
        'DECLARE $h AS Utf8; SELECT fail_count, fail_window_start FROM recovery_name_attempts WHERE name_hash=$h;',
        { $h: T.utf8(hash) }
      );
      const r = rows?.[0];
      const current: NameAttempts | null = r
        ? { nameHash: hash, failCount: num(r.fail_count), failWindowStart: tsMs(r.fail_window_start) }
        : null;

      const { row, result } = decide(current);
      await tx.exec(
        row
          ? 'DECLARE $h AS Utf8; DECLARE $f AS Uint32; DECLARE $w AS Timestamp;' +
            ' UPSERT INTO recovery_name_attempts (name_hash, fail_count, fail_window_start) VALUES ($h, $f, $w);'
          : 'SELECT 1;', // nothing to write, but the tx still has to commit
        row
          ? { $h: T.utf8(row.nameHash), $f: T.uint32(row.failCount), $w: T.timestamp(new Date(row.failWindowStart)) }
          : {},
        true
      );
      return result;
    });
  }

  /** The attempt counter is deliberately left alone: it is keyed by name, and everyone else who chose
   *  that name still needs it. Only this account's index row goes. */
  async purge(accountId: string): Promise<void> {
    await this.clearName(accountId);
  }
}
