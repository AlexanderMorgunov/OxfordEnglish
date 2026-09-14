import { Hono } from 'hono';
import { SyncPushRequestSchema, ErrorCode } from '../contract.js';
import { bearerClaims } from '../tokens.js';
import type { Change, SyncStore } from '../sync.js';

const err = (code: string, status: 400 | 401) => Response.json({ error: { code } }, { status });

/** Mount `/v1/sync` (GET pull, POST push). Both require a Bearer access token; the account id is the
 *  sync partition. See sync.ts for the resolution/log model. */
export function syncRoutes(store: SyncStore): Hono {
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
    const body = SyncPushRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const result = await store.push(claims.sub, body.data.cursorSeq, body.data.changes as Change[], body.data.idempotencyKey);
    return c.json(result);
  });

  return app;
}
