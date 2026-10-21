import { act, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useReadingPosition } from './useReadingPosition';

let y: number;
let wordTop: number;
let frames: Map<number, FrameRequestCallback>;
let fontsDone: () => void;
let originalFonts: PropertyDescriptor | undefined;
let layoutChanged: () => void;

beforeEach(() => {
  y = 0; wordTop = 1200; frames = new Map();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++sequence, fn); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { layoutChanged = callback; }
    observe() {}
    disconnect() {}
  });
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => y });
  vi.spyOn(window, 'scrollTo').mockImplementation((opts: ScrollToOptions | number) => { y = typeof opts === 'number' ? opts : opts.top ?? 0; });
  originalFonts = Object.getOwnPropertyDescriptor(document, 'fonts');
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>(done => { fontsDone = done; }) } });
  localStorage.removeItem('qa-reading-pos');
});
afterEach(() => {
  document.querySelectorAll('[data-qa-reader]').forEach(el => el.remove());
  if (originalFonts) Object.defineProperty(document, 'fonts', originalFonts);
  else Reflect.deleteProperty(document, 'fonts');
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

const runFrames = () => act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(0)); });
function view(jumping = false) {
  const wrapper = document.createElement('div'); wrapper.dataset.qaReader = '';
  wrapper.innerHTML = '<div data-reader-text><p data-para="0" style="line-height:20px"><button data-widx="0:1:7">quiet</button></p></div>';
  document.body.appendChild(wrapper);
  const root = wrapper.firstElementChild!;
  vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 200 - y, 300, 10000));
  vi.spyOn(root.firstElementChild!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, wordTop - y, 300, 300));
  vi.spyOn(root.querySelector('button')!, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, wordTop - y, 60, 20));
  return { wrapper, hook: renderHook(() => useReadingPosition({ rootRef: { current: wrapper }, jumpingRef: { current: jumping }, storageKey: 'qa-reading-pos', pageId: 'chapter-one' })) };
}
const semantic = () => localStorage.setItem('qa-reading-pos', JSON.stringify({ version: 1, pageId: 'chapter-one', scrollY: 1000, word: '0:1:7', lineOffset: 0 }));

test('restores semantic text after layout and saves the last captured position before a route replaces the DOM', () => {
  semantic(); wordTop = 2600;
  const { hook, wrapper } = view(); runFrames();
  expect(y).toBe(2600);
  y = 2610; fireEvent.scroll(window);
  wrapper.remove(); y = 0; hook.unmount();
  expect(JSON.parse(localStorage.getItem('qa-reading-pos')!)).toMatchObject({ word: '0:1:7', scrollY: 2610, lineOffset: -0.5 });
});

test('late font loading corrects reflow without repeating a restore after user input', async () => {
  semantic(); const { hook } = view(); runFrames(); expect(y).toBe(1200);
  wordTop = 1800; fireEvent.wheel(window); y = 1500; fireEvent.scroll(window);
  await act(async () => fontsDone()); runFrames();
  expect(y).toBe(1500); hook.unmount();
});

test('late fonts align the same word if the reader has not intervened', async () => {
  semantic(); view(); runFrames(); wordTop = 1800;
  await act(async () => fontsDone()); runFrames();
  expect(y).toBe(1800);
});

test.each(['owner', 'unmount'] as const)('%s prevents a pending restore and stale position writes', async action => {
  semantic(); const { hook } = view(); const saved = localStorage.getItem('qa-reading-pos');
  if (action === 'owner') act(() => invalidateDataScope()); else hook.unmount();
  await act(async () => fontsDone()); runFrames(); y = 5000; fireEvent.scroll(window); runFrames();
  expect(window.scrollTo).not.toHaveBeenCalled();
  expect(localStorage.getItem('qa-reading-pos')).toBe(saved);
});

test('a bookmark jump owns scroll instead of saved position or late fonts', async () => {
  semantic(); view(true); y = 3000; fireEvent.scroll(window);
  await act(async () => fontsDone()); runFrames();
  expect(window.scrollTo).not.toHaveBeenCalled(); expect(y).toBe(3000);
});

test('pagehide flushes the current position without waiting for a scheduled write', () => {
  semantic(); view(); runFrames(); y = 1205; fireEvent.scroll(window); fireEvent.pageHide(window);
  expect(JSON.parse(localStorage.getItem('qa-reading-pos')!)).toMatchObject({ word: '0:1:7', scrollY: 1205 });
});

test('late bookmark header layout preserves the initial semantic position', () => {
  semantic(); view(); runFrames(); expect(y).toBe(1200);
  wordTop = 1270; act(() => layoutChanged()); runFrames();
  expect(y).toBe(1270);
});

test('layout after user intervention updates the saved anchor without moving the user', () => {
  semantic(); const { hook } = view(); runFrames();
  fireEvent.pointerDown(window); wordTop = 1210;
  act(() => layoutChanged()); runFrames(); hook.unmount();
  expect(y).toBe(1200);
  expect(JSON.parse(localStorage.getItem('qa-reading-pos')!)).toMatchObject({ word: '0:1:7', lineOffset: 0.5 });
});

test('layout corrections have a bounded startup window', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
  semantic(); view(); runFrames(); clock.mockReturnValue(7000); wordTop = 1210;
  act(() => layoutChanged()); runFrames();
  expect(y).toBe(1200);
  expect(JSON.parse(localStorage.getItem('qa-reading-pos')!)).toMatchObject({ lineOffset: 0.5 });
});

test('an explicit same-page bookmark cancels restoration even without a pointer or keyboard event', async () => {
  semantic(); const { hook } = view(); runFrames();
  act(() => hook.result.current()); y = 2500; wordTop = 2800;
  await act(async () => fontsDone()); act(() => layoutChanged()); runFrames();
  expect(y).toBe(2500);
});
