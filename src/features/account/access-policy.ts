export const LOGIN_MIN = 4;
export const LOGIN_MAX = 24;
export const PASSWORD_MIN = 15;
export const PASSWORD_MAX = 128;
export const normalizeLogin = (value: string): string =>
  value.trim().toLowerCase();
export const normalizePassword = (value: string): string =>
  value.normalize('NFC');
export const passwordLength = (value: string): number =>
  Array.from(normalizePassword(value)).length;
export const validLogin = (value: string): boolean =>
  /^[a-z][a-z0-9_]{3,23}$/.test(normalizeLogin(value));
export function passwordPolicyError(
  value: string
): 'password_short' | 'password_long' | 'password_weak' | null {
  const password = normalizePassword(value);
  const length = passwordLength(password);
  if (length < PASSWORD_MIN) return 'password_short';
  if (length > PASSWORD_MAX) return 'password_long';
  if (!password.trim() || /^(.)\1+$/su.test(password)) return 'password_weak';
  return null;
}
