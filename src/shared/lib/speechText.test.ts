/**
 * Several platform voices pronounce punctuation instead of performing it — a quote becomes the word
 * "quote", an ellipsis becomes "dot dot dot". In a novel, where dialogue is nothing but quotes, that is
 * most of what the reader hears.
 *
 * The trap is over-correcting: `. , ; : ! ?` are what give a voice its pauses and intonation, so
 * stripping punctuation wholesale makes the reading run together, which is worse than the problem.
 */
import { test, expect } from 'vitest';
import { forSpeech } from './speechText';

test('quotes go, in every shape a pasted book brings', () => {
  expect(forSpeech('"So, having the wedding in June would be great, right?"')).toBe(
    'So, having the wedding in June would be great, right?'
  );
  expect(forSpeech('“Oh, thanks,” he said.')).toBe('Oh, thanks, he said.');
  expect(forSpeech('«Привет», — сказал он.')).toBe('Привет, сказал он.');
});

test('an ellipsis becomes the pause it stood for, not three words', () => {
  expect(forSpeech('and now, of course, it is too late for this year, which is why . . .')).toBe(
    'and now, of course, it is too late for this year, which is why,'
  );
  expect(forSpeech('I felt… dizzy.')).toBe('I felt, dizzy.');
  expect(forSpeech('Wait...what?')).toBe('Wait, what?');
});

test('the punctuation a voice performs is left alone', () => {
  // Removing these is the over-correction: without them the voice runs every clause together.
  const line = 'Yet, from the very beginning, I was never his first choice; I was just someone to fool around with!';
  expect(forSpeech(line)).toBe(line);
  expect(forSpeech('Whose bag is this? It is hers.')).toBe('Whose bag is this? It is hers.');
});

test('an apostrophe inside a word survives; one used as a quote does not', () => {
  // `dont` and `couldnt` would be mispronounced, so this distinction is the whole reason the rule is
  // about word boundaries rather than about the character.
  expect(forSpeech("I don't know what he'd said.")).toBe("I don't know what he'd said.");
  expect(forSpeech("'So it goes,' she said.")).toBe('So it goes, she said.');
  expect(forSpeech('He said ‘maybe’ twice.')).toBe('He said maybe twice.');
});

test('a dash becomes a pause, but a hyphenated word stays one word', () => {
  expect(forSpeech('Either I was slow—or there was something off about him.')).toBe(
    'Either I was slow, or there was something off about him.'
  );
  expect(forSpeech('a well-known long-term plan')).toBe('a well-known long-term plan');
  expect(forSpeech('she left - and never came back')).toBe('she left, and never came back');
});

test('brackets become a pause and markup symbols are dropped', () => {
  expect(forSpeech('He (finally) agreed.')).toBe('He, finally, agreed.');
  expect(forSpeech('a *bold* claim')).toBe('a bold claim');
  expect(forSpeech('see chapter [4]')).toBe('see chapter, 4,');
});

test('the substitutions never stack into a stutter', () => {
  // Each rule is reasonable alone; together they can leave `, ,` or `,.` where the voice would pause
  // twice or read a comma before a full stop.
  expect(forSpeech('"…" — he said.')).toBe('he said.');
  expect(forSpeech('Well... — what now?')).toBe('Well, what now?');
  expect(forSpeech('(...)')).toBe('');
});

test('nothing to say comes back empty rather than as a silent utterance', () => {
  // Some engines never fire their end event for a punctuation-only utterance, which stalls a passage
  // part-way through instead of skipping one chunk.
  expect(forSpeech('"…"')).toBe('');
  expect(forSpeech('***')).toBe('');
  expect(forSpeech('   ')).toBe('');
  expect(forSpeech('— — —')).toBe('');
  // These reach the end of the chain still holding a mark — the earlier ones are already empty by then,
  // so without these the final "is there anything to say" check is never the thing being tested.
  expect(forSpeech('!!!')).toBe('');
  expect(forSpeech('.')).toBe('');
  expect(forSpeech('?!')).toBe('');
});

test('ordinary text is returned untouched', () => {
  expect(forSpeech('The Odyssey of Captain Blood was derived from various sources.')).toBe(
    'The Odyssey of Captain Blood was derived from various sources.'
  );
  expect(forSpeech('sources')).toBe('sources');
});
