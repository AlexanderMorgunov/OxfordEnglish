export const NAVIGATION_INSETS_EVENT = 'dayenglish:navigation-insets';

export function navigationInsets() {
  const style = getComputedStyle(document.documentElement);
  const reader = Boolean(document.querySelector('.rd-book-view'));
  return {
    top: Math.max(
      0,
      Number.parseFloat(
        style.getPropertyValue(
          reader ? '--reader-header-height' : '--app-nav-top'
        )
      ) || 0
    ),
    bottom: Math.max(
      0,
      Number.parseFloat(
        style.getPropertyValue(
          reader ? '--reader-dock-height' : '--app-nav-bottom'
        )
      ) || 0
    ),
  };
}
