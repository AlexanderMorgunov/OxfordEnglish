import { test, expect } from 'vitest';
import { relatedCatalog, type CatalogEntry } from './catalog';

const lic = { type: 'pd', attribution: '', sourceUrl: '' };
const book = (id: string, level: string, author?: string): CatalogEntry => ({
  id,
  title: id,
  author,
  level,
  license: lic,
  kind: 'bundled',
});

const CATALOG = [
  book('oz', 'B1', 'L. Frank Baum'),
  book('dorothy', 'B1', 'L. Frank Baum'),
  book('alice', 'B1', 'Lewis Carroll'),
  book('peter', 'A2', 'Beatrix Potter'),
  book('frankenstein', 'C1', 'Mary Shelley'),
];

test('same author ranks first, then closest level', () => {
  const oz = CATALOG[0]!;
  const out = relatedCatalog(CATALOG, oz);
  expect(out[0]!.id).toBe('dorothy'); // same author
  expect(out.map((b) => b.id)).not.toContain('oz'); // excludes itself
  // after the same-author pick, B1 (alice) beats A2/C1 by level gap
  expect(out[1]!.id).toBe('alice');
});

test('with no author match, nearest level wins', () => {
  const alice = CATALOG[2]!; // B1, unique author
  const out = relatedCatalog(CATALOG, alice, 2);
  expect(out).toHaveLength(2);
  // the two B1 Baum books are level-gap 0, sorted by title: dorothy, oz
  expect(out.map((b) => b.id)).toEqual(['dorothy', 'oz']);
});

test('respects the limit', () => {
  expect(relatedCatalog(CATALOG, CATALOG[0]!, 1)).toHaveLength(1);
});
