import { captureDataScope } from '@/features/account/dataScope';
import { navigationInsets } from '@/shared/lib/navigation-insets';

export function keepReadingAnchor(change: () => void): void {
  const current = captureDataScope();
  const root = document.querySelector('[data-reader-text]');
  const words = root?.querySelectorAll<HTMLElement>('[data-widx]');
  const insets = navigationInsets();
  const anchor =
    words &&
    [...words].find((word) => {
      const bounds = word.getBoundingClientRect();
      return (
        bounds.top >= insets.top &&
        bounds.top < window.innerHeight - insets.bottom
      );
    });
  const top = anchor?.getBoundingClientRect().top;
  change();
  if (!anchor || top == null) return;
  requestAnimationFrame(() => {
    if (!anchor.isConnected || !current()) return;
    const delta = anchor.getBoundingClientRect().top - top;
    if (Math.abs(delta) > 1)
      window.scrollBy({ top: delta, behavior: 'instant' });
  });
}
