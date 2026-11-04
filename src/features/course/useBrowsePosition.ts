import { useLayoutEffect, useRef } from 'react';
import type { MouseEvent, RefObject } from 'react';
import { useCourseNavigation } from './navigation';

export function useBrowsePosition(
  key: string,
  ready: boolean,
  root: RefObject<HTMLElement | null>
) {
  const restored = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!ready || restored.current === key) return;
    const position = useCourseNavigation.getState().positions[key];
    const frame = requestAnimationFrame(() => {
      restored.current = key;
      if (position) {
        const elements = [
          ...(root.current?.querySelectorAll<HTMLElement>(
            '[data-course-focus]'
          ) ?? []),
        ];
        const visible = (focus: string | null) =>
          elements.find(
            (element) =>
              element.dataset.courseFocus === focus &&
              element.getClientRects().length > 0
          );
        const target =
          visible(position.focus) ??
          visible(position.focus?.replace(/^open:/, 'day:') ?? null) ??
          root.current?.querySelector<HTMLElement>('h1');
        target?.focus({ preventScroll: true });
        window.scrollTo({ top: position.scroll, behavior: 'instant' });
      } else {
        root.current
          ?.querySelector<HTMLElement>('h1')
          ?.focus({ preventScroll: true });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [key, ready, root]);
  const capture = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target instanceof Element) || !event.target.closest('a[href]'))
      return;
    const focus =
      event.target.closest<HTMLElement>('[data-course-focus]')?.dataset
        .courseFocus ?? null;
    useCourseNavigation
      .getState()
      .remember(key, { scroll: window.scrollY, focus });
  };
  return capture;
}
