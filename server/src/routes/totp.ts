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
  TotpRecoverByNameRequestSchema,
  RecoveryNameRequestSchema,
  TotpRotateKeyRequestSchema,
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
  type FailScope,
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
  verifyUncounted,
} from '../totp.js';
import {
  type RecoveryNameStore,
  nameHash,
  nameAcceptable,
  nameThrottled,
  noteNameFailure,
  refundNameAttempt,
} from '../recoveryName.js';
import { indexKeyConfigured } from '../indexHash.js';
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
function attemptVerify(
  totp: TotpStore,
  accountId: string,
  code: string,
  key: Buffer,
  now: number,
  scope: FailScope
): Promise<Attempt> {
  return totp.verify<Attempt>(accountId, (row) => {
    if (!row) return { result: { ok: false, reason: 'missing' } };
    const secret = unseal(row, key);
    if (!secret) return { result: { ok: false, reason: 'sealed' } };
    const attempt = verifyAttempt(row, secret, code, now, scope);
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

export function totpRoutes(store: AuthStore, totp: TotpStore, names: RecoveryNameStore): Hono {
  const app = new Hono();
  const recoverLimiter = ipBucketLimiter(IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC);

  /**
   * Everything that happens once a recovery attempt has proved ownership, shared by both recovery
   * routes so the two cannot drift apart on the part that hands out access.
   *
   * The old key may have been stolen rather than lost, so every refresh family dies with it. Access
   * tokens are NOT revoked here — `verifyAccess` checks only the signature, iss/aud and exp, with no
   * revocation lookup — so a thief keeps API access until their current one expires (ACCESS_TTL_S,
   * 1 hour). Bounded and rare, but real: closing it means either a much shorter access TTL or a
   * per-account revocation epoch read on every authed request.
   */
  async function grantRecovery(accountId: string, verifier: string, deviceName?: string): Promise<Session> {
    await store.setVerifier(accountId, await hashVerifier(verifier));
    for (const d of await store.listDevices(accountId)) await store.revokeDevice(accountId, d.deviceId);
    const deviceId = randomUUID();
    await store.touchDevice(accountId, deviceId, deviceName);
    const refreshToken = await store.issueRefresh(accountId, deviceId);
    const access = await signAccess(accountId, deviceId);
    return { accountId, deviceId, accessToken: access.token, refreshToken, accessExpiresAt: access.expiresAt };
  }

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
      // The owner's only window onto an attack. Splitting the counters removed the symptom they used to
      // notice — their own operations answering 429 — so the count is surfaced here instead. Failures on
      // `/recover` come from someone who is NOT signed in, i.e. not from this screen.
      recoverFailures: row?.anonFailCount ?? 0,
      // Whether, not what: the name is stored as a keyed hash and cannot be read back even by us.
      // Degraded rather than fatal, for the same reason `available` is reported instead of thrown: this
      // route is what the whole account screen hangs off, and the name index is the newest table here —
      // a deploy that lands before its migration must not take the screen down with it.
      recoveryName: await names.hasName(claims.sub).catch(() => false),
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
    const res = await attemptVerify(totp, claims.sub, body.data.code, key, now, 'owner');
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
    if (throttled(row, now, 'owner')) return err(ErrorCode.RateLimited, 429);

    // Not `verifyAttempt`: that one refuses unconfirmed rows, which is exactly what this call is here to
    // change. Backup codes do not exist yet either.
    const secret = unseal(row, key);
    if (!secret) return err(ErrorCode.TotpUnavailable, 503);
    const res = verifyCode(secret, body.data.code, now, row.lastStep);
    if (!res.ok) {
      await totp.put(noteFailure(row, now, 'owner'));
      return err(ErrorCode.TotpInvalid, 401);
    }

    const codes = generateBackupCodes();
    await totp.put({
      ...clearFailures(row, 'owner'),
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
        return { result: throttled(row, now, 'owner') ? ('throttled' as const) : ('ok' as const) };
      });
      if (gate === 'not_enrolled') return err(ErrorCode.TotpNotEnrolled, 409);
      if (gate === 'throttled') return err(ErrorCode.RateLimited, 429);

      const account = await store.getAccount(claims.sub);
      if (!account || !(await verifyVerifier(body.data.verifier, account.verifierHash))) {
        await totp.verify(claims.sub, (row) => ({ row: row ? noteFailure(row, now, 'owner') : undefined, result: undefined }));
        return err(ErrorCode.TotpInvalid, 401);
      }
      await totp.remove(claims.sub);
      return c.json({ ok: true });
    }

    if (!body.data.code) return err(ErrorCode.BadRequest, 400);
    const res = await attemptVerify(totp, claims.sub, body.data.code, key, now, 'owner');
    if (!res.ok) {
      if (res.reason === 'sealed') return err(ErrorCode.TotpUnavailable, 503);
      if (res.reason === 'missing' || res.reason === 'unconfirmed') return err(ErrorCode.TotpNotEnrolled, 409);
      return res.reason === 'throttled' ? err(ErrorCode.RateLimited, 429) : err(ErrorCode.TotpInvalid, 401);
    }
    await totp.remove(claims.sub);
    return c.json({ ok: true });
  });

  /**
   * A new recovery key without signing out first.
   *
   * The only route to a fresh key used to be the lost-key flow, which is signed OUT and revokes every
   * device by design — wrong for someone who simply wants to replace a key they think was seen, and
   * impossible for the people who joined by device approval and have never held a key at all.
   *
   * The account id is deliberately unchanged: it keys the blob prefix, the entitlement row, the grant
   * bindings, TOTP, devices and sync, and the client wipes local data when it sees the id change. Only
   * the verifier moves, exactly as recovery already does.
   */
  app.post('/v1/totp/rotate-key', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    const body = TotpRotateKeyRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);

    // Through attemptVerify, on the owner's scope: a bare code check here would be a new unthrottled
    // proof surface. A backup code is accepted too — it is the credential someone in this situation may
    // actually have to hand.
    const now = Date.now();
    const res = await attemptVerify(totp, claims.sub, body.data.code, key, now, 'owner');
    if (!res.ok) {
      if (res.reason === 'sealed') return err(ErrorCode.TotpUnavailable, 503);
      if (res.reason === 'missing' || res.reason === 'unconfirmed') return err(ErrorCode.TotpNotEnrolled, 409);
      return res.reason === 'throttled' ? err(ErrorCode.RateLimited, 429) : err(ErrorCode.TotpInvalid, 401);
    }

    await store.setVerifier(claims.sub, await hashVerifier(body.data.verifier));

    // Opt-in, not automatic. Rotating because a key was seen means rotating against someone who may
    // already hold a refresh family, and that family rotates forever — so the option has to exist. But
    // the device-linked user replacing a key they never had should not be logged out everywhere for it.
    // This device is skipped either way: it is the one doing the rotating.
    if (body.data.revokeOthers) {
      for (const d of await store.listDevices(claims.sub)) {
        if (d.deviceId !== claims.deviceId) await store.revokeDevice(claims.sub, d.deviceId);
      }
    }
    return c.json({ ok: true, usedBackupCode: res.usedBackup });
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
    const res = await attemptVerify(totp, accountId, code, key, now, 'anon');
    if (!res.ok) {
      if (res.reason === 'sealed') return err(ErrorCode.TotpUnavailable, 503);
      // 401, not 429: a 429 here is reachable only for an id that HAS an authenticator, so it answers
      // "does this account use TOTP" to anyone holding an id — and ids are obtainable. The authenticated
      // routes keep 429, where the caller is already known. The per-IP limiter above is untouched.
      return err(ErrorCode.TotpInvalid, 401);
    }
    if (!(await store.getAccount(accountId))) return err(ErrorCode.TotpInvalid, 401);

    const session = await grantRecovery(accountId, verifier, deviceName);
    return c.json({ ...session, usedBackupCode: res.usedBackup, backupCodesLeft: res.row.backupHashes.length });
  });

  /**
   * Recovery addressed by a NAME instead of the account id.
   *
   * The id is derived from the recovery key, so it is missing in exactly the situation recovery exists
   * for. A name is something the user chose and can retype. It is not a credential and grants nothing:
   * it only narrows which accounts the submitted code is tried against.
   *
   * Names are not unique, so this resolves to a set. Two things make that safe, and both are in
   * recoveryName.ts: the candidate set is capped at write time, and the attempt costs one unit per
   * candidate, which keeps the chance of a code matching the WRONG account no higher than the
   * single-account `/recover` above already accepts.
   */
  app.post('/v1/totp/recover-by-name', recoverLimiter, async (c) => {
    const key = sealingKey();
    if (!key) return err(ErrorCode.TotpUnavailable, 503);
    // The name index is keyed under the Lockbox HMAC key. Without it we cannot compute the lookup at
    // all, and an unkeyed fallback would write a reversible hash of a first name.
    if (!indexKeyConfigured()) return err(ErrorCode.TotpUnavailable, 503);
    const body = TotpRecoverByNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const { name, code, verifier, deviceName } = body.data;
    if (!nameAcceptable(name)) return err(ErrorCode.RecoveryNameInvalid, 400);

    const now = Date.now();
    const hash = nameHash(name);
    const ids = await names.candidates(hash);

    // Charged BEFORE the attempt and in one atomic step, so a burst of parallel guesses is cut off by
    // the counter rather than each one reading it stale and passing. A success refunds it below.
    const gate = await names.bumpAttempts(hash, (a) =>
      nameThrottled(a, now)
        ? { result: 'throttled' as const }
        : { row: noteNameFailure(a, hash, now, ids.length), result: 'ok' as const }
    );
    // 429 here, unlike `/recover`, which answers 401 so it cannot be used to ask whether an account id
    // has TOTP. A name reveals nothing of the sort: a name with no accounts behind it is charged too, so
    // every name can reach this. And the user needs to be told to wait rather than to retype.
    if (gate === 'throttled') return err(ErrorCode.RateLimited, 429);

    let winner: { accountId: string; usedBackup: boolean; codesLeft: number } | null = null;
    for (const accountId of ids) {
      // Inside `verify`, one candidate at a time: the single-use `lastStep` and the spending of a backup
      // code have to be written in the same transaction that read them, or a replay slips through.
      const hit = await totp.verify<{ ok: boolean; usedBackup: boolean; codesLeft: number }>(accountId, (row) => {
        const miss = { result: { ok: false, usedBackup: false, codesLeft: 0 } };
        if (!row) return miss;
        const secret = unseal(row, key);
        if (!secret) return miss;
        const a = verifyUncounted(row, secret, code, now);
        // A miss writes NOTHING. The whole point of the name path is that a stranger's attempt leaves no
        // mark on accounts that merely share a name with their target.
        if (!a.ok) return miss;
        return { row: a.row, result: { ok: true, usedBackup: a.usedBackup, codesLeft: a.row.backupHashes.length } };
      });
      if (hit.ok) {
        winner = { accountId, usedBackup: hit.usedBackup, codesLeft: hit.codesLeft };
        break;
      }
    }

    // One answer for "no such name", "no enrolment" and "wrong code" alike, exactly as `/recover` does.
    if (!winner) return err(ErrorCode.TotpInvalid, 401);
    if (!(await store.getAccount(winner.accountId))) return err(ErrorCode.TotpInvalid, 401);

    // Only this attempt's own cost comes back. A full reset would be an unlimited budget against every
    // OTHER holder of the name: anyone can join a name, so an attacker would alternate between guessing
    // at their target and succeeding on a throwaway account of their own.
    await names.bumpAttempts(hash, (a) => ({ row: refundNameAttempt(a, hash, now, ids.length), result: undefined }));
    const session = await grantRecovery(winner.accountId, verifier, deviceName);
    return c.json({ ...session, usedBackupCode: winner.usedBackup, backupCodesLeft: winner.codesLeft });
  });

  /**
   * Choose the name. Here rather than in `routes/account.ts` because it is only ever useful with an
   * authenticator behind it, and it is read by the recovery routes above.
   *
   * A session is proof enough: the name unlocks nothing on its own, so someone holding a stolen session
   * gains nothing by setting one — they already hold the access it would eventually lead to.
   */
  app.post('/v1/recovery-name', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    if (!indexKeyConfigured()) return err(ErrorCode.TotpUnavailable, 503);
    const body = RecoveryNameRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    if (!nameAcceptable(body.data.name)) return err(ErrorCode.RecoveryNameInvalid, 400);
    const res = await names.setName(claims.sub, nameHash(body.data.name), Date.now());
    if (res === 'crowded') return err(ErrorCode.RecoveryNameCrowded, 409);
    return c.json({ ok: true });
  });

  app.delete('/v1/recovery-name', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    await names.clearName(claims.sub);
    return c.json({ ok: true });
  });

  return app;
}
