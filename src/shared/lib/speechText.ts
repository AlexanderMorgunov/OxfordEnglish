/**
 * Strip the punctuation that speech engines SAY OUT LOUD, keeping the punctuation that shapes how a
 * sentence sounds.
 *
 * `SpeechSynthesisUtterance` hands the text to the platform voice, and several of them pronounce marks
 * instead of performing them: a quote becomes the word "quote", an ellipsis becomes "dot dot dot". In a
 * novel, where dialogue is nothing but quotes, that is most of what you hear.
 *
 * The rule is not "remove punctuation". `. , ; : ! ?` are what give a voice its pauses and its
 * intonation, and stripping them makes the reading run together — worse than the problem. So the marks
 * that get verbalised are either dropped (quotes, which the voice cannot perform anyway) or turned into
 * a comma (ellipsis, dashes, brackets), which keeps the pause they stood for.
 *
 * Which marks a given voice speaks is engine- and language-dependent, so this is the common set rather
 * than a proof. It is applied to the utterance ONLY — never to the text on screen, and never before
 * chunking, because chunks carry their offset into the original text and the reader highlights by it.
 */

/** Quote marks in every shape a pasted book brings: straight, curly, guillemets, low-9, corner. */
const QUOTES = /["“”„‟«»‹›〝〞「」『』]/g;

/**
 * A single quote that opens or closes rather than joining: `'So'` loses them, `don't` keeps its.
 *
 * The closing half allows punctuation before the mark, not only a letter — dialogue almost always ends
 * `goes,'` or `said.'`, which is exactly the case a letter-only rule misses.
 */
const QUOTE_APOSTROPHE = /(^|[^\p{L}\p{N}])['’‘](?=\p{L})|(?<=[\p{L}\p{N},.;:!?])['’‘](?=$|[^\p{L}\p{N}])/gu;

/**
 * Ellipsis, however it is spelled. "dot dot dot" is the worst of them: it is long, and it lands mid-line.
 *
 * TWO dots count, not three. Requiring three left `?..` and `!..` — ordinary Russian typography — read
 * out as "dot dot", and did the same to a plain typo and to a spaced `. .` that a line break had pulled
 * apart. There is no writing in which two consecutive dots are meant to be pronounced.
 */
const ELLIPSIS = /…|\.(?:\s*\.)+/g;

/** Dashes used as punctuation, including an ASCII hyphen standing alone. A hyphen INSIDE a word is not
 *  here on purpose: `well-known` is one word to a voice, and a comma would break it in half. */
const DASHES = /\s*[—–]\s*|\s+-+\s+/g;

/** Brackets and the symbols a voice is liable to name. Parentheses become a pause; the rest are noise
 *  that belongs to markup rather than to the sentence. */
const BRACKETS = /[()[\]{}]/g;
const SYMBOLS = /[*_#~|^\\/<>]+/g;

/** Turn a passage into what should actually be pronounced. Empty when nothing is left to say. */
export function forSpeech(text: string): string {
  const out = text
    .replace(ELLIPSIS, ',')
    .replace(QUOTES, '')
    .replace(QUOTE_APOSTROPHE, (m) => (m.length > 1 ? m[0]! : ''))
    .replace(DASHES, ', ')
    .replace(BRACKETS, ',')
    .replace(SYMBOLS, ' ')
    // A comma that landed next to real punctuation is a stutter in the reading, not a pause.
    .replace(/\s*,\s*(?=[,.;:!?])/g, '')
    .replace(/([.;:!?])\s*,/g, '$1')
    .replace(/\s*,(\s*,)+/g, ',')
    .replace(/\s+/g, ' ')
    // A substituted mark inherits the spacing of the mark it replaced, so `(finally)` came out as
    // `He ,finally,`. This matters to the voice rather than to the page: a space before a comma is read
    // as a pause of its own, and a comma with nothing after it runs into the next word.
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([,;:])(?=[^\s,;:.!?])/g, '$1 ')
    .replace(/^[\s,]+/, '')
    .trim();
  // Punctuation only — a voice asked to read this says nothing useful, and some engines never fire
  // their end event for it, which would stall a passage part-way.
  return /[\p{L}\p{N}]/u.test(out) ? out : '';
}
