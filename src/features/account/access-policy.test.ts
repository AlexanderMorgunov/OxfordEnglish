import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { safeAccessReturn } from './access-return';
import {
  normalizeLogin,
  normalizePassword,
  passwordLength,
  passwordPolicyError,
  validLogin,
} from './access-policy';

test('password policy measures normalized Unicode code points without truncation', () => {
  expect(passwordLength('😀'.repeat(15))).toBe(15);
  expect(passwordPolicyError('😀'.repeat(14))).toBe('password_short');
  expect(passwordPolicyError('😀'.repeat(129))).toBe('password_long');
  expect(normalizePassword('cafe\u0301')).toBe('café');
  expect(passwordPolicyError('A phrase with spaces')).toBeNull();
});
test('usernames are canonical and deliberately restricted', () => {
  expect(normalizeLogin(' Reader_123 ')).toBe('reader_123');
  expect(validLogin(' Reader_123 ')).toBe(true);
  for (const value of ['abc', '1reader', 'my name', 'читатель', 'a'.repeat(25)])
    expect(validLogin(value)).toBe(false);
});

test('account continuation stays on the same origin and avoids account loops', () => {
  const origin = 'https://dayenglish.ru';
  expect(safeAccessReturn('/library/book?chapter=2#paragraph', origin)).toBe('/library/book?chapter=2#paragraph');
  for (const value of ['//other.example', '/\n/other.example', '/\\other.example', '/account/login', '/x/../account/register', 'https://other.example']) expect(safeAccessReturn(value, origin)).toBe('/settings/account');
});
test('client and server access contracts and password policies stay mirrored', () => {
  const read = (path: string) =>
    readFileSync(path, 'utf8')
      .replaceAll('\r\n', '\n')
      .replace("from './contract.js'", "from './contract'");
  expect(read('src/features/account/access-policy.ts')).toBe(
    read('server/src/accessPolicy.ts')
  );
  expect(read('src/features/account/access-contract.ts')).toBe(
    read('server/src/accessContract.ts')
  );
});
