/**
 * Pure-core checks for TOTP. Run: `npx tsx src/totp.smoke.ts`.
 *
 * The load-bearing part is the RFC 6238 Appendix B vector table: a self-consistent implementation
 * (generate a code, verify the same code) passes even with the time-step math off by one, and the bug
 * only surfaces as "the app's codes never work" in production. The vectors are the only real oracle.
 */
import {
  base32Encode,
  base32Decode,
  codeForStep,
  stepAt,
  verifyCode,
  otpauthUri,
  generateSecret,
  generateBackupCodes,
  hashBackupCode,
  STEP_SECONDS,
  BACKUP_CODE_COUNT,
} from './totp.js';

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

// RFC 6238 Appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = new TextEncoder().encode('12345678901234567890');
const VECTORS: Array<{ seconds: number; code8: string }> = [
  { seconds: 59, code8: '94287082' },
  { seconds: 1_111_111_109, code8: '07081804' },
  { seconds: 1_111_111_111, code8: '14050471' },
  { seconds: 1_234_567_890, code8: '89005924' },
  { seconds: 2_000_000_000, code8: '69279037' },
  { seconds: 20_000_000_000, code8: '65353130' },
];

for (const v of VECTORS) {
  const step = stepAt(v.seconds * 1000);
  check(`RFC 6238 vector t=${v.seconds} → ${v.code8}`, codeForStep(RFC_SECRET, step, 8) === v.code8);
  check(`RFC 6238 vector t=${v.seconds} truncates to 6 digits`, codeForStep(RFC_SECRET, step) === v.code8.slice(2));
}

// No RFC vector reaches a step above 2^32 (the largest is 666666666), so the high counter word is
// untested by the table above; a naive 32-bit write wraps there and only breaks in year ~6000.
check('the high counter word is written, not wrapped', (() => {
  const big = 2 ** 32 + 12345;
  return codeForStep(RFC_SECRET, big) !== codeForStep(RFC_SECRET, big - 2 ** 32);
})());

// --- base32 (RFC 4648 §10 vectors) ---
const ascii = (s: string) => new TextEncoder().encode(s);
check('base32("f") = MY======', base32Encode(ascii('f')) === 'MY');
check('base32("fo") = MZXQ====', base32Encode(ascii('fo')) === 'MZXQ');
check('base32("foo") = MZXW6===', base32Encode(ascii('foo')) === 'MZXW6');
check('base32("foobar") = MZXW6YTBOI======', base32Encode(ascii('foobar')) === 'MZXW6YTBOI');
check('base32 round-trips the RFC secret', base32Decode(base32Encode(RFC_SECRET)) .every((b, i) => b === RFC_SECRET[i]));
check('base32 decodes padding and lowercase', new TextDecoder().decode(base32Decode('mzxw6ytboi======')) === 'foobar');
check('base32 uses the RFC alphabet, not Crockford (no U, has I/L/O)', (() => {
  const enc = base32Encode(new Uint8Array([0x44, 0x32, 0x14, 0xc7]));
  return /^[A-Z2-7]+$/.test(enc) && !/[018]/.test(enc);
})());

// --- verification window ---
const NOW = 1_700_000_000_000;
const here = stepAt(NOW);
check('the current code verifies', verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here), NOW).ok);
check('the previous step is accepted (slow phone clock)', verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here - 1), NOW).ok);
check('the next step is accepted (fast phone clock)', verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here + 1), NOW).ok);
check('two steps back is rejected', !verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here - 2), NOW).ok);
check('two steps forward is rejected', !verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here + 2), NOW).ok);
check('verify reports which step matched', (() => {
  const r = verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here - 1), NOW);
  return r.ok && r.step === here - 1;
})());

// --- replay ---
check('a spent code cannot be replayed inside its own window', (() => {
  const code = codeForStep(RFC_SECRET, here);
  const first = verifyCode(RFC_SECRET, code, NOW);
  if (!first.ok) return false;
  return !verifyCode(RFC_SECRET, code, NOW + 1000, first.step).ok;
})());
check('an older code is refused once a newer step was used', !verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here - 1), NOW, here).ok);
check('the next step still works after a code was spent', verifyCode(RFC_SECRET, codeForStep(RFC_SECRET, here + 1), NOW, here).ok);

// --- malformed input never reaches the HMAC compare ---
check('empty code rejected', !verifyCode(RFC_SECRET, '', NOW).ok);
check('non-digits rejected', !verifyCode(RFC_SECRET, 'abcdef', NOW).ok);
check('wrong length rejected', !verifyCode(RFC_SECRET, '1234567', NOW).ok);
check('spaces are tolerated (apps show "123 456")', (() => {
  const c = codeForStep(RFC_SECRET, here);
  return verifyCode(RFC_SECRET, `${c.slice(0, 3)} ${c.slice(3)}`, NOW).ok;
})());

// --- secrets & URI ---
check('generated secret is 160-bit', generateSecret().length === 20);
check('two secrets differ', base32Encode(generateSecret()) !== base32Encode(generateSecret()));
const uri = otpauthUri('acc-0123456789abcdef', RFC_SECRET);
check('otpauth URI is a totp URI', uri.startsWith('otpauth://totp/DayEnglish:acc-0123456789abcdef?'));
check('otpauth URI carries the base32 secret', uri.includes(`secret=${base32Encode(RFC_SECRET)}`));
check('otpauth URI pins the algorithm apps assume', uri.includes('algorithm=SHA1') && uri.includes('digits=6') && uri.includes(`period=${STEP_SECONDS}`));
check('a scanned URI reproduces our codes', (() => {
  const secret = base32Decode(new URL(uri).searchParams.get('secret')!);
  return codeForStep(secret, here) === codeForStep(RFC_SECRET, here);
})());

// --- backup codes ---
const backup = generateBackupCodes();
check('ten backup codes', backup.length === BACKUP_CODE_COUNT);
check('backup codes are unique', new Set(backup).size === backup.length);
check('backup codes avoid ambiguous glyphs (0/O, 1/I/L)', backup.every((c) => !/[01OIL]/.test(c)));
check('backup code hashing ignores the separator and case', hashBackupCode(backup[0]!) === hashBackupCode(backup[0]!.replace('-', '').toLowerCase()));
check('different codes hash differently', hashBackupCode(backup[0]!) !== hashBackupCode(backup[1]!));

console.log(failures === 0 ? '\ntotp: all checks passed' : `\ntotp: ${failures} FAILED`);
// Set the code and let the loop drain: forcing exit() while a wasm/grpc handle is mid-close trips a
// libuv assertion on Windows and turns a passing run into a nonzero exit.
process.exitCode = failures === 0 ? 0 : 1;
