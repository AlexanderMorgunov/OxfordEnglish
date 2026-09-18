/**
 * Where the sentence-lens menu has to sit so it stays on screen.
 *
 * Its own module rather than a helper inside `reading-text.tsx`: that file exports components, and a
 * non-component export there breaks fast refresh for the whole reader.
 */

/** How far left a box anchored at `anchorLeft` must move to stay inside `viewportWidth`. Zero when it
 *  already fits: a menu that has room should stay glued to the button that opened it. */
export function overflowShift(anchorLeft: number, boxWidth: number, viewportWidth: number, margin = 8): number {
  const over = anchorLeft + boxWidth - (viewportWidth - margin);
  return over > 0 ? -over : 0;
}
