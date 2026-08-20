import type { SrsCard, WordStatus, WordTranslation } from '@/db/db';

export type LexiconKind = 'word' | 'phrase';

export type LexiconEntry = {
  /** Dedupe key: the lowercased front. */
  key: string;
  /** Original-case term to show. */
  display: string;
  kind: LexiconKind;
  status?: 'learning' | 'known' | 'ignored';
  /** SRS card id, when this term is in review (enables remove-from-review). */
  cardId?: string;
  hasCard: boolean;
  /** Next review time (ms), only when a card exists. */
  due?: number;
  context?: string;
  translation?: string;
  /** Sort signal for "recent": firstSeenAt if known, else a new card's due (== its add time). */
  sortAt: number;
};

/**
 * Merge the three vocab stores into one personal lexicon, keyed by lowercased term.
 * Error cards (`fromError`) are excluded — they live in Review, not the word bank.
 * Translation resolves: a card's back (when it differs from the front) → the translations
 * cache → none. `unknown` statuses are never written, so they're skipped.
 */
export function buildLexicon(input: {
  statuses: WordStatus[];
  cards: SrsCard[];
  translations: WordTranslation[];
}): LexiconEntry[] {
  const tr = new Map(input.translations.map((t) => [t.word, t.ru]));
  const byKey = new Map<string, LexiconEntry>();

  for (const c of input.cards) {
    if (c.fromError) continue;
    const kind: LexiconKind = c.kind === 'phrase' ? 'phrase' : 'word';
    const key = c.front.toLowerCase();
    const backIsTranslation = Boolean(c.back) && c.back !== c.front;
    const translation = backIsTranslation
      ? c.back
      : tr.get(kind === 'phrase' ? c.front : key);
    const dueMs = (c.due instanceof Date ? c.due : new Date(c.due)).getTime();
    byKey.set(key, {
      key,
      display: c.front,
      kind,
      cardId: c.id,
      hasCard: true,
      due: dueMs,
      context: c.contextSentence || undefined,
      translation: translation || undefined,
      sortAt: dueMs, // a never-reviewed card's due == its add time; degrades after first grade
    });
  }

  for (const s of input.statuses) {
    if (s.status === 'unknown') continue;
    const key = s.word.toLowerCase();
    const existing = byKey.get(key);
    if (existing) {
      existing.status = s.status;
      if (s.firstSeenAt) existing.sortAt = s.firstSeenAt;
      if (!existing.translation) existing.translation = tr.get(key) || undefined;
    } else {
      byKey.set(key, {
        key,
        display: s.word,
        kind: 'word',
        status: s.status,
        hasCard: false,
        translation: tr.get(key) || undefined,
        sortAt: s.firstSeenAt || 0,
      });
    }
  }

  return [...byKey.values()];
}

export type LexiconFilter = 'all' | 'learning' | 'known' | 'saved' | 'phrases' | 'ignored';

/** `all` hides ignored (LingQ pattern); every other filter is an explicit bucket. */
export function matchesFilter(e: LexiconEntry, f: LexiconFilter): boolean {
  switch (f) {
    case 'all':
      return e.status !== 'ignored';
    case 'learning':
      return e.status === 'learning';
    case 'known':
      return e.status === 'known';
    case 'saved':
      return e.hasCard && e.status === undefined && e.kind === 'word';
    case 'phrases':
      return e.kind === 'phrase';
    case 'ignored':
      return e.status === 'ignored';
  }
}

export type LexiconSort = 'recent' | 'alpha' | 'due';

export function sortLexicon(entries: LexiconEntry[], sort: LexiconSort): LexiconEntry[] {
  const out = [...entries];
  if (sort === 'alpha') {
    out.sort((a, b) => a.display.localeCompare(b.display));
  } else if (sort === 'due') {
    out.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  } else {
    out.sort((a, b) => b.sortAt - a.sortAt);
  }
  return out;
}
