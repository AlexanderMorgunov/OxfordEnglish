import { describe, it, expect } from 'vitest';
import { baseForm, isFormOf, type LemmaData } from './lemma';

/** Build a small in-memory lemma set (no fetch) the way loadLemma() would. */
function make(map: Record<string, string[]>): LemmaData {
  const byForm = new Map<string, string>();
  const lemmas = new Set<string>();
  for (const [lemma, forms] of Object.entries(map)) {
    lemmas.add(lemma);
    for (const f of forms) if (!byForm.has(f)) byForm.set(f, lemma);
  }
  return { byForm, lemmas };
}

const d = make({
  go: ['going', 'went', 'gone', 'goes'],
  city: ['cities'],
  walk: ['walked', 'walking', 'walks'],
  good: ['best', 'better'],
});

describe('baseForm', () => {
  it('resolves an inflected form to its dictionary base', () => {
    expect(baseForm('went', d)).toBe('go');
    expect(baseForm('cities', d)).toBe('city');
    expect(baseForm('walked', d)).toBe('walk');
    expect(baseForm('better', d)).toBe('good');
    expect(baseForm('WENT', d)).toBe('go'); // case-insensitive
  });
  it('returns null when the word IS a base form', () => {
    expect(baseForm('go', d)).toBeNull();
    expect(baseForm('walk', d)).toBeNull();
  });
  it('returns null for an unknown word (degrades gracefully)', () => {
    expect(baseForm('xyzzy', d)).toBeNull();
  });
});

describe('isFormOf (context highlighting)', () => {
  it('matches a saved term to its inflections in a sentence', () => {
    expect(isFormOf('went', 'go', d)).toBe(true);
    expect(isFormOf('goes', 'go', d)).toBe(true);
    expect(isFormOf('go', 'go', d)).toBe(true);
    expect(isFormOf('cities', 'city', d)).toBe(true);
  });
  it('does not over-match unrelated words', () => {
    expect(isFormOf('cat', 'go', d)).toBe(false);
    expect(isFormOf('gone', 'city', d)).toBe(false);
  });
  it('falls back to stems() for irregulars not in the loaded list', () => {
    // "mouse"/"mice" isn't in `d`, but stems() knows the irregular.
    expect(isFormOf('mice', 'mouse', make({}))).toBe(true);
    expect(isFormOf('ran', 'run', make({}))).toBe(true);
  });
});
