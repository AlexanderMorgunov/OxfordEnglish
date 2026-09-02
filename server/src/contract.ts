/**
 * Wire contract — MUST stay identical to the client's `src/features/account/contract.ts`. It only
 * depends on zod, so the intended end-state is a shared package both import; until then this is a
 * deliberate mirror (keep the two in sync on any change). See ../../docs/backend-v1-design.md.
 */
import { z } from 'zod';

export const CredentialsSchema = z.object({
  accountId: z.string().min(16),
  verifier: z.string().min(16),
});

export const AuthRequestSchema = CredentialsSchema.extend({
  deviceName: z.string().max(60).optional(),
});

export const SessionSchema = z.object({
  accountId: z.string(),
  deviceId: z.string(),
  accessToken: z.string(),
  refreshToken: z.string(),
  accessExpiresAt: z.number(),
  created: z.boolean().optional(),
});

export const RefreshRequestSchema = z.object({ refreshToken: z.string() });
export const LogoutRequestSchema = z.object({ refreshToken: z.string() });

// --- Device linking by approval (anti-phishing: the already-authed device approves the new one) ---
/** New (unauthenticated) device starts a link request and shows the returned `code`. */
export const DeviceStartRequestSchema = z.object({ deviceName: z.string().max(60).optional() });
export const DeviceStartResponseSchema = z.object({
  requestId: z.string(),
  code: z.string(),
  expiresAt: z.number(),
});
/** Authed device approves a pending request by its code (seeing the new device's name first). */
export const DeviceApproveRequestSchema = z.object({ code: z.string().min(8).max(64) });
export const DeviceApproveResponseSchema = z.object({ ok: z.literal(true), deviceName: z.string().optional() });
/** New device polls until approved; then gets its Session (one-time). */
export const DevicePollResponseSchema = z.object({
  status: z.enum(['pending', 'approved', 'expired']),
  session: SessionSchema.optional(),
});
export const DeviceRevokeRequestSchema = z.object({ deviceId: z.string() });

export const DeviceSchema = z.object({
  deviceId: z.string(),
  deviceName: z.string().optional(),
  createdAt: z.number(),
  lastSeenAt: z.number(),
  current: z.boolean().optional(),
});

export type AuthRequest = z.infer<typeof AuthRequestSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Device = z.infer<typeof DeviceSchema>;

// --- Sync (slice 2) ---
export const SyncStoreSchema = z.enum(['srsCards', 'wordStatus', 'attempts', 'checkpoints', 'books', 'bookmarks', 'settings']);
/** One record change on the wire. `payload` is the full domain row (unknown fields preserved). */
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

export type SyncChange = z.infer<typeof SyncChangeSchema>;
export type SyncEntry = z.infer<typeof SyncEntrySchema>;

export const ErrorCode = {
  InvalidCredentials: 'invalid_credentials',
  AccountExists: 'account_exists',
  RateLimited: 'rate_limited',
  RefreshInvalid: 'refresh_invalid',
  RefreshReused: 'refresh_reused',
  BadRequest: 'bad_request',
  Unauthorized: 'unauthorized',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
