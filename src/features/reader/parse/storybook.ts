import type { ParsedBook } from './types';
import { normalizeText } from './text';

/** Parse an African Storybook (global-asp) markdown file into a readable book. */
export function parseStorybookMd(md: string, fallbackTitle = 'Untitled'): ParsedBook {
  const lines = md.split(/\r?\n/);
  const title = lines.find((l) => l.startsWith('# '))?.slice(2).trim() || fallbackTitle;

  const footerStart = lines.findIndex((l) => /^\*\s*License:/i.test(l));
  const body = (footerStart >= 0 ? lines.slice(0, footerStart) : lines).join('\n');

  const pages = body
    .split(/^##\s*$/m)
    .map((p) => normalizeText(p.replace(/^#.*$/gm, '')))
    .filter(Boolean);

  return { title, chapters: [{ id: 'c0', text: pages.join('\n\n') }] };
}
