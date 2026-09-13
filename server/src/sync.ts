/**
 * Server-side sync engine (slice 2c). Per-user append-only change-log + current-state tables. The server
 * is the source of truth: on push it applies per-store conflict resolution to current-state and appends
 * the resolved rows to the log with monotonic `seq`; on pull it returns log entries after a cursor.
 *
 * The resolvers here MIRROR the client's src/features/sync/resolve.ts (same convergence rules — F5/F6/H1)
 * but operate on the wire envelope (payload is opaque JSON with a known shape per store). Keep the two in
 * sync on any rule change; the eventual shared package removes the duplication. See ../../docs.
 */
import { createHash } from 'node:crypto';

export type SyncStoreName =
  | 'srsCards'
  | 'wordStatus'
  | 'attempts'
  | 'checkpoints'
  | 'books'
  | 'bookmarks'
  | 'settings';

/** One record change on the wire (the changelog row minus server-assigned `seq`/`userId`). */
export interface Change {
  store: SyncStoreName;
  id: string;
  updatedAt: number;
  updatedBy: string;
  deletedAt?: number;
  /** wordStatus only: separate clock for the `status` field (F6). */
  statusUpdatedAt?: number;
  /** The full domain row (unknown fields preserved). */
  payload: unknown;
}

export interface Entry extends Change {
  seq: number;
}

const lwwWins = (a: Change, b: Change): boolean =>
  a.updatedAt !== b.updatedAt ? a.updatedAt > b.updatedAt : a.updatedBy >= b.updatedBy;

const combineDeletedAt = (a: Change, b: Change): number | undefined => {
  const ds = [a.deletedAt, b.deletedAt].filter((d): d is number => d != null);
  return ds.length ? Math.max(...ds) : undefined;
};

function withDeleted(row: Change, deletedAt: number | undefined): Change {
  const { deletedAt: _drop, ...rest } = row;
  return deletedAt == null ? rest : { ...rest, deletedAt };
}

function schedRank(e: Change): [number, number] {
  const card = (e.payload as { card?: { reps?: number; last_review?: string | number | Date | null } } | null)?.card;
  const reps = card?.reps ?? -1;
  const lr = card?.last_review ? new Date(card.last_review).getTime() : -Infinity;
  return [reps, lr];
}

/** srsCards: atomic FSRS `card` (by reps → last_review → LWW) + independent content LWW (F5). */
function resolveSrsCard(a: Change, b: Change): Change {
  const content = lwwWins(a, b) ? a : b;
  const [ra, la] = schedRank(a);
  const [rb, lb] = schedRank(b);
  const sched = ra !== rb ? (ra > rb ? a : b) : la !== lb ? (la > lb ? a : b) : lwwWins(a, b) ? a : b;
  const schedCard = (sched.payload as { card?: unknown; due?: unknown }) ?? {};
  const payload = { ...(content.payload as object), card: schedCard.card, due: (schedCard as { card?: { due?: unknown } }).card?.due };
  return withDeleted({ ...content, payload }, combineDeletedAt(a, b));
}

/** wordStatus: status LWW by (statusUpdatedAt, updatedBy); encounters=max, firstSeenAt=min (F6). */
function resolveWordStatus(a: Change, b: Change): Change {
  const sa = a.statusUpdatedAt ?? a.updatedAt;
  const sb = b.statusUpdatedAt ?? b.updatedAt;
  const statusWinner = sa !== sb ? (sa > sb ? a : b) : a.updatedBy >= b.updatedBy ? a : b;
  const pa = (a.payload ?? {}) as { encounters?: number; firstSeenAt?: number };
  const pb = (b.payload ?? {}) as { encounters?: number; firstSeenAt?: number };
  const meta = lwwWins(a, b) ? a : b;
  const payload = {
    ...(statusWinner.payload as object),
    encounters: Math.max(pa.encounters ?? 0, pb.encounters ?? 0),
    firstSeenAt: Math.min(pa.firstSeenAt ?? Infinity, pb.firstSeenAt ?? Infinity),
  };
  return { store: 'wordStatus', id: a.id, updatedAt: meta.updatedAt, updatedBy: meta.updatedBy, statusUpdatedAt: Math.max(sa, sb), payload };
}

function resolveLww(a: Change, b: Change): Change {
  return withDeleted(lwwWins(a, b) ? a : b, combineDeletedAt(a, b));
}

/** Merge an incoming change against the stored current-state row. Append-only stores keep the first
 *  (immutable, idempotent by id); the rest apply their convergent rule. */
export function resolveServer(stored: Change | undefined, incoming: Change): Change {
  if (!stored) return incoming;
  switch (incoming.store) {
    case 'attempts':
    case 'checkpoints':
      return stored; // immutable union by id
    case 'srsCards':
      return resolveSrsCard(stored, incoming);
    case 'wordStatus':
      return resolveWordStatus(stored, incoming);
    default:
      return resolveLww(stored, incoming);
  }
}

/** Deep-ish equality just precise enough to decide "did resolution change the stored row?" */
export function sameChange(a: Change, b: Change): boolean {
  return (
    a.updatedAt === b.updatedAt &&
    a.updatedBy === b.updatedBy &&
    a.deletedAt === b.deletedAt &&
    a.statusUpdatedAt === b.statusUpdatedAt &&
    JSON.stringify(a.payload) === JSON.stringify(b.payload)
  );
}

export interface PushResult {
  head: number;
  applied: Entry[];
}
export interface PullResult {
  head: number;
  entries: Entry[];
  snapshot?: boolean;
}

export interface SyncStore {
  /** Apply a batch (idempotent by key). Returns the authoritative rows that actually changed + head seq. */
  push(userId: string, cursorSeq: number, changes: Change[], idempotencyKey: string): Promise<PushResult>;
  /** Return log entries with `seq > since`, capped; `since === 0` returns the current-state snapshot. */
  pull(userId: string, since: number, limit?: number): Promise<PullResult>;
  /** Delete-account: drop all of a user's changelog, current-state, seq counter, and idempotency records. */
  purge(userId: string): Promise<void>;
}

const MAX_PULL = 500;

export class InMemorySyncStore implements SyncStore {
  private log = new Map<string, Entry[]>(); // userId -> append-only entries (seq-ordered)
  private state = new Map<string, Map<string, Entry>>(); // userId -> `${store}:${id}` -> current row
  private seqs = new Map<string, number>(); // userId -> last allocated seq
  private idem = new Map<string, PushResult>(); // `${userId}:${key}` -> memoized result

  private nextSeq(userId: string): number {
    const n = (this.seqs.get(userId) ?? 0) + 1;
    this.seqs.set(userId, n);
    return n;
  }

  async push(userId: string, _cursorSeq: number, changes: Change[], idempotencyKey: string): Promise<PushResult> {
    const memoKey = `${userId}:${idempotencyKey}`;
    const memo = this.idem.get(memoKey);
    if (memo) return memo;

    const log = this.log.get(userId) ?? [];
    const state = this.state.get(userId) ?? new Map<string, Entry>();
    const applied: Entry[] = [];

    for (const incoming of changes) {
      const key = `${incoming.store}:${incoming.id}`;
      const stored = state.get(key);
      const resolved = resolveServer(stored, incoming);
      // No-op if resolution left the stored row unchanged (idempotent re-push, or a losing write).
      if (stored && sameChange(stored, resolved)) continue;
      const entry: Entry = { ...resolved, store: incoming.store, id: incoming.id, seq: this.nextSeq(userId) };
      state.set(key, entry);
      log.push(entry);
      applied.push(entry);
    }

    this.log.set(userId, log);
    this.state.set(userId, state);
    const result: PushResult = { head: this.seqs.get(userId) ?? 0, applied };
    this.idem.set(memoKey, result);
    return result;
  }

  async pull(userId: string, since: number, limit = MAX_PULL): Promise<PullResult> {
    const head = this.seqs.get(userId) ?? 0;
    if (since <= 0) {
      // Bootstrap baseline: the current-state rows (each carries the seq it was last written at), seq-ordered.
      const rows = [...(this.state.get(userId)?.values() ?? [])].sort((a, b) => a.seq - b.seq);
      return { head, entries: rows.slice(0, limit), snapshot: true };
    }
    const log = this.log.get(userId) ?? [];
    const entries = log.filter((e) => e.seq > since).slice(0, limit);
    return { head, entries };
  }

  async purge(userId: string): Promise<void> {
    this.log.delete(userId);
    this.state.delete(userId);
    this.seqs.delete(userId);
    for (const k of this.idem.keys()) if (k.startsWith(`${userId}:`)) this.idem.delete(k);
  }
}

/** Stable idempotency key for a batch (client may also supply its own; this is the fallback). */
export function batchKey(changes: Change[]): string {
  return createHash('sha256').update(JSON.stringify(changes)).digest('base64url').slice(0, 32);
}
