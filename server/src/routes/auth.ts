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
  type Session,
} from '../contract.js';
import { type AuthStore, hashVerifier, verifyVerifier } from '../store.js';
import { signAccess, verifyAccess } from '../tokens.js';

const err = (code: string, status: 400 | 401 | 409) =>
  Response.json({ error: { code } }, { status });

/** Mount all `/v1/auth/*` routes against a storage backend. */
export function authRoutes(store: AuthStore): Hono {
  const app = new Hono();

  async function issueSession(accountId: string, deviceName: string | undefined, created: boolean): Promise<Session> {
    const deviceId = randomUUID();
    await store.touchDevice(accountId, deviceId, deviceName);
    const refreshToken = await store.issueRefresh(accountId, deviceId);
    const access = await signAccess(accountId, deviceId);
    return { accountId, deviceId, accessToken: access.token, refreshToken, accessExpiresAt: access.expiresAt, created };
  }

  app.post('/v1/auth/register', async (c) => {
    const body = AuthRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    if (await store.getAccount(body.data.accountId)) return err(ErrorCode.AccountExists, 409);
    await store.createAccount(body.data.accountId, hashVerifier(body.data.verifier));
    return c.json(await issueSession(body.data.accountId, body.data.deviceName, true));
  });

  app.post('/v1/auth/login', async (c) => {
    const body = AuthRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const account = await store.getAccount(body.data.accountId);
    // Generic failure — no account-existence enumeration.
    if (!account || !verifyVerifier(body.data.verifier, account.verifierHash)) {
      return err(ErrorCode.InvalidCredentials, 401);
    }
    return c.json(await issueSession(body.data.accountId, body.data.deviceName, false));
  });

  app.post('/v1/auth/refresh', async (c) => {
    const body = RefreshRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const rot = await store.rotateRefresh(body.data.refreshToken);
    if (rot.status === 'reused') return err(ErrorCode.RefreshReused, 401);
    if (rot.status === 'invalid') return err(ErrorCode.RefreshInvalid, 401);
    await store.touchDevice(rot.accountId, rot.deviceId);
    const access = await signAccess(rot.accountId, rot.deviceId);
    const session: Session = {
      accountId: rot.accountId,
      deviceId: rot.deviceId,
      accessToken: access.token,
      refreshToken: rot.token,
      accessExpiresAt: access.expiresAt,
    };
    return c.json(session);
  });

  app.post('/v1/auth/logout', async (c) => {
    const body = LogoutRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    await store.revokeByToken(body.data.refreshToken);
    return c.body(null, 204);
  });

  /** Verify the Bearer access token; returns claims or null. */
  const claimsOf = async (c: { req: { header(name: string): string | undefined } }) => {
    const auth = c.req.header('authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    try {
      return await verifyAccess(token);
    } catch {
      return null;
    }
  };

  app.get('/v1/auth/devices', async (c) => {
    const claims = await claimsOf(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const devices = (await store.listDevices(claims.sub)).map((d) => ({ ...d, current: d.deviceId === claims.deviceId }));
    return c.json({ devices });
  });

  app.post('/v1/auth/device/revoke', async (c) => {
    const claims = await claimsOf(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = DeviceRevokeRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    await store.revokeDevice(claims.sub, body.data.deviceId);
    return c.json({ ok: true });
  });

  // --- Device linking by approval ---
  // New device starts a request and shows the returned code (no auth).
  app.post('/v1/auth/device/start', async (c) => {
    const body = DeviceStartRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    return c.json(await store.createLinkRequest(body.data.deviceName));
  });

  // Already-authed device approves a pending request by its code (it should show the new device's name).
  app.post('/v1/auth/device/approve', async (c) => {
    const claims = await claimsOf(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = DeviceApproveRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const res = await store.approveLink(body.data.code, claims.sub);
    if (res.status !== 'ok') return err(ErrorCode.InvalidCredentials, 401);
    return c.json({ ok: true, deviceName: res.deviceName });
  });

  // New device polls until approved, then receives its session (one-time).
  app.get('/v1/auth/device/poll', async (c) => {
    const requestId = c.req.query('requestId') ?? '';
    if (!requestId) return err(ErrorCode.BadRequest, 400);
    const res = await store.consumeApprovedLink(requestId);
    if (res.status !== 'approved') return c.json({ status: res.status });
    const access = await signAccess(res.accountId, res.deviceId);
    const session: Session = {
      accountId: res.accountId,
      deviceId: res.deviceId,
      accessToken: access.token,
      refreshToken: res.refreshToken,
      accessExpiresAt: access.expiresAt,
    };
    return c.json({ status: 'approved', session });
  });

  return app;
}
