import { shuffle } from './shuffle';
import { useExerciseState } from './exercises/useExerciseState';

export type ShuffledOption = {
  text: string;
  /** Index in the authored `options`/`variants` array — what `correctIndex` refers to. */
  original: number;
};

export type ShuffledOptions = {
  items: ShuffledOption[];
  /** Where the authored correct answer ended up on screen. */
  correctAt: number;
};

/** Pure part, so the display→authored mapping is testable without a component. */
export function shuffleOptions(options: readonly string[], correctIndex: number): ShuffledOptions {
  const items = shuffle(options.map((text, original) => ({ text, original })));
  return { items, correctAt: items.findIndex((o) => o.original === correctIndex) };
}

/**
 * Randomise once per exercise run, including detours through account settings.
 *
 * The authored content is overwhelmingly ordered with the answer in a fixed slot (choice: first,
 * spot-error: second), which makes every option exercise guessable without reading it. Shuffling at
 * render fixes the whole catalogue at once; `correctIndex` keeps pointing at the authored array, so
 * scoring, the "correct answer" line and attempt logging all stay in terms of the original data.
 */
export function useShuffledOptions(id: string, options: readonly string[], correctIndex: number): ShuffledOptions {
  const [order] = useExerciseState(id, 'order', () => shuffle(options.map((_, i) => i)));
  const items = order.map(original => ({ text: options[original] ?? '', original }));
  return { items, correctAt: order.indexOf(correctIndex) };
}
