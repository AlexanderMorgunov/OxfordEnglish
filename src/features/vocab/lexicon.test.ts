import { test, expect } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import type { SrsCard, WordStatus, WordTranslation } from '@/db/db';
import { buildLexicon, matchesFilter, sortLexicon } from './lexicon';

const card = (over: Partial<SrsCard>): SrsCard => {
  const c = createEmptyCard(new Date(1_700_000_000_000));
  return {
    id: 'word:x',
    kind: 'word',
    front: 'x',
    back: 'x',
    tags: [],
    due: c.due,
    card: c,
    ...over,
  };
};
const status = (over: Partial<WordStatus>): WordStatus => ({
  word: 'x',
  status: 'learning',
  firstSeenAt: 1,
  encounters: 1,
  ...over,
});

test('a learning word merges its status row and card into one entry', () => {
  const lex = buildLexicon({
    statuses: [status({ word: 'travel', status: 'learning', firstSeenAt: 500 })],
    cards: [card({ id: 'word:travel', front: 'travel', back: 'путешествовать' })],
    translations: [],
  });
  expect(lex).toHaveLength(1);
  expect(lex[0]).toMatchObject({
    display: 'travel',
    status: 'learning',
    hasCard: true,
    translation: 'путешествовать',
    sortAt: 500, // firstSeenAt wins over the card's due
  });
});

test('a known word with no card, and a card with no status, both appear', () => {
  const lex = buildLexicon({
    statuses: [status({ word: 'apple', status: 'known', firstSeenAt: 10 })],
    cards: [card({ id: 'word:orange', front: 'orange', back: 'апельсин' })],
    translations: [],
  });
  const byWord = Object.fromEntries(lex.map((e) => [e.display, e]));
  expect(byWord['apple']).toMatchObject({ status: 'known', hasCard: false });
  expect(byWord['orange']).toMatchObject({ hasCard: true });
  expect(byWord['orange']!.status).toBeUndefined();
});

test('error cards are excluded; phrases are kept', () => {
  const lex = buildLexicon({
    statuses: [],
    cards: [
      card({ id: 'err:1', kind: 'phrase', front: 'wrong answer', back: 'x', fromError: true }),
      card({ id: 'phrase:took a train', kind: 'phrase', front: 'took a train', back: 'сел на поезд' }),
    ],
    translations: [],
  });
  expect(lex).toHaveLength(1);
  expect(lex[0]).toMatchObject({ display: 'took a train', kind: 'phrase' });
});

test('translation falls back to the cache when the card back equals the front', () => {
  const tr: WordTranslation[] = [{ word: 'run', ru: 'бежать', source: 'mymemory' }];
  const lex = buildLexicon({
    statuses: [],
    cards: [card({ id: 'word:run', front: 'run', back: 'run' })],
    translations: tr,
  });
  expect(lex[0]!.translation).toBe('бежать');
});

test('filters: all hides ignored; buckets are exclusive where expected', () => {
  const lex = buildLexicon({
    statuses: [
      status({ word: 'a', status: 'learning' }),
      status({ word: 'b', status: 'known' }),
      status({ word: 'c', status: 'ignored' }),
    ],
    cards: [
      card({ id: 'word:d', front: 'd', back: 'д' }), // saved, no status
      card({ id: 'phrase:e f', kind: 'phrase', front: 'e f', back: 'е ф' }),
    ],
    translations: [],
  });
  expect(lex.filter((e) => matchesFilter(e, 'all')).map((e) => e.display).sort()).toEqual(['a', 'b', 'd', 'e f']);
  expect(lex.filter((e) => matchesFilter(e, 'saved')).map((e) => e.display)).toEqual(['d']);
  expect(lex.filter((e) => matchesFilter(e, 'phrases')).map((e) => e.display)).toEqual(['e f']);
  expect(lex.filter((e) => matchesFilter(e, 'ignored')).map((e) => e.display)).toEqual(['c']);
});

test('sort: alpha and recent', () => {
  const lex = buildLexicon({
    statuses: [status({ word: 'zebra', firstSeenAt: 100 }), status({ word: 'apple', firstSeenAt: 200 })],
    cards: [],
    translations: [],
  });
  expect(sortLexicon(lex, 'alpha').map((e) => e.display)).toEqual(['apple', 'zebra']);
  expect(sortLexicon(lex, 'recent').map((e) => e.display)).toEqual(['apple', 'zebra']); // 200 > 100
});
