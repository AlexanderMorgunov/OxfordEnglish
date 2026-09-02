import { test, expect } from 'vitest';
import {
  generateRecoveryKey,
  keyToBytes,
  formatRecoveryKey,
  deriveAccountId,
  deriveVerifier,
  deriveCredentials,
} from './keys';

test('generateRecoveryKey yields a 128-bit key that round-trips to 16 bytes', () => {
  const key = generateRecoveryKey();
  expect(keyToBytes(key)).toHaveLength(16);
  // Two keys differ (randomness).
  expect(generateRecoveryKey()).not.toBe(key);
});

test('parsing is tolerant of grouping/case/lookalikes', () => {
  const key = generateRecoveryKey();
  const bytes = keyToBytes(key);
  // Same key without dashes and lowercased decodes identically.
  expect(keyToBytes(key.replace(/-/g, '').toLowerCase())).toEqual(bytes);
});

test('keyToBytes rejects a malformed key', () => {
  expect(() => keyToBytes('')).toThrow();
  expect(() => keyToBytes('ABC')).toThrow(); // too short
});

test('formatRecoveryKey groups into 4-char blocks with no trailing dash', () => {
  expect(formatRecoveryKey('ABCDEFGH')).toBe('ABCD-EFGH');
  expect(formatRecoveryKey('ABCDE')).toBe('ABCD-E');
});

test('accountId and verifier are deterministic for the same key and differ from each other', async () => {
  const key = generateRecoveryKey();
  const a1 = await deriveAccountId(key);
  const a2 = await deriveAccountId(key);
  const v1 = await deriveVerifier(key);
  expect(a1).toBe(a2); // deterministic
  expect(a1).not.toBe(v1); // different derivation contexts
  expect(a1.length).toBeGreaterThan(10);
});

test('different keys derive different account ids', async () => {
  const a = await deriveAccountId(generateRecoveryKey());
  const b = await deriveAccountId(generateRecoveryKey());
  expect(a).not.toBe(b);
});

test('deriveCredentials returns both derivations consistent with the singles', async () => {
  const key = generateRecoveryKey();
  const { accountId, verifier } = await deriveCredentials(key);
  expect(accountId).toBe(await deriveAccountId(key));
  expect(verifier).toBe(await deriveVerifier(key));
});
