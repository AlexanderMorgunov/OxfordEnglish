import { Hono } from 'hono';
import { z } from 'zod';
import {
  ACCESS_ROUTES,
  AccessRequestSchema,
  AccessTokenSchema,
} from '../accessContract.js';
import { PASSWORD_MIN, PASSWORD_MAX } from '../accessPolicy.js';
import { bearerClaims } from '../tokens.js';
import { clientIp } from '../rateLimit.js';
import type { AccountAccess } from '../accountAccess.js';

export function accountAccessRoutes(service: AccountAccess): Hono {
  const app = new Hono();
  app.get(ACCESS_ROUTES.capabilities, async (c) =>
    c.json({
      enabled: await service.enabled(),
      passwordMin: PASSWORD_MIN,
      passwordMax: PASSWORD_MAX,
    })
  );
  app.post(ACCESS_ROUTES.availability, async (c) => {
    if (!(await service.enabled()))
      return c.json({ error: { code: 'access_unavailable' } }, 503);
    const body = z
      .object({ login: z.string().max(256) })
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'bad_request' } }, 400);
    const result = await service.availability(body.data.login, clientIp(c));
    if ('error' in result)
      return c.json({ error: { code: result.error } }, result.status);
    return c.json(result);
  });
  app.get(ACCESS_ROUTES.status, async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return c.json({ error: { code: 'unauthorized' } }, 401);
    if (!(await service.enabled()))
      return c.json({ error: { code: 'access_unavailable' } }, 503);
    return c.json(await service.status(claims.sub));
  });
  app.post(ACCESS_ROUTES.operation, async (c) => {
    const body = AccessRequestSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!body.success) return c.json({ error: { code: 'bad_request' } }, 400);
    const result = await service.operation(
      body.data,
      await bearerClaims(c),
      clientIp(c)
    );
    if ('error' in result)
      return c.json({ error: { code: result.error } }, result.status);
    return c.json(result.result);
  });
  app.post(ACCESS_ROUTES.receipt, async (c) => {
    if (!(await service.enabled()))
      return c.json({ error: { code: 'access_unavailable' } }, 503);
    const body = z
      .object({ operationToken: AccessTokenSchema })
      .strict()
      .safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: { code: 'bad_request' } }, 400);
    const result = await service.receipt(
      body.data.operationToken,
      await bearerClaims(c)
    );
    if ('error' in result)
      return c.json({ error: { code: result.error } }, result.status);
    return c.json(result.result);
  });
  return app;
}
