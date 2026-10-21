import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { AiTaskRequestSchema } from '@/features/account/contract';
import { SenseTermSchema, exampleContainsTerm, parseWordSenses, wordSensesMessages } from './word-senses';

const sense = { partOfSpeech: 'noun', translation: 'берег', distinction: 'Край реки', example: 'We sat on the river bank.' };
test('client and server request, result, prompts and budgets remain exact mirrors', () => {
  const root = join(__dirname, '..', '..', '..');
  expect(readFileSync(join(root, 'src/features/ai/word-senses.ts'), 'utf8').replace(/\r\n/g, '\n'))
    .toBe(readFileSync(join(root, 'server/src/wordSenses.ts'), 'utf8').replace(/\r\n/g, '\n'));
  const server = readFileSync(join(root, 'server/src/contract.ts'), 'utf8');
  expect(server).toContain("z.object({ task: z.literal('wordSenses'), term: SenseTermSchema })");
  expect(AiTaskRequestSchema.parse({ task: 'wordSenses', term: ' Take\n care ' })).toEqual({ task: 'wordSenses', term: 'Take care' });
});
test('normalizes only lookup input and keeps it JSON data in the prompt', () => {
  expect(SenseTermSchema.parse('  Can’t  ')).toBe("Can't");
  expect(wordSensesMessages('take care')[1]?.content).toBe('{"term":"take care"}');
});
test.each(['', 'банк', 'bank<script>', 'a'.repeat(81), ' '.repeat(161), 'hello?', '123', 'a'.repeat(159)+' x'])('rejects unsupported request %s', term => {
  expect(SenseTermSchema.safeParse(term).success).toBe(false);
});
test('accepts one genuine sense, multiple distinct meanings and an honest empty result', () => {
  expect(parseWordSenses(JSON.stringify({ senses: [sense] }), 'bank')).toEqual([sense]);
  expect(parseWordSenses(JSON.stringify({ senses: [] }), 'bank')).toEqual([]);
  expect(parseWordSenses(JSON.stringify({ senses: [sense, { ...sense, translation: 'банк', distinction: 'Финансовое учреждение', example: 'I went to the bank today.' }] }), 'bank')).toHaveLength(2);
});
test.each([
  'not json', '```json\n{"senses":[]}\n```', JSON.stringify({ senses: [], extra: true }), ' '.repeat(4097),
  JSON.stringify({ senses: [sense, sense] }), JSON.stringify({ senses: Array(5).fill(sense) }),
  JSON.stringify({ senses: [{ ...sense, translation: 'river' }] }),
  JSON.stringify({ senses: [{ ...sense, distinction: 'a'.repeat(101) }] }),
  JSON.stringify({ senses: [{ ...sense, example: 'A river is near the house.' }] }),
  JSON.stringify({ senses: [{ ...sense, example: 'A banker lives here.' }] }),
  JSON.stringify({ senses: [{ ...sense, example: 'Мы сидели на bank у реки.' }] }),
  JSON.stringify({ senses: [{ ...sense, partOfSpeech: 'made-up' }] }),
  JSON.stringify({ senses: [{ ...sense, extra: true }] }),
])('rejects malformed or misleading structural output %#', raw => {
  expect(() => parseWordSenses(raw, 'bank')).toThrow('Invalid word senses');
});
test('same Russian equivalent may have distinct parts of speech or distinctions', () => {
  expect(parseWordSenses(JSON.stringify({ senses: [sense, { ...sense, distinction: 'Край озера' }] }), 'bank')).toHaveLength(2);
});
test('examples require exact whole targets with agreed apostrophe and whitespace handling', () => {
  expect(exampleContainsTerm("I can’t wait.", "can't")).toBe(true);
  expect(exampleContainsTerm('Please TAKE   care.', 'take care')).toBe(true);
  expect(exampleContainsTerm('I cannot wait.', 'can')).toBe(false);
  expect(exampleContainsTerm("I can't wait.", 'can')).toBe(false);
  expect(exampleContainsTerm('A run-on sentence.', 'run')).toBe(false);
  expect(exampleContainsTerm('Use bank123.', 'bank')).toBe(false);
  expect(exampleContainsTerm('Use _bank_.', 'bank')).toBe(false);
  expect(exampleContainsTerm('Use ébank.', 'bank')).toBe(false);
});
