import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { blobRoutes } from './routes/blobs.js';
import { accountRoutes } from './routes/account.js';
import { entitlementRoutes } from './routes/entitlement.js';
import { billingRoutes } from './routes/billing.js';
import { aiRoutes } from './routes/ai.js';
import { totpRoutes } from './routes/totp.js';
import { InMemoryAuthStore, type AuthStore } from './store.js';
import { InMemorySyncStore, type SyncStore } from './sync.js';
import { InMemoryBlobStore, type BlobStore } from './blobs.js';
import { InMemoryEntitlementStore, indexKeyConfigured, useEphemeralIndexKey, type EntitlementStore } from './entitlements.js';
import { InMemoryAiCacheStore, type AiCacheStore } from './ai.js';
import { InMemoryTotpStore, type TotpStore } from './totp.js';
import { InMemoryRecoveryNameStore, type RecoveryNameStore } from './recoveryName.js';
import { ydbConfigured } from './ydb.js';
import { YdbAuthStore } from './stores/ydbAuth.js';
import { YdbSyncStore } from './stores/ydbSync.js';
import { YcBlobStore } from './stores/ycBlob.js';
import { YdbEntitlementStore } from './stores/ydbEntitlement.js';
import { YdbAiCacheStore } from './stores/ydbAiCache.js';
import { YdbTotpStore } from './stores/ydbTotp.js';
import { YdbRecoveryNameStore } from './stores/ydbRecoveryName.js';
import type { Completer } from './aiProvider.js';
import { jwks } from './tokens.js';
import { ErrorCode } from './contract.js';

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
  totp?: TotpStore,
  names?: RecoveryNameStore
): Hono {
  const real = ydbConfigured();
  // Without a real database there is no Lockbox either; a per-process key keeps dev and the in-process
  // smokes on the same code path as production instead of special-casing the hash.
  if (!real) useEphemeralIndexKey();
  if (real && !indexKeyConfigured()) console.warn('[entitlements] INDEX_HMAC_KEY missing — billing and the trial will answer 503');
  const authStore = store ?? (real ? new YdbAuthStore() : new InMemoryAuthStore());
  const syncStore = sync ?? (real ? new YdbSyncStore() : new InMemorySyncStore());
  const blobStore = blobs ?? (real ? new YcBlobStore() : new InMemoryBlobStore());
  const entStore = ent ?? (real ? new YdbEntitlementStore() : new InMemoryEntitlementStore());
  const aiCacheStore = aiCache ?? (real ? new YdbAiCacheStore() : new InMemoryAiCacheStore());
  const totpStore = totp ?? (real ? new YdbTotpStore() : new InMemoryTotpStore());
  const nameStore = names ?? (real ? new YdbRecoveryNameStore() : new InMemoryRecoveryNameStore());
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

  /**
   * Reject an oversized body before it is read, let alone parsed.
   *
   * Per-field `.max()` in the schemas is not enough on its own: the body is buffered before zod ever
   * sees it. On a 512 MB instance at concurrency 16, where argon2id already reserves 19 MiB per hash,
   * a few multi-megabyte requests are a cheap unauthenticated way to push it into OOM — and because the
   * platform timeout is per-INSTANCE, one stall takes every co-tenant request down with it.
   *
   * 1 MB clears the largest legitimate request by a wide margin: a sync push is 500 changes and the AI
   * route caps input at 8 000 characters.
   */
  const MAX_BODY_BYTES = 1024 * 1024;
  app.use('/v1/*', async (c, next) => {
    const declared = Number(c.req.header('content-length') ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      return c.json({ error: { code: ErrorCode.InputTooLarge } }, 413);
    }
    return next();
  });

  app.onError((e, c) => {
    // eslint-disable-next-line no-console
    console.error('[api error]', e);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  app.get('/health', (c) => c.text('ok'));
  app.get('/v1/.well-known/jwks.json', async (c) => c.json(await jwks()));
  app.route('/', authRoutes(authStore));
  app.route('/', syncRoutes(syncStore, entStore));
  app.route('/', blobRoutes(blobStore, entStore));
  app.route('/', accountRoutes(authStore, syncStore, blobStore, entStore, totpStore, nameStore));
  app.route('/', entitlementRoutes(entStore));
  app.route('/', billingRoutes(entStore));
  app.route('/', aiRoutes(entStore, aiCacheStore, completer));
  app.route('/', totpRoutes(authStore, totpStore, nameStore));

  return app;
}
