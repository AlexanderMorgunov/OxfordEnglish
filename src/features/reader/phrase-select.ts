import { create } from 'zustand';

/** A word's position: paragraph, sentence, and token index within that sentence's split array. */
export type WordPos = { p: number; s: number; t: number };

type PhraseSelectState = {
  anchor: WordPos | null;
  end: WordPos | null;
  begin: (pos: WordPos) => void;
  extend: (pos: WordPos) => void;
  clear: () => void;
};

/** Touch phrase-picking state for the book reader: tap a word's "select phrase" action to set the
 *  anchor, then tap the last word to set the end. Module-level is safe — the book reader and the
 *  learn reading view never co-mount; the reader clears this on mount to drop any stale range. */
export const usePhraseSelect = create<PhraseSelectState>((set) => ({
  anchor: null,
  end: null,
  begin: (pos) => set({ anchor: pos, end: null }),
  extend: (pos) => set({ end: pos }),
  clear: () => set({ anchor: null, end: null }),
}));

export const parsePos = (id: string): WordPos => {
  const [p, s, t] = id.split(':').map(Number);
  return { p: p ?? 0, s: s ?? 0, t: t ?? 0 };
};

export const samePos = (a: WordPos, b: WordPos) => a.p === b.p && a.s === b.s && a.t === b.t;

/** Is `pos` inside the current selection? The range is constrained to the anchor's sentence; with no
 *  end yet, only the anchor highlights; an end in a different sentence is ignored (anchor-only). */
export function inPhraseRange(pos: WordPos, anchor: WordPos | null, end: WordPos | null): boolean {
  if (!anchor || pos.p !== anchor.p || pos.s !== anchor.s) return false;
  const hi = end && end.p === anchor.p && end.s === anchor.s ? end.t : anchor.t;
  return pos.t >= Math.min(anchor.t, hi) && pos.t <= Math.max(anchor.t, hi);
}
