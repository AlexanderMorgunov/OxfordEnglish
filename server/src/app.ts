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
import { adminRoutes, adminPage, ADMIN_TOKEN_MIN } from './routes/admin.js';
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
  /**
   * Answer every origin, and answer a stranger with the canonical one rather than with nothing.
   *
   * Handed a LIST, Hono omits `Access-Control-Allow-Origin` entirely for an origin it does not know —
   * and the API Gateway in front of us fills that gap with `*`. Measured on the live host: a preflight
   * from `https://dayenglish.ru` comes back with itself, one from `https://evil.example` comes back with
   * `*`. That approves the preflight, so the browser goes on to send the real request; only the RESPONSE
   * is then hidden from the attacker's page. The request still ran, which is the whole problem — the
   * per-IP limiter on `/v1/totp/recover*` is meant to stop the attempt, not to hide its answer, and a
   * page on any domain could spend it from thousands of its visitors' addresses.
   *
   * Naming an origin the caller does not have is what a browser rejects, so nothing downstream runs.
   * Fixing it here rather than in the gateway spec, which lives only in the cloud and is version
   * controlled nowhere.
   */
  const allowOrigin = (origin: string): string => (origins.includes(origin) ? origin : origins[0]!);
  app.use(
    '/v1/*',
    // DELETE is here for /v1/account — without it the browser preflight for delete-account fails.
    // PUT is for the dev stand-in upload route (/v1/blobs/data/:key): prod PUTs the presigned storage URL
    // instead, so this is unused there, but without it book-file upload cannot be exercised in a browser
    // against a local server at all — which is how it stayed untested end to end.
    cors({ origin: allowOrigin, allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'], allowHeaders: ['content-type', 'authorization'], maxAge: 86400 })
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

  // Read here, not at module scope: an import-time read would make "no token → 404" depend on import
  // order and pass or fail by accident. Below the minimum length the surface is NOT mounted — warning
  // and mounting anyway would leave a guessable token as the only thing in front of granting plans.
  const adminToken = process.env.ADMIN_TOKEN ?? '';
  if (adminToken && adminToken.length < ADMIN_TOKEN_MIN) {
    console.warn(`[admin] ADMIN_TOKEN shorter than ${ADMIN_TOKEN_MIN} characters — admin routes not mounted`);
  } else if (adminToken) {
    app.route('/', adminRoutes(new Hono(), adminToken, authStore, entStore));
    app.get('/admin', (c) => c.html(adminPage()));
    console.log('[admin] admin routes mounted (ADMIN_TOKEN is set)');
  }

  return app;
}
