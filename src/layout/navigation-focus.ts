export function focusNavigationControl(target: HTMLElement | null | undefined) {
  if (!target) return;
  target.focus({ preventScroll: true });
  if (!target.getClientRects().length) return;
  const bounds = target.getBoundingClientRect(),
    viewport = window.visualViewport;
  const top = viewport?.offsetTop ?? 0,
    bottom = top + (viewport?.height ?? innerHeight);
  if (bounds.top < top || bounds.bottom > bottom)
    target.scrollIntoView({ block: 'nearest', behavior: 'instant' });
}
