import { API_BASE } from './config';
import {
  Routes,
  SessionSchema,
  DeviceListSchema,
  DeviceStartResponseSchema,
  DevicePollResponseSchema,
  SyncPushResponseSchema,
  SyncPullResponseSchema,
  BlobUploadTargetSchema,
  BlobMetaSchema,
  BlobListResponseSchema,
  BlobDownloadResponseSchema,
  ApiErrorSchema,
  type AuthRequest,
  type Session,
  type Device,
  type DeviceStartResponse,
  type DevicePollResponse,
  type SyncChange,
  type SyncPushResponse,
  type SyncPullResponse,
  type BlobUploadTarget,
  type BlobMeta,
  type BlobListResponse,
} from './contract';

/** A typed API failure carrying the server's stable `code` (see contract ErrorCode). */
export class ApiFailure extends Error {
  constructor(
    public code: string,
    public status: number,
    message?: string
  ) {
    super(message ?? code);
    this.name = 'ApiFailure';
  }
}

async function request<T>(path: string, init: RequestInit, parse: (j: unknown) => T): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    // Network-level failure — surfaced as a soft error the caller can queue/retry on.
    throw new ApiFailure('network', 0, 'network unreachable');
  }
  const json: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    throw new ApiFailure(
      parsed.success ? parsed.data.error.code : 'bad_request',
      res.status,
      parsed.success ? parsed.data.error.message : undefined
    );
  }
  return parse(json);
}

const asSession = (j: unknown): Session => SessionSchema.parse(j);

export function register(body: AuthRequest): Promise<Session> {
  return request(Routes.register, { method: 'POST', body: JSON.stringify(body) }, asSession);
}

export function login(body: AuthRequest): Promise<Session> {
  return request(Routes.login, { method: 'POST', body: JSON.stringify(body) }, asSession);
}

export function refresh(refreshToken: string): Promise<Session> {
  return request(
    Routes.refresh,
    { method: 'POST', body: JSON.stringify({ refreshToken }) },
    asSession
  );
}

export function logout(refreshToken: string): Promise<void> {
  return request(Routes.logout, { method: 'POST', body: JSON.stringify({ refreshToken }) }, () => undefined);
}

export function listDevices(accessToken: string): Promise<Device[]> {
  return request(
    Routes.devices,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
    (j) => DeviceListSchema.parse(j).devices
  );
}

/** New device: start a link request; returns the code to show + poll on. No auth. */
export function deviceStart(deviceName?: string): Promise<DeviceStartResponse> {
  return request(
    Routes.deviceStart,
    { method: 'POST', body: JSON.stringify({ deviceName }) },
    (j) => DeviceStartResponseSchema.parse(j)
  );
}

/** Authed device: approve a pending request by its code. Returns the new device's self-chosen name. */
export function deviceApprove(accessToken: string, code: string): Promise<{ deviceName?: string }> {
  return request(
    Routes.deviceApprove,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ code }) },
    (j) => ({ deviceName: (j as { deviceName?: string }).deviceName })
  );
}

/** New device: poll until approved; once approved carries the session (one-time). */
export function devicePoll(requestId: string): Promise<DevicePollResponse> {
  return request(
    `${Routes.devicePoll}?requestId=${encodeURIComponent(requestId)}`,
    { method: 'GET' },
    (j) => DevicePollResponseSchema.parse(j)
  );
}

export function deviceRevoke(accessToken: string, deviceId: string): Promise<void> {
  return request(
    Routes.deviceRevoke,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ deviceId }) },
    () => undefined
  );
}

export function deleteAccount(accessToken: string): Promise<void> {
  return request(Routes.account, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } }, () => undefined);
}

export function syncPush(
  accessToken: string,
  body: { cursorSeq: number; changes: SyncChange[]; idempotencyKey: string }
): Promise<SyncPushResponse> {
  return request(
    Routes.sync,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body) },
    (j) => SyncPushResponseSchema.parse(j)
  );
}

export function syncPull(accessToken: string, since: number): Promise<SyncPullResponse> {
  return request(
    `${Routes.sync}?since=${since}`,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
    (j) => SyncPullResponseSchema.parse(j)
  );
}

// --- Book file blobs (slice 3) ---

export function blobUploadUrl(accessToken: string, bookId: string, size: number): Promise<BlobUploadTarget> {
  return request(
    Routes.blobUploadUrl,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ bookId, size }) },
    (j) => BlobUploadTargetSchema.parse(j)
  );
}

export function blobCommit(accessToken: string, bookId: string, key: string, size: number): Promise<BlobMeta> {
  return request(
    Routes.blobCommit,
    { method: 'POST', headers: { authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ bookId, key, size }) },
    (j) => BlobMetaSchema.parse(j)
  );
}

export function blobList(accessToken: string): Promise<BlobListResponse> {
  return request(Routes.blobs, { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } }, (j) => BlobListResponseSchema.parse(j));
}

export function blobDelete(accessToken: string, bookId: string): Promise<void> {
  return request(`${Routes.blobs}/${encodeURIComponent(bookId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${accessToken}` } }, () => undefined);
}

/** A relative target (the dev/skeleton endpoint) needs our Bearer; an absolute one (a prod presigned URL)
 *  is self-authorizing and must NOT get an Authorization header (it would break the signature). */
function targetHeaders(url: string, accessToken: string, extra: Record<string, string> = {}): Record<string, string> {
  return url.startsWith('http') ? extra : { ...extra, authorization: `Bearer ${accessToken}` };
}
const absolute = (url: string): string => (url.startsWith('http') ? url : `${API_BASE}${url}`);

/** Upload the raw bytes to a target from `blobUploadUrl` (direct-to-storage in prod). */
export async function blobUpload(accessToken: string, target: BlobUploadTarget, blob: Blob): Promise<void> {
  const res = await fetch(absolute(target.url), { method: target.method, headers: targetHeaders(target.url, accessToken, target.headers), body: blob });
  if (!res.ok) throw new ApiFailure('blob_upload_failed', res.status);
}

export async function blobDownloadUrl(accessToken: string, bookId: string): Promise<string> {
  const res = await request(
    `${Routes.blobs}/${encodeURIComponent(bookId)}/download-url`,
    { method: 'GET', headers: { authorization: `Bearer ${accessToken}` } },
    (j) => BlobDownloadResponseSchema.parse(j)
  );
  return res.url;
}

export async function blobDownload(accessToken: string, url: string): Promise<Blob> {
  const res = await fetch(absolute(url), { headers: targetHeaders(url, accessToken) });
  if (!res.ok) throw new ApiFailure('blob_download_failed', res.status);
  return res.blob();
}
