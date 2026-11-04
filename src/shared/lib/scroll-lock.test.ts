import { expect, test } from 'vitest';
import { lockBodyScroll } from './scroll-lock';

test.each([true, false])(
  'nested dialogs retain scrolling ownership when the outer closes first: %s',
  (outerFirst) => {
    document.body.style.overflow = 'auto';
    const outer = lockBodyScroll();
    const inner = lockBodyScroll();
    const [first, last] = outerFirst ? [outer, inner] : [inner, outer];
    try {
      first();
      expect(document.body.style.overflow).toBe('hidden');
      first();
      expect(document.body.style.overflow).toBe('hidden');
      last();
      expect(document.body.style.overflow).toBe('auto');
    } finally {
      outer();
      inner();
      document.body.style.overflow = '';
    }
  }
);

test('release preserves an explicit external overflow change', () => {
  const release = lockBodyScroll();
  try {
    document.body.style.overflow = 'clip';
    release();
    expect(document.body.style.overflow).toBe('clip');
  } finally {
    release();
    document.body.style.overflow = '';
  }
});
