import { describe, expect, it } from 'vitest';
import { shuffleOptions } from './useShuffledOptions';

const OPTIONS = ['Did', 'Do', 'Was', 'Were'];

describe('shuffleOptions', () => {
  it('keeps every option exactly once', () => {
    for (let run = 0; run < 50; run++) {
      const { items } = shuffleOptions(OPTIONS, 0);
      expect(items.map((o) => o.text).sort()).toEqual([...OPTIONS].sort());
      expect(new Set(items.map((o) => o.original)).size).toBe(OPTIONS.length);
    }
  });

  it('points correctAt at the authored answer wherever it lands', () => {
    for (let run = 0; run < 50; run++) {
      const correctIndex = run % OPTIONS.length;
      const { items, correctAt } = shuffleOptions(OPTIONS, correctIndex);
      expect(items[correctAt]!.original).toBe(correctIndex);
      expect(items[correctAt]!.text).toBe(OPTIONS[correctIndex]);
    }
  });

  it('actually moves the answer off its authored slot sometimes', () => {
    const positions = new Set<number>();
    for (let run = 0; run < 100; run++) positions.add(shuffleOptions(OPTIONS, 0).correctAt);
    // A fixed order would only ever produce 0 — this is the regression the shuffle exists to prevent.
    expect(positions.size).toBeGreaterThan(1);
  });

  it('handles a two-option exercise and duplicate texts', () => {
    const { items, correctAt } = shuffleOptions(['same', 'same'], 1);
    expect(items).toHaveLength(2);
    expect(items[correctAt]!.original).toBe(1);
  });
});
