/**
 * Keyed hashes used as lookup keys for things we must be able to FIND but must not be able to READ.
 *
 * Three domains share one key: payment grant bindings, trial install markers, and recovery names. They
 * share it deliberately — a second Lockbox secret means a second chance to deploy a revision without it,
 * and the domain prefix already keeps the spaces apart.
 *
 * A plain hash would do only if the preimages were unguessable, and none of them are. An account id is
 * the prefix of every book's object key, so it rides in presigned URLs. An install id is stamped into
 * synced rows as `updatedBy`, i.e. it sits in the same database as the table it was meant to protect. A
 * recovery name is a first name or a nickname — a dictionary of thousands, reversible in milliseconds.
 *
 * Absent, this fails LOUDLY. `TOTP_ENC_KEY` may degrade to null because AES-GCM authenticates, so a
 * wrong key refuses to open; an HMAC under a wrong key yields a perfectly well-formed value bound to
 * nobody, which reads back exactly like "this is not yours" and is durable.
 */
import { createHmac, randomBytes } from 'node:crypto';

function indexKey(): Buffer {
  const raw = process.env.INDEX_HMAC_KEY;
  if (!raw) throw new Error('INDEX_HMAC_KEY is not set — refusing to compute an index hash');
  const key = Buffer.from(raw, 'base64');
  if (key.length < 32) throw new Error('INDEX_HMAC_KEY must be at least 32 bytes (base64)');
  return key;
}

/** Whether the key is usable, so routes that need it can answer 503 instead of 500. Deliberately not a
 *  boot check: a missing key should take billing and the trial offline, not the whole API. */
export function indexKeyConfigured(): boolean {
  try {
    indexKey();
    return true;
  } catch {
    return false;
  }
}

/** Dev and the in-process smokes have no Lockbox. A per-process random key keeps them on the same code
 *  path; the values simply do not outlive the process. */
export function useEphemeralIndexKey(): void {
  if (!process.env.INDEX_HMAC_KEY) process.env.INDEX_HMAC_KEY = randomBytes(32).toString('base64');
}

/** Version prefix on every stored index hash. Makes "how many rows are still in the old form" a real
 *  query, lets the code notice an unmigrated row instead of silently answering "not yours", and makes a
 *  future key change recognisable rather than silent. */
export const INDEX_HASH_VERSION = 'v2:';

export const keyedHash = (domain: string, value: string): string =>
  INDEX_HASH_VERSION + createHmac('sha256', indexKey()).update(`${domain}:${value}`).digest('base64');
