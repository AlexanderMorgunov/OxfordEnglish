/**
 * A sync cycle must not touch the database or the network once the account it started for has stopped
 * being the current one (queue item 12).
 *
 * Checking the account store instead does not work, which is why the guard is a generation counter:
 * `maybeSwitchWipe` runs BEFORE `applySession`, so for the whole duration of a wipe the store still
 * names the old account — the obvious guard passes exactly when it must not. The invalidating event is
 * the wipe, so `wipeSyncedData` owns the bump.
 */
import 'fake-indexeddb/auto';
import { vi, test, expect, beforeEach } from 'vitest';
import Dexie from 'dexie';
import { db } from '@/db/db';
import type { SyncEntry } from '@/features/account/contract';
import { applyEntry, syncWith, wipeSyncedData, type SyncTransport } from './engine';
import { SYNCED_STORES } from './resolve';

beforeEach(async () => {
  vi.restoreAllMocks();
  if (!db.isOpen()) await db.open();
  await Promise.all([...SYNCED_STORES.map((s) => db.table(s).clear()), db.pending.clear(), db.syncState.clear()]);
});

const bookEntry = (id: string, seq: number, updatedAt: number): SyncEntry => ({
  store: 'books',
  id,
  updatedAt,
  updatedBy: 'other',
  seq,
  payload: { id, title: 't', format: 'epub', addedAt: updatedAt, chapterCount: 1, lastChapter: 0, updatedAt, updatedBy: 'other' },
});

/** `wipeSyncedData` clears through `db.table(name)`, which hands out a fresh wrapper per call — a spy on
 *  `db.wordStatus` never sees the object it actually clears, so the interception goes one level up. */
function failWordStatusClear(): void {
  const realTable = db.table.bind(db);
  // Cast because the doubles hand back plain promises where Dexie's own `PromiseExtended` is declared.
  vi.spyOn(db, 'table').mockImplementation(((name: string) => {
    const t = realTable(name);
    if (name !== 'wordStatus') return t;
    const failing = Object.create(t) as typeof t;
    failing.clear = () => Dexie.Promise.reject(new Error('quota'));
    return failing;
  }) as typeof db.table);
}

/** A transport whose pull runs the wipe before answering — the real interleaving, made deterministic:
 *  `nudgeSync` fires 3 s after any local write and `logout` awaits a network round trip before wiping. */
function wipingTransport(entries: SyncEntry[], head: number, onWipe: () => Promise<void> = wipeSyncedData): SyncTransport {
  return {
    push: async () => ({ head, applied: [] }),
    pull: async () => {
      await onWipe();
      return { head, entries };
    },
  };
}

test('a pull page that resolves after the account was wiped writes nothing', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });

  const outcome = await syncWith('A', wipingTransport([bookEntry('b6', 6, 60)], 6));

  expect(outcome.stale).toBe(true);
  expect(await db.books.count()).toBe(0);
});

test('the cursor the wipe deleted is not written back by the cycle that outlived it', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });

  // No entries on purpose: with a page to apply, `applyEntry` aborts the cycle first and this would
  // pass whether or not `setCursor` is guarded at all.
  await syncWith('A', wipingTransport([], 5));

  // A resurrected cursor row is worse than a lost one: the next sign-in to this account sees a cursor,
  // skips reconcile, and diverges from the server with no way to notice.
  expect(await db.syncState.get('A')).toBeUndefined();
});

test('a wipe that throws half-way still abandons the cycle, and the queue is not rebuilt', async () => {
  await db.wordStatus.put({
    word: 'apple', status: 'known', encounters: 1, firstSeenAt: 9,
    updatedAt: 9, updatedBy: 'installA', statusUpdatedAt: 9,
  });
  // The case the `.catch` in `maybeSwitchWipe` exists for: the switch proceeds with the old account's
  // rows still present, so the bump has to happen BEFORE the clears rather than after them.
  failWordStatusClear();

  const swallowed = () => wipeSyncedData().catch(() => undefined);
  const outcome = await syncWith('A', wipingTransport([], 0, swallowed)); // no cursor row → reconcile

  expect(outcome.stale).toBe(true);
  expect(await db.wordStatus.count()).toBe(1); // the failed clear left it behind
  // Without bump-first the failed clear leaves `epoch` untouched, the cycle runs to completion, and
  // reconcile's sweep enqueues the surviving row for the next account to push.
  expect(await db.pending.count()).toBe(0);
});

test('an abandoned cycle resolves rather than throwing, while a real failure still propagates', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });
  await expect(syncWith('A', wipingTransport([bookEntry('b6', 6, 60)], 6))).resolves.toEqual({
    pushBlocked: false,
    stale: true,
  });

  await db.syncState.put({ account: 'A', cursorSeq: 5 });
  const broken: SyncTransport = {
    push: async () => ({ head: 5, applied: [] }),
    pull: async () => {
      throw new Error('boom');
    },
  };
  await expect(syncWith('A', broken)).rejects.toThrow('boom');
});

test('a later cycle runs normally once the wipe is behind it', async () => {
  await syncWith('A', wipingTransport([], 0)); // abandoned

  await db.syncState.put({ account: 'B', cursorSeq: 5 });
  const transport: SyncTransport = {
    push: async () => ({ head: 6, applied: [] }),
    pull: async (since) => ({ head: 6, entries: since < 6 ? [bookEntry('b6', 6, 60)] : [] }),
  };
  const outcome = await syncWith('B', transport);

  // The guard must cost nothing once the boundary has passed, or sync stalls with nothing saying so.
  expect(outcome.stale).toBeUndefined();
  expect(await db.books.count()).toBe(1);
  expect((await db.syncState.get('B'))?.cursorSeq).toBe(6);
});

test('a push whose answer lands after a failed wipe does not clear the queue it left behind', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });
  await db.wordStatus.put({
    word: 'apple', status: 'known', encounters: 1, firstSeenAt: 9,
    updatedAt: 9, updatedBy: 'installA', statusUpdatedAt: 9,
  });
  await db.pending.put({ key: 'wordStatus:apple', store: 'wordStatus', id: 'apple' });
  failWordStatusClear();

  // An empty `applied` is real server behaviour for a no-op push, and it reaches the mark-clearing loop
  // without passing through `applyEntry` — so that loop needs its own check.
  const transport: SyncTransport = {
    push: async () => {
      await wipeSyncedData().catch(() => undefined);
      return { head: 5, applied: [] };
    },
    pull: async () => ({ head: 5, entries: [] }),
  };
  const outcome = await syncWith('A', transport);

  expect(outcome.stale).toBe(true);
  // The wipe threw before it reached `db.pending.clear()`, so the queue is still there — and a cycle
  // belonging to the old account must not be the thing that empties it.
  expect(await db.pending.count()).toBe(1);
});

test('the guard is inert when no cycle is running', async () => {
  await wipeSyncedData();

  // Every exported internal is called directly by engine.test.ts. Armed outside a cycle, the guard would
  // throw for all of them the moment any test wiped first — a trap for whoever appends the next test.
  await expect(applyEntry(bookEntry('b1', 1, 10))).resolves.toBeUndefined();
  expect(await db.books.count()).toBe(1);
});

test('rows belonging to the old account never reach the server after the boundary', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });
  await db.wordStatus.put({
    word: 'apple', status: 'known', encounters: 1, firstSeenAt: 9,
    updatedAt: 9, updatedBy: 'installA', statusUpdatedAt: 9,
  });
  await db.pending.put({ key: 'wordStatus:apple', store: 'wordStatus', id: 'apple' });
  failWordStatusClear(); // the queue survives, so there is still something to wrongly send

  // The wipe lands between `drainPush` reading the queue length and `pushOnce` collecting it. This is
  // defect 3 itself: `transport`'s token is re-resolved per call, so a request issued here would carry
  // the NEW account's credentials while carrying the OLD account's rows.
  vi.spyOn(db.pending, 'count').mockImplementationOnce((() =>
    Dexie.Promise.resolve().then(async () => {
      await wipeSyncedData().catch(() => undefined);
      return 1;
    })) as typeof db.pending.count);

  let pushes = 0;
  const transport: SyncTransport = {
    push: async () => {
      pushes += 1;
      return { head: 5, applied: [] };
    },
    pull: async () => ({ head: 5, entries: [] }),
  };
  const outcome = await syncWith('A', transport);

  expect(outcome.stale).toBe(true);
  expect(pushes).toBe(0);
});

test('a superseded cycle does not even open the connection', async () => {
  // No cursor row, so this is the reconcile path, and the wipe lands while `syncWith` is still reading
  // sync state — before the first `transport.pull`. A pull is authenticated too: `run.ts` resolves the
  // token at call time, so a read issued here would carry the NEW account's credentials.
  vi.spyOn(db.syncState, 'get').mockImplementationOnce((() =>
    Dexie.Promise.resolve().then(async () => {
      await wipeSyncedData();
      return undefined;
    })) as typeof db.syncState.get);

  let pulls = 0;
  const transport: SyncTransport = {
    push: async () => ({ head: 0, applied: [] }),
    pull: async () => {
      pulls += 1;
      return { head: 0, entries: [] };
    },
  };
  const outcome = await syncWith('A', transport);

  expect(outcome.stale).toBe(true);
  expect(pulls).toBe(0);
});

/** `setCursor` checks, then does an IDB get and an IDB put. A wipe landing across those two awaits is
 *  past every check made so far, which is what the loop-top checks are for. */
function wipeOnCursorWrite(): void {
  vi.spyOn(db.syncState, 'put').mockImplementationOnce((() =>
    Dexie.Promise.resolve().then(async () => {
      await wipeSyncedData().catch(() => undefined);
      return 'A';
    })) as typeof db.syncState.put);
}

test('no second page is requested once the wipe lands between pages', async () => {
  await db.syncState.put({ account: 'A', cursorSeq: 5 });
  wipeOnCursorWrite();

  let pulls = 0;
  const transport: SyncTransport = {
    push: async () => ({ head: 7, applied: [] }),
    pull: async (since) => {
      pulls += 1;
      return { head: 7, entries: since < 6 ? [bookEntry('b6', 6, 60)] : [] };
    },
  };
  const outcome = await syncWith('A', transport);

  expect(outcome.stale).toBe(true);
  expect(pulls).toBe(1); // head is 7 and the cursor reached 6, so an unguarded loop would ask again
});

test('a wipe landing as the baseline cursor is written does not let the sweep rebuild the queue', async () => {
  await db.wordStatus.put({
    word: 'apple', status: 'known', encounters: 1, firstSeenAt: 9,
    updatedAt: 9, updatedBy: 'installA', statusUpdatedAt: 9,
  });
  failWordStatusClear(); // the row survives the wipe, so the sweep would have something to enqueue
  wipeOnCursorWrite();

  // No cursor row → reconcile: snapshot, then the sweep that marks every local row for push.
  const outcome = await syncWith('A', {
    push: async () => ({ head: 0, applied: [] }),
    pull: async () => ({ head: 0, entries: [] }),
  });

  expect(outcome.stale).toBe(true);
  expect(await db.wordStatus.count()).toBe(1);
  expect(await db.pending.count()).toBe(0);
});
