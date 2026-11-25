import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { gameRoutes } from './routes/games.js';
import { InMemoryGameStore, type GameManifest } from './games.js';
import { InMemoryEntitlementStore, TRIAL_MS } from './entitlements.js';
import { signAccess } from './tokens.js';
import { z } from 'zod';
import { createApp } from './app.js';
import { InMemoryAuthStore } from './store.js';
import { GAME_FEATURE, InMemoryFeatureSettingsStore } from './featureSettings.js';

const store = new InMemoryGameStore();
const ent = new InMemoryEntitlementStore();
const game: GameManifest = {
  gameId: 'demo',
  releaseId: '1',
  title: 'Demo',
  entryUrl: 'https://game.example/',
  skills: ['grammar.past-simple'],
  resources: [
    { id: 'intro', access: 'public' },
    {
      id: 'paid',
      access: 'pro',
      assets: [{ id: 'chapter', key: 'private/chapter.json' }],
    },
  ],
};
let signs = 0;
const features = new InMemoryFeatureSettingsStore();
await features.replace(GAME_FEATURE, { expectedRevision: 0, mode: 'public', testAccountIds: [] });
const app = new Hono().route(
  '/',
  gameRoutes(store, ent, [game], { ready: true, store: features }, async () => {
    signs++;
    return 'https://assets.example/signed';
  })
);
const token = (await signAccess('player', 'device')).token;
const otherToken = (await signAccess('other', 'device')).token;
const send = (path: string, body?: unknown, method = 'POST', auth = token) =>
  app.request(`/v1/games${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: `Bearer ${auth}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const allowed = async (response: Response) =>
  z.object({ allowed: z.boolean() }).parse(await response.json()).allowed;
const saved = async (response: Response) =>
  z.object({ save: z.unknown().nullable() }).parse(await response.json()).save;
assert.equal(
  await allowed(
    await send('/demo/access', { resourceId: 'intro' }, 'POST', '')
  ),
  true
);
assert.equal(
  await allowed(await send('/demo/access', { resourceId: 'paid' })),
  false
);
assert.equal(
  (await send('/demo/asset', { resourceId: 'paid', assetId: 'chapter' }))
    .status,
  402
);
assert.equal(signs, 0);
assert.equal(
  JSON.stringify(
    await (await app.request('/v1/games/catalog')).json()
  ).includes('private/chapter'),
  false
);
const save = {
  baseRevision: 0,
  operationId: crypto.randomUUID(),
  schemaVersion: 1,
  payload: { scene: 3 },
};
assert.equal((await send('/demo/saves/0', save, 'PUT')).status, 402);
await ent.put({
  accountId: 'player',
  trialStartedAt: Date.now(),
  aiUsed: 0,
  windowStartedAt: Date.now(),
});
assert.equal(
  (await send('/demo/asset', { resourceId: 'paid', assetId: 'chapter' }))
    .status,
  200
);
assert.equal(signs, 1);
assert.equal(
  await allowed(await send('/demo/access', { resourceId: 'paid' })),
  true
);
assert.equal((await send('/demo/saves/0', save, 'PUT')).status, 200);
assert.equal((await send('/demo/saves/0', save, 'PUT')).status, 200);
assert.equal(
  (await send('/demo/saves/0', { ...save, payload: { scene: 99 } }, 'PUT'))
    .status,
  409
);
const race = await Promise.all(
  [1, 2].map((scene) =>
    send(
      '/demo/saves/0',
      {
        ...save,
        baseRevision: 1,
        operationId: crypto.randomUUID(),
        payload: { scene },
      },
      'PUT'
    )
  )
);
assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
assert.equal(
  await saved(await send('/demo/saves/0', undefined, 'GET', otherToken)),
  null
);
await ent.put({
  accountId: 'player',
  trialStartedAt: Date.now() - TRIAL_MS - 1,
  aiUsed: 0,
  windowStartedAt: Date.now(),
});
assert.equal((await send('/demo/saves/0', undefined, 'GET')).status, 200);
assert.equal((await send('/demo/saves/0', save, 'PUT')).status, 402);
await ent.put({
  accountId: 'player',
  paidUntil: Date.now() + 60000,
  aiUsed: 0,
  windowStartedAt: Date.now(),
});
assert.equal(
  await allowed(await send('/demo/access', { resourceId: 'paid' })),
  true
);
assert.equal((await send('/demo/saves/8', save, 'PUT')).status, 400);
assert.equal((await send('/unknown/saves/0', save, 'PUT')).status, 400);
assert.equal(
  (await send('/demo/saves/0', { ...save, payload: 'x'.repeat(310000) }, 'PUT'))
    .status,
  413
);
await store.purge('player');
assert.equal(await saved(await send('/demo/saves/0', undefined, 'GET')), null);
console.log(
  'Games API: guest/trial/Pro/expiry, isolation, CAS race/retry, quotas, purge PASS'
);

delete process.env.GAMES_ENABLED;
const disabled = createApp();
assert.equal((await disabled.request('/v1/games/catalog')).status, 404);
process.env.GAMES_CATALOG_JSON = JSON.stringify([game]);
const auth = new InMemoryAuthStore();
const integratedStore = new InMemoryGameStore();
const integratedEnt = new InMemoryEntitlementStore();
const integrated = createApp(
  auth,
  undefined,
  undefined,
  integratedEnt,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  integratedStore,
  features
);
const accountId = 'game-owner-0123456789';
const registered = await integrated.request('/v1/auth/register', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    accountId,
    verifier: 'game-verifier-0123456789',
    deviceName: 'Game smoke',
  }),
});
assert.equal(registered.status, 200);
const session = z
  .object({ accessToken: z.string() })
  .parse(await registered.json());
const headers = {
  authorization: `Bearer ${session.accessToken}`,
  'content-type': 'application/json',
};
await integratedEnt.put({
  accountId,
  paidUntil: Date.now() + 60000,
  aiUsed: 0,
  windowStartedAt: Date.now(),
});
assert.equal(
  (
    await integrated.request('/v1/games/demo/saves/0', {
      method: 'PUT',
      headers,
      body: JSON.stringify(save),
    })
  ).status,
  200
);
assert.equal(
  (await integrated.request('/v1/account', { method: 'DELETE', headers }))
    .status,
  200
);
assert.equal(await integratedStore.get(accountId, 'demo', '0'), null);
assert.equal(
  (await integrated.request('/v1/games/demo/saves/0', { headers })).status,
  401
);
delete process.env.GAMES_CATALOG_JSON;
console.log(
  'Games createApp: disabled by default, real session guard, account purge/revoked token PASS'
);
