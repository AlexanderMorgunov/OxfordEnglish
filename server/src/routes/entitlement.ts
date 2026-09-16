import { Hono } from 'hono';
import { ErrorCode, TrialClaimRequestSchema, RedeemRequestSchema } from '../contract.js';
import { bearerClaims } from '../tokens.js';
import { evaluate, grantTrial, installHash, type EntitlementStore } from '../entitlements.js';

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
    // This account already holds the trial, so the answer it is asking for is simply its own state.
    // Returning an error here left a client whose first response was lost stuck on "free" until the next
    // boot, with a retry that could only ever make it look worse.
    if (row?.trialStartedAt != null) return c.json(evaluate(row, now));
    const hash = installHash(body.data.installId);
    // Stays an error, and the check above is what makes that safe: an account retrying its OWN claim
    // always has `trialStartedAt` and never reaches here, so this can only be a DIFFERENT account on an
    // install that already drew a trial. Answering with state would be a silent no — the caller is still
    // on `free`, the offer stays on screen, and nothing ever explains why the button does nothing.
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

    const now = Date.now();
    const res = await store.redeemInto(body.data.grantToken, claims.sub, now);
    if (res.status === 'invalid') return err(ErrorCode.GrantInvalid, 400);
    // `already` is not a failure: the grant is this account's own and its days are on the row. Saying
    // "invalid" here is what left a buyer whose answer was lost retrying a purchase they already had.
    return c.json(evaluate(res.row, now));
  });

  return app;
}
