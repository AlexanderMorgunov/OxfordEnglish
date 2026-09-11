import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IRREGULAR_TABLE, formsText, irregularForms } from './irregular';
import type { LemmaData } from './lemma';

const lemmaMap = (
  JSON.parse(readFileSync(resolve(process.cwd(), 'public/reader/en-lemma.json'), 'utf8')) as {
    map: Record<string, string[]>;
  }
).map;

// Valid forms that lemma.en doesn't list under that base.
const MISSING_OK = new Set<string>([
  'babysit:babysat',
  'sneak:snuck',
  'person:people',
  'ill:worse',
  'ill:worst',
  'little:less',
  'little:least',
  'much:more',
  'much:most',
  'old:elder',
  'old:eldest',
  'well:best',
]);

function lemmaOf(map: Record<string, string[]>): LemmaData {
  const byForm = new Map<string, string>();
  const lemmas = new Set<string>();
  for (const [lemma, forms] of Object.entries(map)) {
    lemmas.add(lemma);
    for (const f of forms) if (!byForm.has(f)) byForm.set(f, lemma);
  }
  return { byForm, lemmas };
}

const bases = (word: string, lemma?: LemmaData) => irregularForms(word, lemma).map((f) => f.base);

describe('irregular table', () => {
  it('every form is attested in lemma.en for its base (catches typos)', () => {
    let checked = 0;
    const missing: string[] = [];
    for (const f of IRREGULAR_TABLE) {
      const known = lemmaMap[f.base];
      if (!known) continue;
      checked += 1;
      for (const v of f.parts.slice(1).flat()) {
        if (v !== f.base && !known.includes(v) && !MISSING_OK.has(`${f.base}:${v}`)) missing.push(`${f.base}:${v}`);
      }
    }
    expect(missing).toEqual([]);
    expect(checked).toBeGreaterThan(150);
  });

  it('keeps past and participle in their slots', () => {
    const line = (w: string) => formsText(irregularForms(w)[0]!);
    expect(line('go')).toBe('go — went — gone');
    expect(line('begin')).toBe('begin — began — begun');
    expect(line('drink')).toBe('drink — drank — drunk');
    expect(line('swim')).toBe('swim — swam — swum');
    expect(line('write')).toBe('write — wrote — written');
    expect(line('ring')).toBe('ring — rang — rung');
    expect(line('see')).toBe('see — saw — seen');
    expect(line('get')).toBe('get — got — got/gotten');
    expect(line('learn')).toBe('learn — learned/learnt — learned/learnt');
    expect(line('put')).toBe('put — put — put');
    expect(line('child')).toBe('child — children');
    expect(line('good')).toBe('good — better — best');
  });
});

describe('irregularForms', () => {
  it('resolves a form to its base set', () => {
    expect(bases('went')).toEqual(['go']);
    expect(bases('Gone')).toEqual(['go']);
    expect(bases('saw')).toEqual(['see']);
    expect(bases('children')).toEqual(['child']);
    expect(bases('better')).toEqual(['good', 'well']);
  });

  it('a base that is also a form shows its own set first', () => {
    const forms = irregularForms('lay');
    expect(forms.map(formsText)).toEqual(['lay — laid — laid', 'lie — lay — lain']);
    expect(forms[1]!.sense?.en).toBe('lie down');
  });

  it('lie carries both senses', () => {
    expect(irregularForms('lie').map(formsText)).toEqual(['lie — lay — lain', 'lie — lied — lied']);
  });

  it('resolves inflections outside the table via the lemma list or suffix rules', () => {
    const lemma = lemmaOf({ lie: ['lying', 'lies'], go: ['going', 'goes'] });
    expect(bases('lying', lemma)).toEqual(['lie', 'lie']);
    expect(bases('going', lemma)).toEqual(['go']);
    expect(bases('cutting')).toEqual(['cut']);
    expect(bases('is')).toEqual(['be']);
  });

  it('regular words have none', () => {
    expect(irregularForms('walk')).toEqual([]);
    expect(irregularForms('walked')).toEqual([]);
    expect(irregularForms('table')).toEqual([]);
  });

  it('does not read verb -s forms as irregular plurals', () => {
    expect(bases('lives')).not.toContain('life');
    expect(bases('leaves')).not.toContain('leaf');
  });
});
