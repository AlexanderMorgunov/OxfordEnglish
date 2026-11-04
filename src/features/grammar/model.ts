import type { GrammarArticle } from '@/content/schema';

export const CATEGORIES = [
  { id: 'all', ru: 'Все темы', en: 'All topics' },
  { id: 'tenses', ru: 'Времена', en: 'Tenses' },
  { id: 'verbs', ru: 'Глаголы', en: 'Verbs' },
  { id: 'words', ru: 'Слова и количество', en: 'Words and quantity' },
  { id: 'sentence', ru: 'Построение фразы', en: 'Sentence structure' },
  { id: 'other', ru: 'Другие темы', en: 'Other topics' },
] as const;
type Category = (typeof CATEGORIES)[number]['id'];

const GROUPS: Record<Exclude<Category, 'all' | 'other'>, string[]> = {
  tenses: [
    'present-simple',
    'present-continuous',
    'present-vs-continuous',
    'past-simple',
    'past-continuous',
    'present-perfect',
    'past-perfect',
    'narrative-tenses',
    'present-perfect-continuous',
    'present-perfect-signals',
    'perfect-vs-past',
    'future-forms',
    'future-forms-extended',
  ],
  verbs: [
    'verb-be',
    'have-got',
    'modals-can',
    'imperatives',
    'modals-obligation',
    'might-may',
    'modals-deduction',
    'past-modals',
    'gerund-infinitive',
    'used-to',
  ],
  words: [
    'articles',
    'plurals',
    'pronouns',
    'possessives',
    'demonstratives',
    'prepositions-place',
    'some-any',
    'indefinite-pronouns',
    'comparatives',
    'too-enough',
    'quantifiers-b1',
  ],
  sentence: [
    'there-is',
    'future-time-clauses',
    'conditionals-0-1',
    'relative-clauses',
    'so-neither-tags',
    'passive',
    'reported-speech',
    'second-conditional',
    'wish',
    'reported-questions',
    'non-defining-clauses',
    'passive-extended',
    'passive-report',
    'third-conditional',
  ],
};
const ALIASES: Record<string, string> = {
  'present-simple': 'настоящее простое привычки',
  'past-simple': 'прошедшее простое прошлое',
  'present-continuous': 'настоящее длительное сейчас',
  'past-continuous': 'прошедшее длительное прошлое',
  'present-perfect': 'настоящее совершенное опыт результат',
  'past-perfect': 'прошедшее совершенное предпрошедшее прошлое',
  'present-perfect-continuous': 'настоящее совершенное длительное',
  'narrative-tenses': 'прошедшее прошлое рассказ повествование',
  articles: 'артикль артикли',
  plurals: 'множественное число существительное',
  'verb-be': 'быть am is are',
  'have-got': 'иметь есть has have got',
  'conditionals-0-1': 'условные предложения если нулевое первое',
  'second-conditional': 'условные предложения если бы второе',
  'third-conditional': 'условные предложения если бы третье прошлое',
  wish: 'если бы хотелось сожаление',
  passive: 'пассив страдательный залог',
  'reported-speech': 'косвенная речь',
  'reported-questions': 'косвенные вопросы',
  'gerund-infinitive': 'герундий инфинитив ing',
  'relative-clauses': 'относительные придаточные который',
  'non-defining-clauses': 'относительные придаточные запятые',
  'modals-can': 'модальные возможность способность уметь',
  'modals-obligation': 'модальные должен обязан совет',
  'modals-deduction': 'модальные вывод предположение',
  'past-modals': 'модальные прошлое прошедшее сожаление',
};
export function categoryOf(id: string): Category {
  return (
    (Object.entries(GROUPS).find(([, ids]) => ids.includes(id))?.[0] as
      Category | undefined) ?? 'other'
  );
}
export const normalizeSearch = (value: string) =>
  value.toLocaleLowerCase().replaceAll('ё', 'е').replace(/[’‘]/g, "'").trim();
export function matchesGrammar(
  article: GrammarArticle,
  query: string
): boolean {
  const text = normalizeSearch(
    [
      article.id,
      article.title.en,
      article.title.ru,
      article.summary.en,
      article.summary.ru,
      ALIASES[article.id],
      ...article.blocks.flatMap((block) => [
        block.heading?.en,
        block.heading?.ru,
        ...(block.examples?.flatMap((example) => [example.en, example.ru]) ??
          []),
      ]),
    ].join(' ')
  );
  return normalizeSearch(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word));
}
export const grammarHref = (id: string | null, source: string | null) =>
  `${id ? `/grammar/${encodeURIComponent(id)}` : '/grammar'}${source ? `?from=${encodeURIComponent(source)}` : ''}`;
