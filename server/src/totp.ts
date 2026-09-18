/**
 * TOTP (RFC 6238) core — pure functions, no I/O, `now` always passed in.
 *
 * Why an authenticator and not e-mail: the account holds no PII, so there is no address to send to.
 * An open-standard authenticator works offline, on any app, and needs no Google services — which also
 * matters for a RuStore build. The seed and the backup codes are random secrets, not personal data, so
 * the no-PII posture survives.
 *
 * Defaults are the ones every authenticator app assumes: SHA-1, 30-second steps, 6 digits. They are NOT
 * a security choice we are free to modernise — an app that scans our QR will compute SHA-1/30/6.
 */
import { createHmac, randomBytes, createHash, createCipheriv, createDecipheriv } from 'node:crypto';
import { constantTimeEqual } from './secrets.js';

export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** Accept the neighbouring steps so a phone clock that is a few seconds off still works. ±1 is the
 *  usual compromise: it triples the codes live at any moment, which is why verification has to be
 *  rate-limited per account rather than relying on the code space. */
export const STEP_WINDOW = 1;

/** RFC 4648 base32 — what `otpauth://` URIs use. Deliberately NOT the Crockford alphabet in
 *  `src/features/account/keys.ts`: that one omits I/L/O/U for copy safety, and feeding it to an
 *  authenticator would produce codes that never match. */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Uint8Array {
  const clean = s.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error('invalid base32');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh 160-bit seed — the size RFC 4226 recommends for HMAC-SHA1. */
export const generateSecret = (): Uint8Array => new Uint8Array(randomBytes(20));

export const stepAt = (nowMs: number): number => Math.floor(nowMs / 1000 / STEP_SECONDS);

/** One code for one time step. Dynamic truncation exactly as RFC 4226 §5.3. */
export function codeForStep(secret: Uint8Array, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  // Steps stay well inside 2^53, so a 32-bit split is enough and avoids BigInt.
  counter.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const mac = createHmac('sha1', Buffer.from(secret)).update(counter).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin =
    ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export type VerifyResult = { ok: false } | { ok: true; step: number };

/**
 * Check a submitted code against the steps around `nowMs`.
 *
 * `lastUsedStep` makes a code single-use: without it a code stays valid for its whole 30–90 s life, so
 * anyone who sees it over a shoulder or in a log can replay it. Callers must persist the returned step
 * and pass it back next time.
 */
export function verifyCode(
  secret: Uint8Array,
  submitted: string,
  nowMs: number,
  lastUsedStep?: number
): VerifyResult {
  const code = submitted.replace(/\s/g, '');
  if (!/^\d+$/.test(code) || code.length !== DIGITS) return { ok: false };
  const current = stepAt(nowMs);
  for (let d = -STEP_WINDOW; d <= STEP_WINDOW; d += 1) {
    const step = current + d;
    if (lastUsedStep != null && step <= lastUsedStep) continue; // already spent
    if (constantTimeEqual(code, codeForStep(secret, step))) return { ok: true, step };
  }
  return { ok: false };
}


/** The URI an authenticator scans. `label` carries the accountId on purpose: after losing the recovery
 *  key that entry is the only place the user can still read their own id, and the same app already holds
 *  the stronger secret, so showing the id there costs nothing. */
export function otpauthUri(accountId: string, secret: Uint8Array, issuer = 'DayEnglish'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountId)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export const BACKUP_CODE_COUNT = 10;

/** One-time codes for the case the authenticator itself is lost. Crockford-ish rendering (no vowels, so
 *  no accidental words) and hashed at rest like refresh tokens — the server never keeps them readable. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const alphabet = '23456789BCDFGHJKMNPQRSTVWXZ';
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const raw = randomBytes(10);
    let s = '';
    for (const b of raw) s += alphabet[b % alphabet.length];
    codes.push(`${s.slice(0, 5)}-${s.slice(5)}`);
  }
  return codes;
}

export const hashBackupCode = (code: string): string =>
  createHash('sha256').update(code.toUpperCase().replace(/[^0-9A-Z]/g, '')).digest('base64');

// --- secret at rest ---
/**
 * Verification needs the plaintext seed, so it cannot be hashed the way the verifier and refresh tokens
 * are. That makes it the one row in the database whose leak is directly exploitable: a seed next to its
 * `accountId` is a single factor away from taking the account over. Sealing it under a key held in
 * Lockbox (never in YDB) keeps a database dump as useless as it is today.
 */
export function sealSecret(secret: Uint8Array, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret), cipher.final()]);
  return [iv, body, cipher.getAuthTag()].map((b) => b.toString('base64url')).join('.');
}

export function openSecret(blob: string, key: Buffer): Uint8Array {
  const [iv, body, tag] = blob.split('.').map((p) => Buffer.from(p, 'base64url'));
  if (!iv || !body || !tag) throw new Error('malformed sealed secret');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return new Uint8Array(Buffer.concat([decipher.update(body), decipher.final()]));
}

// --- persistence ---
export type TotpRow = {
  accountId: string;
  secretEnc: string;
  /** Unset while enrollment is pending: a seed nobody has proved they can read must never unlock anything. */
  confirmedAt?: number;
  lastStep?: number;
  backupHashes: string[];
  /**
   * Failed attempts on the OWNER's routes — confirm, reissue backup codes, disable. Every caller there
   * is authenticated as this account.
   */
  failCount: number;
  failWindowStart: number;
  /**
   * Failed attempts on `/v1/totp/recover`, which needs no session. Separate because the two used to
   * share one counter: a stranger who knew an account id could spend the owner's budget ten requests at
   * a time and keep them locked out of reissuing codes or disabling TOTP, indefinitely. NULL on rows
   * written before the split, which reads as zero.
   */
  anonFailCount?: number;
  anonFailWindowStart?: number;
};

/**
 * Which budget an attempt spends. The axis is authentication, not the route: `/confirm` is on the
 * owner's side because its caller is already authenticated as the account.
 */
export type FailScope = 'owner' | 'anon';

export interface TotpStore {
  get(accountId: string): Promise<TotpRow | null>;
  put(row: TotpRow): Promise<void>;
  remove(accountId: string): Promise<void>;
  /**
   * Read, decide and write as ONE atomic step — how every verification must go.
   *
   * With a plain get→put the failure counter is a lost update: parallel guesses all read the same
   * `failCount`, so it advances about once per database round-trip instead of once per attempt, and the
   * 10-per-15-minutes lockout silently becomes hundreds. Against a six-digit code with a ±1 step
   * tolerance (three live codes, ~333k expected guesses) that is the difference between "not
   * brute-forceable" and "a few days of free, scriptable traffic".
   */
  verify<R>(accountId: string, decide: (row: TotpRow | null) => { row?: TotpRow; result: R }): Promise<R>;
  /**
   * Delete an enrollment ONLY while it is still unconfirmed. Returns whether anything was deleted.
   *
   * Atomic for the same reason `verify` is, and here the stakes are higher than a lost counter: a plain
   * get-then-remove lets a `confirm` land in the gap, turning an innocent "cancel setup" into the one
   * thing /v1/totp/disable refuses to do without a live code or the recovery key — stripping a live
   * second factor. A user pressing Confirm, losing the response and pressing Cancel is all it takes.
   */
  removeIfUnconfirmed(accountId: string): Promise<boolean>;
}

/** Six digits with a ±1 step tolerance leave ~3 codes live at once, so the code space is not what stops
 *  a guessing run — this throttle is. Keyed on the account, because the attack comes at one account from
 *  many addresses, and persisted, because serverless instances share no memory. */
export const VERIFY_MAX_FAILURES = 10;
export const VERIFY_WINDOW_MS = 15 * 60_000;

const counters = (row: TotpRow, scope: FailScope): { count: number; start: number } =>
  scope === 'owner'
    ? { count: row.failCount, start: row.failWindowStart }
    : { count: row.anonFailCount ?? 0, start: row.anonFailWindowStart ?? 0 };

export const throttled = (row: TotpRow, now: number, scope: FailScope): boolean => {
  const { count, start } = counters(row, scope);
  return now - start < VERIFY_WINDOW_MS && count >= VERIFY_MAX_FAILURES;
};

export type AttemptResult =
  | { ok: false; reason: 'throttled' | 'unconfirmed' | 'bad_code'; row: TotpRow }
  | { ok: true; row: TotpRow; usedBackup: boolean };

/**
 * The whole security decision for one submitted code, as a pure function: throttle, then TOTP, then
 * backup codes, with the counters and single-use bookkeeping folded into the returned row. Callers
 * persist `row` whatever the outcome — a failure that is not written down does not throttle anything.
 */
export function verifyAttempt(
  row: TotpRow,
  secret: Uint8Array,
  code: string,
  now: number,
  scope: FailScope
): AttemptResult {
  if (!row.confirmedAt) return { ok: false, reason: 'unconfirmed', row };

  /**
   * A backup code is checked BEFORE the throttle, deliberately.
   *
   * The throttle exists against guessing a six-digit TOTP: a million values, about three live at once,
   * so roughly 333k expected attempts — the code space is not what stops that, the counter is. A backup
   * code is ten characters from a 27-symbol alphabet, about 2·10^14 values, and ten of them live; at the
   * IP limiter's dozen requests a minute, guessing one is out of reach by many orders of magnitude.
   *
   * It is also the one credential a locked-out owner actually holds. Without this, anyone who knows an
   * account id can keep it permanently unrecoverable at ten requests per fifteen minutes — which is the
   * difference between a denial of service that is contained and one that is total.
   */
  const hash = hashBackupCode(code);
  if (row.backupHashes.includes(hash)) {
    const backupHashes = row.backupHashes.filter((h) => h !== hash); // single use
    return { ok: true, row: { ...clearFailures(row, scope), backupHashes }, usedBackup: true };
  }

  if (throttled(row, now, scope)) return { ok: false, reason: 'throttled', row };

  const totp = verifyCode(secret, code, now, row.lastStep);
  if (totp.ok) return { ok: true, row: { ...clearFailures(row, scope), lastStep: totp.step }, usedBackup: false };

  return { ok: false, reason: 'bad_code', row: noteFailure(row, now, scope) };
}

export function noteFailure(row: TotpRow, now: number, scope: FailScope): TotpRow {
  const { count, start } = counters(row, scope);
  const fresh = now - start >= VERIFY_WINDOW_MS;
  const next = fresh ? { count: 1, start: now } : { count: count + 1, start };
  return scope === 'owner'
    ? { ...row, failCount: next.count, failWindowStart: next.start }
    : { ...row, anonFailCount: next.count, anonFailWindowStart: next.start };
}

/** Clears only the scope in play: a routine success on the owner's routes must not wipe an attacker's
 *  `/recover` lockout, and a successful recovery must not wipe the owner's. */
export const clearFailures = (row: TotpRow, scope: FailScope): TotpRow =>
  scope === 'owner'
    ? { ...row, failCount: 0, failWindowStart: 0 }
    : { ...row, anonFailCount: 0, anonFailWindowStart: 0 };

/**
 * One submitted code against ONE candidate account, with no counter bookkeeping at all.
 *
 * Recovery by name cannot go through `verifyAttempt`: that one reads and charges this account's
 * counters, and a name resolves to several accounts, so a stranger typing a common name ten times would
 * lock every holder of it out of their own recovery. The name path is throttled on the NAME instead
 * (see recoveryName.ts), which is why nothing here is counted.
 *
 * What it still does is everything that is not a counter: refuse an unconfirmed enrolment, honour
 * `lastStep` so a code cannot be replayed, and spend a backup code exactly once. The caller persists
 * `row` only on success — a miss against a candidate must leave no trace on that account.
 */
export function verifyUncounted(
  row: TotpRow,
  secret: Uint8Array,
  code: string,
  now: number
): { ok: false } | { ok: true; row: TotpRow; usedBackup: boolean } {
  if (!row.confirmedAt) return { ok: false };

  const hash = hashBackupCode(code);
  if (row.backupHashes.includes(hash)) {
    return { ok: true, row: { ...row, backupHashes: row.backupHashes.filter((h) => h !== hash) }, usedBackup: true };
  }

  const totp = verifyCode(secret, code, now, row.lastStep);
  return totp.ok ? { ok: true, row: { ...row, lastStep: totp.step }, usedBackup: false } : { ok: false };
}

export class InMemoryTotpStore implements TotpStore {
  private rows = new Map<string, TotpRow>();
  async get(accountId: string) {
    return this.rows.get(accountId) ?? null;
  }
  async put(row: TotpRow) {
    this.rows.set(row.accountId, row);
  }
  async remove(accountId: string) {
    this.rows.delete(accountId);
  }
  /** Atomic by construction: nothing awaits between the read and the write. */
  async verify<R>(accountId: string, decide: (row: TotpRow | null) => { row?: TotpRow; result: R }): Promise<R> {
    const { row, result } = decide(this.rows.get(accountId) ?? null);
    if (row) this.rows.set(row.accountId, row);
    return result;
  }
  async removeIfUnconfirmed(accountId: string): Promise<boolean> {
    const row = this.rows.get(accountId);
    if (!row || row.confirmedAt) return false;
    this.rows.delete(accountId);
    return true;
  }
}
