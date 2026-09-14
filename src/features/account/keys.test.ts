import { test, expect } from 'vitest';
import {
  generateRecoveryKey,
  keyToBytes,
  formatRecoveryKey,
  deriveAccountId,
  deriveVerifier,
  deriveCredentials,
  splitCredential,
  formatCompositeKey,
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

test('a legacy key still derives both halves', async () => {
  const key = generateRecoveryKey();
  const { accountId, verifier } = await deriveCredentials(key);
  expect(accountId).toBe(await deriveAccountId(key));
  expect(verifier).toBe(await deriveVerifier(key));
});

test('a composite credential keeps the OLD account id and derives only the verifier', async () => {
  // The whole point of recovery: the id survives so synced data, books and the paid plan stay attached.
  const oldId = await deriveAccountId(generateRecoveryKey());
  const newKey = generateRecoveryKey();
  const composite = formatCompositeKey(oldId, newKey);

  const { accountId, verifier } = await deriveCredentials(composite);
  expect(accountId).toBe(oldId);
  expect(accountId).not.toBe(await deriveAccountId(newKey));
  expect(verifier).toBe(await deriveVerifier(newKey));
});

test('the account id half is case-sensitive (base64url), never normalized like a key', async () => {
  const id = 'aB-cD_0123456789xyz012';
  const key = generateRecoveryKey();
  const { accountId } = await deriveCredentials(formatCompositeKey(id, key));
  expect(accountId).toBe(id);
});

test('splitCredential tells the two shapes apart', () => {
  const key = generateRecoveryKey();
  expect(splitCredential(key)).toEqual({ key });
  expect(splitCredential(formatCompositeKey('acc-id', key))).toEqual({ accountId: 'acc-id', key });
  expect(splitCredential(`  ${key}  `)).toEqual({ key });
});

test('splitCredential rejects malformed composites', () => {
  expect(() => splitCredential('.ABCD')).toThrow();
  expect(() => splitCredential('acc-id.')).toThrow();
  expect(() => splitCredential('acc-id.ABCD.EFGH')).toThrow();
});

test('a composite whose key half is malformed still fails loudly', async () => {
  // Without the split, keyToBytes would strip the dot and silently decode the id as key material.
  await expect(deriveCredentials(formatCompositeKey('acc-id', 'ABC'))).rejects.toThrow();
});
