import type { ParsedBook, Chapter } from './types';
import { normalizeText } from './text';

const tag = (root: Element | Document, name: string) => root.getElementsByTagName(name);
const first = (root: Element | Document, name: string): Element | undefined => tag(root, name)[0];

function sectionText(section: Element): string {
  const parts: string[] = [];
  // Direct paragraph-like children plus those of nested subsections, in document order.
  section.querySelectorAll('p, subtitle').forEach((p) => {
    if (p.closest('title')) return; // heading text is shown separately
    const t = p.textContent?.trim();
    if (t) parts.push(t);
  });
  return normalizeText(parts.join('\n\n'));
}

export function parseFb2(xmlStr: string): ParsedBook {
  const doc = new DOMParser().parseFromString(xmlStr, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('FB2: invalid XML');

  const titleInfo = first(doc, 'title-info');
  const title = (titleInfo && first(titleInfo, 'book-title')?.textContent?.trim()) || 'Untitled';
  const authorEl = titleInfo && first(titleInfo, 'author');
  const author = authorEl
    ? [first(authorEl, 'first-name')?.textContent, first(authorEl, 'last-name')?.textContent]
        .filter(Boolean)
        .join(' ')
        .trim() || undefined
    : undefined;

  const body = first(doc, 'body');
  if (!body) throw new Error('FB2: no body');

  const chapters: Chapter[] = [];
  const sections = Array.from(body.children).filter((el) => el.tagName.toLowerCase() === 'section');
  const source = sections.length > 0 ? sections : [body];
  source.forEach((section, i) => {
    const text = sectionText(section);
    if (text.length < 20) return;
    const heading = first(section, 'title')?.textContent?.trim();
    chapters.push({ id: `c${i}`, title: heading || undefined, text });
  });

  if (chapters.length === 0) throw new Error('FB2: no readable chapters');
  return { title, author, chapters };
}
