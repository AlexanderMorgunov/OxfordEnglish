import { useEffect, useState } from 'react';
import { stems } from '@/features/reader/difficulty';
import { baseForm, type LemmaData } from './lemma';

/**
 * CEFR-J level per headword (`public/reader/en-cefr.json`, built by `scripts/build-cefr.mjs`,
 * lazy-loaded, not precached). `order` ranks usefulness: level first, then frequency within it.
 */
export type CefrHit = { level: number; order: number };
export type CefrData = Map<string, CefrHit>;

export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2'] as const;

const EMPTY: CefrData = new Map();
let dataPromise: Promise<CefrData> | null = null;

export function loadCefr(): Promise<CefrData> {
  if (!dataPromise) {
    const url = `${import.meta.env.BASE_URL}reader/en-cefr.json`;
    dataPromise = fetch(url)
      .then((r) => r.json())
      .then((j: { levels: string[][] }) => indexCefr(j.levels))
      .catch(() => EMPTY);
  }
  return dataPromise;
}

/** `levels[i]` = headwords at CEFR_LEVELS[i], most frequent first → word → { level, order }. */
export function indexCefr(levels: string[][]): CefrData {
  const m: CefrData = new Map();
  let order = 0;
  levels.forEach((words, level) => {
    for (const w of words) m.set(w, { level, order: order++ });
  });
  return m;
}

/** The CEFR list, empty until loaded (callers render without it first). */
export function useCefr(): CefrData {
  const [data, setData] = useState<CefrData>(EMPTY);
  useEffect(() => {
    let alive = true;
    void loadCefr().then((d) => {
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

/**
 * The easiest listed reading of a term across its surface form, base form and suffix-rule stems,
 * so "went" rates as go and a rarer homograph never hides the common word. Phrases match exactly.
 * Null = not in the list (C1+ / rare).
 */
export function cefrOf(term: string, data: CefrData, lemma?: LemmaData): CefrHit | null {
  const w = term.toLowerCase().trim();
  const candidates = /\s/.test(w) ? [w] : [w, lemma ? baseForm(w, lemma) : null, ...stems(w)];
  let best: CefrHit | null = null;
  for (const c of candidates) {
    const hit = c ? data.get(c) : undefined;
    if (hit && (!best || hit.order < best.order)) best = hit;
  }
  return best;
}
