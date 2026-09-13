import { Hono } from 'hono';
import { BlobUploadRequestSchema, BlobCommitRequestSchema, BLOB_MAX_BYTES, BLOB_ACCOUNT_MAX_BYTES, ErrorCode } from '../contract.js';
import { bearerClaims } from '../tokens.js';
import type { BlobStore } from '../blobs.js';

const err = (code: string, status: 400 | 401 | 403 | 404 | 409 | 413) => Response.json({ error: { code } }, { status });

/** Mount `/v1/blobs/*` (opt-in book-file upload/download). All require a Bearer access token; the account
 *  id is the storage partition. See blobs.ts for the no-reservation quota model. */
export function blobRoutes(store: BlobStore): Hono {
  const app = new Hono();

  // Ask for an upload target. Enforces the per-object cap up front; account quota is re-checked at commit
  // against the ACTUAL uploaded size (the declared size here can't be trusted).
  app.post('/v1/blobs/upload-url', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = BlobUploadRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    if (body.data.size > BLOB_MAX_BYTES) return err(ErrorCode.BlobTooLarge, 413);
    const existing = (await store.list(claims.sub)).find((b) => b.bookId === body.data.bookId)?.size ?? 0;
    if ((await store.usage(claims.sub)) - existing + body.data.size > BLOB_ACCOUNT_MAX_BYTES) return err(ErrorCode.QuotaExceeded, 409);
    return c.json(await store.presignUpload(claims.sub, body.data.bookId));
  });

  // Dev stand-in for the direct-to-storage upload (prod: client PUTs the presigned URL instead).
  app.put('/v1/blobs/data/:key', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = decodeURIComponent(c.req.param('key'));
    if (!key.startsWith(`${claims.sub}/`)) return err(ErrorCode.Unauthorized, 403); // key is another user's prefix
    const bytes = new Uint8Array(await c.req.arrayBuffer());
    if (bytes.byteLength > BLOB_MAX_BYTES) return err(ErrorCode.BlobTooLarge, 413);
    await store.putObject(key, bytes);
    return c.body(null, 204);
  });

  // Finalize: HEAD the object, verify size, re-check quota against actual bytes, then record it.
  app.post('/v1/blobs/commit', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const body = BlobCommitRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    if (body.data.key !== store.objectKey(claims.sub, body.data.bookId)) return err(ErrorCode.BadRequest, 400);
    const stat = await store.statObject(body.data.key);
    if (!stat) return err(ErrorCode.BlobNotFound, 404);
    if (stat.size !== body.data.size) return err(ErrorCode.SizeMismatch, 409);
    const existing = (await store.list(claims.sub)).find((b) => b.bookId === body.data.bookId)?.size ?? 0;
    if ((await store.usage(claims.sub)) - existing + stat.size > BLOB_ACCOUNT_MAX_BYTES) {
      await store.remove(claims.sub, body.data.bookId); // roll back the orphaned object
      return err(ErrorCode.QuotaExceeded, 409);
    }
    return c.json(await store.commit(claims.sub, body.data.bookId, stat.size));
  });

  app.get('/v1/blobs', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    return c.json({ blobs: await store.list(claims.sub), usedBytes: await store.usage(claims.sub), limitBytes: BLOB_ACCOUNT_MAX_BYTES });
  });

  app.get('/v1/blobs/:bookId/download-url', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const bookId = c.req.param('bookId');
    const meta = (await store.list(claims.sub)).find((b) => b.bookId === bookId);
    if (!meta) return err(ErrorCode.BlobNotFound, 404);
    return c.json(await store.presignDownload(claims.sub, bookId));
  });

  app.get('/v1/blobs/data/:key', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    const key = decodeURIComponent(c.req.param('key'));
    if (!key.startsWith(`${claims.sub}/`)) return err(ErrorCode.Unauthorized, 403);
    const bytes = await store.getObject(key);
    if (!bytes) return err(ErrorCode.BlobNotFound, 404);
    return c.body(bytes as unknown as ArrayBuffer, 200, { 'content-type': 'application/octet-stream' });
  });

  app.delete('/v1/blobs/:bookId', async (c) => {
    const claims = await bearerClaims(c);
    if (!claims) return err(ErrorCode.Unauthorized, 401);
    await store.remove(claims.sub, c.req.param('bookId'));
    return c.json({ ok: true });
  });

  return app;
}
