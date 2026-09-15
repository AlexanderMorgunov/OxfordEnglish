import { Hono } from 'hono';
import { SyncPushRequestSchema, ErrorCode } from '../contract.js';
import { bearerClaims } from '../tokens.js';
import { evaluate, type EntitlementStore } from '../entitlements.js';
import type { Change, SyncStore } from '../sync.js';

const err = (code: string, status: 400 | 401 | 402) => Response.json({ error: { code } }, { status });

/**
 * Mount `/v1/sync` (GET pull, POST push). Both require a Bearer access token; the account id is the
 * sync partition. See sync.ts for the resolution/log model.
 *
 * Sync is part of Pro, but only WRITING is. Pull stays open to any authenticated account on purpose:
 * when a subscription lapses the cloud copy is not deleted and must remain retrievable, because
 * holding someone's own learning progress hostage to a payment is not a product decision we are
 * willing to make. This is also promised in the offer at /terms, so it is a contractual rule and not
 * just a UI nicety. A free account that never synced simply pulls an empty changelog.
 */
export function syncRoutes(store: SyncStore, ent: EntitlementStore): Hono {
  const app = new Hono();

  app.get('/v1/sync', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const since = Number(c.req.query('since') ?? '0');
    if (!Number.isFinite(since) || since < 0) return err(ErrorCode.BadRequest, 400);
    // `snapshot=1` continues a baseline past the page cap; without it `since > 0` reads the changelog.
    const snapshot = c.req.query('snapshot') === '1';
    return c.json(await store.pull(claims.sub, since, undefined, snapshot));
  });

  app.post('/v1/sync', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    if (!evaluate(await ent.get(claims.sub), Date.now()).active) return err(ErrorCode.NoPlan, 402);
    const body = SyncPushRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const result = await store.push(claims.sub, body.data.cursorSeq, body.data.changes as Change[], body.data.idempotencyKey);
    return c.json(result);
  });

  return app;
}
