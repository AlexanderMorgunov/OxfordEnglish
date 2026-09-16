/**
 * TOTP enrollment and recovery (`/v1/totp/*`).
 *
 * Recovery exists because `accountId` and `verifier` are both derived from the one recovery key: lose it
 * and the account is unreachable, paid plan and all. A confirmed authenticator proves ownership, and the
 * server then rebinds a NEW verifier onto the SAME `accountId` — see docs/backend-v1-design.md.
 */
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  TotpConfirmRequestSchema,
  TotpDisableRequestSchema,
  TotpRecoverRequestSchema,
  ErrorCode,
  IP_BUCKET_CAPACITY,
  IP_BUCKET_REFILL_PER_SEC,
  type Session,
} from '../contract.js';
import type { AuthStore } from '../store.js';
import {
  type TotpStore,
  type TotpRow,
  type AttemptResult,
  generateSecret,
  otpauthUri,
  base32Encode,
  sealSecret,
  openSecret,
  verifyCode,
  verifyAttempt,
  noteFailure,
  clearFailures,
  throttled,
  generateBackupCodes,
  hashBackupCode,
} from '../totp.js';
import { hashVerifier, verifyVerifier } from '../password.js';
import { signAccess, bearerClaims } from '../tokens.js';
import { ipBucketLimiter } from '../rateLimit.js';

const err = (code: string, status: 400 | 401 | 403 | 409 | 429 | 503) =>
  Response.json({ error: { code } }, { status });

/** The sealing key lives in Lockbox and reaches us as an env var, like the AI key. Absent or wrong-sized
 *  means TOTP is simply unavailable — storing seeds in the clear instead is not a fallback we want. */
function sealingKey(): Buffer | null {
  const raw = process.env.TOTP_ENC_KEY;
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}

export const totpConfigured = (): boolean => sealingKey() !== null;

/** A seed that will not unseal means the sealing key changed under us. Answering 503 says "this feature
 *  is down", which is true and actionable, where an exception would just 500 on every attempt. */
function unseal(row: TotpRow, key: Buffer): Uint8Array | null {
  try {
    return openSecret(row.secretEnc, key);
  } catch {
    return null;
  }
}

/** `missing` = no enrollment at all; `sealed` = the row will not decrypt. Both are kept distinct from a
 *  wrong code inside the server and collapsed to one answer at the edge, where enumeration matters. */
type Attempt = AttemptResult | { ok: false; reason: 'missing' | 'sealed' };

/**
 * One verification attempt: read the row, check the code, and record the failure — all inside a single
 * transaction. Counting failures outside one lets parallel guesses share a stale counter, so the lockout
 * ends up counting database round-trips rather than attempts.
 */
function attemptVerify(totp: TotpStore, accountId: string, code: string, key: Buffer, now: number): Promise<Attempt> {
  return totp.verify<Attempt>(accountId, (row) => {
    if (!row) return { result: { ok: false, reason: 'missing' } };
    const secret = unseal(row, key);
    if (!secret) return { result: { ok: false, reason: 'sealed' } };
    const attempt = verifyAttempt(row, secret, code, now);
    return { row: attempt.row, result: attempt };
  });
}

const freshRow = (accountId: string, secretEnc: string): TotpRow => ({
  accountId,
  secretEnc,
  backupHashes: [],
  failCount: 0,
  failWindowStart: 0,
});

export function totpRoutes(store: AuthStore, totp: TotpStore): Hono {
  const app = new Hono();
  const recoverLimiter = ipBucketLimiter(IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC);

  app.get('/v1/totp/status', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const row = await totp.get(claims.sub);
    const enrolled = !!row?.confirmedAt;
    // Reported rather than 503: this is the one route that must answer while the feature is off, so the
    // UI can stay silent instead of offering a button that only errors.
    return c.json({
      available: totpConfigured(),
      enrolled,
      backupCodesLeft: enrolled ? row.backupHashes.length : 0,
      // An enrollment started and not finished. Read-only on purpose: the UI needs to know whether a
      // half-finished setup exists, and `enroll` cannot answer that — it MINTS one when none exists,
      // so asking it would create the very state it was meant to report.
      pending: !!row && !row.confirmedAt,
    });
  });

  app.post('/v1/totp/enroll', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    const existing = await totp.get(claims.sub);
    if (existing?.confirmedAt) return err(ErrorCode.TotpAlreadyEnrolled, 409);

    // Hand back a pending enrollment rather than minting over it. A second call — a retry after a lost
    // response, a reload, a second tab — used to replace the secret behind an already-scanned QR, so the
    // authenticator the user had just set up produced codes `confirm` rejected, each one counted as a
    // failure on the way to a lockout.
    const pending = existing ? unseal(existing, key) : null;
    if (pending) return c.json({ secret: base32Encode(pending), uri: otpauthUri(claims.sub, pending) });

    const secret = generateSecret();
    await totp.put(freshRow(claims.sub, sealSecret(secret, key)));
    return c.json({ secret: base32Encode(secret), uri: otpauthUri(claims.sub, secret) });
  });

  /**
   * A fresh set of backup codes, replacing whatever is on the row.
   *
   * Without this there is no way back from a lost set, and losing one takes nothing more than a dropped
   * response: `confirm` shows the codes exactly once, stores only their hashes, and answers every retry
   * with "already enrolled". That left people holding a live authenticator, no codes, and a UI that
   * still claimed they were not enrolled.
   *
   * Proof required is a live code — the same bar as disabling, and the person must have the app in hand.
   */
  app.post('/v1/totp/backup-codes', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    const body = TotpConfirmRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);

    const now = Date.now();
    const res = await attemptVerify(totp, claims.sub, body.data.code, key, now);
    if (!res.ok) {
      if (res.reason === 'sealed') return err(ErrorCode.TotpUnavailable, 503);
      if (res.reason === 'missing' || res.reason === 'unconfirmed') return err(ErrorCode.TotpNotEnrolled, 409);
      return res.reason === 'throttled' ? err(ErrorCode.RateLimited, 429) : err(ErrorCode.TotpInvalid, 401);
    }

    const codes = generateBackupCodes();
    await totp.verify(claims.sub, (row) => ({
      row: row ? { ...row, backupHashes: codes.map(hashBackupCode) } : undefined,
      result: undefined,
    }));
    return c.json({ backupCodes: codes });
  });

  /**
   * Abandon a setup that was never confirmed.
   *
   * Needed because `enroll` returns the pending secret rather than minting over it (which is what keeps
   * an already-scanned QR working across an app switch) — so without this, a half-finished enrollment
   * is immortal: every later attempt hands back the same secret, and there is no way to start clean
   * after the key was shoulder-surfed or half-configured.
   *
   * Scoped to the caller's own account, and refuses a CONFIRMED row: taking away a live second factor
   * is what /v1/totp/disable is for, and that deliberately demands a code or the recovery key.
   */
  app.post('/v1/totp/cancel', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const removed = await totp.removeIfUnconfirmed(claims.sub);
    if (!removed) return err(ErrorCode.TotpAlreadyEnrolled, 409);
    return c.json({ ok: true });
  });

  app.post('/v1/totp/confirm', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    const body = TotpConfirmRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);

    const row = await totp.get(claims.sub);
    if (!row) return err(ErrorCode.TotpNotEnrolled, 409);
    if (row.confirmedAt) return err(ErrorCode.TotpAlreadyEnrolled, 409);
    const now = Date.now();
    if (throttled(row, now)) return err(ErrorCode.RateLimited, 429);

    // Not `verifyAttempt`: that one refuses unconfirmed rows, which is exactly what this call is here to
    // change. Backup codes do not exist yet either.
    const secret = unseal(row, key);
    if (!secret) return err(ErrorCode.TotpUnavailable, 503);
    const res = verifyCode(secret, body.data.code, now, row.lastStep);
    if (!res.ok) {
      await totp.put(noteFailure(row, now));
      return err(ErrorCode.TotpInvalid, 401);
    }

    const codes = generateBackupCodes();
    await totp.put({
      ...clearFailures(row),
      confirmedAt: now,
      lastStep: res.step,
      backupHashes: codes.map(hashBackupCode),
    });
    return c.json({ backupCodes: codes });
  });

  // Disabling needs more than a session: a stolen session grants nothing new on its own, but stripping
  // the second factor would leave the real owner unable to ever recover. Either proof is accepted — a
  // live code, or the recovery key itself. Without the second door, someone who still has their key but
  // lost both the phone and the backup codes could never replace a dead enrollment.
  app.post('/v1/totp/disable', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    const body = TotpDisableRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);

    const now = Date.now();

    if (body.data.verifier) {
      // Gate on the throttle BEFORE argon2: this branch is otherwise the only argon2 path on the whole
      // surface with no limiter in front of it, which makes it an amplifier as well as a guessing oracle.
      const gate = await totp.verify(claims.sub, (row) => {
        if (!row?.confirmedAt) return { result: 'not_enrolled' as const };
        return { result: throttled(row, now) ? ('throttled' as const) : ('ok' as const) };
      });
      if (gate === 'not_enrolled') return err(ErrorCode.TotpNotEnrolled, 409);
      if (gate === 'throttled') return err(ErrorCode.RateLimited, 429);

      const account = await store.getAccount(claims.sub);
      if (!account || !(await verifyVerifier(body.data.verifier, account.verifierHash))) {
        await totp.verify(claims.sub, (row) => ({ row: row ? noteFailure(row, now) : undefined, result: undefined }));
        return err(ErrorCode.TotpInvalid, 401);
      }
      await totp.remove(claims.sub);
      return c.json({ ok: true });
    }

    if (!body.data.code) return err(ErrorCode.BadRequest, 400);
    const res = await attemptVerify(totp, claims.sub, body.data.code, key, now);
    if (!res.ok) {
      if (res.reason === 'sealed') return err(ErrorCode.TotpUnavailable, 503);
      if (res.reason === 'missing' || res.reason === 'unconfirmed') return err(ErrorCode.TotpNotEnrolled, 409);
      return res.reason === 'throttled' ? err(ErrorCode.RateLimited, 429) : err(ErrorCode.TotpInvalid, 401);
    }
    await totp.remove(claims.sub);
    return c.json({ ok: true });
  });

  app.post('/v1/totp/recover', recoverLimiter, async (c) => {
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    const body = TotpRecoverRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const { accountId, code, verifier, deviceName } = body.data;

    // Every failure below answers `totp_invalid`: telling "no such account" apart from "wrong code"
    // would make this endpoint an oracle for guessing account ids.
    const now = Date.now();
    const res = await attemptVerify(totp, accountId, code, key, now);
    if (!res.ok) {
      if (res.reason === 'sealed') return err(ErrorCode.TotpUnavailable, 503);
      return res.reason === 'throttled' ? err(ErrorCode.RateLimited, 429) : err(ErrorCode.TotpInvalid, 401);
    }
    if (!(await store.getAccount(accountId))) return err(ErrorCode.TotpInvalid, 401);

    await store.setVerifier(accountId, await hashVerifier(verifier));
    // The old key may have been stolen rather than lost, so every refresh family dies with it. Access
    // tokens are NOT revoked here — `verifyAccess` checks only the signature, iss/aud and exp, with no
    // revocation lookup — so a thief keeps API access until their current one expires (ACCESS_TTL_S,
    // 1 hour). Bounded and rare, but real: closing it means either a much shorter access TTL or a
    // per-account revocation epoch read on every authed request.
    for (const d of await store.listDevices(accountId)) await store.revokeDevice(accountId, d.deviceId);

    const deviceId = randomUUID();
    await store.touchDevice(accountId, deviceId, deviceName);
    const refreshToken = await store.issueRefresh(accountId, deviceId);
    const access = await signAccess(accountId, deviceId);
    const session: Session = {
      accountId,
      deviceId,
      accessToken: access.token,
      refreshToken,
      accessExpiresAt: access.expiresAt,
    };
    return c.json({ ...session, usedBackupCode: res.usedBackup, backupCodesLeft: res.row.backupHashes.length });
  });

  return app;
}
