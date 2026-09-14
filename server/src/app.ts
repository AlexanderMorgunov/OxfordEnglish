import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { blobRoutes } from './routes/blobs.js';
import { accountRoutes } from './routes/account.js';
import { entitlementRoutes } from './routes/entitlement.js';
import { aiRoutes } from './routes/ai.js';
import { totpRoutes } from './routes/totp.js';
import { InMemoryAuthStore, type AuthStore } from './store.js';
import { InMemorySyncStore, type SyncStore } from './sync.js';
import { InMemoryBlobStore, type BlobStore } from './blobs.js';
import { InMemoryEntitlementStore, type EntitlementStore } from './entitlements.js';
import { InMemoryAiCacheStore, type AiCacheStore } from './ai.js';
import { InMemoryTotpStore, type TotpStore } from './totp.js';
import { ydbConfigured } from './ydb.js';
import { YdbAuthStore } from './stores/ydbAuth.js';
import { YdbSyncStore } from './stores/ydbSync.js';
import { YcBlobStore } from './stores/ycBlob.js';
import { YdbEntitlementStore } from './stores/ydbEntitlement.js';
import { YdbAiCacheStore } from './stores/ydbAiCache.js';
import { YdbTotpStore } from './stores/ydbTotp.js';
import type { Completer } from './aiProvider.js';
import { jwks } from './tokens.js';

/** Build the API app. Storage is injectable (tests pass explicit stores); otherwise it picks the YDB +
 *  Object Storage impls when a real backend is configured (YDB_DATABASE set), else the in-memory skeleton
 *  (local/tests). Separated from index.ts so tests use `app.request(...)` in-process. */
export function createApp(
  store?: AuthStore,
  sync?: SyncStore,
  blobs?: BlobStore,
  ent?: EntitlementStore,
  aiCache?: AiCacheStore,
  completer?: Completer,
  totp?: TotpStore
): Hono {
  const real = ydbConfigured();
  const authStore = store ?? (real ? new YdbAuthStore() : new InMemoryAuthStore());
  const syncStore = sync ?? (real ? new YdbSyncStore() : new InMemorySyncStore());
  const blobStore = blobs ?? (real ? new YcBlobStore() : new InMemoryBlobStore());
  const entStore = ent ?? (real ? new YdbEntitlementStore() : new InMemoryEntitlementStore());
  const aiCacheStore = aiCache ?? (real ? new YdbAiCacheStore() : new InMemoryAiCacheStore());
  const totpStore = totp ?? (real ? new YdbTotpStore() : new InMemoryTotpStore());
  const app = new Hono();

  const origins = (process.env.CORS_ORIGINS ?? 'https://dayenglish.ru,https://www.dayenglish.ru')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    '/v1/*',
    // DELETE is here for /v1/account — without it the browser preflight for delete-account fails.
    cors({ origin: origins, allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'], allowHeaders: ['content-type', 'authorization'], maxAge: 86400 })
  );

  app.onError((e, c) => {
    // eslint-disable-next-line no-console
    console.error('[api error]', e);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  app.get('/health', (c) => c.text('ok'));
  app.get('/v1/.well-known/jwks.json', async (c) => c.json(await jwks()));
  app.route('/', authRoutes(authStore));
  app.route('/', syncRoutes(syncStore));
  app.route('/', blobRoutes(blobStore));
  app.route('/', accountRoutes(authStore, syncStore, blobStore, entStore, totpStore));
  app.route('/', entitlementRoutes(entStore));
  app.route('/', aiRoutes(entStore, aiCacheStore, completer));
  app.route('/', totpRoutes(authStore, totpStore));

  return app;
}
