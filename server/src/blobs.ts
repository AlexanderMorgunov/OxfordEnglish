/**
 * Book-file blob storage (slice 3, opt-in). The route layer talks only to `BlobStore`, so the in-memory
 * skeleton swaps for a Yandex Object Storage impl later. Deliberate design (per audit): NO upload-time
 * reservations — a direct-to-storage upload the API never sees can't be reliably released, so quota would
 * leak on abandoned uploads. Instead the per-object cap is enforced by the storage policy
 * (content-length-range) + a HEAD check at commit, and account usage is the sum of COMMITTED objects.
 *
 * `statObject` is the seam for that HEAD: the in-memory impl answers from its map, the YC impl does a real
 * HEAD against the object key.
 */
import { BLOB_MAX_BYTES, type BlobMeta, type BlobUploadTarget } from './contract.js';

export interface BlobStore {
  /** Total committed bytes for a user (the account-quota basis). */
  usage(userId: string): Promise<number>;
  list(userId: string): Promise<BlobMeta[]>;
  /** The storage key for a user's book file (per-user prefix). MUST equal what the client sends at commit. */
  objectKey(userId: string, bookId: string): string;
  /** Build the client's upload target: dev = a same-API PUT endpoint; prod = a presigned S3 PUT (absolute).
   *  The returned `key` must equal `objectKey(userId, bookId)` (the commit route re-checks it). */
  presignUpload(userId: string, bookId: string): Promise<BlobUploadTarget>;
  /** Build the client's download target (dev = same-API GET; prod = a presigned S3 GET). */
  presignDownload(userId: string, bookId: string): Promise<{ url: string; method: 'GET' }>;
  /** Dev stand-in for the direct-to-storage upload (prod: client PUTs a presigned URL, not this). */
  putObject(key: string, bytes: Uint8Array): Promise<void>;
  getObject(key: string): Promise<Uint8Array | null>;
  /** HEAD the object — the size the storage actually holds (prod: a real HEAD; here: the map). */
  statObject(key: string): Promise<{ size: number } | null>;
  /** Record a committed blob's metadata (replaces any prior meta for that book). */
  commit(userId: string, bookId: string, size: number): Promise<BlobMeta>;
  remove(userId: string, bookId: string): Promise<void>;
  /** Delete committed blobs whose book is no longer live. `knownBookIds` MUST be the authoritative set of a
   *  user's non-tombstoned books from the sync current-state — NOT one client's partial view (that would
   *  delete a blob another device still references). Intended trigger: a server-side maintenance cron, not
   *  a client call. Returns how many blobs were removed. */
  gcOrphans(userId: string, knownBookIds: string[]): Promise<number>;
}

export class InMemoryBlobStore implements BlobStore {
  private objects = new Map<string, Uint8Array>(); // key -> bytes (the "storage")
  private metas = new Map<string, Map<string, BlobMeta>>(); // userId -> bookId -> meta

  objectKey(userId: string, bookId: string): string {
    return `${userId}/${bookId}`;
  }
  async presignUpload(userId: string, bookId: string): Promise<BlobUploadTarget> {
    const key = this.objectKey(userId, bookId);
    return { url: `/v1/blobs/data/${encodeURIComponent(key)}`, method: 'PUT', headers: {}, key, maxBytes: BLOB_MAX_BYTES };
  }
  async presignDownload(userId: string, bookId: string): Promise<{ url: string; method: 'GET' }> {
    return { url: `/v1/blobs/data/${encodeURIComponent(this.objectKey(userId, bookId))}`, method: 'GET' };
  }
  async usage(userId: string): Promise<number> {
    let sum = 0;
    for (const m of this.metas.get(userId)?.values() ?? []) sum += m.size;
    return sum;
  }
  async list(userId: string): Promise<BlobMeta[]> {
    return [...(this.metas.get(userId)?.values() ?? [])];
  }
  async putObject(key: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(key, bytes);
  }
  async getObject(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }
  async statObject(key: string): Promise<{ size: number } | null> {
    const b = this.objects.get(key);
    return b ? { size: b.byteLength } : null;
  }
  async commit(userId: string, bookId: string, size: number): Promise<BlobMeta> {
    const meta: BlobMeta = { bookId, size, uploadedAt: Date.now() };
    const map = this.metas.get(userId) ?? new Map<string, BlobMeta>();
    map.set(bookId, meta);
    this.metas.set(userId, map);
    return meta;
  }
  async remove(userId: string, bookId: string): Promise<void> {
    this.metas.get(userId)?.delete(bookId);
    this.objects.delete(this.objectKey(userId, bookId));
  }
  async gcOrphans(userId: string, knownBookIds: string[]): Promise<number> {
    const known = new Set(knownBookIds);
    let removed = 0;
    for (const bookId of [...(this.metas.get(userId)?.keys() ?? [])]) {
      if (!known.has(bookId)) {
        await this.remove(userId, bookId);
        removed += 1;
      }
    }
    return removed;
  }
}
