import { stems } from '@/features/reader/difficulty';

/**
 * Base-form (lemma) lookup for the vocabulary: shows a word's dictionary form ("went" → "go") and
 * recognizes a saved word's inflections inside its source sentence (for highlighting). Backed by a
 * lazy-loaded top-15k `lemma → forms` list (`public/reader/en-lemma.json`, MIT `skywind3000/lemma.en`,
 * NOT precached) inverted to `form → lemma` at load; the regular long tail falls back to the shipped
 * rule-based `stems()`. So common + irregular words are exact, rare regulars still work via rules.
 */
export type LemmaData = { byForm: Map<string, string>; lemmas: Set<string> };

const EMPTY: LemmaData = { byForm: new Map(), lemmas: new Set() };
let dataPromise: Promise<LemmaData> | null = null;

/** Load + invert the lemma list once (form → lemma map + the set of base forms). Best-effort. */
export function loadLemma(): Promise<LemmaData> {
  if (!dataPromise) {
    const url = `${import.meta.env.BASE_URL}reader/en-lemma.json`;
    dataPromise = fetch(url)
      .then((r) => r.json())
      .then((j: { map: Record<string, string[]> }) => {
        const byForm = new Map<string, string>();
        const lemmas = new Set<string>();
        for (const [lemma, forms] of Object.entries(j.map)) {
          lemmas.add(lemma);
          for (const f of forms) if (!byForm.has(f)) byForm.set(f, lemma);
        }
        return { byForm, lemmas };
      })
      .catch(() => EMPTY);
  }
  return dataPromise;
}

/** The dictionary base form of a surface word, or null when it IS a base or can't be resolved confidently. */
export function baseForm(word: string, d: LemmaData): string | null {
  const w = word.toLowerCase();
  const viaList = d.byForm.get(w);
  if (viaList && viaList !== w) return viaList;
  if (d.lemmas.has(w)) return null; // the word is already a base form
  // Rare-word fallback: a stems() candidate that the list recognizes as a real base.
  for (const s of stems(w)) if (s !== w && (d.lemmas.has(s) || d.byForm.has(s))) return d.byForm.get(s) ?? s;
  return null;
}

/** Whether a surface `word` (from a sentence) is a form of the saved `term` — for context highlighting. */
export function isFormOf(word: string, term: string, d: LemmaData): boolean {
  const w = word.toLowerCase();
  const t = term.toLowerCase();
  if (w === t) return true;
  if (d.byForm.get(w) === t) return true; // word's lemma is the saved term
  if (baseForm(w, d) === t) return true;
  return stems(w).includes(t); // rule-based tail (covers irregulars in stems' own map + regulars)
}
