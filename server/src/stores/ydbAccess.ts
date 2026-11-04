import type { AccessRowOptions, AccessStore } from '../accessStore.js';
import { atomicQuery, query, TypedValues as T, Types } from '../ydb.js';

export class YdbAccessStore implements AccessStore {
  private ready = false;
  async available(): Promise<boolean> {
    if (this.ready) return true;
    try {
      await query('SELECT record_key FROM account_access LIMIT 0;');
      await query(
        'SELECT record_key FROM account_access VIEW by_account LIMIT 0;'
      );
      this.ready = true;
      return true;
    } catch (error) {
      if (
        error instanceof Error &&
        /(?:path|table).*(?:does not exist|not found)|(?:cannot find|unknown) table/i.test(
          error.message
        )
      )
        return false;
      throw error;
    }
  }
  async get<V>(key: string): Promise<V | undefined> {
    const [rows] = await query(
      'DECLARE $key AS Utf8; SELECT payload, expires_at FROM account_access WHERE record_key=$key;',
      { $key: T.utf8(key) }
    );
    const row = rows[0];
    if (!row) return;
    if (row.expires_at != null) {
      const expiry =
        row.expires_at instanceof Date
          ? row.expires_at.getTime()
          : typeof row.expires_at === 'number'
            ? row.expires_at / 1000
            : Date.parse(String(row.expires_at));
      if (!Number.isFinite(expiry))
        throw new Error('Invalid account-access expiry');
      if (expiry <= Date.now()) return;
    }
    return JSON.parse(String(row.payload)) as V;
  }
  async put<V>(
    key: string,
    value: V,
    options: AccessRowOptions = {}
  ): Promise<void> {
    await query(
      'DECLARE $key AS Utf8; DECLARE $payload AS Utf8; DECLARE $account AS Utf8?; DECLARE $expiry AS Timestamp?;' +
        'UPSERT INTO account_access (record_key,payload,account_id,expires_at) VALUES ($key,$payload,$account,$expiry);',
      {
        $key: T.utf8(key),
        $payload: T.utf8(JSON.stringify(value)),
        $account:
          options.accountId == null
            ? T.optionalNull(Types.UTF8)
            : T.optional(T.utf8(options.accountId)),
        $expiry:
          options.expiresAt == null
            ? T.optionalNull(Types.TIMESTAMP)
            : T.optional(T.timestamp(new Date(options.expiresAt))),
      }
    );
  }
  async remove(key: string): Promise<void> {
    await query(
      'DECLARE $key AS Utf8; DELETE FROM account_access WHERE record_key=$key;',
      { $key: T.utf8(key) }
    );
  }
  async purge(accountId: string): Promise<void> {
    for (;;) {
      const [rows] = await query(
        'DECLARE $account AS Utf8; SELECT record_key FROM account_access VIEW by_account WHERE account_id=$account LIMIT 100;',
        { $account: T.utf8(accountId) }
      );
      if (!rows.length) return;
      await this.atomic(async () => {
        for (const row of rows) await this.remove(String(row.record_key));
      });
    }
  }
  atomic<V>(fn: () => Promise<V>): Promise<V> {
    return atomicQuery(fn);
  }
}
