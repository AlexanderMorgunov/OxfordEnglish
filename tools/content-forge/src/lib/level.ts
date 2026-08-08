import { existsSync, readFileSync } from 'node:fs';
import { tokenize, uniqueWords } from './text.ts';
import { WORDLISTS_PATH } from './paths.ts';

type Wordlists = {
  ngsl: Record<string, number>;
  cefrj: Record<string, string>;
};

let lists: Wordlists | null = null;

function load(): Wordlists {
  if (lists) return lists;
  if (!existsSync(WORDLISTS_PATH)) {
    throw new Error(
      `wordlists missing at ${WORDLISTS_PATH} — run "npm run fetch:wordlists"`
    );
  }
  lists = JSON.parse(readFileSync(WORDLISTS_PATH, 'utf8')) as Wordlists;
  return lists;
}

export function ngslRank(word: string): number | null {
  return load().ngsl[word.toLowerCase()] ?? null;
}

export function cefrjLevel(word: string): string | null {
  return load().cefrj[word.toLowerCase()] ?? null;
}

export type LevelReport = {
  totalWords: number;
  offenders: { word: string; rank: number | null; cefr: string | null }[];
  offenderShare: number;
  averageSentenceLength: number;
  verdict: 'fits' | 'too hard — rewrite using the listed words as the problem set';
};

/** A2 ≈ rank under 1500, B1 ≈ under 2800. Returns offending words so the caller rewrites. */
export function levelCheck(text: string, maxRank = 1500): LevelReport {
  const words = uniqueWords(text);
  const offenders = words
    .map((word) => ({ word, rank: ngslRank(word), cefr: cefrjLevel(word) }))
    .filter((o) => o.rank === null || o.rank > maxRank)
    .sort((a, b) => (b.rank ?? 1e9) - (a.rank ?? 1e9))
    .slice(0, 40);

  const sentences = text.split(/[.!?]+/).filter((s) => s.trim());
  const totalTokens = tokenize(text).length;
  const avgLen = sentences.length ? Math.round(totalTokens / sentences.length) : 0;
  const share = +(offenders.length / Math.max(words.length, 1)).toFixed(3);

  return {
    totalWords: words.length,
    offenders,
    offenderShare: share,
    averageSentenceLength: avgLen,
    verdict:
      share < 0.1 && avgLen <= 14
        ? 'fits'
        : 'too hard — rewrite using the listed words as the problem set',
  };
}
