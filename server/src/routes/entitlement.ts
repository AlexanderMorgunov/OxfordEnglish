import { Hono } from 'hono';
import { ErrorCode, TrialClaimRequestSchema, RedeemRequestSchema } from '../contract.js';
import { bearerClaims } from '../tokens.js';
import { evaluate, grantTrial, applyPayment, installHash, type EntitlementStore } from '../entitlements.js';

const err = (code: string, status: 400 | 401 | 409) => Response.json({ error: { code } }, { status });

/** Mount `/v1/entitlement`. Every gate reads the store rather than a token claim — entitlement can drop
 *  mid-token (refund, lapse, quota) and an hour-long access token cannot be revoked. */
export function entitlementRoutes(store: EntitlementStore): Hono {
  const app = new Hono();

  app.get('/v1/entitlement', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    return c.json(evaluate(await store.get(claims.sub), Date.now()));
  });

  app.post('/v1/entitlement/trial', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = TrialClaimRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);

    const now = Date.now();
    const row = await store.get(claims.sub);
    if (row?.trialStartedAt != null) return err(ErrorCode.TrialAlreadyClaimed, 409);
    const hash = installHash(body.data.installId);
    if (await store.trialClaimed(hash)) return err(ErrorCode.TrialAlreadyClaimed, 409);

    const next = grantTrial(row, claims.sub, now);
    await store.put(next);
    await store.markTrialClaimed(hash);
    return c.json(evaluate(next, now));
  });

  app.post('/v1/entitlement/redeem', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = RedeemRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);

    const days = await store.redeemGrant(body.data.grantToken, claims.sub);
    if (days == null) return err(ErrorCode.GrantInvalid, 400);
    const now = Date.now();
    const next = applyPayment(await store.get(claims.sub), claims.sub, now, days);
    await store.put(next);
    return c.json(evaluate(next, now));
  });

  return app;
}
