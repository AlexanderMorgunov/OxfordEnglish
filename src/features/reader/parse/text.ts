const BLOCK = /^(p|div|section|article|h[1-6]|li|blockquote|tr|figcaption|pre)$/;

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
  return normalizeText(walk(doc.body));
}

/** Split reading text into sentences, keeping abbreviations mostly intact. */
export function toSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])["')\]]?\s+(?=[A-Z"'(])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
