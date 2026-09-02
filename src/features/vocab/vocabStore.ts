import { create } from 'zustand';
import { db, type WordStatusValue } from '@/db/db';
import { putWordStatus } from '@/features/sync/local';

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
    } catch {
      // best-effort
    }
  },
}));
