import { checkAnswer, normalizeAnswer } from './normalize';

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
