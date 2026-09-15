import { describe, it, expect } from 'vitest';
import { avatarIndex, avatarSrc, AVATAR_COUNT } from './avatar';

// Real base64url account ids, the shape deriveAccountId produces.
const IDS = [
  'inMBJmHJve2CKl5JgnyYw',
  '6hMSRWMNOCu2CKl5JgnyYw',
  'acc-0123456789abcdef',
  'Zm9vYmFyYmF6cXV4',
  '2XGHBGG34Q1770XJN5CK6BGCEC',
];

describe('avatarIndex', () => {
  // The point of deriving rather than storing: the same account looks the same everywhere, with no
  // state to sync. If this ever stopped holding, avatars would differ between a phone and a laptop.
  it('is stable for the same id', () => {
    for (const id of IDS) expect(avatarIndex(id)).toBe(avatarIndex(id));
  });

  it('always lands inside the range of files that exist', () => {
    for (const id of IDS) {
      const i = avatarIndex(id);
      expect(i).toBeGreaterThanOrEqual(1);
      expect(i).toBeLessThanOrEqual(AVATAR_COUNT);
    }
  });

  // `>>> 0` in the hash is load-bearing: without it a high bit makes the result negative and the
  // index lands at 0 or below, pointing at a file that does not exist.
  it('never goes negative or zero, whatever the id', () => {
    for (let n = 0; n < 500; n += 1) {
      const id = `acc-${n.toString(36)}${'x'.repeat(n % 17)}`;
      expect(avatarIndex(id)).toBeGreaterThanOrEqual(1);
    }
  });

  it('spreads across the set rather than collapsing onto one', () => {
    const seen = new Set<number>();
    for (let n = 0; n < 400; n += 1) seen.add(avatarIndex(`acc-${n.toString(36)}`));
    expect(seen.size).toBe(AVATAR_COUNT);
  });

  it('honours a custom count, so the set can grow without touching callers', () => {
    for (const id of IDS) expect(avatarIndex(id, 4)).toBeLessThanOrEqual(4);
  });
});

describe('avatarSrc', () => {
  it('builds a zero-padded path that matches the files on disk', () => {
    expect(avatarSrc('acc-0123456789abcdef')).toMatch(/^\/assets\/pixel\/avatars\/a\d{2}\.png$/);
  });
});
