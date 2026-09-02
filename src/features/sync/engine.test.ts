import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import type { SyncChange, SyncEntry, SyncPullResponse, SyncPushResponse } from '@/features/account/contract';
import { applyEntry, pullLoop, syncWith, type SyncTransport } from './engine';

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.books.clear(), db.srsCards.clear(), db.attempts.clear(), db.pending.clear(), db.syncState.clear()]);
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

/** Minimal in-memory server (LWW, contiguous log, snapshot) to drive a realistic reconcile. */
function fakeServer(): SyncTransport & { _count: () => Promise<number> } {
  const state = new Map<string, SyncEntry>();
  const log: SyncEntry[] = [];
  let seq = 0;
  return {
    push: async (body): Promise<SyncPushResponse> => {
      if (body.changes.length > 500) throw new Error('batch exceeds the 500-change contract cap');
      const applied: SyncEntry[] = [];
      for (const ch of body.changes as SyncChange[]) {
        const key = `${ch.store}:${ch.id}`;
        const cur = state.get(key);
        const wins = !cur || ch.updatedAt > cur.updatedAt || (ch.updatedAt === cur.updatedAt && ch.updatedBy >= cur.updatedBy);
        if (!wins) continue;
        const entry: SyncEntry = { ...ch, seq: (seq += 1) };
        state.set(key, entry);
        log.push(entry);
        applied.push(entry);
      }
      return { head: seq, applied };
    },
    pull: async (since): Promise<SyncPullResponse> => {
      if (since <= 0) return { head: seq, entries: [...state.values()].sort((a, b) => a.seq - b.seq), snapshot: true };
      return { head: seq, entries: log.filter((e) => e.seq > since) };
    },
    _count: async () => state.size,
  };
}

test('reconcile: merges the server snapshot into local and pushes local-only rows up', async () => {
  const server = fakeServer();
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
  const server = fakeServer(); // throws if any single push carries > 500 changes

  await syncWith('A', server); // must chunk, not send all 520 at once

  expect(await db.pending.count()).toBe(0);
  expect(await server._count()).toBe(n);
}, 20_000);
