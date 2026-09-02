/**
 * Client-side crypto for the no-PII recovery-key account (backend v1). A 128-bit random key is the sole
 * credential; from it we deterministically derive:
 *  - `accountId` — a stable public lookup id (HKDF, "accountId" info),
 *  - `verifier`  — a secret sent to the server over TLS, which argon2id-hashes at rest (HKDF, "verifier").
 * The raw key never leaves the device except as the user's own saved backup. No email/PII involved.
 * See docs/backend-v1-design.md §Auth.
 */

const KEY_BYTES = 16; // 128-bit
const INFO_ACCOUNT = 'dayenglish/v1/accountId';
const INFO_VERIFIER = 'dayenglish/v1/verifier';

/** Crockford base32 (no I/L/O/U — copy-safe), used to render the recovery key for humans. */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const DECODE: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i += 1) m[ALPHABET[i]!] = i;
  // Accept common look-alikes on input.
  Object.assign(m, { O: 0, I: 1, L: 1, U: 27 });
  return m;
})();

function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str: string): Uint8Array {
  const clean = str.toUpperCase().replace(/[^0-9A-Z]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const v = DECODE[ch];
    if (v === undefined) throw new Error('invalid recovery key');
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** Group into 4-char blocks for display: "A1B2-C3D4-…". */
export function formatRecoveryKey(raw: string): string {
  return raw.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}

/** A fresh 128-bit recovery key, rendered as a grouped Crockford-base32 string (the user saves this). */
export function generateRecoveryKey(): string {
  const bytes = new Uint8Array(KEY_BYTES);
  crypto.getRandomValues(bytes);
  return formatRecoveryKey(base32Encode(bytes));
}

/** Parse a user-entered key back to its 16 bytes; throws on a malformed key. */
export function keyToBytes(key: string): Uint8Array {
  const bytes = base32Decode(key);
  if (bytes.length !== KEY_BYTES) throw new Error('invalid recovery key length');
  return bytes;
}

const enc = new TextEncoder();

async function hkdf(keyBytes: Uint8Array, info: string, bits: number): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey('raw', keyBytes, 'HKDF', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: enc.encode(info) },
    base,
    bits
  );
  return new Uint8Array(derived);
}

function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Deterministic public account id (safe to send/store). */
export async function deriveAccountId(key: string): Promise<string> {
  return base64url(await hkdf(keyToBytes(key), INFO_ACCOUNT, 128));
}

/** Secret verifier: sent to the server over TLS, argon2id-hashed there (never stored raw). */
export async function deriveVerifier(key: string): Promise<string> {
  return base64url(await hkdf(keyToBytes(key), INFO_VERIFIER, 256));
}

/** Both derivations at once (what the client needs to register/login). */
export async function deriveCredentials(key: string): Promise<{ accountId: string; verifier: string }> {
  return { accountId: await deriveAccountId(key), verifier: await deriveVerifier(key) };
}
