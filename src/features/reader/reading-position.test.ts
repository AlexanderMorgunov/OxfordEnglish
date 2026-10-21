import { afterEach, expect, test, vi } from 'vitest';
import { captureReadingPosition, readReadingPosition, restoreReadingPosition } from './reading-position';

afterEach(() => { document.querySelectorAll('[data-position-test]').forEach(el => el.remove()); vi.restoreAllMocks(); });

function passage(top = -5, height = 20) {
  const root = document.createElement('div');
  root.dataset.positionTest = '';
  root.innerHTML = '<p data-para="0" style="line-height:20px"><button data-widx="0:1:7">quiet</button></p>';
  document.body.appendChild(root);
  const word = root.querySelector<HTMLElement>('button')!;
  vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -100, 300, 1000));
  vi.spyOn(root.firstElementChild!, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -100, 300, 500));
  vi.spyOn(word, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, top, 40, height));
  return { root, word };
}

test('resume follows the same word after font, line spacing and wrapping change its document position', () => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 1000 });
  const { root, word } = passage();
  const saved = captureReadingPosition(root, 'chapter-one');
  expect(saved).toMatchObject({ word: '0:1:7', lineOffset: -0.25 });
  (root.firstElementChild as HTMLElement).style.lineHeight = '40px';
  vi.mocked(word.getBoundingClientRect).mockReturnValue(new DOMRect(0, 1400, 80, 40));
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  restoreReadingPosition(root, saved);
  expect(scroll).toHaveBeenCalledWith({ top: 2410, behavior: 'instant' });
});

test('legacy pixel records and a missing token retain a safe fallback', () => {
  const saved = readReadingPosition('1234', 'chapter-one')!;
  const { root } = passage();
  const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  restoreReadingPosition(root, { ...saved, word: '99:0:1', lineOffset: 0 });
  expect(scroll).toHaveBeenCalledWith({ top: 1234, behavior: 'instant' });
});

test.each([null, '', 'NaN', '-20', 'null', '{}', '{"version":2}', '{"version":1,"pageId":"another","scrollY":10}'])('rejects invalid or different-page saved position: %s', raw => {
  expect(readReadingPosition(raw, 'chapter-one')).toBeNull();
});

test('unsafe tokens are discarded and finite offsets are bounded', () => {
  const record = { version: 1, pageId: 'chapter-one', scrollY: 100, word: '0:1:7', lineOffset: 10000 };
  expect(readReadingPosition(JSON.stringify(record), 'chapter-one')?.lineOffset).toBe(4);
  expect(readReadingPosition(JSON.stringify({ ...record, word: '"] div' }), 'chapter-one')?.word).toBeUndefined();
});

test('before or after the reading text keeps the non-reading page offset', () => {
  Object.defineProperty(window, 'scrollY', { configurable: true, value: 150 });
  const { root } = passage();
  for (const bounds of [new DOMRect(0, 200, 300, 1000), new DOMRect(0, -1100, 300, 1000)]) {
    vi.mocked(root.getBoundingClientRect).mockReturnValue(bounds);
    expect(captureReadingPosition(root, 'chapter-one')).toEqual({ version: 1, pageId: 'chapter-one', scrollY: 150 });
  }
});

test('a visible paragraph without source words does not hide the next usable anchor', () => {
  const { root } = passage();
  const empty = document.createElement('p'); empty.dataset.para = '99'; empty.textContent = '12345';
  root.prepend(empty);
  vi.spyOn(empty, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, -40, 300, 100));
  expect(captureReadingPosition(root, 'chapter-one').word).toBe('0:1:7');
});
