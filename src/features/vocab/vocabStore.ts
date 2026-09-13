import { create } from 'zustand';
import { db, type WordStatus, type WordStatusValue } from '@/db/db';
import { putWordStatus } from '@/features/sync/local';
import { recordActivity } from '@/features/stats/activity';

/** A move into `known` counts for the «marked known» stat. Compared against the stored row, not the
 *  in-memory map, which both setters update optimistically before the write. */
const countKnown = (prev: WordStatus | undefined, next: WordStatusValue) => {
  if (next === 'known' && prev?.status !== 'known') void recordActivity({ learned: 1 });
};

type VocabState = {
  statuses: Map<string, WordStatusValue>;
  ready: boolean;
  load: () => Promise<void>;
  setStatus: (word: string, status: WordStatusValue) => Promise<void>;
  /** Reclassify without counting it as an encounter — for the vocabulary manager, not reading. */
  updateStatus: (word: string, status: WordStatusValue) => Promise<void>;
};

export const useVocabStore = create<VocabState>((set, get) => ({
  statuses: new Map(),
  ready: false,
  load: async () => {
    if (get().ready) return;
    try {
      const all = await db.wordStatus.toArray();
      set({ statuses: new Map(all.map((w) => [w.word, w.status])), ready: true });
    } catch {
      set({ ready: true });
    }
  },
  setStatus: async (rawWord, status) => {
    const word = rawWord.toLowerCase();
    const next = new Map(get().statuses);
    next.set(word, status);
    set({ statuses: next });
    try {
      const existing = await db.wordStatus.get(word);
      await putWordStatus({
        word,
        status,
        firstSeenAt: existing?.firstSeenAt ?? Date.now(),
        encounters: (existing?.encounters ?? 0) + 1,
      });
      countKnown(existing, status);
    } catch {
      // best-effort — word status is non-critical if IndexedDB is unavailable
    }
  },
  updateStatus: async (rawWord, status) => {
    const word = rawWord.toLowerCase();
    const next = new Map(get().statuses);
    next.set(word, status);
    set({ statuses: next });
    try {
      const existing = await db.wordStatus.get(word);
      await putWordStatus({
        word,
        status,
        firstSeenAt: existing?.firstSeenAt ?? Date.now(),
        encounters: existing?.encounters ?? 0, // reclassification is not a new sighting
      });
      countKnown(existing, status);
    } catch {
      // best-effort
    }
  },
}));
