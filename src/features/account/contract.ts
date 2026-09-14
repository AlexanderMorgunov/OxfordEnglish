/**
 * Wire contract for the account/auth API (`/v1/auth/*`), shared by client and the Hono server so the two
 * can't drift. Zod schemas double as runtime validation on both ends. No PII — only derived credentials
 * (see keys.ts) and opaque tokens. See docs/backend-v1-design.md.
 */
import { z } from 'zod';

/** Credentials the client derives from the recovery key (never the raw key). */
export const CredentialsSchema = z.object({
  // Upper bounds as well as lower: unbounded strings on an unauthenticated route are a free way to make
  // a 512 MB container buffer megabytes per request, next to argon2 already holding 19 MiB per hash.
  accountId: z.string().min(16).max(256),
  verifier: z.string().min(16).max(256),
});

/** Register-or-login is one call: create the account if `accountId` is new, else verify. A `deviceName`
 *  is a self-chosen label (e.g. "Chrome on Android") — NOT PII, purely for the per-device revoke list. */
/** The client mints a device id ONCE and reuses it, so one physical device keeps one entry in the
 *  revoke list. Without it the server minted a fresh id per call and "devices" was really a login log —
 *  a new row and a new token family every sign-in, neither ever cleaned up. Scoped to the caller's own
 *  account, so a chosen value can only ever collide with the caller's own device. */
export const AuthRequestSchema = CredentialsSchema.extend({
  deviceName: z.string().max(60).optional(),
  deviceId: z.string().min(8).max(64).optional(),
});

/** Session tokens. `accessToken` is a short-lived JWT (Bearer); `refreshToken` is opaque + rotating. */
export const SessionSchema = z.object({
  accountId: z.string(),
  deviceId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  /** Access-token expiry (epoch ms) so the client can refresh proactively. */
  accessExpiresAt: z.number(),
  /** True when this call created a brand-new account (client then shows the save-your-key screen). */
  created: z.boolean().optional(),
});

export const RefreshRequestSchema = z.object({ refreshToken: z.string() });
export const LogoutRequestSchema = z.object({ refreshToken: z.string() });

// --- Device linking by approval (the already-authed device approves the new one — anti-phishing) ---
export const DeviceStartRequestSchema = z.object({ deviceName: z.string().max(60).optional() });
export const DeviceStartResponseSchema = z.object({
  requestId: z.string(),
  code: z.string(),
  expiresAt: z.number(),
});
export const DeviceApproveRequestSchema = z.object({ code: z.string().min(8).max(64) });
export const DevicePollResponseSchema = z.object({
  status: z.enum(['pending', 'approved', 'expired']),
  session: SessionSchema.optional(),
});
export const DeviceRevokeRequestSchema = z.object({ deviceId: z.string() });

export type DeviceStartResponse = z.infer<typeof DeviceStartResponseSchema>;
export type DevicePollResponse = z.infer<typeof DevicePollResponseSchema>;

/** One entry in the account's device list (for the revoke UI). */
export const DeviceSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().optional(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  current: z.boolean().optional(),
});
export const DeviceListSchema = z.object({ devices: z.array(DeviceSchema) });

/** Uniform error envelope. `code` is stable/machine-readable; `message` is for logs, not the UI. */
export const ApiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string().optional() }),
});

// --- Sync (slice 2) — mirror of server/src/contract.ts ---
export const SyncStoreSchema = z.enum(['srsCards', 'wordStatus', 'attempts', 'checkpoints', 'books', 'bookmarks', 'settings']);
export const SyncChangeSchema = z.object({
  store: SyncStoreSchema,
  id: z.string().min(1).max(200),
  updatedAt: z.number(),
  updatedBy: z.string().min(1).max(64),
  deletedAt: z.number().optional(),
  statusUpdatedAt: z.number().optional(),
  payload: z.unknown(),
});
export const SyncEntrySchema = SyncChangeSchema.extend({ seq: z.number() });
export const SyncPushRequestSchema = z.object({
  cursorSeq: z.number().int().nonnegative(),
  changes: z.array(SyncChangeSchema).max(500),
  idempotencyKey: z.string().min(8).max(200),
});
export const SyncPushResponseSchema = z.object({ head: z.number(), applied: z.array(SyncEntrySchema) });
export const SyncPullResponseSchema = z.object({ head: z.number(), entries: z.array(SyncEntrySchema), snapshot: z.boolean().optional() });

// --- Book file blobs (slice 3) — mirror of server/src/contract.ts ---
export const BLOB_MAX_BYTES = 20 * 1024 * 1024;
export const BLOB_ACCOUNT_MAX_BYTES = 300 * 1024 * 1024;
export const BlobUploadTargetSchema = z.object({
  url: z.string(),
  method: z.enum(['PUT', 'POST']),
  headers: z.record(z.string()),
  key: z.string(),
  maxBytes: z.number(),
});
export const BlobMetaSchema = z.object({ bookId: z.string(), size: z.number(), uploadedAt: z.number() });
export const BlobListResponseSchema = z.object({ blobs: z.array(BlobMetaSchema), usedBytes: z.number(), limitBytes: z.number() });
export const BlobDownloadResponseSchema = z.object({ url: z.string(), method: z.literal('GET') });
export type BlobUploadTarget = z.infer<typeof BlobUploadTargetSchema>;
export type BlobMeta = z.infer<typeof BlobMetaSchema>;
export type BlobListResponse = z.infer<typeof BlobListResponseSchema>;

export type Credentials = z.infer<typeof CredentialsSchema>;
export type AuthRequest = z.infer<typeof AuthRequestSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type SyncStoreName = z.infer<typeof SyncStoreSchema>;
export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncEntry = z.infer<typeof SyncEntrySchema>;
export type SyncPushResponse = z.infer<typeof SyncPushResponseSchema>;
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

// --- Entitlements (paid plan) ---
export const PlanSchema = z.enum(['free', 'trial', 'pro']);
export const EntitlementSchema = z.object({
  plan: PlanSchema,
  active: z.boolean(),
  trialEndsAt: z.number().optional(),
  paidUntil: z.number().optional(),
  ai: z.object({ used: z.number(), limit: z.number(), resetsAt: z.number().optional() }),
});
export const TrialClaimRequestSchema = z.object({ installId: z.string().min(8).max(200) });

/** Plan catalog. Prices are the SERVER's — the client never states an amount, it only renders one. */
export const BillingPlanSchema = z.object({
  code: z.string(),
  days: z.number(),
  priceKopecks: z.number(),
  title: z.string(),
});
export const BillingPlansSchema = z.object({ available: z.boolean(), plans: z.array(BillingPlanSchema) });
/** A grant this account paid for and has not redeemed, for a device that lost its own copy. */
export const UnclaimedGrantSchema = z.object({ grantToken: z.string().nullable() });
/** What checkout hands back: where to pay, and the token that will later be worth the plan. The token
 *  is useless until the payment callback confirms it, so it is safe to keep on the device. */
export const CheckoutResponseSchema = z.object({
  paymentUrl: z.string(),
  grantToken: z.string(),
  invoiceId: z.string(),
  plan: z.string(),
  amountKopecks: z.number(),
});
export type BillingPlan = z.infer<typeof BillingPlanSchema>;
export type BillingPlans = z.infer<typeof BillingPlansSchema>;
export type CheckoutResponse = z.infer<typeof CheckoutResponseSchema>;
export const RedeemRequestSchema = z.object({ grantToken: z.string().min(16).max(200) });

export type Plan = z.infer<typeof PlanSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;

// --- Managed AI (server key) ---
/** Mirrors the server's discriminated union. The proxy takes a NAMED TASK, never raw messages: prompts
 *  are assembled server-side, so model/temperature/token-ceiling are not client inputs. */
export const AiTaskRequestSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('translate'), text: z.string().min(1), sentence: z.string().optional() }),
  z.object({ task: z.literal('simplify'), sentence: z.string().min(1), level: z.string().optional(), stepDown: z.number().int().min(0).max(3).optional() }),
  z.object({ task: z.literal('grammar'), sentence: z.string().min(1), level: z.string().optional() }),
  z.object({ task: z.literal('wordInContext'), word: z.string().min(1), sentence: z.string().min(1) }),
  z.object({ task: z.literal('explain'), prompt: z.string().min(1), userAnswer: z.string(), correct: z.string(), topic: z.string(), attempts: z.array(z.string()).max(20).optional() }),
  z.object({ task: z.literal('hint'), prompt: z.string().min(1), topic: z.string(), userAnswer: z.string().optional() }),
  z.object({ task: z.literal('exercises'), text: z.string().min(1), targets: z.array(z.string()).max(40), count: z.number().int().min(1).max(12).optional() }),
]);
export const AiCompleteResponseSchema = z.object({
  content: z.string(),
  cached: z.boolean(),
  ai: z.object({ used: z.number(), limit: z.number(), resetsAt: z.number().optional() }),
});

export type AiTaskRequest = z.infer<typeof AiTaskRequestSchema>;
export type AiCompleteResponse = z.infer<typeof AiCompleteResponseSchema>;

/** Stable error codes both ends agree on. */
// --- TOTP recovery ---
/** Enrollment happens while logged in; the secret is shown once. Backup codes arrive only from
 *  `confirm`, once the authenticator has proved it works. */
export const TotpEnrollResponseSchema = z.object({ secret: z.string(), uri: z.string() });
export const TotpConfirmRequestSchema = z.object({ code: z.string().min(6).max(12) });
export const TotpConfirmResponseSchema = z.object({ backupCodes: z.array(z.string()) });
/** Disabling accepts EITHER proof: a live code, or the recovery key the user still holds. One of the two
 *  must be present — a session alone is not enough, or a stolen session could strip the second factor. */
export const TotpDisableRequestSchema = z
  .object({ code: z.string().min(6).max(20).optional(), verifier: z.string().min(16).max(256).optional() })
  .refine((v) => !!v.code || !!v.verifier, { message: 'code or verifier required' });
/** `available` is false when the server has no sealing key: the whole feature is off, and offering an
 *  enroll button that can only 503 is worse than showing nothing. */
export const TotpStatusSchema = z.object({ available: z.boolean(), enrolled: z.boolean(), backupCodesLeft: z.number() });
/** Recovery runs without a session: `accountId` is read off the authenticator entry, and `verifier` is
 *  derived from the NEW key. The server keeps the id and swaps only the verifier. */
export const TotpRecoverRequestSchema = z.object({
  accountId: z.string().min(16).max(256),
  code: z.string().min(6).max(20),
  verifier: z.string().min(16).max(256),
  deviceName: z.string().max(60).optional(),
});

/** Separator in a post-recovery composite credential `<accountId>.<key>`. Neither half can contain it:
 *  the id is base64url and the key is Crockford base32. */
export const COMPOSITE_KEY_SEPARATOR = '.';

export type TotpStatus = z.infer<typeof TotpStatusSchema>;
export type TotpEnrollResponse = z.infer<typeof TotpEnrollResponseSchema>;

export const ErrorCode = {
  InvalidCredentials: 'invalid_credentials',
  RateLimited: 'rate_limited',
  RefreshInvalid: 'refresh_invalid',
  RefreshReused: 'refresh_reused',
  BadRequest: 'bad_request',
  TrialAlreadyClaimed: 'trial_already_claimed',
  NoPlan: 'no_plan',
  GrantInvalid: 'grant_invalid',
  QuotaExhausted: 'quota_exhausted',
  InputTooLarge: 'input_too_large',
  AiUnavailable: 'ai_unavailable',
  TotpInvalid: 'totp_invalid',
  TotpAlreadyEnrolled: 'totp_already_enrolled',
  TotpNotEnrolled: 'totp_not_enrolled',
  TotpUnavailable: 'totp_unavailable',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** API route paths (versioned). */
export const Routes = {
  register: '/v1/auth/register',
  login: '/v1/auth/login',
  refresh: '/v1/auth/refresh',
  logout: '/v1/auth/logout',
  devices: '/v1/auth/devices',
  deviceStart: '/v1/auth/device/start',
  deviceApprove: '/v1/auth/device/approve',
  devicePoll: '/v1/auth/device/poll',
  deviceRevoke: '/v1/auth/device/revoke',
  jwks: '/v1/.well-known/jwks.json',
  sync: '/v1/sync',
  blobs: '/v1/blobs',
  blobUploadUrl: '/v1/blobs/upload-url',
  blobCommit: '/v1/blobs/commit',
  account: '/v1/account',
  entitlement: '/v1/entitlement',
  entitlementTrial: '/v1/entitlement/trial',
  entitlementRedeem: '/v1/entitlement/redeem',
  billingPlans: '/v1/billing/plans',
  billingCheckout: '/v1/billing/checkout',
  billingUnclaimed: '/v1/billing/unclaimed',
  ai: '/v1/ai',
  totpStatus: '/v1/totp/status',
  totpEnroll: '/v1/totp/enroll',
  totpConfirm: '/v1/totp/confirm',
  totpDisable: '/v1/totp/disable',
  totpRecover: '/v1/totp/recover',
} as const;
