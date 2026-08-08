import { normalizeAnswer } from '@/features/practice/normalize';

export function activeCueIndex(
  time: number,
  cues: { start: number; end: number }[]
): number {
  return cues.findIndex((c) => time >= c.start && time < c.end);
}

export type DiffPart = { text: string; ok: boolean };

/** Positional word diff for the dictation mode — each expected word marked ok/miss. */
export function diffWords(expected: string, actual: string): DiffPart[] {
  const exp = expected.trim().split(/\s+/).filter(Boolean);
  const act = actual.trim().split(/\s+/).filter(Boolean);
  return exp.map((word, i) => ({
    text: word,
    ok: normalizeAnswer(act[i] ?? '') === normalizeAnswer(word),
  }));
}

export function dictationCorrect(expected: string, actual: string): boolean {
  const parts = diffWords(expected, actual);
  const actLen = actual.trim().split(/\s+/).filter(Boolean).length;
  return parts.length === actLen && parts.every((p) => p.ok);
}
