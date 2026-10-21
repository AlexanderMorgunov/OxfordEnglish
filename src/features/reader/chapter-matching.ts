import type { ChapterTerm } from './chapter-vocabulary';
import { shuffle } from '@/features/practice/shuffle';

export type PlayableTerm = ChapterTerm & { answer: string };
export const normalizedAnswer = (answer: string): string => answer.trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru');

export function playableTerms(terms: ChapterTerm[]): PlayableTerm[] {
  const fronts = new Set<string>();
  return terms.filter((term): term is PlayableTerm => {
    const front = term.front.trim().toLowerCase();
    if (!term.answer?.trim() || fronts.has(front)) return false;
    fronts.add(front);
    return true;
  });
}

export function matchingRounds(terms: PlayableTerm[]): PlayableTerm[][] {
  const pool = shuffle(terms);
  const rounds: PlayableTerm[][] = [];
  while (pool.length) rounds.push(pool.splice(0, pool.length === 5 ? 5 : 4));
  return rounds;
}
