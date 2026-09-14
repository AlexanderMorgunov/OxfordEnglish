import { test, expect } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import {
  resolveLww,
  resolveSrsCard,
  resolveWordStatus,
  isDeleted,
  type Synced,
  type SyncedWordStatus,
} from './resolve';

const card = (over: Partial<{ reps: number; last_review: Date; due: Date }> = {}) => {
  const c = createEmptyCard(new Date(0));
  c.reps = over.reps ?? 0;
  if (over.last_review) c.last_review = over.last_review;
  c.due = over.due ?? c.due;
  return c;
};

const srs = (o: Partial<Synced<SrsCard>> & Pick<Synced<SrsCard>, 'updatedAt' | 'updatedBy'>): Synced<SrsCard> => {
  const cd = o.card ?? card();
  return {
    id: 'word:apple',
    kind: 'word',
    front: 'apple',
    back: 'яблоко',
    tags: [],
    ...o,
    card: cd,
    due: cd.due,
  };
};

const ws = (o: Partial<SyncedWordStatus> & Pick<SyncedWordStatus, 'updatedAt' | 'updatedBy'>): SyncedWordStatus => ({
  word: 'apple',
  status: 'learning',
  statusUpdatedAt: o.updatedAt,
  encounters: 1,
  firstSeenAt: 0,
  ...o,
});

// --- Generic LWW (books/bookmarks/settings) ---

type Book = Synced<{ id: string; title: string }>;
const bk = (title: string, updatedAt: number, updatedBy: string, deletedAt?: number): Book => ({
  id: 'b1',
  title,
  updatedAt,
  updatedBy,
  ...(deletedAt != null ? { deletedAt } : {}),
});

test('LWW: later updatedAt wins', () => {
  const a = bk('old', 10, 'devA');
  const b = bk('new', 20, 'devB');
  expect(resolveLww(a, b).title).toBe('new');
  expect(resolveLww(a, b)).toEqual(resolveLww(b, a)); // commutative
});

test('LWW: equal updatedAt tie-broken deterministically by updatedBy', () => {
  const a = bk('A', 10, 'devA');
  const b = bk('B', 10, 'devB');
  expect(resolveLww(a, b).title).toBe('B'); // devB > devA
  expect(resolveLww(a, b)).toEqual(resolveLww(b, a));
});

test('delete wins vs older edit; a later edit resurrects (H1)', () => {
  const edit = bk('edit', 10, 'devA');
  const del: Book = { ...bk('edit', 10, 'devA'), deletedAt: 15 };
  const merged = resolveLww(edit, del);
  expect(isDeleted(merged)).toBe(true);
  expect(resolveLww(edit, del)).toEqual(resolveLww(del, edit)); // commutative

  const laterEdit = bk('resurrected', 20, 'devB');
  const back = resolveLww(del, laterEdit);
  expect(isDeleted(back)).toBe(false); // updatedAt 20 > deletedAt 15
  expect(back.title).toBe('resurrected');
  expect(resolveLww(del, laterEdit)).toEqual(resolveLww(laterEdit, del));
});

test('delete does NOT resurrect when the edit is older than the tombstone', () => {
  const del: Book = { ...bk('x', 20, 'devA'), deletedAt: 20 };
  const olderEdit = bk('y', 10, 'devB');
  expect(isDeleted(resolveLww(del, olderEdit))).toBe(true);
});

// --- srsCards: atomic card + independent content LWW (F5) ---

test('srsCard: schedule from higher-reps device, content from the LWW winner', () => {
  const a = srs({ updatedAt: 10, updatedBy: 'devA', front: 'apple', card: card({ reps: 9, last_review: new Date(100), due: new Date(500) }) });
  const b = srs({ updatedAt: 20, updatedBy: 'devB', front: 'apple (edited)', card: card({ reps: 3, last_review: new Date(50), due: new Date(200) }) });
  const m = resolveSrsCard(a, b);
  expect(m.card.reps).toBe(9); // schedule from A (more reps)
  expect(m.due).toEqual(new Date(500)); // due mirrors the winning card
  expect(m.front).toBe('apple (edited)'); // content from B (later updatedAt)
  expect(resolveSrsCard(a, b)).toEqual(resolveSrsCard(b, a)); // commutative
});

test('srsCard: equal reps tie-broken by later last_review', () => {
  const a = srs({ updatedAt: 10, updatedBy: 'devA', card: card({ reps: 5, last_review: new Date(100), due: new Date(300) }) });
  const b = srs({ updatedAt: 10, updatedBy: 'devB', card: card({ reps: 5, last_review: new Date(200), due: new Date(400) }) });
  expect(resolveSrsCard(a, b).due).toEqual(new Date(400)); // B reviewed later
  expect(resolveSrsCard(a, b)).toEqual(resolveSrsCard(b, a));
});

test('srsCard: idempotent', () => {
  const a = srs({ updatedAt: 10, updatedBy: 'devA', card: card({ reps: 4, due: new Date(300) }) });
  expect(resolveSrsCard(a, a)).toEqual(a);
});

// --- wordStatus: total 4x4 merge incl. ignored (F6) ---

const STATUSES = ['unknown', 'learning', 'known', 'ignored'] as const;

test('wordStatus: status is LWW by statusUpdatedAt; encounters=max, firstSeenAt=min', () => {
  const a = ws({ updatedAt: 10, updatedBy: 'devA', status: 'known', encounters: 8, firstSeenAt: 5 });
  const b = ws({ updatedAt: 20, updatedBy: 'devB', status: 'learning', encounters: 3, firstSeenAt: 2 });
  const m = resolveWordStatus(a, b);
  expect(m.status).toBe('learning'); // later statusUpdatedAt
  expect(m.encounters).toBe(8);
  expect(m.firstSeenAt).toBe(2);
  expect(resolveWordStatus(a, b)).toEqual(resolveWordStatus(b, a));
});

test('wordStatus: total & commutative across all 16 status pairings', () => {
  for (const sa of STATUSES) {
    for (const sb of STATUSES) {
      const a = ws({ updatedAt: 10, updatedBy: 'devA', status: sa });
      const b = ws({ updatedAt: 10, updatedBy: 'devB', status: sb });
      // equal statusUpdatedAt → deterministic tiebreak (devB wins), and commutative
      expect(resolveWordStatus(a, b)).toEqual(resolveWordStatus(b, a));
      expect(STATUSES).toContain(resolveWordStatus(a, b).status);
    }
  }
});

test('wordStatus: idempotent', () => {
  const a = ws({ updatedAt: 10, updatedBy: 'devA', status: 'ignored', encounters: 4, firstSeenAt: 1 });
  expect(resolveWordStatus(a, a)).toEqual(a);
});
