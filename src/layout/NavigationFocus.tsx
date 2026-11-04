import { useEffect } from 'react';
import {
  NAVIGATION_INSETS_EVENT,
  navigationInsets,
} from '@/shared/lib/navigation-insets';

export function NavigationFocus() {
  useEffect(() => {
    let frame = 0;
    const reveal = () => {
      frame = 0;
      const element = document.activeElement;
      if (
        !(element instanceof HTMLElement) ||
        !element.closest('.app-main') ||
        element.closest(
          'dialog,[role="dialog"],[popover],.rd-reader-header,.rdc-dock'
        )
      )
        return;
      const bounds = element.getBoundingClientRect(),
        insets = navigationInsets(),
        vp = window.visualViewport;
      const top = (vp?.offsetTop ?? 0) + insets.top + 12,
        bottom =
          (vp?.offsetTop ?? 0) +
          (vp?.height ?? innerHeight) -
          insets.bottom -
          12;
      if (bounds.height <= 0 || bounds.height > bottom - top) return;
      if (bounds.top < top)
        window.scrollBy({ top: bounds.top - top, behavior: 'instant' });
      else if (bounds.bottom > bottom)
        window.scrollBy({ top: bounds.bottom - bottom, behavior: 'instant' });
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };
    document.addEventListener('focusin', schedule);
    window.addEventListener(NAVIGATION_INSETS_EVENT, schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('focusin', schedule);
      window.removeEventListener(NAVIGATION_INSETS_EVENT, schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
    };
  }, []);
  return null;
}
