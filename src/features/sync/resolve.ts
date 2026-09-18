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

/** A row is effectively deleted when its tombstone is at least as recent as its last content edit (H1).
 *  Accepts partial meta (books carry optional sync fields until stamped) — a missing `updatedAt` counts
 *  as ancient, so any tombstone wins. */
export function isDeleted(row: { updatedAt?: number; deletedAt?: number }): boolean {
  return row.deletedAt != null && row.deletedAt >= (row.updatedAt ?? 0);
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
 * Precedence when two devices set a DIFFERENT status at the same millisecond. Deciding it by `updatedBy`
 * looked like a tiebreak and was not: the merged row carries the LWW winner's `updatedBy`, not the status
 * winner's, so the next merge compared against an install that had never set the status — and the answer
 * depended on the order the rows happened to meet.
 *
 * Ranking the VALUES makes it a max over a total order, which is associative and commutative and needs
 * no new field on the wire. The string fallback keeps it TOTAL rather than a preorder: a rank alone
 * would put every unrecognised value at the same level, and two of those would then break by argument
 * position — which is the same order-dependence, on exactly the out-of-contract rows the surrounding
 * fallbacks exist for.
 *
 * The order is "prefer what is recoverable": `unknown` is the absence of a choice, and `learning` beating
 * `ignored` leaves a word in the queue the user can ignore again, where the reverse would quietly drop
 * it from study.
 */
// A fifth value must be added to the server's copy in the same change: an old client ranks anything it
// does not recognise at -1, i.e. BELOW `unknown`, which is the opposite of the intent above.
const STATUS_RANK: Record<string, number> = { unknown: 0, ignored: 1, learning: 2, known: 3 };

function statusAtLeast(x: unknown, y: unknown): boolean {
  const rx = STATUS_RANK[String(x)] ?? -1;
  const ry = STATUS_RANK[String(y)] ?? -1;
  return rx !== ry ? rx > ry : String(x) >= String(y);
}

/**
 * wordStatus: a total, order-free merge over all four status values incl. `ignored` (F6). `status` wins
 * by `(statusUpdatedAt, STATUS_RANK)`; `encounters` = max; `firstSeenAt` = min (both semilattice joins).
 * wordStatus is never soft-deleted (there is no delete path for it), so no tombstone handling.
 *
 * Everything OTHER than `status` follows the ordinary LWW winner, and the row is carried by spread rather
 * than rebuilt from a field list. Both of those are load-bearing, and both were wrong here once:
 *  - a rebuild dropped any field it did not name, and `applyEntry`'s re-enqueue-on-divergence then pushed
 *    the stripped row back, destroying that field for every device — so an older client turned a routine
 *    field-adding migration into silent data loss;
 *  - resolving non-status content by `statusUpdatedAt` reverts edits, because that clock is deliberately
 *    frozen while the status value is unchanged (local.ts `putWordStatus`). One device editing such a
 *    field twice loses the second edit and diverges from the server permanently.
 * Mirrors server/src/sync.ts `resolveWordStatus` exactly; resolver-parity.test.ts fails if it stops.
 */
export function resolveWordStatus(a: Synced<WordStatus>, b: Synced<WordStatus>): SyncedWordStatus {
  const sa = a.statusUpdatedAt ?? a.updatedAt;
  const sb = b.statusUpdatedAt ?? b.updatedAt;
  const statusWinner = sa !== sb ? (sa > sb ? a : b) : statusAtLeast(a.status, b.status) ? a : b;
  const meta = pickLww(a, b);
  // Defensive against rows that predate these fields or arrive hand-edited: the types promise numbers,
  // the wire does not. The server already made this allowance and the client did not, so a row missing
  // `encounters` resolved to NaN here and to a number there, and the two sides then disagreed forever,
  // each re-pushing its own answer.
  // A row with no `firstSeenAt` is treated as first seen when it was last updated — the same assumption
  // the v8 backfill makes. Resolving the absence AFTER the min instead (a fallback on the result) is
  // what broke associativity: it materialised the LWW winner's `updatedAt`, which then entered the next
  // merge as a real operand, so three such rows settled differently depending on the order they met.
  const firstSeen = Math.min(a.firstSeenAt ?? a.updatedAt, b.firstSeenAt ?? b.updatedAt);
  return {
    ...meta,
    status: statusWinner.status,
    statusUpdatedAt: Math.max(sa, sb),
    encounters: Math.max(a.encounters ?? 0, b.encounters ?? 0),
    firstSeenAt: firstSeen,
    updatedAt: meta.updatedAt,
    updatedBy: meta.updatedBy,
    deletedAt: undefined,
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
