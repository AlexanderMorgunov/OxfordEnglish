import { db, type ActivityDay, type ReviewLogEntry } from '@/db/db';
import { applyDelta, emptyDay, localDayKey, type ActivityDelta } from './accounting';
import { installId } from './device';

/** Add to this device's row for today inside one rw transaction (get → merge → put), so a reading tick
 *  and a save landing together — or two reader tabs — never lose an update. Best-effort. */
export async function recordActivity(delta: ActivityDelta, now = Date.now()): Promise<void> {
  const day = localDayKey(now);
  const id = `${day}:${installId()}`;
  try {
    await db.transaction('rw', db.activity, async () => {
      const row = (await db.activity.get(id)) ?? emptyDay(id, day);
      await db.activity.put(applyDelta(row, delta));
    });
  } catch {
    // stats are non-critical if IndexedDB is unavailable
  }
}

type Reading = { key: string; title: string };
let reading: Reading | null = null;

/** The open book, so a word saved from the reader is credited to it. Cleared when the reader unmounts. */
export function setCurrentReading(book: Reading | null): void {
  reading = book;
}

export function recordSave(kind: 'word' | 'phrase'): Promise<void> {
  return recordActivity({
    [kind === 'word' ? 'wordsSaved' : 'phrasesSaved']: 1,
    ...(reading ? { book: { ...reading, saved: 1 } } : {}),
  });
}

export async function logReview(cardId: string, rating: number): Promise<void> {
  try {
    await db.reviewLog.add({ id: crypto.randomUUID(), cardId, rating, ts: Date.now() });
  } catch {
    // best-effort
  }
}

const PENDING_KEY = 'oxford-stats-pending';
type Pending = { ts: number; sec: number; words: number; book?: Reading };

/** Reading time not yet credited when the page hides. Written synchronously (an IndexedDB write may
 *  not finish during pagehide) and folded in by the next `flushPending`. */
export function stashPending(p: Pending): void {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as Pending[];
    list.push(p);
    localStorage.setItem(PENDING_KEY, JSON.stringify(list));
  } catch {
    // best-effort
  }
}

export async function flushPending(): Promise<void> {
  let list: Pending[] = [];
  try {
    list = JSON.parse(localStorage.getItem(PENDING_KEY) ?? '[]') as Pending[];
    localStorage.removeItem(PENDING_KEY);
  } catch {
    return;
  }
  for (const p of list) {
    const words = p.words ?? 0;
    await recordActivity(
      { readSec: p.sec, readWords: words, ...(p.book ? { book: { ...p.book, sec: p.sec, words } } : {}) },
      p.ts
    );
  }
}

/** Activity rows and review log since a local day (inclusive), after folding in any stashed time. */
export async function loadActivity(from: string): Promise<{ rows: ActivityDay[]; reviews: ReviewLogEntry[] }> {
  await flushPending();
  try {
    const [rows, reviews] = await Promise.all([
      db.activity.where('day').aboveOrEqual(from).toArray(),
      db.reviewLog.where('ts').aboveOrEqual(new Date(`${from}T00:00:00`).getTime()).toArray(),
    ]);
    return { rows, reviews };
  } catch {
    return { rows: [], reviews: [] };
  }
}

/** The first local day anything was recorded, for the «collecting since» note; null when nothing yet. */
export async function statsSince(): Promise<string | null> {
  try {
    const [first, firstReview] = await Promise.all([db.activity.orderBy('day').first(), db.reviewLog.orderBy('ts').first()]);
    const days = [first?.day, firstReview ? localDayKey(firstReview.ts) : undefined].filter(Boolean) as string[];
    return days.sort()[0] ?? null;
  } catch {
    return null;
  }
}
