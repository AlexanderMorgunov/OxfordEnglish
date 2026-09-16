import { test, expect, beforeEach } from 'vitest';
import { inLensOutput } from './lens-output';

/**
 * Reported from the reader: selecting words inside a Russian translation opened the phrase bar and
 * offered to translate them — "но я был у → но я был у". The lens result is our own text; nothing in it
 * is a word of the book to look up, save or translate.
 */
beforeEach(() => {
  document.body.innerHTML = `
    <p id="para">
      <span data-widx="0:0:2" id="word">decade</span>
      <span data-lens-out id="lens">
        (в последний раз я видел его, <b id="deep">но я был уверен</b>, что это его голос.)
      </span>
    </p>
  `;
});

const el = (id: string) => document.getElementById(id)!;

test('a word of the book is not lens output', () => {
  expect(inLensOutput(el('word'))).toBe(false);
  expect(inLensOutput(el('word').firstChild)).toBe(false);
});

test('the translation is', () => {
  expect(inLensOutput(el('lens'))).toBe(true);
});

// The selection the user actually made was deep inside the translation, on a text node.
test('a text node nested inside the translation counts too', () => {
  expect(inLensOutput(el('deep').firstChild)).toBe(true);
});

test('text outside any sentence is not lens output', () => {
  expect(inLensOutput(el('para').firstChild)).toBe(false);
});

test('no node at all is not lens output', () => {
  expect(inLensOutput(null)).toBe(false);
});
