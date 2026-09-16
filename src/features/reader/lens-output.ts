/**
 * The marker that separates a lens RESULT from the book's own text.
 *
 * A translation, a simplification or a grammar note is our text, not the author's: nothing in it is a
 * word to look up, save or translate. Before this existed, selecting inside a Russian translation
 * opened the phrase bar and offered to translate it — into Russian.
 */
export const LENS_OUT_ATTR = 'data-lens-out';

export function inLensOutput(node: Node | null): boolean {
  const el = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
  return !!el?.closest(`[${LENS_OUT_ATTR}]`);
}
