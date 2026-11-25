import assert from 'node:assert/strict';
import { createApp } from './app.js';
import { GAME_FEATURE, FeatureSettingsSchema, InMemoryFeatureSettingsStore, type FeatureEdit, type FeatureKey } from './featureSettings.js';
import { InMemoryAuthStore } from './store.js';
import { InMemoryGameStore, type GameManifest } from './games.js';
import { InMemoryEntitlementStore, applyPayment } from './entitlements.js';
import { signAccess } from './tokens.js';

const owner = 'rollout-tester-0001';
const other = 'rollout-member-0002';
const adminToken = 'fixture-admin-token-rollout-0001';
const origin = 'https://dayenglish.ru';
const game: GameManifest = {
  gameId: 'demo', releaseId: '1', title: 'Demo', entryUrl: 'https://game.example/',
  skills: [],
  resources: [
    { id: 'free', access: 'public' },
    { id: 'pro', access: 'pro', assets: [{ id: 'file', key: 'private/demo' }] },
  ],
};
class TestSettings extends InMemoryFeatureSettingsStore {
  fail = false;
  override async replace(key: FeatureKey, edit: Parameters<InMemoryFeatureSettingsStore['replace']>[1]) {
    const result = await super.replace(key, edit);
    if (this.fail) throw new Error('Synthetic settings write failure');
    return result;
  }
}
process.env.ADMIN_TOKEN = adminToken;
process.env.GAMES_CATALOG_JSON = JSON.stringify([game]);
const auth = new InMemoryAuthStore();
const store = new TestSettings();
const games = new InMemoryGameStore();
const entitlements = new InMemoryEntitlementStore();
const makeApp = (gameStore?: InMemoryGameStore) => createApp(
  auth, undefined, undefined, entitlements, undefined, undefined, undefined,
  undefined, undefined, undefined, gameStore, store,
);
const app = makeApp(games);
for (const id of [owner, other]) await auth.createAccount(id, 'fixture-verifier');
const ownerToken = (await signAccess(owner, 'test-device')).token;
const otherToken = (await signAccess(other, 'test-device')).token;
const request = (path: string, token?: string, method = 'GET', body?: unknown) =>
  app.request('/v1' + path, {
    method, headers: {
      origin,
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const edit = (revision: number, mode: FeatureEdit['mode'], ids: string[], token = adminToken, androidEnabled?: boolean) =>
  request('/admin/features/' + GAME_FEATURE, token, 'POST', { expectedRevision: revision, mode, testAccountIds: ids, androidEnabled });
async function checkAccess(token: string | undefined, allowed: boolean, androidAllowed = false) {
  const response = await request('/features', token);
  assert.equal(response.status, 200);
  const value = await response.json() as { features: Record<FeatureKey, { allowed: boolean; androidAllowed: boolean }> };
  assert.equal(value.features[GAME_FEATURE].allowed, allowed);
  assert.equal(value.features[GAME_FEATURE].androidAllowed, androidAllowed);
  assert.equal(JSON.stringify(value).includes(owner), false);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  const catalog = await request('/games/catalog', token);
  assert.equal(catalog.status, allowed ? 200 : 403);
  assert.equal(catalog.headers.get('cache-control'), 'private, no-store');
  const vary = catalog.headers.get('vary')?.toLowerCase().split(',').map((part) => part.trim());
  assert(vary?.includes('origin') && vary.includes('authorization'));
  assert.equal(JSON.stringify(await catalog.json()).includes('https://game.example/'), allowed);
}

assert.equal(FeatureSettingsSchema.parse({
  mode: 'public', testAccountIds: [], revision: 1, updatedAt: 1,
}).androidEnabled, false);
await checkAccess(undefined, false);
await checkAccess(ownerToken, false);
assert.equal((await edit(0, 'testing', [owner], ownerToken)).status, 401);
assert.equal((await edit(0, 'testing', [owner, 'missing-account-00'])).status, 400);
assert.equal((await edit(0, 'testing', [owner, owner])).status, 400);
assert.equal((await edit(0, 'testing', [owner], adminToken, true)).status, 200);
assert.equal((await request('/features', 'invalid')).status, 401);
await checkAccess(undefined, false);
await checkAccess(otherToken, false);
await checkAccess(ownerToken, true, true);
assert.equal((await request('/games/demo/access', otherToken, 'POST', { resourceId: 'free', accountId: owner })).status, 403);
assert.equal((await request('/games/demo/access', ownerToken, 'POST', { resourceId: 'pro' })).status, 200);
assert.equal((await request('/games/demo/asset', ownerToken, 'POST', { resourceId: 'pro', assetId: 'file' })).status, 402);
const save = { baseRevision: 0, operationId: crypto.randomUUID(), schemaVersion: 1, payload: { stage: 3 } };
assert.equal((await request('/games/demo/saves/0', ownerToken, 'PUT', save)).status, 402);
await entitlements.put(applyPayment(null, other, Date.now(), 30));
assert.equal((await request('/games/demo/saves/0', otherToken, 'PUT', save)).status, 403);

const results = await Promise.all([edit(1, 'public', [owner]), edit(1, 'public', [owner])]);
assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
await checkAccess(undefined, true);
await checkAccess(otherToken, true);
const disabledResponse = await makeApp().request('/v1/features');
const disabledFeatures = await disabledResponse.json() as { features: Record<FeatureKey, { allowed: boolean }> };
assert.equal(disabledFeatures.features[GAME_FEATURE].allowed, false);
assert.equal((await request('/games/demo/saves/0', otherToken, 'PUT', save)).status, 200);
assert.equal((await edit(2, 'public', [owner], adminToken, true)).status, 200);
await checkAccess(undefined, true, true);
assert.equal((await edit(3, 'off', [owner], adminToken, true)).status, 200);
await checkAccess(otherToken, false);
assert.equal((await request('/games/demo/saves/0', otherToken)).status, 200);
assert.equal((await request('/games/demo/saves/0', ownerToken)).status, 200);
assert.equal((await request('/games/demo/asset', otherToken, 'POST', { resourceId: 'pro', assetId: 'file' })).status, 403);

store.fail = true;
assert.equal((await request('/account', ownerToken, 'DELETE')).status, 500);
assert(await auth.getAccount(owner));
assert.deepEqual((await store.get(GAME_FEATURE)).testAccountIds, [owner]);
store.fail = false;
assert.equal((await request('/account', ownerToken, 'DELETE')).status, 200);
assert.equal(await auth.getAccount(owner), null);
assert.deepEqual((await store.get(GAME_FEATURE)).testAccountIds, []);
assert.equal((await store.get(GAME_FEATURE)).androidEnabled, true);
assert.equal((await edit(5, 'testing', [owner])).status, 400);
assert.equal((await request('/features', ownerToken)).status, 401);

console.log('Feature rollout: no-store, default off, roles, all modes, Android opt-in, cache isolation, Pro, CAS and deletion rollback PASS');
