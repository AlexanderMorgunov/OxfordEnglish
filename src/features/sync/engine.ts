/**
 * Client sync engine (slice 2d). Push local dirty rows, then pull to head, merging with the shared
 * resolvers (resolve.ts). The cursor advances only over the CONTIGUOUS prefix actually received (F1),
 * never to `head` past a hole. First login for an account = reconcile (snapshot-merge-push).
 *
 * The engine is transport-injected so the correctness core (cursor rule, merge, enqueue-on-divergence)
 * is unit-tested without a network. Nothing here runs unless the caller is authenticated.
 */
import { db, EPOCH_SENTINEL, INSTALL_ROW, type SrsCard } from '@/db/db';
import { reviveCard } from '@/features/progress/backup';
import type { SyncChange, SyncEntry, SyncPushResponse, SyncPullResponse } from '@/features/account/contract';
import { resolveByStore, type SyncedStore } from './resolve';

export interface SyncTransport {
  push(body: { cursorSeq: number; changes: SyncChange[]; idempotencyKey: string }): Promise<SyncPushResponse>;
  pull(since: number): Promise<SyncPullResponse>;
}

const APPEND_ONLY = new Set<SyncedStore>(['attempts', 'checkpoints']);

type Row = Record<string, unknown> & { updatedAt?: number; updatedBy?: string; deletedAt?: number; statusUpdatedAt?: number };
export type SyncedRow = Row;

/** Domain primary-key field per store (append-only stores are located by `syncId` instead). */
function pkField(store: SyncedStore): string {
  return store === 'wordStatus' ? 'word' : store === 'settings' ? 'key' : 'id';
}

async function getLocal(store: SyncedStore, id: string): Promise<Row | undefined> {
  if (APPEND_ONLY.has(store)) return (await db[store].where('syncId').equals(id).first()) as Row | undefined;
  return (await db.table(store).get(id)) as Row | undefined;
}

async function putLocal(store: SyncedStore, row: Row): Promise<void> {
  await db.table(store).put(row);
}

const pendingKey = (store: SyncedStore, syncOrPk: string): string => `${store}:${syncOrPk}`;

/** Enqueue a row for push, keyed on its sync identity (`syncId` for append-only, else the domain PK).
 *  Called by the write-through layer (local.ts) on every local mutation, and by the merge path when a
 *  resolution diverges from what the server holds. */
export async function markDirty(store: SyncedStore, row: Row): Promise<void> {
  const syncId = APPEND_ONLY.has(store) ? (row.syncId as string) : undefined;
  const id = String(row[pkField(store)] ?? '');
  await db.pending.put({ key: pendingKey(store, syncId ?? id), store, id, syncId });
}

/** Build the wire envelope for a local row. Append-only payloads drop the device-local numeric `id`. */
export function toEnvelope(store: SyncedStore, row: Row): SyncChange {
  const id = APPEND_ONLY.has(store) ? String(row.syncId) : String(row[pkField(store)]);
  const payload: Row = { ...row };
  if (APPEND_ONLY.has(store)) delete payload.id;
  const change: SyncChange = {
    store,
    id,
    updatedAt: row.updatedAt ?? EPOCH_SENTINEL,
    updatedBy: row.updatedBy ?? '',
    payload,
  };
  if (row.deletedAt != null) change.deletedAt = row.deletedAt;
  if (store === 'wordStatus' && row.statusUpdatedAt != null) change.statusUpdatedAt = row.statusUpdatedAt;
  return change;
}

/** Reconstruct a local domain row from a pulled entry (meta lifted from the envelope; Dates revived). */
function rowFromEntry(entry: SyncEntry): Row {
  const base: Row = { ...(entry.payload as object) };
  base.updatedAt = entry.updatedAt;
  base.updatedBy = entry.updatedBy;
  if (entry.deletedAt != null) base.deletedAt = entry.deletedAt;
  else delete base.deletedAt;
  if (entry.store === 'wordStatus' && entry.statusUpdatedAt != null) base.statusUpdatedAt = entry.statusUpdatedAt;
  if (entry.store === 'srsCards') return reviveCard(base as unknown as SrsCard) as unknown as Row;
  if (APPEND_ONLY.has(entry.store as SyncedStore)) {
    delete base.id;
    base.syncId = entry.id;
  }
  return base;
}

function sortDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, unknown>)[k])])
    );
  }
  return v;
}

/** Stable signature of a row's synced content — meta + domain payload with Dates normalized to numbers
 *  and the device-local numeric id dropped. Used to decide whether a merge diverged from the incoming. */
function sig(store: SyncedStore, row: Row): string {
  const meta = { u: row.updatedAt ?? 0, b: row.updatedBy ?? '', d: row.deletedAt ?? null, s: row.statusUpdatedAt ?? null };
  const p: Row = { ...row };
  delete p.updatedAt;
  delete p.updatedBy;
  delete p.deletedAt;
  delete p.statusUpdatedAt;
  if (APPEND_ONLY.has(store)) delete p.id;
  if (store === 'srsCards') {
    const c = p.card as { due?: unknown; last_review?: unknown } | undefined;
    p.due = +new Date(p.due as string);
    if (c) p.card = { ...c, due: +new Date(c.due as string), last_review: c.last_review ? +new Date(c.last_review as string) : null };
  }
  return JSON.stringify([meta, sortDeep(p)]);
}

/**
 * Merge a pulled entry into local. Append-only: insert if unseen, else keep (immutable union). Others:
 * resolve against the local row and write the winner. CRITICAL (advisor #1): if the merge produces a row
 * that differs from the incoming entry — i.e. this device holds state the server has not — enqueue it so
 * the next push carries it; otherwise the merge is stranded here forever.
 */
export async function applyEntry(entry: SyncEntry): Promise<void> {
  const store = entry.store as SyncedStore;
  const incoming = rowFromEntry(entry);

  if (APPEND_ONLY.has(store)) {
    const exists = await getLocal(store, entry.id);
    if (!exists) await db.table(store).add(incoming);
    return;
  }

  const local = await getLocal(store, entry.id);
  if (!local) {
    await putLocal(store, incoming);
    return;
  }
  const winner = resolveByStore(store, local as never, incoming as never) as unknown as Row;
  await putLocal(store, winner);
  if (sig(store, winner) !== sig(store, incoming)) await markDirty(store, winner);
}

interface Collected {
  changes: SyncChange[];
  marks: { key: string; store: SyncedStore; id: string; syncId?: string; updatedAt: number }[];
}

/** Max changes per push — must stay ≤ the contract's `SyncPushRequestSchema.max(500)`, so a first-login
 *  reconcile of a large history is chunked across several pushes rather than rejected as one 400. */
const PUSH_BATCH = 500;

/** Read up to one batch of the dirty set, re-read each row fresh, and build the push changes. */
export async function collectDirty(limit = PUSH_BATCH): Promise<Collected> {
  const pend = await db.pending.orderBy('key').limit(limit).toArray();
  const changes: SyncChange[] = [];
  const marks: Collected['marks'] = [];
  for (const p of pend) {
    const row = (await getLocal(p.store as SyncedStore, p.syncId ?? p.id)) as Row | undefined;
    if (!row) {
      await db.pending.delete(p.key); // row vanished (hard-deleted) — nothing to push
      continue;
    }
    const store = p.store as SyncedStore;
    changes.push(toEnvelope(store, row));
    marks.push({ key: p.key, store, id: p.id, syncId: p.syncId, updatedAt: row.updatedAt ?? EPOCH_SENTINEL });
  }
  return { changes, marks };
}

function idempotencyKey(cursorSeq: number, changes: SyncChange[]): string {
  const basis = JSON.stringify([cursorSeq, changes.map((c) => [c.store, c.id, c.updatedAt, c.updatedBy])]);
  let h = 0;
  for (let i = 0; i < basis.length; i += 1) h = (Math.imul(31, h) + basis.charCodeAt(i)) | 0;
  return `b${(h >>> 0).toString(36)}-${changes.length}`;
}

/** Push the dirty set. Clears a dirty mark only if its row is unchanged since collection (a concurrent
 *  edit re-dirties the key, which a later push carries). Applied authoritative rows are written back. */
export async function pushOnce(transport: SyncTransport, cursorSeq: number): Promise<void> {
  const { changes, marks } = await collectDirty();
  if (!changes.length) return;
  const res = await transport.push({ cursorSeq, changes, idempotencyKey: idempotencyKey(cursorSeq, changes) });
  for (const entry of res.applied) await applyEntry(entry);
  for (const m of marks) {
    const row = (await getLocal(m.store, m.syncId ?? m.id)) as Row | undefined;
    if (!row || (row.updatedAt ?? EPOCH_SENTINEL) === m.updatedAt) await db.pending.delete(m.key);
  }
}

async function setCursor(account: string, cursorSeq: number): Promise<void> {
  const row = await db.syncState.get(account);
  await db.syncState.put({ ...row, account, cursorSeq });
}

/** Pull from the cursor to head, applying only the contiguous prefix (F1) and advancing the cursor to
 *  the last contiguous seq. A snapshot response (since=0) is a baseline: apply all, cursor = head. */
export async function pullLoop(transport: SyncTransport, account: string, from: number): Promise<void> {
  let cursor = from;
  for (;;) {
    const res = await transport.pull(cursor);
    if (res.snapshot) {
      for (const e of [...res.entries].sort((a, b) => a.seq - b.seq)) await applyEntry(e);
      cursor = res.head;
      await setCursor(account, cursor);
      if (cursor >= res.head) return;
      continue;
    }
    const sorted = [...res.entries].sort((a, b) => a.seq - b.seq);
    let advanced = cursor;
    for (const e of sorted) {
      if (e.seq !== advanced + 1) break; // hole — stop; a later pull retries from here
      await applyEntry(e);
      advanced = e.seq;
    }
    const progressed = advanced > cursor;
    cursor = advanced;
    await setCursor(account, cursor);
    if (!progressed || cursor >= res.head) return;
  }
}

/** First contact for an account: snapshot-merge the server, enqueue every local row, push, then pull. */
export async function reconcile(transport: SyncTransport, account: string): Promise<void> {
  await pullLoop(transport, account, 0); // snapshot merge → cursor = head
  for (const store of ['srsCards', 'wordStatus', 'attempts', 'checkpoints', 'books', 'bookmarks', 'settings'] as SyncedStore[]) {
    const rows = (await db.table(store).toArray()) as Row[];
    for (const row of rows) await markDirty(store, row);
  }
  await drainPush(transport, account);
  await pullLoop(transport, account, (await db.syncState.get(account))?.cursorSeq ?? 0);
}

async function drainPush(transport: SyncTransport, account: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const before = await db.pending.count();
    if (!before) return;
    await pushOnce(transport, (await db.syncState.get(account))?.cursorSeq ?? 0);
    if ((await db.pending.count()) >= before) return; // no progress — avoid a spin
  }
}

const SYNCED_TABLES: SyncedStore[] = ['srsCards', 'wordStatus', 'attempts', 'checkpoints', 'books', 'bookmarks', 'settings'];

/** Wipe locally-synced data on logout / account switch so account A's rows never bleed into account B
 *  (H5). The install id is preserved; per-account cursors + the dirty queue are cleared, so the next
 *  login reconciles cleanly from the server. NOTE: unpushed changes made while offline are lost on an
 *  offline logout — a deliberate simplification for the skeleton. */
export async function wipeSyncedData(): Promise<void> {
  await Promise.all(SYNCED_TABLES.map((s) => db.table(s).clear()));
  await db.pending.clear();
  const rows = await db.syncState.toArray();
  await Promise.all(rows.filter((r) => r.account !== INSTALL_ROW).map((r) => db.syncState.delete(r.account)));
}

let inFlight: Promise<void> | null = null;

/** Run one full sync cycle for an account (single-flight). Reconciles on first contact, else push→pull. */
export function syncWith(account: string, transport: SyncTransport): Promise<void> {
  if (inFlight) return inFlight;
  const run = async () => {
    try {
      const state = await db.syncState.get(account);
      if (state?.cursorSeq == null) {
        await reconcile(transport, account);
      } else {
        await drainPush(transport, account);
        await pullLoop(transport, account, state.cursorSeq);
      }
    } finally {
      inFlight = null;
    }
  };
  inFlight = run();
  return inFlight;
}
