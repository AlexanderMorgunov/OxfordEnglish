/**
 * Conflict resolution for cross-device sync (design doc §"Data model", slice 2b). Every rule here is a
 * PURE function and MUST be convergent: order-free (commutative) OR deterministically tie-broken, so any
 * two devices that have seen the same set of writes converge to the same row. This is the correctness
 * core of sync — the server and client both reason in these terms. See resolve.test.ts (property tests).
 *
 * Synced rows carry sync metadata: `updatedAt` (content-change time, NOT processing time), `updatedBy`
 * (a stable install id — the LWW tiebreaker; the account deviceId is NOT stable across device-linking,
 * so sync uses its own install id), and optional soft-delete `deletedAt`.
 */
import type { SrsCard, WordStatus } from '@/db/db';

export interface SyncMeta {
  updatedAt: number;
  updatedBy: string;
  /** Soft-delete tombstone time. A delete does NOT bump `updatedAt` (else no later edit could win the
   *  row back); the row counts as deleted iff `deletedAt >= updatedAt` (H1). */
  deletedAt?: number;
}

export type Synced<T> = T & SyncMeta;

/** A row is effectively deleted when its tombstone is at least as recent as its last content edit (H1). */
export function isDeleted(row: SyncMeta): boolean {
  return row.deletedAt != null && row.deletedAt >= row.updatedAt;
}

/** Last-writer-wins order: later `updatedAt`, ties broken by the larger `updatedBy` (a total, stable
 *  order). Equal `(updatedAt, updatedBy)` means the same install wrote at the same instant → identical. */
function lwwWins(a: SyncMeta, b: SyncMeta): boolean {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt;
  return a.updatedBy >= b.updatedBy;
}

const pickLww = <T extends SyncMeta>(a: T, b: T): T => (lwwWins(a, b) ? a : b);

/** Combined tombstone = the latest delete either side saw (a semilattice max; `undefined` = never). */
function combineDeletedAt(a: SyncMeta, b: SyncMeta): number | undefined {
  const ds = [a.deletedAt, b.deletedAt].filter((d): d is number => d != null);
  return ds.length ? Math.max(...ds) : undefined;
}

function withDeleted<T extends SyncMeta>(row: T, deletedAt: number | undefined): T {
  return deletedAt == null ? { ...row, deletedAt: undefined } : { ...row, deletedAt };
}

/** Generic LWW row merge (books, bookmarks, settings). Content = the LWW winner; tombstone combined. */
export function resolveLww<T extends SyncMeta>(a: T, b: T): T {
  return withDeleted(pickLww(a, b), combineDeletedAt(a, b));
}

/**
 * srsCards: the FSRS `card` sub-object is ONE atomic schedule unit — never cherry-pick its nested fields
 * (that would desync `state`/`learning_steps` — F5). Pick the whole `card` by higher `reps`, then later
 * `last_review`, then LWW; `due` mirrors the winning card. Content (`front`/`back`/`contextGloss`/`tags`/…)
 * is resolved independently by LWW. So the merged card can take its schedule from one device and its
 * content from the other.
 */
export function resolveSrsCard(a: Synced<SrsCard>, b: Synced<SrsCard>): Synced<SrsCard> {
  const content = pickLww(a, b);
  const sched = pickCardSchedule(a, b);
  return withDeleted(
    { ...content, card: sched.card, due: sched.card.due },
    combineDeletedAt(a, b)
  );
}

function pickCardSchedule(a: Synced<SrsCard>, b: Synced<SrsCard>): Synced<SrsCard> {
  if (a.card.reps !== b.card.reps) return a.card.reps > b.card.reps ? a : b;
  const la = a.card.last_review?.getTime() ?? -Infinity;
  const lb = b.card.last_review?.getTime() ?? -Infinity;
  if (la !== lb) return la > lb ? a : b;
  return pickLww(a, b);
}

export type SyncedWordStatus = Synced<WordStatus> & { statusUpdatedAt: number };

/**
 * wordStatus: a total, order-free merge over all four status values incl. `ignored` (F6). `status` is LWW
 * by `(statusUpdatedAt, updatedBy)`; `encounters` = max; `firstSeenAt` = min (both semilattice joins).
 * wordStatus is never soft-deleted (there is no delete path for it), so no tombstone handling.
 */
export function resolveWordStatus(a: SyncedWordStatus, b: SyncedWordStatus): SyncedWordStatus {
  const statusWinner =
    a.statusUpdatedAt !== b.statusUpdatedAt
      ? a.statusUpdatedAt > b.statusUpdatedAt
        ? a
        : b
      : a.updatedBy >= b.updatedBy
        ? a
        : b;
  const meta = pickLww(a, b);
  return {
    word: a.word,
    status: statusWinner.status,
    statusUpdatedAt: Math.max(a.statusUpdatedAt, b.statusUpdatedAt),
    encounters: Math.max(a.encounters, b.encounters),
    firstSeenAt: Math.min(a.firstSeenAt, b.firstSeenAt),
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
  };
}

/**
 * attempts / checkpoints: append-only, immutable rows keyed by a globally-unique id (`updatedBy:localId`).
 * The same id always denotes the same immutable event, so a merge is a union by id — pairwise resolution
 * is only ever invoked with identical rows. We keep either deterministically.
 */
export function resolveImmutable<T extends SyncMeta>(a: T, _b: T): T {
  return a;
}

export const SYNCED_STORES = [
  'srsCards',
  'wordStatus',
  'attempts',
  'checkpoints',
  'books',
  'bookmarks',
  'settings',
] as const;
export type SyncedStore = (typeof SYNCED_STORES)[number];

/** Dispatch to the right resolver by store name (the sync engine works over erased row types). */
export function resolveByStore(store: SyncedStore, a: SyncMeta, b: SyncMeta): SyncMeta {
  switch (store) {
    case 'srsCards':
      return resolveSrsCard(a as Synced<SrsCard>, b as Synced<SrsCard>);
    case 'wordStatus':
      return resolveWordStatus(a as SyncedWordStatus, b as SyncedWordStatus);
    case 'attempts':
    case 'checkpoints':
      return resolveImmutable(a, b);
    case 'books':
    case 'bookmarks':
    case 'settings':
      return resolveLww(a, b);
  }
}
