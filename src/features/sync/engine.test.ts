import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db, INSTALL_ROW } from '@/db/db';
import { SyncPushRequestSchema } from '@/features/account/contract';
import type { SyncChange, SyncEntry, SyncPullResponse, SyncPushResponse } from '@/features/account/contract';
import { applyEntry, idempotencyKey, pullLoop, syncWith, wipeSyncedData, type SyncTransport } from './engine';
import { SYNCED_STORES, type SyncedStore } from './resolve';
import { InMemorySyncStore, type Change } from '../../../server/src/sync';

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  // All seven synced stores: `reconcile` sweeps every one of them, so a fixture left in any of them
  // silently changes another test's expected push count.
  await Promise.all([
    ...SYNCED_STORES.map((s) => db.table(s).clear()),
    db.pending.clear(),
    db.syncState.clear(),
  ]);
});

const bookEntry = (id: string, seq: number, title: string, updatedAt: number, updatedBy = 'other'): SyncEntry => ({
  store: 'books',
  id,
  updatedAt,
  updatedBy,
  seq,
  payload: { id, title, format: 'epub', addedAt: updatedAt, chapterCount: 1, lastChapter: 0, updatedAt, updatedBy },
});

// F1: the cursor must stop at the last CONTIGUOUS seq, never jump a hole to `head`.
test('pullLoop advances only over the contiguous prefix and stops at a hole (F1)', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });
  const log = [bookEntry('b6', 6, 'six', 60), bookEntry('b7', 7, 'seven', 70), bookEntry('b9', 9, 'nine', 90)];
  const transport: SyncTransport = {
    push: async () => ({ head: 9, applied: [] }),
    pull: async (since) => ({ head: 9, entries: log.filter((e) => e.seq > since) }),
  };

  await pullLoop(transport, 'A', 5);

  expect((await db.syncState.get('A'))?.cursorSeq).toBe(7); // stopped before the hole at 8
  expect(await db.books.get('b6')).toBeTruthy();
  expect(await db.books.get('b7')).toBeTruthy();
  expect(await db.books.get('b9')).toBeUndefined(); // beyond the hole — not applied
});

// Advisor #1: a merge that diverges from the incoming entry must be enqueued, or it strands here.
test('applyEntry enqueues when the merge diverges from the incoming row', async () => {
  const localCard = createEmptyCard(new Date(0));
  localCard.reps = 9;
  localCard.last_review = new Date(500);
  await db.srsCards.put({ id: 'word:apple', kind: 'word', front: 'apple', back: 'old', tags: [], due: localCard.due, card: localCard, updatedAt: 100, updatedBy: 'inst' });

  const incomingCard = createEmptyCard(new Date(0));
  incomingCard.reps = 3;
  incomingCard.last_review = new Date(50);
  const entry: SyncEntry = {
    store: 'srsCards',
    id: 'word:apple',
    updatedAt: 200,
    updatedBy: 'other',
    seq: 1,
    payload: { id: 'word:apple', kind: 'word', front: 'apple', back: 'new', tags: [], due: incomingCard.due, card: incomingCard, updatedAt: 200, updatedBy: 'other' },
  };

  await applyEntry(entry);

  const merged = (await db.srsCards.get('word:apple'))!;
  expect(merged.card.reps).toBe(9); // kept our higher-reps schedule (F5)
  expect(merged.back).toBe('new'); // took their newer content (LWW)
  const pend = await db.pending.get('srsCards:word:apple');
  expect(pend).toBeTruthy(); // the merged state is on no server yet → must be pushed
});

// A pulled entry that wins outright (no local row) is written but NOT enqueued.
test('applyEntry does not enqueue when the incoming entry wins unchanged', async () => {
  await applyEntry(bookEntry('b1', 1, 'srv', 100));
  expect(await db.books.get('b1')).toBeTruthy();
  expect(await db.pending.count()).toBe(0);
});

/**
 * The reference server, not a hand-rolled stand-in. This used to be a hand-rolled fake that applied plain LWW to every
 * store, ignored the idempotency key, and never dropped a no-op — so every "end-to-end" test below ran
 * against a server unlike production, and the per-store rules (the srsCards schedule, the wordStatus
 * status clock, the immutable union) were exercised on the client side only.
 *
 * `server/src/sync.ts` imports nothing but `node:crypto`, and resolver-parity.test.ts holds the two
 * implementations to the same rules, so wiring the actual store in here costs one adapter.
 *
 * Scope, stated so it is not over-read: production runs `YdbSyncStore` (app.ts picks it when YDB is
 * configured), which re-implements push/pull/idempotency/paging and shares only `resolveServer` and
 * `sameChange`. What follows pins the in-memory reference store and the rules both stores share.
 */
function realServer(): SyncTransport & { _count: () => Promise<number> } {
  const store = new InMemorySyncStore();
  const USER = 'test-user';
  return {
    push: async (body): Promise<SyncPushResponse> => {
      // Contract cap, enforced by the route in production rather than by the store.
      if (body.changes.length > 500) throw new Error('batch exceeds the 500-change contract cap');
      const r = await store.push(USER, body.cursorSeq, body.changes as Change[], body.idempotencyKey);
      return { head: r.head, applied: r.applied as SyncEntry[] };
    },
    pull: async (since, snapshot): Promise<SyncPullResponse> => {
      const r = await store.pull(USER, since, undefined, snapshot);
      return { head: r.head, entries: r.entries as SyncEntry[], snapshot: r.snapshot };
    },
    _count: async () => (await store.pull(USER, 0, 100_000, true)).entries.length,
  };
}

test('reconcile: merges the server snapshot into local and pushes local-only rows up', async () => {
  const server = realServer();
  // Server already has b1 (newer than local) and b2 (server-only).
  await server.push({ cursorSeq: 0, idempotencyKey: 'seed', changes: [bookEntry('b1', 0, 'server', 200), bookEntry('b2', 0, 'srv2', 150)] });

  // Local has an older b1 and a local-only b3.
  await db.books.put({ id: 'b1', title: 'local', format: 'epub', addedAt: 100, chapterCount: 1, lastChapter: 0, updatedAt: 100, updatedBy: 'inst' });
  await db.books.put({ id: 'b3', title: 'local3', format: 'epub', addedAt: 300, chapterCount: 1, lastChapter: 0, updatedAt: 300, updatedBy: 'inst' });

  await syncWith('A', server); // no cursor row yet → reconcile

  expect((await db.books.get('b1'))!.title).toBe('server'); // server newer won locally
  expect((await db.books.get('b2'))!.title).toBe('srv2'); // pulled down
  expect(await server._count()).toBe(3); // b3 pushed up
  expect(await db.pending.count()).toBe(0); // fully drained
  expect((await db.syncState.get('A'))?.cursorSeq).toBeGreaterThan(0); // cursor established
});

test('drainPush chunks a large dirty set under the 500-per-push cap', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 0 }); // incremental path
  const n = 520; // > the 500 cap → must split into ≥2 pushes
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `bk${i}`, title: `t${i}`, format: 'epub' as const, addedAt: i + 1, chapterCount: 1, lastChapter: 0, updatedAt: i + 1, updatedBy: 'inst',
  }));
  await db.books.bulkPut(rows);
  await db.pending.bulkPut(rows.map((r) => ({ key: `books:${r.id}`, store: 'books', id: r.id }))); // seed pending directly (fast)
  const server = realServer(); // throws if any single push carries > 500 changes

  await syncWith('A', server); // must chunk, not send all 520 at once

  expect(await db.pending.count()).toBe(0);
  expect(await server._count()).toBe(n);
}, 20_000);

// A baseline larger than one page must arrive IN FULL. The snapshot branch used to set the cursor to
// `head` after the first page and return, so every row past the cap was never requested again — silent,
// permanent divergence for anyone with more than a page of history (~a month of daily study).
test('pullLoop pages the snapshot to the end instead of stopping at the cap', async () => {
  const PAGE = 50;
  const total = 130; // 2 full pages + a partial one
  const state = Array.from({ length: total }, (_, i) => bookEntry(`b${i + 1}`, i + 1, `t${i + 1}`, 1000 + i));
  const asked: Array<{ since: number; snapshot?: boolean }> = [];

  const transport: SyncTransport = {
    push: async () => ({ head: total, applied: [] }),
    pull: async (since, snapshot): Promise<SyncPullResponse> => {
      asked.push({ since, snapshot });
      if (since <= 0 || snapshot) {
        return { head: total, entries: state.filter((e) => e.seq > since).slice(0, PAGE), snapshot: true };
      }
      return { head: total, entries: [] };
    },
  };

  await pullLoop(transport, 'A', 0);

  expect(await db.books.count()).toBe(total);
  expect(await db.books.get('b130')).toBeTruthy(); // the row that used to be dropped
  expect((await db.syncState.get('A'))?.cursorSeq).toBe(total);
  expect(asked.length).toBeGreaterThan(1); // it actually paged
  expect(asked.every((a) => a.snapshot === true || a.since === 0)).toBe(true);
});

// The cursor is the changelog position. Writing it mid-baseline would make a crash look like a consumed
// log, and the unread rows would never be asked for again — worse than not paging at all.
test('the cursor is not written until the whole snapshot has landed', async () => {
  const PAGE = 10;
  const state = Array.from({ length: 25 }, (_, i) => bookEntry(`c${i + 1}`, i + 1, `t${i + 1}`, 2000 + i));
  const cursorsDuringPaging: (number | undefined)[] = [];

  const transport: SyncTransport = {
    push: async () => ({ head: 25, applied: [] }),
    pull: async (since, snapshot): Promise<SyncPullResponse> => {
      cursorsDuringPaging.push((await db.syncState.get('A'))?.cursorSeq);
      if (since <= 0 || snapshot) {
        return { head: 25, entries: state.filter((e) => e.seq > since).slice(0, PAGE), snapshot: true };
      }
      return { head: 25, entries: [] };
    },
  };

  await pullLoop(transport, 'A', 0);

  expect(cursorsDuringPaging.every((c) => c === undefined)).toBe(true);
  expect((await db.syncState.get('A'))?.cursorSeq).toBe(25);
});

// A server that never advances must not spin the client forever.
test('a snapshot that stops progressing terminates', async () => {
  const stuck = [bookEntry('s1', 1, 'one', 1)];
  let calls = 0;
  const transport: SyncTransport = {
    push: async () => ({ head: 9, applied: [] }),
    pull: async (): Promise<SyncPullResponse> => {
      calls += 1;
      return { head: 9, entries: stuck, snapshot: true }; // always the same row
    },
  };

  await pullLoop(transport, 'A', 0);
  expect(calls).toBeLessThan(5);
});

// Uploading is part of Pro; downloading never is. A refused push must not look like a failed sync:
// the pull still has to run (that is the restore path for a lapsed subscriber) and the dirty queue —
// the user's own unsent work — must survive untouched.
test('a push refused for want of a plan still pulls, keeps the queue, and reports pushBlocked', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 0 });
  await db.books.put({
    id: 'mine', title: 'local only', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0,
    updatedAt: 10, updatedBy: 'me',
  } as never);
  await db.pending.put({ key: 'books:mine', store: 'books', id: 'mine' });

  let pulled = 0;
  const noPlan = Object.assign(new Error('no_plan'), { code: 'no_plan' });
  const transport: SyncTransport = {
    push: async () => {
      throw noPlan;
    },
    pull: async (since) => {
      pulled += 1;
      return { head: 1, entries: since < 1 ? [bookEntry('theirs', 1, 'from the cloud', 20)] : [] };
    },
  };

  const outcome = await syncWith('A', transport);

  expect(outcome.pushBlocked).toBe(true);
  expect(pulled).toBeGreaterThan(0); // the download half ran
  expect(await db.books.get('theirs')).toBeTruthy(); // ...and actually merged
  expect(await db.pending.get('books:mine')).toBeTruthy(); // unsent local work is not discarded
});

// Any other push failure is a real error and must still propagate — the plan gate must not become a
// blanket swallow of upload problems.
test('a push that fails for any other reason still throws', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 0 });
  await db.books.put({
    id: 'mine', title: 'local only', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0,
    updatedAt: 10, updatedBy: 'me',
  } as never);
  await db.pending.put({ key: 'books:mine', store: 'books', id: 'mine' });

  const transport: SyncTransport = {
    push: async () => {
      throw Object.assign(new Error('boom'), { code: 'internal' });
    },
    pull: async () => ({ head: 0, entries: [] }),
  };

  await expect(syncWith('A', transport)).rejects.toThrow('boom');
});

// --- Things the hand-rolled fake could not catch, because it was plain LWW with no idempotency ---

test('the server applies the srsCards schedule rule, not plain LWW', async () => {
  // The fake replaced the whole row by updatedAt, so a later CONTENT edit silently rolled the schedule
  // back — on the server, where no client-side test would ever see it.
  const server = realServer();
  const far = createEmptyCard(new Date(0));
  far.reps = 7;
  far.last_review = new Date(900);
  const near = createEmptyCard(new Date(0));
  near.reps = 3;
  near.last_review = new Date(100);

  const card = (reps: typeof far, updatedAt: number, updatedBy: string, back: string): SyncChange => ({
    store: 'srsCards',
    id: 'word:apple',
    updatedAt,
    updatedBy,
    payload: { id: 'word:apple', kind: 'word', front: 'apple', back, tags: [], due: reps.due, card: reps, updatedAt, updatedBy },
  });

  await server.push({ cursorSeq: 0, idempotencyKey: 'k1', changes: [card(far, 100, 'devA', 'old')] });
  await server.push({ cursorSeq: 0, idempotencyKey: 'k2', changes: [card(near, 200, 'devB', 'edited')] });

  const stored = (await server.pull(0, true)).entries.find((e) => e.id === 'word:apple')!;
  const payload = stored.payload as { back: string; card: { reps: number } };
  expect(payload.back).toBe('edited'); // content follows LWW
  expect(payload.card.reps).toBe(7); // …but the schedule keeps the further-along card
});

test('the server honours the idempotency key, so a retried push does not double-apply', async () => {
  const server = realServer();
  const batch = { cursorSeq: 0, idempotencyKey: 'same-key', changes: [bookEntry('b1', 0, 'one', 100) as SyncChange] };

  const first = await server.push(batch);
  const retry = await server.push(batch); // the client resends after a lost response

  expect(retry.head).toBe(first.head); // no new seq burned
  expect(retry.applied.map((e) => e.seq)).toEqual(first.applied.map((e) => e.seq));
  expect(await server._count()).toBe(1);
});

test('the server drops a no-op push instead of appending a changelog entry', async () => {
  const server = realServer();
  const row = bookEntry('b1', 0, 'one', 100) as SyncChange;
  const head1 = (await server.push({ cursorSeq: 0, idempotencyKey: 'k1', changes: [row] })).head;

  // Same content, different key (an idempotency memo would not cover this — the row itself is unchanged).
  const second = await server.push({ cursorSeq: 0, idempotencyKey: 'k2', changes: [row] });

  expect(second.applied).toEqual([]);
  expect(second.head).toBe(head1);
});

test('append-only stores are a union by id on the server, not a last-writer overwrite', async () => {
  const server = realServer();
  const attempt = (correct: boolean, updatedAt: number): SyncChange => ({
    store: 'attempts',
    id: 'devA:evt-1',
    updatedAt,
    updatedBy: 'devA',
    payload: { syncId: 'devA:evt-1', exerciseId: 'e1', tags: [], correct, userAnswer: 'x', attemptNumber: 1, timestamp: updatedAt, usedHint: false, usedAI: false, updatedAt, updatedBy: 'devA' },
  });

  await server.push({ cursorSeq: 0, idempotencyKey: 'k1', changes: [attempt(true, 100)] });
  await server.push({ cursorSeq: 0, idempotencyKey: 'k2', changes: [attempt(false, 200)] });

  const stored = (await server.pull(0, true)).entries.find((e) => e.id === 'devA:evt-1')!;
  expect((stored.payload as { correct: boolean }).correct).toBe(true); // the event is immutable

  // And it must not append a changelog entry either. Keeping the row while logging a duplicate on every
  // re-push reads as correct from current-state, and inflates every other device's pull forever.
  const again = await server.push({ cursorSeq: 0, idempotencyKey: 'k3', changes: [attempt(false, 300)] });
  expect(again.applied).toEqual([]);
});

test('wipeSyncedData clears every synced table, the dirty queue and the account cursors — but keeps the install id', async () => {
  // Called on logout and on an account switch (store.ts:96, :368, :408). Untested until now, and the
  // consequences of each half going wrong are different: leaving rows behind bleeds account A's data into
  // account B; leaving the dirty queue behind pushes A's rows up under B's credentials; and dropping the
  // INSTALL_ROW would hand this device a new identity, breaking the LWW tiebreaker against its own history.
  await db.syncState.put({ account: INSTALL_ROW, installId: 'install-xyz' });
  await db.syncState.put({ account: 'acc-A', cursorSeq: 42 });
  // Driven off SYNCED_STORES rather than a hand-picked pair: asserting only `books` and `wordStatus`
  // let five stores be dropped from the wipe list with the whole suite still green, and the list is
  // hardcoded in three places with nothing pinning the copies together.
  const seeds: Record<SyncedStore, object> = {
    books: { id: 'b1', title: 'A private book', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0, updatedAt: 1, updatedBy: 'inst' },
    wordStatus: { word: 'apple', status: 'known', firstSeenAt: 1, encounters: 1, statusUpdatedAt: 1, updatedAt: 1, updatedBy: 'inst' },
    srsCards: { id: 'word:apple', kind: 'word', front: 'apple', back: 'яблоко', tags: [], due: new Date(0), card: createEmptyCard(new Date(0)), updatedAt: 1, updatedBy: 'inst' },
    attempts: { syncId: 'inst:a1', exerciseId: 'e1', tags: [], correct: true, userAnswer: 'x', attemptNumber: 1, timestamp: 1, usedHint: false, usedAI: false, updatedAt: 1, updatedBy: 'inst' },
    checkpoints: { syncId: 'inst:c1', unitId: 'u01', timestamp: 1, score: 5, total: 6, tagBreakdown: [], updatedAt: 1, updatedBy: 'inst' },
    bookmarks: { id: 'bm1', bookKey: 'reader.x', page: 0, paragraph: 1, pageId: 'p', snippet: 's', createdAt: 1, updatedAt: 1, updatedBy: 'inst' },
    settings: { key: 'uiLang', value: 'ru', updatedAt: 1, updatedBy: 'inst' },
  };
  for (const store of SYNCED_STORES) await db.table(store).put(seeds[store]);
  await db.pending.put({ key: 'books:b1', store: 'books', id: 'b1' });

  await wipeSyncedData();

  for (const store of SYNCED_STORES) expect(await db.table(store).count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
  expect(await db.syncState.get('acc-A')).toBeUndefined();
  expect((await db.syncState.get(INSTALL_ROW))?.installId).toBe('install-xyz');
});

test('every idempotency key satisfies the contract the server validates against', async () => {
  // The key is a pure function of (cursorSeq, changes), so a key the server rejects is not a lost push —
  // it is a stuck one: the retry rebuilds the same rejected key and the cycle stays in `error` until some
  // unrelated local write changes the batch. An unpadded base36 hash produced 6-character keys
  // (`b7zr-1`) for roughly one single-change push in 2 400, against a contract minimum of 8.
  const shape = (i: number): SyncChange => ({
    store: 'books',
    id: `bk-${i}`,
    updatedAt: 1_700_000_000_000 + i,
    updatedBy: `inst-${i % 7}`,
    payload: { id: `bk-${i}` },
  });

  let shortest = Infinity;
  for (let i = 0; i < 20_000; i += 1) {
    const key = idempotencyKey(i % 900, [shape(i)]);
    shortest = Math.min(shortest, key.length);
    expect(SyncPushRequestSchema.shape.idempotencyKey.safeParse(key).success).toBe(true);
  }
  expect(shortest).toBeGreaterThanOrEqual(8);

  // A batch is still keyed by its contents, or the memo would collapse unrelated pushes into one.
  expect(idempotencyKey(0, [shape(1)])).not.toBe(idempotencyKey(0, [shape(2)]));
  expect(idempotencyKey(0, [shape(1)])).not.toBe(idempotencyKey(1, [shape(1)]));
});
