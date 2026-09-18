import { timingSafeEqual } from 'node:crypto';

/**
 * Compare two secrets without leaking which byte differed — and without leaking their LENGTH through an
 * exception: `timingSafeEqual` throws on buffers of unequal size, so the length check has to come first.
 *
 * Its own module because three places needed it and each wrote its own: TOTP codes, the Robokassa
 * signature, and now the admin token.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
