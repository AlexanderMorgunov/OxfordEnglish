/**
 * The sentence lens menu hangs off the ⋯ button, which sits wherever its sentence happens to end — so
 * near the right margin it opened straight off the screen, items unreadable and unreachable.
 *
 * The subtlety is not the arithmetic but what you measure against: an absolutely positioned box that
 * sticks out extends the document's scrollable area, and `window.innerWidth` grows with it. On a 360px
 * screen it already read 529 by the time the correction ran, so the overflow measured as nothing.
 * The caller passes `document.documentElement.clientWidth`, which is the viewport and does not move.
 */
import { readFile } from 'node:fs/promises';
import { test, expect } from 'vitest';
import { overflowShift } from './lens-menu';

const VIEWPORT = 360;

test('a menu with room is not moved at all', () => {
  // It should stay glued to the button that opened it; flipping or nudging a menu that fits is worse
  // than leaving it, because the reader loses the link between the two.
  expect(overflowShift(26, 235, VIEWPORT)).toBe(0);
});

test('a menu past the right edge is moved back by exactly its overflow', () => {
  // The real measurement from the reported case: trigger at 302, menu 235 wide, 360px screen.
  expect(overflowShift(302, 235, VIEWPORT)).toBe(-185);
});

test('the corrected box lands inside the viewport, margin included', () => {
  const shift = overflowShift(302, 235, VIEWPORT);

  expect(302 + shift).toBeGreaterThanOrEqual(0);
  expect(302 + shift + 235).toBe(VIEWPORT - 8);
});

test('a box exactly at the margin is left alone', () => {
  expect(overflowShift(0, VIEWPORT - 8, VIEWPORT)).toBe(0);
});

test('one pixel over is one pixel back', () => {
  expect(overflowShift(1, VIEWPORT - 8, VIEWPORT)).toBe(-1);
});

test('a menu wider than the screen is pinned to the left margin rather than centred on nothing', () => {
  // Nothing can make it fit; the left edge is the half worth keeping, since that is where the items
  // start. The caller also caps the width, so this is the degenerate case rather than the usual one.
  expect(overflowShift(50, 400, VIEWPORT)).toBe(-98);
});

/**
 * A source-level assertion, deliberately: the bug was not in the arithmetic but in which width is fed
 * to it, and jsdom computes no layout — `innerWidth` and `clientWidth` are both whatever the test says,
 * so no rendering test can tell the two apart. This is the cheapest thing that fails if someone
 * "simplifies" it back.
 */
test('the menu is measured against the viewport, not the document it just stretched', async () => {
  const source = await readFile('src/features/reader/reading-text.tsx', 'utf8');
  // The effect body alone — the surrounding comment names `window.innerWidth` as the thing not to use.
  const start = source.indexOf('useLayoutEffect(() => {');
  const body = source.slice(start, source.indexOf('}, [menuIdx]);', start));

  expect(body).toContain('documentElement.clientWidth');
  expect(body).not.toContain('window.innerWidth');
});
