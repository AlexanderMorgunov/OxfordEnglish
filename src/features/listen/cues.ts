export function activeCueIndex(
  time: number,
  cues: { start: number; end: number }[]
): number {
  return cues.findIndex((c) => time >= c.start && time < c.end);
}

export type DiffPart = { text: string; ok: boolean };

/** Dictation is judged by what you heard, not spelling niceties: fold away case and ALL punctuation
 *  (commas, quotes, apostrophes…) so "Den, why…" accepts "den why". */
const foldSpoken = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Positional word diff for the dictation mode — each expected word marked ok/miss. */
export function diffWords(expected: string, actual: string): DiffPart[] {
  const exp = expected.trim().split(/\s+/).filter(Boolean);
  const act = actual.trim().split(/\s+/).filter(Boolean);
  return exp.map((word, i) => ({
    text: word,
    ok: foldSpoken(act[i] ?? '') === foldSpoken(word),
  }));
}

export function dictationCorrect(expected: string, actual: string): boolean {
  const parts = diffWords(expected, actual);
  const actLen = actual.trim().split(/\s+/).filter(Boolean).length;
  return parts.length === actLen && parts.every((p) => p.ok);
}
