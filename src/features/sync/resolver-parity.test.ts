/**
 * Client↔server resolver parity. `src/features/sync/resolve.ts` and `server/src/sync.ts` are two
 * implementations of ONE set of convergence rules on two shapes (Dexie row vs wire envelope), and the
 * server's own header says "keep the two in sync on any rule change" — with nothing enforcing it. This is
 * the enforcement.
 *
 * The cross-boundary import is deliberate: the test exists to span the boundary. `server/src/sync.ts`
 * imports only `node:crypto`, so it costs nothing to pull in here.
 *
 * Both directions go through the engine's REAL adapters (`toEnvelope` / `rowFromEntry`) and a real JSON
 * round-trip, because that is what production does. A hand-written adapter would be free to normalise
 * away the difference being measured, which is the usual way a test like this goes quietly vacuous.
 */
import { test, expect } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import type { SrsCard, WordStatus } from '@/db/db';
import { SyncStoreSchema } from '@/features/account/contract';
import type { SyncEntry } from '@/features/account/contract';
import { SyncStoreSchema as ServerSyncStoreSchema } from '../../../server/src/contract';
import { resolveServer, type Change, type SyncStoreName } from '../../../server/src/sync';
import { resolveByStore, SYNCED_STORES, type Synced, type SyncedStore, type SyncMeta } from './resolve';
import { toEnvelope, rowFromEntry, type SyncedRow } from './engine';

const wire = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Run one pair through the server implementation, entering and leaving by the paths production uses. */
function throughServer(store: SyncedStore, a: SyncedRow, b: SyncedRow): SyncedRow {
  const envelope = (row: SyncedRow): Change => wire(toEnvelope(store, row)) as Change;
  const resolved = resolveServer(envelope(a), envelope(b));
  return rowFromEntry(wire({ ...resolved, store, seq: 1 }) as SyncEntry);
}

/**
 * Assert the two implementations agree, in both argument orders. Order matters: `a` is the stored/local
 * row on both sides, so a rule that reads `a` (resolveImmutable, `word: a.word`) must be fed the same way.
 */
function parity(store: SyncedStore, a: SyncedRow, b: SyncedRow): SyncedRow {
  const client = resolveByStore(store, a as SyncMeta, b as SyncMeta) as unknown as SyncedRow;
  expect(throughServer(store, a, b)).toEqual(client);
  expect(throughServer(store, b, a)).toEqual(resolveByStore(store, b as SyncMeta, a as SyncMeta));
  return client;
}

const card = (over: Partial<{ reps: number; last_review: Date; due: Date }> = {}) => {
  const c = createEmptyCard(new Date(0));
  c.reps = over.reps ?? 0;
  if (over.last_review) c.last_review = over.last_review;
  c.due = over.due ?? c.due;
  return c;
};

const srs = (o: Partial<Synced<SrsCard>> & Pick<Synced<SrsCard>, 'updatedAt' | 'updatedBy'>): SyncedRow => {
  const cd = o.card ?? card();
  return { id: 'word:apple', kind: 'word', front: 'apple', back: 'яблоко', tags: [], ...o, card: cd, due: cd.due } as unknown as SyncedRow;
};

type WsExtra = Synced<WordStatus> & Record<string, unknown>;
const ws = (o: Partial<WsExtra> & Pick<WsExtra, 'updatedAt' | 'updatedBy'>): SyncedRow =>
  ({ word: 'apple', status: 'learning', statusUpdatedAt: o.updatedAt, encounters: 1, firstSeenAt: 0, ...o }) as SyncedRow;

const bk = (title: string, updatedAt: number, updatedBy: string, deletedAt?: number): SyncedRow =>
  ({ id: 'b1', title, lastChapter: 0, updatedAt, updatedBy, ...(deletedAt != null ? { deletedAt } : {}) }) as SyncedRow;

// --- Generic LWW: books / bookmarks / settings ---

test('LWW: the later write wins identically on both sides', () => {
  const winner = parity('books', bk('old', 10, 'devA'), bk('new', 20, 'devB'));
  expect(winner.title).toBe('new');
});

test('LWW: an updatedAt tie breaks on updatedBy identically on both sides', () => {
  const winner = parity('settings', { key: 'uiLang', value: 'ru', updatedAt: 10, updatedBy: 'devA' }, { key: 'uiLang', value: 'en', updatedAt: 10, updatedBy: 'devB' });
  expect(winner.value).toBe('en');
});

test('LWW: the tombstone is the max of both sides, and survives a later content edit', () => {
  const winner = parity('books', bk('kept', 30, 'devA'), bk('old', 10, 'devB', 20));
  expect(winner.deletedAt).toBe(20);
  expect(winner.title).toBe('kept');
});

test('LWW: two tombstones combine to the later one', () => {
  expect(parity('bookmarks', bk('x', 10, 'devA', 40), bk('x', 10, 'devB', 30)).deletedAt).toBe(40);
});

// --- srsCards: atomic schedule, independent content ---

test('srsCards: schedule from one device, content from the other, identically on both sides', () => {
  const a = srs({ updatedAt: 50, updatedBy: 'devA', front: 'apple/edited', card: card({ reps: 1 }) });
  const b = srs({ updatedAt: 10, updatedBy: 'devB', card: card({ reps: 7 }) });
  const winner = parity('srsCards', a, b);
  expect(winner.front).toBe('apple/edited');
  expect((winner.card as { reps: number }).reps).toBe(7);
});

test('srsCards: a reps tie falls through to last_review identically on both sides', () => {
  const a = srs({ updatedAt: 50, updatedBy: 'devA', card: card({ reps: 3, last_review: new Date(1000) }) });
  const b = srs({ updatedAt: 10, updatedBy: 'devB', card: card({ reps: 3, last_review: new Date(9000) }) });
  const sched = parity('srsCards', a, b).card as { last_review: Date };
  expect(sched.last_review.getTime()).toBe(9000);
});

// --- Append-only stores ---

test('attempts: an immutable row is kept identically on both sides', () => {
  // No numeric `id` in the fixture: toEnvelope drops it for append-only stores and rowFromEntry never
  // puts it back, while the client resolver returns the local row untouched. Including it would fail for
  // a reason that has nothing to do with the rules under test.
  const row = { syncId: 'devA:7', dayId: 'u01.d01', correct: true, updatedAt: 10, updatedBy: 'devA' } as unknown as SyncedRow;
  expect(parity('attempts', row, { ...row, correct: false, updatedAt: 99 } as SyncedRow).correct).toBe(true);
});

// --- wordStatus: the store where the two had actually drifted ---

test('wordStatus: the status clock decides status, the LWW clock decides the meta', () => {
  const a = ws({ updatedAt: 99, updatedBy: 'devA', status: 'learning', statusUpdatedAt: 10 });
  const b = ws({ updatedAt: 20, updatedBy: 'devB', status: 'known', statusUpdatedAt: 50 });
  const winner = parity('wordStatus', a, b);
  expect(winner.status).toBe('known');
  expect(winner.updatedAt).toBe(99);
  expect(winner.statusUpdatedAt).toBe(50);
});

test('wordStatus: encounters joins upward and firstSeenAt downward on both sides', () => {
  const winner = parity(
    'wordStatus',
    ws({ updatedAt: 10, updatedBy: 'devA', encounters: 9, firstSeenAt: 500 }),
    ws({ updatedAt: 20, updatedBy: 'devB', encounters: 3, firstSeenAt: 100 })
  );
  expect(winner.encounters).toBe(9);
  expect(winner.firstSeenAt).toBe(100);
});

test('wordStatus: a field neither resolver knows about survives on both sides', () => {
  // THE case this file was written for. The client used to rebuild the row from an explicit field list,
  // so an older client dropped any field a newer one had added — and applyEntry's
  // re-enqueue-on-divergence then pushed the stripped row back, destroying the field for every device.
  const a = ws({ updatedAt: 10, updatedBy: 'devA', statusUpdatedAt: 10, notes: 'from A' });
  const b = ws({ updatedAt: 20, updatedBy: 'devB', statusUpdatedAt: 20, notes: 'from B' });
  expect(parity('wordStatus', a, b).notes).toBe('from B');
});

test('wordStatus: a non-status edit is not reverted by the frozen status clock', () => {
  // putWordStatus freezes statusUpdatedAt while the status VALUE is unchanged, so one device editing some
  // other field twice produces exactly this pair. Resolving non-status content by that clock kept the
  // stale copy and reported the edit as applied — a permanent client/server divergence, on one device.
  const v1 = ws({ updatedAt: 100, updatedBy: 'devA', statusUpdatedAt: 100, notes: 'x' });
  const v2 = ws({ updatedAt: 200, updatedBy: 'devA', statusUpdatedAt: 100, notes: 'y' });
  expect(parity('wordStatus', v1, v2).notes).toBe('y');
});

test('wordStatus: a row without statusUpdatedAt falls back to updatedAt, not to NaN', () => {
  // Unreachable through the app's own writers (putWordStatus always sets it, stampImported and the v8
  // upgrade backfill), but the client used to compute Math.max(undefined, n) = NaN — and statusUpdatedAt
  // is an INDEXED field, so IndexedDB would have silently dropped the row from that index.
  const a = ws({ updatedAt: 10, updatedBy: 'devA', statusUpdatedAt: undefined, status: 'unknown' });
  const b = ws({ updatedAt: 40, updatedBy: 'devB', statusUpdatedAt: undefined, status: 'ignored' });
  const winner = parity('wordStatus', a, b);
  expect(winner.statusUpdatedAt).toBe(40);
  expect(winner.status).toBe('ignored');
});

test('wordStatus: a stray tombstone is dropped on both sides', () => {
  // wordStatus has no delete path, so both sides deliberately drop deletedAt. Spreading the winner (the
  // fix for the unknown-field case) would have started carrying it along on the client only.
  // The tombstone has to sit on the LWW WINNER, or the spread never reaches it and the assertion is
  // satisfied by a resolver that does nothing — which is exactly how this case passed at first.
  const winner = parity('wordStatus', ws({ updatedAt: 20, updatedBy: 'devA', deletedAt: 999 }), ws({ updatedAt: 10, updatedBy: 'devB' }));
  expect(winner.deletedAt).toBeUndefined();
});

test('wordStatus: `word` comes from the same side on both implementations', () => {
  // The client used to pin `word` to the stored row while the server took it from the winner's payload.
  // Unreachable through applyEntry (it fetches `local` BY the incoming id, so the two always match), but
  // it made the "mirrors the server exactly" claim false, which is the claim this file exists to hold.
  const winner = parity('wordStatus', ws({ updatedAt: 10, updatedBy: 'devA', word: 'APPLE' }), ws({ updatedAt: 20, updatedBy: 'devB', word: 'apple' }));
  expect(winner.word).toBe('apple');
});

test('wordStatus: the server hands back an envelope whose meta agrees with its own payload', () => {
  // rowFromEntry overwrites updatedAt/updatedBy/statusUpdatedAt from the envelope, so the payload copies
  // are invisible to every client — which is exactly why nothing would notice the two drifting apart
  // again. They HAD drifted: the payload carried the status winner's meta while the envelope carried the
  // LWW winner's. Built by hand rather than via toEnvelope, because toEnvelope can only ever produce a
  // self-consistent pair and the server takes whatever a client sends.
  const change = (updatedAt: number, updatedBy: string, statusUpdatedAt: number, status: string, stale: number): Change => ({
    store: 'wordStatus',
    id: 'apple',
    updatedAt,
    updatedBy,
    statusUpdatedAt,
    payload: { word: 'apple', status, encounters: 1, firstSeenAt: 0, updatedAt: stale, updatedBy: 'stale', statusUpdatedAt: stale },
  });
  const resolved = resolveServer(change(99, 'devA', 10, 'learning', 1), change(20, 'devB', 50, 'known', 2));
  const p = resolved.payload as Record<string, unknown>;
  expect(resolved.statusUpdatedAt).toBe(50);
  expect([p.updatedAt, p.updatedBy, p.statusUpdatedAt]).toEqual([resolved.updatedAt, resolved.updatedBy, resolved.statusUpdatedAt]);
  expect(p.status).toBe('known');
});

// --- The store lists ---

test('every store list agrees, and no store resolves to undefined', () => {
  // resolveServer LWWs an unrecognised store through its `default:`; resolveByStore is exhaustive with no
  // default and returns undefined for one — which applyEntry then writes into Dexie.
  // The annotations are the type-level half: each list has to be assignable to the OTHER side's
  // union, so a store added to one union alone fails the build before it can fail a run.
  const clientAsServer: SyncStoreName[] = [...SYNCED_STORES];
  const serverAsClient: SyncedStore[] = [...ServerSyncStoreSchema.options];
  expect(clientAsServer).toEqual(SyncStoreSchema.options);
  expect(serverAsClient).toEqual(SyncStoreSchema.options);
  for (const store of SYNCED_STORES) {
    const cd = card();
    const row = { id: 'x', key: 'x', word: 'x', syncId: 'devA:1', card: cd, due: cd.due, updatedAt: 1, updatedBy: 'devA' } as unknown as SyncMeta;
    expect(resolveByStore(store, row, row)).toBeDefined();
  }
});

/**
 * Rows that do not satisfy the type. `encounters` and `firstSeenAt` were added after the store existed
 * and travel as plain JSON, so "always a number" is a promise the wire cannot keep. The server allowed
 * for that and the client did not: a row missing `encounters` resolved to NaN on one side and to a
 * number on the other — and because `applyEntry` re-enqueues on a signature mismatch, the two would
 * then push their own answer at each other indefinitely.
 */
const bare = (updatedBy: string, updatedAt: number, over: Record<string, unknown> = {}): SyncedRow =>
  ({ word: 'apple', status: 'known', updatedAt, updatedBy, statusUpdatedAt: updatedAt, ...over }) as SyncedRow;

test('both sides agree on a wordStatus row that is missing its counters', () => {
  const merged = parity('wordStatus', bare('i1', 100), bare('i2', 200, { encounters: 3, firstSeenAt: 50 }));

  expect(merged.encounters).toBe(3);
  expect(merged.firstSeenAt).toBe(50);
});

test('with no firstSeenAt anywhere, neither side invents Infinity', () => {
  const merged = parity('wordStatus', bare('i1', 100), bare('i2', 200));

  // `Infinity` does not survive JSON: it would reach the other device as `null` and come back as
  // missing, so the row would never settle.
  expect(Number.isFinite(merged.firstSeenAt)).toBe(true);
  // Each row stands in for itself with its own `updatedAt` BEFORE the min — the same assumption the v8
  // backfill makes. Resolving the absence AFTERWARDS instead took the LWW winner's timestamp, which
  // varies with merge order, so rows like these never converged.
  expect(merged.firstSeenAt).toBe(100);
  expect(merged.encounters).toBe(0);
});

test('a row with no firstSeenAt converges whatever order the merges happen in', () => {
  const m = (x: SyncedRow, y: SyncedRow) =>
    resolveByStore('wordStatus', x as SyncMeta, y as SyncMeta) as unknown as SyncedRow;
  const a = bare('i1', 30);
  const b = bare('i2', 10);
  const c = bare('i3', 20);

  const seen = [m(m(a, b), c), m(a, m(b, c)), m(m(b, c), a), m(m(c, a), b)].map((r) => r.firstSeenAt);

  expect(new Set(seen).size).toBe(1);
  expect(seen[0]).toBe(10);
});

test('two statuses outside the rank table break the tie the same way in both orders', () => {
  const odd = (updatedBy: string, status: string): SyncedRow =>
    ({ word: 'apple', status, updatedAt: 10, updatedBy, statusUpdatedAt: 5, encounters: 1, firstSeenAt: 1 }) as SyncedRow;
  const m = (x: SyncedRow, y: SyncedRow) =>
    resolveByStore('wordStatus', x as SyncMeta, y as SyncMeta) as unknown as SyncedRow;

  // A rank alone put every unrecognised value at the same level, so two of those broke by argument
  // position — order-dependence again, on exactly the rows the surrounding fallbacks exist for.
  expect(m(odd('i1', 'bogus'), odd('i2', 'weird')).status).toBe(m(odd('i2', 'weird'), odd('i1', 'bogus')).status);
  expect(parity('wordStatus', odd('i1', 'bogus'), odd('i2', 'weird')).status).toBe('weird');
});

/**
 * Three versions of one row, all claiming the same `statusUpdatedAt`. Breaking that tie by `updatedBy`
 * looked like a tiebreak and was not: the merged row carries the LWW winner's `updatedBy`, not the
 * status winner's, so the next merge compared against an install that had never set the status. Devices
 * that met the same three rows in a different order settled on different answers and stayed there.
 */
test('a three-way status tie settles the same way in every merge order', () => {
  const at = (updatedBy: string, updatedAt: number, status: string): SyncedRow =>
    ({ word: 'apple', status, updatedAt, updatedBy, statusUpdatedAt: 5, encounters: 1, firstSeenAt: 1 }) as SyncedRow;

  const a = at('i1', 10, 'known');
  const b = at('i3', 1, 'learning');
  const c = at('i2', 2, 'ignored');

  const merge = (x: SyncedRow, y: SyncedRow) => resolveByStore('wordStatus', x as SyncMeta, y as SyncMeta) as unknown as SyncedRow;
  const orders = [
    merge(merge(a, b), c),
    merge(merge(b, c), a),
    merge(merge(c, a), b),
    merge(a, merge(b, c)),
  ];

  expect(new Set(orders.map((r) => r.status)).size).toBe(1);
  expect(orders[0]!.status).toBe('known');
});

test('the tie precedence keeps a word in the queue rather than silently dropping it', () => {
  const at = (updatedBy: string, status: string): SyncedRow =>
    ({ word: 'apple', status, updatedAt: 10, updatedBy, statusUpdatedAt: 5, encounters: 1, firstSeenAt: 1 }) as SyncedRow;

  // Losing an "ignore" is recoverable in one tap; losing a "learning" removes the word from study with
  // nothing to notice.
  expect(parity('wordStatus', at('i1', 'ignored'), at('i2', 'learning')).status).toBe('learning');
  expect(parity('wordStatus', at('i9', 'unknown'), at('i1', 'ignored')).status).toBe('ignored');
});
