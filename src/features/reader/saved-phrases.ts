import { create } from 'zustand';
import { db } from '@/db/db';
import { phraseKey } from './phrase-marks';

/** Live index of phrases the user has saved from the reader, so re-selecting one shows it as
 *  already-saved and its words underline as *learning* in the text. Source of truth is the SRS
 *  `phrase:<text>` card; this is the in-memory projection, keyed by `phraseKey`. */
type SavedPhrasesState = {
  phrases: Set<string>;
  ready: boolean;
  load: () => Promise<void>;
  /** Register a just-saved phrase; identity changes only on a real add (no wasted re-render). */
  add: (text: string) => void;
  has: (text: string) => boolean;
};

export const useSavedPhrases = create<SavedPhrasesState>((set, get) => ({
  phrases: new Set(),
  ready: false,
  load: async () => {
    if (get().ready) return;
    try {
      // Prefix on the primary key — only reader-saved phrases (`err:`/`word:` cards excluded).
      const cards = await db.srsCards.where('id').startsWith('phrase:').toArray();
      const loaded = cards.map((c) => phraseKey(c.front)).filter(Boolean);
      // Merge, don't replace — an add() that lands during the in-flight query must survive.
      set({ phrases: new Set([...get().phrases, ...loaded]), ready: true });
    } catch {
      set({ ready: true });
    }
  },
  add: (text) => {
    const key = phraseKey(text);
    if (!key || get().phrases.has(key)) return;
    const next = new Set(get().phrases);
    next.add(key);
    set({ phrases: next });
  },
  has: (text) => get().phrases.has(phraseKey(text)),
}));
