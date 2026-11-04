import { expect, test } from 'vitest';
import { navigationContext, navigationLayout } from './navigation';

test.each([
  ['/', '/'],
  ['/syllabus', '/'],
  ['/placement', '/'],
  ['/course/u02/day/u02.d90', '/'],
  ['/grammar/present-simple', '/grammar'],
  ['/vocabulary/text', '/vocabulary'],
  ['/library/catalog/alice', '/library'],
  ['/library/local-book', '/library'],
  ['/settings/interface', '/settings'],
  ['/billing/success', '/pro'],
  ['/billing/fail', '/pro'],
  ['/checkpoint/u01', '/'],
  ['/credits', '/about'],
  ['/terms', null],
  ['/grammar-unrelated', null],
  ['/unknown', null],
])('navigation context %s → %s', (path, expected) =>
  expect(navigationContext(path)).toBe(expected)
);
test('checkpoint origin selects Progress only for the explicit progress marker', () => {
  expect(navigationContext('/checkpoint/u01', '?from=progress')).toBe(
    '/progress'
  );
  expect(navigationContext('/checkpoint/u01', '?from=reader')).toBe('/');
});
test('fit follows real geometry and switches to Sections for large labels or short viewports', () => {
  const size = {
    width: 1440,
    height: 900,
    available: 1120,
    required: 1050,
    labelWidth: 60,
  };
  expect(navigationLayout(size)).toBe('wide');
  expect(navigationLayout({ ...size, required: 1200 })).toBe('bottom');
  expect(navigationLayout({ ...size, width: 390, available: 350 })).toBe(
    'bottom'
  );
  expect(
    navigationLayout({ ...size, width: 390, available: 350, labelWidth: 120 })
  ).toBe('stacked');
  expect(navigationLayout({ ...size, height: 390 })).toBe('stacked');
});
