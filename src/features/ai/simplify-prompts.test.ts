import { describe, it, expect } from 'vitest';
import { clampBand, simplifySystem, BANDS } from './simplify-prompts';

describe('clampBand', () => {
  it('maps each level to its band', () => {
    expect(clampBand('A1')).toBe('A1');
    expect(clampBand('A2')).toBe('A2');
    expect(clampBand('B1')).toBe('B1');
    expect(clampBand('B2')).toBe('B2');
  });
  it('clamps C1/C2 down to B2 (simplifying "to C1" is meaningless)', () => {
    expect(clampBand('C1')).toBe('B2');
    expect(clampBand('C2')).toBe('B2');
  });
  it('defaults a missing level (placement not done) to B1', () => {
    expect(clampBand(null)).toBe('B1');
    expect(clampBand(undefined)).toBe('B1');
  });
  it('steps down toward A1, clamping first and flooring at A1', () => {
    expect(clampBand('B2', 1)).toBe('B1');
    expect(clampBand('B2', 2)).toBe('A2');
    expect(clampBand('B1', 1)).toBe('A2');
    expect(clampBand('A2', 1)).toBe('A1');
    expect(clampBand('A1', 3)).toBe('A1');
    expect(clampBand('C1', 1)).toBe('B1'); // clamp to B2, then one step down
  });
});

describe('simplifySystem', () => {
  it('names the band and is deterministic per band (for prefix caching)', () => {
    for (const b of BANDS) {
      const s = simplifySystem(b);
      expect(s).toContain(`CEFR level ${b}`);
      expect(s).toBe(simplifySystem(b));
    }
  });
});
