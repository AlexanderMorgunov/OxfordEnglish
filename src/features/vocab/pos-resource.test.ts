import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { indexPartsOfSpeech } from './usePartOfSpeech';

test('the shipped POS map preserves ambiguous readings and the original dataset attribution', () => {
  const source = JSON.parse(readFileSync('public/reader/en-pos.json', 'utf8')) as { meta: { citation: string }; partsOfSpeech: unknown };
  const cefr = JSON.parse(readFileSync('public/reader/en-cefr.json', 'utf8')) as { meta: { citation: string } };
  const data = indexPartsOfSpeech(source.partsOfSpeech);
  expect(source.meta.citation).toBe(cefr.meta.citation);
  expect(data.get('go')).toContain('verb');
  expect(data.get('record')).toEqual(['noun', 'verb']);
  expect(data.get('information')).toEqual(['noun']);
  expect(data.get('main')).toEqual(['adjective']);
});

test('untrusted POS metadata is filtered rather than inventing a reading', () => {
  const data = indexPartsOfSpeech({ Record: ['noun', 'noun', 'verb', 'not a part of speech'], test: 'verb', invalid: [null, 2] });
  expect(data.get('record')).toEqual(['noun', 'verb']);
  expect(data.has('test')).toBe(false);
  expect(data.has('invalid')).toBe(false);
});
