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
  EntitlementSchema,
  BillingPlansSchema,
  CheckoutResponseSchema,
  UnclaimedGrantSchema,
  AiCompleteResponseSchema,
  TotpStatusSchema,
  TotpEnrollResponseSchema,
  TotpConfirmResponseSchema,
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
  type Entitlement,
  type BillingPlans,
  type CheckoutResponse,
  type AiTaskRequest,
  type AiCompleteResponse,
  type TotpStatus,
  type TotpEnrollResponse,
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

export function syncPull(accessToken: string, since: number, snapshot = false): Promise<SyncPullResponse> {
  return request(
    `${Routes.sync}?since=${since}${snapshot ? '&snapshot=1' : ''}`,
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

const authed = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

/** Current plan + AI quota. Always fetched, never read off the access token: entitlement can lapse
 *  mid-token (refund, expiry, quota) and an hour-long JWT cannot be revoked. */
export function getEntitlement(accessToken: string): Promise<Entitlement> {
  return request(Routes.entitlement, { method: 'GET', headers: authed(accessToken) }, (j) => EntitlementSchema.parse(j));
}

/** Start the free trial. `installId` lets the server refuse a second trial from the same install
 *  (throws ApiFailure `trial_already_claimed`). */
export function claimTrial(accessToken: string, installId: string): Promise<Entitlement> {
  return request(
    Routes.entitlementTrial,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify({ installId }) },
    (j) => EntitlementSchema.parse(j)
  );
}

/** The plan catalog and whether payments are switched on at all. Public — the paywall has to name a
 *  price before anyone signs in, and the price is the server's to state. */
export function billingPlans(): Promise<BillingPlans> {
  return request(Routes.billingPlans, { method: 'GET' }, (j) => BillingPlansSchema.parse(j));
}

/** Open a checkout. The server prices the plan, mints an unpaid grant bound to this account, and
 *  returns both the acquirer's payment page and the token to redeem once the money lands. */
export function startCheckout(accessToken: string, plan: string): Promise<CheckoutResponse> {
  return request(
    Routes.billingCheckout,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify({ plan }) },
    (j) => CheckoutResponseSchema.parse(j)
  );
}

/** A purchase this account has paid for and not yet redeemed, for a device that never held the token
 *  (bought on another device, or storage cleared). Null when there is nothing outstanding. */
export function unclaimedGrant(accessToken: string): Promise<string | null> {
  return request(Routes.billingUnclaimed, { method: 'GET', headers: authed(accessToken) }, (j) => UnclaimedGrantSchema.parse(j).grantToken);
}

/** Exchange a grant token issued by checkout for paid time. One-time: a replay fails `grant_invalid`. */
export function redeemGrant(accessToken: string, grantToken: string): Promise<Entitlement> {
  return request(
    Routes.entitlementRedeem,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify({ grantToken }) },
    (j) => EntitlementSchema.parse(j)
  );
}

/** Managed-AI call: the server holds the key, assembles the prompt, and charges the account's quota.
 *  Throws ApiFailure with `no_plan` / `quota_exhausted` / `ai_unavailable` — all recoverable by falling
 *  back to BYOK or to the free path, so callers should catch rather than surface a raw error. */
export function aiComplete(accessToken: string, req: AiTaskRequest): Promise<AiCompleteResponse> {
  return request(
    Routes.ai,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify(req) },
    (j) => AiCompleteResponseSchema.parse(j)
  );
}

// --- TOTP recovery ---

/** Whether this account has a working authenticator, and how many backup codes are left. */
export function totpStatus(accessToken: string): Promise<TotpStatus> {
  return request(Routes.totpStatus, { method: 'GET', headers: authed(accessToken) }, (j) => TotpStatusSchema.parse(j));
}

/** Begin enrollment. The secret is returned ONCE — it is not retrievable afterwards, so the caller must
 *  show it before navigating away. Nothing is active until `totpConfirm` succeeds. */
export function totpEnroll(accessToken: string): Promise<TotpEnrollResponse> {
  return request(
    Routes.totpEnroll,
    { method: 'POST', headers: authed(accessToken), body: '{}' },
    (j) => TotpEnrollResponseSchema.parse(j)
  );
}

/** Prove the authenticator works; returns the backup codes, also shown only once. */
export function totpConfirm(accessToken: string, code: string): Promise<string[]> {
  return request(
    Routes.totpConfirm,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify({ code }) },
    (j) => TotpConfirmResponseSchema.parse(j).backupCodes
  );
}

/**
 * Replace the backup codes with a fresh set, proved by a live code.
 *
 * The way out of a lost set — and losing one needs nothing more than a dropped response, since
 * `totpConfirm` shows them once and answers every retry with "already enrolled".
 */
export function totpBackupCodes(accessToken: string, code: string): Promise<string[]> {
  return request(
    Routes.totpBackupCodes,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify({ code }) },
    (j) => TotpConfirmResponseSchema.parse(j).backupCodes
  );
}

/** Turn the authenticator off. Either proof works: a live code, or the recovery key the user still
 *  holds — the second door exists for a phone lost along with the backup codes. */
export function totpDisable(accessToken: string, proof: { code?: string; verifier?: string }): Promise<void> {
  return request(
    Routes.totpDisable,
    { method: 'POST', headers: authed(accessToken), body: JSON.stringify(proof) },
    () => undefined
  );
}

/** Rebind a lost account to a new key. No session: this is the path for someone who has nothing but
 *  their authenticator. `accountId` is read off the authenticator entry's label. */
export function totpRecover(body: {
  accountId: string;
  code: string;
  verifier: string;
  deviceName?: string;
}): Promise<Session> {
  return request(Routes.totpRecover, { method: 'POST', body: JSON.stringify(body) }, asSession);
}
