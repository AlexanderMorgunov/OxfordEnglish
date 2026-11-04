import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  AuthRequestSchema,
  RefreshRequestSchema,
  LogoutRequestSchema,
  DeviceStartRequestSchema,
  DeviceApproveRequestSchema,
  DeviceRevokeRequestSchema,
  ErrorCode,
  REGISTER_MAX_PER_IP,
  REGISTER_WINDOW_MS,
  IP_BUCKET_CAPACITY,
  IP_BUCKET_REFILL_PER_SEC,
  type Session,
} from '../contract.js';
import { type AuthStore } from '../store.js';
import { hashVerifier, verifyVerifier } from '../password.js';
import { signAccess, bearerClaims } from '../tokens.js';
import { clientIp, ipBucketLimiter } from '../rateLimit.js';
import { accessHandler } from '../accessHandler.js';
import type { AccessSecurity } from '../accessSecurity.js';

const err = (code: string, status: 400 | 401 | 409 | 429) =>
  Response.json({ error: { code } }, { status });

/** Mount all `/v1/auth/*` routes against a storage backend. */
export function authRoutes(store: AuthStore, security?: AccessSecurity): Hono {
  const app = new Hono();
  const transaction = accessHandler(security);

  async function issueSession(accountId: string, deviceName: string | undefined, created: boolean, requestedDeviceId?: string): Promise<Session> {
    if (security && await security.rows.available()) return security.session(accountId, deviceName, requestedDeviceId, created);
    // Reuse the caller's own id when it offers one: a fresh uuid per login turned the device list into a
    // login list and left a token family behind every time.
    const deviceId = requestedDeviceId ?? randomUUID();
    await store.touchDevice(accountId, deviceId, deviceName);
    const refreshToken = await store.issueRefresh(accountId, deviceId);
    const access = await signAccess(accountId, deviceId);
    return { accountId, deviceId, accessToken: access.token, refreshToken, accessExpiresAt: access.expiresAt, created };
  }

  // Separate bucket maps per endpoint (login and device-start must not share a counter).
  const loginLimiter = ipBucketLimiter(IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC);
  const deviceStartLimiter = ipBucketLimiter(IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC);

  app.post('/v1/auth/register', transaction(async (c) => {
    const body = AuthRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    // Password-account UUIDs are server-issued and cannot be claimed through legacy registration.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.data.accountId)) return err(ErrorCode.BadRequest, 400);
    if (!(await store.hitRegisterRate(clientIp(c), REGISTER_WINDOW_MS, REGISTER_MAX_PER_IP))) return err(ErrorCode.RateLimited, 429);
    if (await store.getAccount(body.data.accountId)) return err(ErrorCode.AccountExists, 409);
    // The check above is a separate read, so the INSERT is what actually decides — it loses the race
    // rather than overwriting the winner's credential.
    if (!(await store.createAccount(body.data.accountId, await hashVerifier(body.data.verifier)))) {
      return err(ErrorCode.AccountExists, 409);
    }
    return c.json(await issueSession(body.data.accountId, body.data.deviceName, true, body.data.deviceId));
  }));

  app.post('/v1/auth/login', loginLimiter, transaction(async (c) => {
    const body = AuthRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const account = await store.getAccount(body.data.accountId);
    // Generic failure — no account-existence enumeration.
    if (!account || security && !await security.legacyAllowed(body.data.accountId) || !(await verifyVerifier(body.data.verifier, account.verifierHash))) {
      return err(ErrorCode.InvalidCredentials, 401);
    }
    return c.json(await issueSession(body.data.accountId, body.data.deviceName, false, body.data.deviceId));
  }));

  app.post('/v1/auth/refresh', transaction(async (c) => {
    const body = RefreshRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const rot = await store.rotateRefresh(body.data.refreshToken);
    if (rot.status === 'reused') return err(ErrorCode.RefreshReused, 401);
    if (rot.status === 'invalid') return err(ErrorCode.RefreshInvalid, 401);
    if (security && await security.rows.available() && !await security.refreshAllowed(body.data.refreshToken, rot.accountId)) return err(ErrorCode.RefreshInvalid, 401);
    await store.touchDevice(rot.accountId, rot.deviceId);
    const generation = security && await security.rows.available() ? (await security.account(rot.accountId)).generation : 0;
    if (security && await security.rows.available()) await security.rememberRefresh(rot.token, rot.accountId, generation);
    const access = await signAccess(rot.accountId, rot.deviceId, generation);
    const session: Session = {
      accountId: rot.accountId,
      deviceId: rot.deviceId,
      accessToken: access.token,
      refreshToken: rot.token,
      accessExpiresAt: access.expiresAt,
    };
    return c.json(session);
  }));

  app.post('/v1/auth/logout', transaction(async (c) => {
    const body = LogoutRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    await store.revokeByToken(body.data.refreshToken);
    return c.body(null, 204);
  }));

  const claimsOf = bearerClaims;

  app.get('/v1/auth/devices', transaction(async (c) => {
    const claims = await claimsOf(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const devices = (await store.listDevices(claims.sub)).map((d) => ({ ...d, current: d.deviceId === claims.deviceId }));
    return c.json({ devices });
  }));

  app.post('/v1/auth/device/revoke', transaction(async (c) => {
    const claims = await claimsOf(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = DeviceRevokeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    await store.revokeDevice(claims.sub, body.data.deviceId);
    return c.json({ ok: true });
  }));

  // --- Device linking by approval ---
  // New device starts a request and shows the returned code (no auth).
  app.post('/v1/auth/device/start', deviceStartLimiter, transaction(async (c) => {
    const body = DeviceStartRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const request = await store.createLinkRequest(body.data.deviceName);
    if (security && await security.rows.available()) await security.rememberLink(request.requestId, request.code);
    return c.json(request);
  }));

  // Already-authed device approves a pending request by its code (it should show the new device's name).
  app.post('/v1/auth/device/approve', transaction(async (c) => {
    const claims = await claimsOf(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = DeviceApproveRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const res = await store.approveLink(body.data.code, claims.sub);
    if (res.status !== 'ok') return err(ErrorCode.InvalidCredentials, 401);
    if (security && await security.rows.available()) await security.approveLink(body.data.code, claims.sub);
    return c.json({ ok: true, deviceName: res.deviceName });
  }));

  // New device polls until approved, then receives its session (one-time).
  app.get('/v1/auth/device/poll', transaction(async (c) => {
    const requestId = c.req.query('requestId') ?? '';
    if (!requestId) return err(ErrorCode.BadRequest, 400);
    const res = await store.consumeApprovedLink(requestId);
    if (res.status !== 'approved') return c.json({ status: res.status });
    if (security && await security.rows.available() && !await security.linkAllowed(requestId, res.accountId)) return c.json({ status: 'expired' });
    const generation = security && await security.rows.available() ? (await security.account(res.accountId)).generation : 0;
    if (security && await security.rows.available()) await security.rememberRefresh(res.refreshToken, res.accountId, generation);
    const access = await signAccess(res.accountId, res.deviceId, generation);
    const session: Session = {
      accountId: res.accountId,
      deviceId: res.deviceId,
      accessToken: access.token,
      refreshToken: res.refreshToken,
      accessExpiresAt: access.expiresAt,
    };
    return c.json({ status: 'approved', session });
  }));

  return app;
}
