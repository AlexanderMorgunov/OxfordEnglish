import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authRoutes } from './routes/auth.js';
import { syncRoutes } from './routes/sync.js';
import { blobRoutes } from './routes/blobs.js';
import { InMemoryAuthStore, type AuthStore } from './store.js';
import { InMemorySyncStore, type SyncStore } from './sync.js';
import { InMemoryBlobStore, type BlobStore } from './blobs.js';
import { jwks } from './tokens.js';

/** Build the API app. Storage is injectable so tests (and the future YDB impl) can swap it; the default
 *  in-memory stores are the local/dev skeleton. Separated from index.ts so tests use `app.request(...)`
 *  in-process without starting a network server. */
export function createApp(
  store: AuthStore = new InMemoryAuthStore(),
  sync: SyncStore = new InMemorySyncStore(),
  blobs: BlobStore = new InMemoryBlobStore()
): Hono {
  const app = new Hono();

  const origins = (process.env.CORS_ORIGINS ?? 'https://dayenglish.ru,https://www.dayenglish.ru')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.use(
    '/v1/*',
    cors({ origin: origins, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type', 'authorization'], maxAge: 86400 })
  );

  app.onError((e, c) => {
    // eslint-disable-next-line no-console
    console.error('[api error]', e);
    return c.json({ error: { code: 'internal' } }, 500);
  });

  app.get('/health', (c) => c.text('ok'));
  app.get('/v1/.well-known/jwks.json', async (c) => c.json(await jwks()));
  app.route('/', authRoutes(store));
  app.route('/', syncRoutes(sync));
  app.route('/', blobRoutes(blobs));

  return app;
}
