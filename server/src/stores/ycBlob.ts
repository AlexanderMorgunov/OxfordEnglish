/**
 * BlobStore on Yandex Object Storage (S3-compatible) + YDB book_blobs metadata (Track B). Uploads/downloads
 * go DIRECTLY between the browser and Object Storage via presigned URLs — the API never proxies the bytes.
 * Per-object size is validated at commit via a HEAD (no Content-Length pinning — browsers forbid setting it,
 * so a signed length would 403); account usage = SUM(book_blobs.size).
 */
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { query, TypedValues as T, num } from '../ydb.js';
import { BLOB_MAX_BYTES, type BlobMeta, type BlobUploadTarget } from '../contract.js';
import type { BlobStore } from '../blobs.js';

const PRESIGN_TTL_S = 600;
const str = (v: unknown): string => (v == null ? '' : String(v));
const tsMs = (v: unknown): number => (v instanceof Date ? v.getTime() : v == null ? 0 : Math.floor(Number((v as { toString(): string }).toString()) / 1000));

export class YcBlobStore implements BlobStore {
  private s3: S3Client;
  private bucket: string;

  constructor() {
    this.bucket = process.env.S3_BUCKET ?? '';
    this.s3 = new S3Client({
      region: process.env.S3_REGION ?? 'ru-central1',
      endpoint: process.env.S3_ENDPOINT ?? 'https://storage.yandexcloud.net',
      credentials: { accessKeyId: process.env.S3_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET ?? '' },
    });
  }

  objectKey(userId: string, bookId: string): string {
    return `${userId}/${bookId}`;
  }

  async usage(userId: string): Promise<number> {
    const [rows] = await query('DECLARE $u AS Utf8; SELECT SUM(size) AS total FROM book_blobs WHERE user_id=$u;', { $u: T.utf8(userId) });
    return rows[0] ? num(rows[0].total) : 0;
  }

  async list(userId: string): Promise<BlobMeta[]> {
    const [rows] = await query('DECLARE $u AS Utf8; SELECT book_id, size, uploaded_at FROM book_blobs WHERE user_id=$u;', { $u: T.utf8(userId) });
    return rows.map((r) => ({ bookId: str(r.book_id), size: num(r.size), uploadedAt: tsMs(r.uploaded_at) }));
  }

  async presignUpload(userId: string, bookId: string): Promise<BlobUploadTarget> {
    const key = this.objectKey(userId, bookId);
    const url = await getSignedUrl(this.s3, new PutObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: PRESIGN_TTL_S });
    return { url, method: 'PUT', headers: {}, key, maxBytes: BLOB_MAX_BYTES };
  }

  async presignDownload(userId: string, bookId: string): Promise<{ url: string; method: 'GET' }> {
    const url = await getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(userId, bookId) }), { expiresIn: PRESIGN_TTL_S });
    return { url, method: 'GET' };
  }

  async putObject(key: string, bytes: Uint8Array): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes }));
  }

  async getObject(key: string): Promise<Uint8Array | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return res.Body ? await res.Body.transformToByteArray() : null;
    } catch {
      return null;
    }
  }

  async statObject(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch {
      return null; // 404 / not found
    }
  }

  async commit(userId: string, bookId: string, size: number): Promise<BlobMeta> {
    const uploadedAt = Date.now();
    await query(
      'DECLARE $u AS Utf8; DECLARE $b AS Utf8; DECLARE $s AS Uint64; DECLARE $t AS Timestamp;' +
        'UPSERT INTO book_blobs (user_id, book_id, size, uploaded_at) VALUES ($u, $b, $s, $t);',
      { $u: T.utf8(userId), $b: T.utf8(bookId), $s: T.uint64(size), $t: T.timestamp(new Date(uploadedAt)) }
    );
    return { bookId, size, uploadedAt };
  }

  async remove(userId: string, bookId: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(userId, bookId) })).catch(() => undefined);
    await query('DECLARE $u AS Utf8; DECLARE $b AS Utf8; DELETE FROM book_blobs WHERE user_id=$u AND book_id=$b;', { $u: T.utf8(userId), $b: T.utf8(bookId) });
  }

  async gcOrphans(userId: string, knownBookIds: string[]): Promise<number> {
    const known = new Set(knownBookIds);
    const blobs = await this.list(userId);
    let removed = 0;
    for (const b of blobs) {
      if (!known.has(b.bookId)) {
        await this.remove(userId, b.bookId);
        removed += 1;
      }
    }
    return removed;
  }
}
