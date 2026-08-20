import { test, expect } from 'vitest';
import {
  groupLines,
  linesToParagraphs,
  stripRunningLines,
  assembleParagraphs,
  reconstruct,
  type TextItem,
} from './pdf-reconstruct';

/** Build a run at (x, y). Page space: y grows upward, so higher y = higher on the page. */
const run = (str: string, x: number, y: number, width = str.length * 5, height = 10): TextItem => ({
  str,
  x,
  y,
  width,
  height,
});

test('groupLines clusters runs on the same baseline and orders them left-to-right', () => {
  const items = [run('world', 60, 700), run('Hello', 10, 700), run('next', 10, 685)];
  const lines = groupLines(items);
  expect(lines.map((l) => l.text)).toEqual(['Hello world', 'next']);
});

test('linesToParagraphs breaks on a wide vertical gap and de-hyphenates line breaks', () => {
  const lines = [
    { text: 'The vocab-', x: 10, y: 700, height: 10 },
    { text: 'ulary grows', x: 10, y: 688, height: 10 },
    { text: 'A new idea', x: 10, y: 660, height: 10 }, // big gap → new paragraph
  ];
  expect(linesToParagraphs(lines)).toEqual(['The vocabulary grows', 'A new idea']);
});

test('stripRunningLines drops page numbers and repeated headers', () => {
  const header = { text: 'MY BOOK', x: 10, y: 780, height: 8 };
  const num = (n: number) => ({ text: String(n), x: 10, y: 20, height: 8 });
  const body = (t: string) => ({ text: t, x: 10, y: 400, height: 10 });
  const pages = [
    [header, body('one'), num(1)],
    [header, body('two'), num(2)],
    [header, body('three'), num(3)],
  ];
  const out = stripRunningLines(pages);
  expect(out.flat().map((l) => l.text)).toEqual(['one', 'two', 'three']);
});

test('stripRunningLines drops table-of-contents lines with dot leaders', () => {
  const toc = { text: '1.1 Topological Spaces . . . . . . . . . . . 2', x: 10, y: 400, height: 10 };
  const body = { text: 'A real sentence of prose.', x: 10, y: 380, height: 10 };
  const ellipsis = { text: 'She paused... then spoke.', x: 10, y: 360, height: 10 };
  const out = stripRunningLines([[toc, body, ellipsis]]);
  expect(out[0]!.map((l) => l.text)).toEqual(['A real sentence of prose.', 'She paused... then spoke.']);
});

test('assembleParagraphs merges a paragraph flowing across a page break', () => {
  const pages = [
    ['A sentence that runs on'],
    ['and finishes here.', 'A separate paragraph.'],
  ];
  expect(assembleParagraphs(pages)).toEqual([
    'A sentence that runs on and finishes here.',
    'A separate paragraph.',
  ]);
});

test('assembleParagraphs keeps paragraphs that end a sentence separate', () => {
  const pages = [['First idea.'], ['Second idea.']];
  expect(assembleParagraphs(pages)).toEqual(['First idea.', 'Second idea.']);
});

test('reconstruct: two-page doc with header + page numbers yields clean paragraphs', () => {
  const p1: TextItem[] = [
    run('MY BOOK', 10, 780, 40, 8),
    run('Once upon a time there was', 10, 700),
    run('a small town by the sea that', 10, 688),
    run('1', 10, 20, 5, 8),
  ];
  const p2: TextItem[] = [
    run('MY BOOK', 10, 780, 40, 8),
    run('everyone loved dearly.', 10, 700),
    run('2', 10, 20, 5, 8),
  ];
  const p3: TextItem[] = [run('MY BOOK', 10, 780, 40, 8), run('The end.', 10, 700), run('3', 10, 20, 5, 8)];
  const paras = reconstruct([p1, p2, p3]);
  expect(paras[0]).toBe(
    'Once upon a time there was a small town by the sea that everyone loved dearly.'
  );
  expect(paras).toContain('The end.');
  expect(paras.join(' ')).not.toContain('MY BOOK');
});
