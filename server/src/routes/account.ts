import { Hono } from 'hono';
import { bearerClaims } from '../tokens.js';
import { ErrorCode } from '../contract.js';
import type { AuthStore } from '../store.js';
import type { SyncStore } from '../sync.js';
import type { BlobStore } from '../blobs.js';

const err = (code: string, status: 401) => Response.json({ error: { code } }, { status });

/** Delete-account (152-ФЗ right to erasure): purge the caller's blobs, synced data, and auth records. */
export function accountRoutes(auth: AuthStore, sync: SyncStore, blobs: BlobStore): Hono {
  const app = new Hono();

  app.delete('/v1/account', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const userId = claims.sub;
    await blobs.gcOrphans(userId, []); // no known books → removes every blob (S3 objects + book_blobs rows)
    await sync.purge(userId); // changelog + current_state + seq_counter + idempotency
    await auth.deleteAccount(userId); // account + refresh tokens + devices + link requests
    return c.json({ ok: true });
  });

  return app;
}
