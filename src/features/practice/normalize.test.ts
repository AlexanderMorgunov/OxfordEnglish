import { checkAnswer, matchCommonError, normalizeAnswer } from './normalize';

test('trims and collapses whitespace', () => {
  expect(normalizeAnswer('  deployed   the  app ')).toBe('deployed the app');
});

test('is case-insensitive by default, case-sensitive on request', () => {
  expect(normalizeAnswer('Deployed')).toBe('deployed');
  expect(normalizeAnswer('Deployed', { caseSensitive: true })).toBe('Deployed');
});

test('folds smart apostrophes and quotes', () => {
  expect(normalizeAnswer('don’t')).toBe(normalizeAnswer("don't"));
  expect(normalizeAnswer('“ci”')).toBe(normalizeAnswer('"ci"'));
});

test('folds a backtick or acute typed instead of an apostrophe', () => {
  expect(normalizeAnswer('don`t')).toBe(normalizeAnswer("don't"));
  expect(normalizeAnswer('don´t')).toBe(normalizeAnswer("don't"));
  expect(checkAnswer('We don`t have enough cups', ["We don't have enough cups."])).toBe(true);
});

test('drops trailing sentence punctuation', () => {
  expect(normalizeAnswer('Yesterday I fixed the bug.')).toBe(
    'yesterday i fixed the bug'
  );
  expect(normalizeAnswer('Did the tests pass?')).toBe('did the tests pass');
});

test('checkAnswer accepts any listed variant', () => {
  const answers = ['Yesterday I fixed the bug.', 'I fixed the bug yesterday.'];
  expect(checkAnswer('  i fixed the bug yesterday  ', answers)).toBe(true);
  expect(checkAnswer("Yesterday I fixed the bug", answers)).toBe(true);
  expect(checkAnswer('I broke the bug yesterday', answers)).toBe(false);
});

test('checkAnswer rejects empty input', () => {
  expect(checkAnswer('   ', ['deployed'])).toBe(false);
});

test('caseSensitive gap-fill distinguishes case', () => {
  expect(checkAnswer('ci', ['CI'], { caseSensitive: true })).toBe(false);
  expect(checkAnswer('CI', ['CI'], { caseSensitive: true })).toBe(true);
});

test('matchCommonError matches a trigger regardless of case/spacing', () => {
  const errors = [
    { match: ['usually i'], explanation: { en: 'Put the subject before the adverb.' } },
  ];
  // different capitalization + extra spaces still matches (same folding as checkAnswer)
  expect(matchCommonError('Usually  I get up early', errors)?.explanation.en).toBe(
    'Put the subject before the adverb.'
  );
  expect(matchCommonError('I usually get up early', errors)).toBeUndefined();
  expect(matchCommonError('anything', undefined)).toBeUndefined();
  expect(matchCommonError('   ', errors)).toBeUndefined();
});
