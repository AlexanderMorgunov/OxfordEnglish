/**
 * Verifier hashing — argon2id via hash-wasm (pure wasm, no native build → alpine-safe). The client's
 * `verifier` (derived from the recovery key, never the key itself) is hashed here before storage; the
 * server keeps only the argon2id PHC string. Replaces the earlier scrypt placeholder.
 */
import { argon2id, argon2Verify } from 'hash-wasm';

// OWASP argon2id baseline: 19 MiB, 2 passes, 1 lane.
const PARAMS = { parallelism: 1, iterations: 2, memorySize: 19456, hashLength: 32 } as const;

export async function hashVerifier(verifier: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return argon2id({ password: verifier, salt, ...PARAMS, outputType: 'encoded' });
}

export async function verifyVerifier(verifier: string, storedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password: verifier, hash: storedHash });
  } catch {
    return false; // malformed stored hash → treat as no match
  }
}
