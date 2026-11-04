import { afterEach, expect, test, vi } from 'vitest';
import { currentReadingLocation } from './reader-location';
afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});
function root() {
  const root = document.createElement('div');
  root.innerHTML =
    '<p data-para="0"><span data-sent="0:0">The first sentence.</span><span data-sent="0:1">The current sentence.</span></p><p data-para="1"><span data-sent="1:0">The offscreen paragraph.</span></p>';
  document.body.append(root);
  const set = (element: Element, top: number, height: number) => {
    const rect = new DOMRect(0, top, 300, height);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue(rect);
    vi.spyOn(element, 'getClientRects').mockReturnValue([
      rect,
    ] as unknown as DOMRectList);
  };
  set(root, -500, 1500);
  set(root.children[0]!, -500, 1200);
  set(root.children[1]!, 700, 300);
  set(root.querySelector('[data-sent="0:0"]')!, -500, 550);
  set(root.querySelector('[data-sent="0:1"]')!, 90, 500);
  set(root.querySelector('[data-sent="1:0"]')!, 700, 100);
  return { root, set };
}
const paragraphs = [
  'The first sentence. The current sentence.',
  'The offscreen paragraph.',
];
test('uses the current sentence inside a long paragraph rather than its first or the next offscreen paragraph', () => {
  const { root } = rootFixture();
  expect(
    currentReadingLocation(root, paragraphs, { top: 120, bottom: 100 })
  ).toEqual({ paragraph: 0, sentence: 1, text: 'The current sentence.' });
});
const rootFixture = root;
test('ignores sentences covered by the dock and header, including wrapped client rects', () => {
  const { root, set } = rootFixture();
  const wrapped = root.querySelector<HTMLElement>('[data-sent="0:0"]')!;
  vi.mocked(wrapped.getClientRects).mockReturnValue([
    new DOMRect(0, -500, 100, 20),
    new DOMRect(0, 130, 100, 20),
  ] as unknown as DOMRectList);
  set(root.querySelector('[data-sent="0:1"]')!, 720, 40);
  expect(
    currentReadingLocation(root, paragraphs, { top: 120, bottom: 100 })
      ?.sentence
  ).toBe(0);
});
test('at the end of the document retains the last actual sentence', () => {
  const { root, set } = rootFixture();
  set(root, -1500, 800);
  for (const element of root.querySelectorAll('[data-sent]'))
    set(element, -1000, 10);
  expect(
    currentReadingLocation(root, paragraphs, { top: 100, bottom: 100 })
  ).toEqual({ paragraph: 1, sentence: 0, text: 'The offscreen paragraph.' });
});
