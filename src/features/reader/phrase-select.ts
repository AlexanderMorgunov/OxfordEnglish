import { create } from 'zustand';

/** A word's position: paragraph, sentence, and token index within that sentence's split array. */
export type WordPos = { p: number; s: number; t: number };

type PhraseSelectState = {
  anchor: WordPos | null;
  end: WordPos | null;
  owner: string | null;
  begin: (pos: WordPos, owner?: string) => void;
  extend: (pos: WordPos) => void;
  clear: () => void;
};

/** Scope tap endpoints to their reading instance; a lesson may contain several reading blocks. */
export const usePhraseSelect = create<PhraseSelectState>((set) => ({
  anchor: null,
  end: null,
  owner: null,
  begin: (pos, owner) => set({ anchor: pos, end: null, owner: owner ?? null }),
  extend: (pos) => set({ end: pos }),
  clear: () => set({ anchor: null, end: null, owner: null }),
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
