import { test, expect } from 'vitest';
import { paginateChapters } from './paginate';

const para = (n: number) => Array.from({ length: n }, (_, i) => `paragraph number ${i}`).join('\n\n');

test('short chapters pass through untouched', () => {
  const chapters = [{ id: 'c0', title: 'One', text: 'a\n\nb' }];
  expect(paginateChapters(chapters, 1000)).toEqual(chapters);
});

test('a long chapter is split on paragraph boundaries with numbered titles', () => {
  const text = para(100); // ~100 paragraphs
  const out = paginateChapters([{ id: 'c0', title: 'Long', text }], 200);
  expect(out.length).toBeGreaterThan(1);
  expect(out.every((c) => c.text.length <= 200 || !c.text.includes('\n\n'))).toBe(true);
  expect(out[0]!.id).toBe('c0#1');
  expect(out[0]!.title).toMatch(/^Long · 1\/\d+$/);
  // no text is lost
  expect(out.map((c) => c.text).join('\n\n')).toBe(text);
});

test('splitting keeps every paragraph (no loss, no duplication)', () => {
  const text = para(50);
  const out = paginateChapters([{ id: 'c0', text }], 150);
  const rejoined = out.map((c) => c.text).join('\n\n');
  expect(rejoined.split('\n\n')).toHaveLength(50);
});
