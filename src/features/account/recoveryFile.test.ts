import { test, expect } from 'vitest';
import { recoveryFileBody } from './recoveryFile';

const KEY = 'ABCD-EFGH-JKMN-PQRS-TVWX-YZ23-45';
const ID = 'inMBJmHJve2CKl5JgnyYw';

/**
 * This file is the artefact a user actually keeps. A reported failure came from it holding only the key:
 * the account id was never mentioned anywhere, shown truncated in settings, and the only full copy lived
 * inside the label of an authenticator entry — which the setup screen now steers people away from by
 * offering manual entry first.
 */
test('it carries the key and the id, because recovery needs both', () => {
  const ru = recoveryFileBody(KEY, ID, true);
  expect(ru).toContain(KEY);
  expect(ru).toContain(ID);

  const en = recoveryFileBody(KEY, ID, false);
  expect(en).toContain(KEY);
  expect(en).toContain(ID);
});

// The two are not equally sensitive, and a file that treats them alike teaches the wrong habit: the key
// is access, the id is only a lookup.
test('it says which of the two is the secret', () => {
  expect(recoveryFileBody(KEY, ID, true)).toMatch(/в тайне/);
  expect(recoveryFileBody(KEY, ID, true)).toMatch(/не тайна/);
  expect(recoveryFileBody(KEY, ID, false)).toMatch(/keep it secret/i);
  expect(recoveryFileBody(KEY, ID, false)).toMatch(/not a secret/i);
});

// Saying "you will need an authenticator" only at the moment the key is lost is too late; the file is
// read then, so it has to point at the thing that should already have been set up.
test('it names the authenticator as the way back', () => {
  expect(recoveryFileBody(KEY, ID, true)).toMatch(/аутентификатор/i);
  expect(recoveryFileBody(KEY, ID, false)).toMatch(/authenticator/i);
});

test('a missing id degrades to a placeholder rather than the word undefined', () => {
  const body = recoveryFileBody(KEY, null, true);
  expect(body).not.toMatch(/undefined|null/);
  expect(body).toContain('—');
});

test('it ends with a newline, so appending to it never joins two lines', () => {
  expect(recoveryFileBody(KEY, ID, true).endsWith('\n')).toBe(true);
});
