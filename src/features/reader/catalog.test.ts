import { test, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseStorybookMd } from './parse/storybook';

test('parseStorybookMd extracts title and pages, drops the license footer', () => {
  const md = [
    '# The Clever Goat',
    '',
    'The goat was hungry.',
    '',
    '##',
    '',
    'It found some grass.',
    '',
    '* License: CC-BY',
    '* Text: A. Author',
  ].join('\n');
  const book = parseStorybookMd(md);
  expect(book.title).toBe('The Clever Goat');
  expect(book.chapters.length).toBe(1);
  expect(book.chapters[0]!.text).toContain('The goat was hungry.');
  expect(book.chapters[0]!.text).toContain('It found some grass.');
  expect(book.chapters[0]!.text).not.toContain('License');
});

test('shipped catalog is well-formed and free-license (no NC)', () => {
  const manifest = JSON.parse(
    readFileSync(resolve(process.cwd(), 'public/reader/catalog.json'), 'utf8')
  ) as { books: { id: string; level: string; license: { type: string }; kind: string; path?: string; mdUrl?: string }[] };
  expect(manifest.books.length).toBeGreaterThan(0);

  for (const b of manifest.books) {
    expect(/^(A1|A2|B1|B2|C1|C2)$/.test(b.level)).toBe(true);
    // never ship a non-commercial or no-derivatives license
    expect(b.license.type).not.toMatch(/NC|ND/i);
    if (b.kind === 'bundled') {
      expect(b.path).toBeTruthy();
      expect(existsSync(resolve(process.cwd(), 'public', b.path!))).toBe(true);
    } else {
      expect(b.kind).toBe('remote');
      expect(b.mdUrl).toMatch(/^https:\/\//);
    }
  }
});
