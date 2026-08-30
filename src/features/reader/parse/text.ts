import { ABBREVIATIONS } from '@/shared/lib/audio';

const BLOCK = /^(p|div|section|article|h[1-6]|li|blockquote|tr|figcaption|pre)$/;

// Split on a terminator + space + capital, but NOT when the period belongs to an abbreviation
// ("Mr. Blood") or a single-letter initial ("H. G. Wells") — those aren't sentence ends.
const SENTENCE_BOUNDARY = new RegExp(
  `(?<!\\b(?:${ABBREVIATIONS})\\.)(?<![A-Z]\\.)(?<=[.!?])["')\\]]?\\s+(?=[A-Z"'(])`
);

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  if (tag === 'script' || tag === 'style' || tag === 'head') return '';
  if (tag === 'br') return '\n';
  let inner = '';
  for (const child of Array.from(node.childNodes)) inner += walk(child);
  return BLOCK.test(tag) ? `\n${inner}\n` : inner;
}

/** Collapse horizontal whitespace so paragraphs stay separated by one blank line. */
export function normalizeText(raw: string): string {
  return raw
    .replace(/\r\n?/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extract paragraph-separated reading text from an (X)HTML document string. */
export function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.body && (doc.body.textContent ?? '').trim()) return normalizeText(walk(doc.body));
  // Some EPUB chapters are XHTML with an `<?xml?>` prolog + xmlns; the HTML parser then
  // leaves `<body>` empty and strands the content. Re-parse strictly as XHTML when it is
  // well-formed so those chapters aren't lost.
  const xdoc = new DOMParser().parseFromString(html, 'application/xhtml+xml');
  if (!xdoc.getElementsByTagName('parsererror').length) {
    const xbody = xdoc.getElementsByTagName('body')[0];
    if (xbody && (xbody.textContent ?? '').trim()) return normalizeText(walk(xbody));
  }
  return normalizeText(walk(doc.body ?? doc.documentElement));
}

/** Split reading text into sentences, keeping abbreviations mostly intact. */
export function toSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(SENTENCE_BOUNDARY)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
