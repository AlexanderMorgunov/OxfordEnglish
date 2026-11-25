import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  GameId,
  SaveWriteSchema,
  type GameManifest,
  type GameStore,
} from '../games.js';
import { bearerClaims } from '../tokens.js';
import { evaluate, type EntitlementStore } from '../entitlements.js';
import { signGameAsset, type GameAssetSigner } from '../stores/gameAssets.js';
import { gameDecision, type GameRollout } from './features.js';

export function gameRoutes(
  store: GameStore,
  ent: EntitlementStore,
  catalog: GameManifest[],
  rollout: GameRollout,
  signAsset: GameAssetSigner = signGameAsset
) {
  const app = new Hono<{ Variables: { gameClaims: Awaited<ReturnType<typeof bearerClaims>> } }>();
  app.use(
    '/v1/games/*',
    bodyLimit({
      maxSize: 300000,
      onError: (c) => c.json({ error: { code: 'input_too_large' } }, 413),
    })
  );
  app.use('/v1/games/*', async (c, next) => {
    if (c.req.method === 'GET' && /^\/v1\/games\/[^/]+\/saves\/[^/]+$/.test(c.req.path))
      return next();
    const decision = await gameDecision(c, rollout);
    if (decision.status !== 200) return c.json({ error: { code: decision.code } }, decision.status);
    if (!decision.allowed) return c.json({ error: { code: 'feature_unavailable' } }, 403);
    c.set('gameClaims', decision.claims);
    await next();
  });
  app.get('/v1/games/catalog', (c) =>
    c.json({
      version: 1,
      games: catalog.map((g) => ({
        ...g,
        resources: g.resources.map((r) => ({ id: r.id, access: r.access })),
      })),
    })
  );
  app.post('/v1/games/:gameId/asset', async (c) => {
    c.header('Cache-Control', 'no-store');
    const game = catalog.find((g) => g.gameId === c.req.param('gameId'));
    const body = await c.req.json().catch(() => null);
    const resource = game?.resources.find((r) => r.id === body?.resourceId);
    const asset = resource?.assets?.find((a) => a.id === body?.assetId);
    if (!resource || !asset)
      return c.json({ error: { code: 'not_found' } }, 404);
    let ttl = 120;
    if (resource.access === 'pro') {
      const claims = c.get('gameClaims');
      if (!claims) return c.json({ error: { code: 'no_plan' } }, 402);
      const plan = evaluate(await ent.get(claims.sub), Date.now());
      if (!plan.active) return c.json({ error: { code: 'no_plan' } }, 402);
      ttl = Math.min(
        ttl,
        Math.floor(
          ((plan.plan === 'pro' ? plan.paidUntil : plan.trialEndsAt) ?? 0) /
            1000 -
            Date.now() / 1000
        )
      );
      if (ttl < 1) return c.json({ error: { code: 'no_plan' } }, 402);
    }
    const url = await signAsset(asset.key, ttl);
    return url
      ? c.json({ url, expiresAt: Date.now() + ttl * 1000 })
      : c.json({ error: { code: 'unavailable' } }, 503);
  });
  app.post('/v1/games/:gameId/access', async (c) => {
    c.header('Cache-Control', 'no-store');
    const game = catalog.find((g) => g.gameId === c.req.param('gameId'));
    const body = await c.req.json().catch(() => null);
    const resource = game?.resources.find((r) => r.id === body?.resourceId);
    if (!resource) return c.json({ error: { code: 'not_found' } }, 404);
    if (resource.access === 'public')
      return c.json({ allowed: true, reason: 'public' });
    const claims = c.get('gameClaims');
    if (!claims) return c.json({ allowed: false, reason: 'no_plan' });
    const plan = evaluate(await ent.get(claims.sub), Date.now());
    return c.json({
      allowed: plan.active,
      reason: plan.active ? 'pro' : 'no_plan',
      expiresAt: plan.plan === 'pro' ? plan.paidUntil : plan.trialEndsAt,
    });
  });
  app.get('/v1/games/:gameId/saves/:slotId', async (c) => {
    c.header('Cache-Control', 'no-store');
    const claims = await bearerClaims(c);
    if (!claims) return c.json({ error: { code: 'unauthorized' } }, 401);
    if (
      !GameId.safeParse(c.req.param('gameId')).success ||
      !/^[0-7]$/.test(c.req.param('slotId'))
    )
      return c.json({ error: { code: 'bad_request' } }, 400);
    return c.json({
      save: await store.get(
        claims.sub,
        c.req.param('gameId'),
        c.req.param('slotId')
      ),
    });
  });
  app.put('/v1/games/:gameId/saves/:slotId', async (c) => {
    const claims = c.get('gameClaims');
    if (!claims) return c.json({ error: { code: 'unauthorized' } }, 401);
    if (
      !catalog.some((g) => g.gameId === c.req.param('gameId')) ||
      !/^[0-7]$/.test(c.req.param('slotId'))
    )
      return c.json({ error: { code: 'bad_request' } }, 400);
    if (!evaluate(await ent.get(claims.sub), Date.now()).active)
      return c.json({ error: { code: 'no_plan' } }, 402);
    const parsed = SaveWriteSchema.safeParse(
      await c.req.json().catch(() => null)
    );
    if (!parsed.success) return c.json({ error: { code: 'bad_request' } }, 400);
    const save = await store.put(
      claims.sub,
      c.req.param('gameId'),
      c.req.param('slotId'),
      parsed.data
    );
    return save
      ? c.json({ save })
      : c.json({ error: { code: 'conflict' } }, 409);
  });
  return app;
}
