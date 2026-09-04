/**
 * SyncStore on YDB (Track B). The push runs in ONE serializable transaction (F1): read the seq counter +
 * all touched current_state rows, resolve in JS with the shared `resolveServer`, then batch-write the
 * changed rows to current_state + changelog via AS_TABLE (a handful of statements regardless of batch
 * size — no per-row round-trips), bump the counter by the number of changes, and record the idempotency
 * key. Pull returns the current-state snapshot (since=0) or changelog rows after a cursor.
 */
import { query, withSerializableTx, TypedValues as T, Types, num } from '../ydb.js';
import { resolveServer, sameChange, type Change, type Entry, type PushResult, type PullResult, type SyncStore } from '../sync.js';

const str = (v: unknown): string => (v == null ? '' : String(v));

/** current_state / changelog share these columns; one row array feeds both AS_TABLE upserts. */
const ROW_LIST = Types.list(
  Types.struct({
    user_id: Types.UTF8,
    store: Types.UTF8,
    id: Types.UTF8,
    seq: Types.UINT64,
    updated_at: Types.UINT64,
    updated_by: Types.UTF8,
    deleted_at: Types.optional(Types.UINT64),
    status_updated_at: Types.optional(Types.UINT64),
    payload: Types.JSON,
  })
);

interface Row {
  user_id: string;
  store: string;
  id: string;
  seq: number;
  updated_at: number;
  updated_by: string;
  deleted_at: number | null;
  status_updated_at: number | null;
  payload: string;
}

function parsePayload(v: unknown): unknown {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v);
    } catch {
      return v;
    }
  }
  return v;
}

/** A current_state / changelog DB row → a wire Change (payload parsed, nulls dropped). */
function rowToChange(r: Record<string, unknown>): Change {
  const c: Change = {
    store: str(r.store) as Change['store'],
    id: str(r.id),
    updatedAt: num(r.updated_at),
    updatedBy: str(r.updated_by),
    payload: parsePayload(r.payload),
  };
  if (r.deleted_at != null) c.deletedAt = num(r.deleted_at);
  if (r.status_updated_at != null) c.statusUpdatedAt = num(r.status_updated_at);
  return c;
}

function changeToRow(userId: string, seq: number, c: Change): Row {
  return {
    user_id: userId,
    store: c.store,
    id: c.id,
    seq,
    updated_at: c.updatedAt,
    updated_by: c.updatedBy,
    deleted_at: c.deletedAt ?? null,
    status_updated_at: c.statusUpdatedAt ?? null,
    payload: JSON.stringify(c.payload ?? null),
  };
}

export class YdbSyncStore implements SyncStore {
  async push(userId: string, _cursorSeq: number, changes: Change[], idempotencyKey: string): Promise<PushResult> {
    return withSerializableTx(async (tx) => {
      // 1. Idempotency: a replayed batch returns its memoized result without re-applying.
      const [idem] = await tx.exec(
        'DECLARE $u AS Utf8; DECLARE $k AS Utf8; SELECT result FROM idempotency WHERE user_id=$u AND idem_key=$k;',
        { $u: T.utf8(userId), $k: T.utf8(idempotencyKey) }
      );
      if (idem[0]) {
        await tx.exec('SELECT 1;', {}, true);
        return JSON.parse(str(idem[0].result)) as PushResult;
      }

      // 2. seq counter.
      const [seqRows] = await tx.exec('DECLARE $u AS Utf8; SELECT seq FROM seq_counter WHERE user_id=$u;', { $u: T.utf8(userId) });
      let seq = seqRows[0] ? num(seqRows[0].seq) : 0;

      // 3. Load all touched current_state rows in one query (batched — no per-row round-trips).
      const ids = [...new Set(changes.map((c) => c.id))];
      const stored = new Map<string, Change>();
      if (ids.length) {
        const [rows] = await tx.exec(
          'DECLARE $u AS Utf8; DECLARE $ids AS List<Utf8>; SELECT store, id, updated_at, updated_by, deleted_at, status_updated_at, payload FROM current_state WHERE user_id=$u AND id IN $ids;',
          { $u: T.utf8(userId), $ids: T.fromNative(Types.list(Types.UTF8), ids) }
        );
        for (const r of rows) stored.set(`${str(r.store)}:${str(r.id)}`, rowToChange(r));
      }

      // 4. Resolve in JS; only rows that actually change get a new seq + a changelog entry.
      const applied: Entry[] = [];
      const currentByKey = new Map<string, Row>();
      const changelogRows: Row[] = [];
      for (const incoming of changes) {
        const key = `${incoming.store}:${incoming.id}`;
        const prev = stored.get(key);
        const resolved = resolveServer(prev, incoming);
        if (prev && sameChange(prev, resolved)) continue; // no-op / losing write
        seq += 1;
        stored.set(key, resolved); // a later change to the same key resolves against this
        const row = changeToRow(userId, seq, resolved);
        currentByKey.set(key, row);
        changelogRows.push(row);
        applied.push({ ...resolved, seq });
      }

      // 5. Batch-write changed rows, bump the counter, record idempotency — then commit atomically.
      if (applied.length) {
        await tx.exec(
          'DECLARE $rows AS List<Struct<user_id:Utf8,store:Utf8,id:Utf8,seq:Uint64,updated_at:Uint64,updated_by:Utf8,deleted_at:Uint64?,status_updated_at:Uint64?,payload:Json>>;' +
            'UPSERT INTO current_state SELECT user_id, store, id, seq, updated_at, updated_by, deleted_at, status_updated_at, payload FROM AS_TABLE($rows);',
          { $rows: T.fromNative(ROW_LIST, [...currentByKey.values()]) }
        );
        await tx.exec(
          'DECLARE $rows AS List<Struct<user_id:Utf8,store:Utf8,id:Utf8,seq:Uint64,updated_at:Uint64,updated_by:Utf8,deleted_at:Uint64?,status_updated_at:Uint64?,payload:Json>>;' +
            'UPSERT INTO changelog SELECT user_id, seq, store, id, updated_at, updated_by, deleted_at, status_updated_at, payload FROM AS_TABLE($rows);',
          { $rows: T.fromNative(ROW_LIST, changelogRows) }
        );
      }
      const result: PushResult = { head: seq, applied };
      await tx.exec('DECLARE $u AS Utf8; DECLARE $s AS Uint64; UPSERT INTO seq_counter (user_id, seq) VALUES ($u, $s);', { $u: T.utf8(userId), $s: T.uint64(seq) });
      await tx.exec(
        'DECLARE $u AS Utf8; DECLARE $k AS Utf8; DECLARE $r AS Json; DECLARE $t AS Timestamp; UPSERT INTO idempotency (user_id, idem_key, result, created_at) VALUES ($u, $k, $r, $t);',
        { $u: T.utf8(userId), $k: T.utf8(idempotencyKey), $r: T.json(JSON.stringify(result)), $t: T.timestamp(new Date()) },
        true
      );
      return result;
    });
  }

  async pull(userId: string, since: number, limit = 500): Promise<PullResult> {
    const [headRows] = await query('DECLARE $u AS Utf8; SELECT seq FROM seq_counter WHERE user_id=$u;', { $u: T.utf8(userId) });
    const head = headRows[0] ? num(headRows[0].seq) : 0;

    if (since <= 0) {
      const [rows] = await query(
        'DECLARE $u AS Utf8; DECLARE $lim AS Uint64; SELECT store, id, seq, updated_at, updated_by, deleted_at, status_updated_at, payload FROM current_state WHERE user_id=$u ORDER BY seq LIMIT $lim;',
        { $u: T.utf8(userId), $lim: T.uint64(limit) }
      );
      return { head, entries: rows.map((r) => ({ ...rowToChange(r), seq: num(r.seq) })), snapshot: true };
    }
    const [rows] = await query(
      'DECLARE $u AS Utf8; DECLARE $since AS Uint64; DECLARE $lim AS Uint64; SELECT store, id, seq, updated_at, updated_by, deleted_at, status_updated_at, payload FROM changelog WHERE user_id=$u AND seq > $since ORDER BY seq LIMIT $lim;',
      { $u: T.utf8(userId), $since: T.uint64(since), $lim: T.uint64(limit) }
    );
    return { head, entries: rows.map((r) => ({ ...rowToChange(r), seq: num(r.seq) })) };
  }

  async purge(userId: string): Promise<void> {
    for (const t of ['changelog', 'current_state', 'seq_counter', 'idempotency']) {
      await query(`DECLARE $u AS Utf8; DELETE FROM ${t} WHERE user_id=$u;`, { $u: T.utf8(userId) });
    }
  }
}
