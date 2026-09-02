/**
 * Wire contract for the account/auth API (`/v1/auth/*`), shared by client and the Hono server so the two
 * can't drift. Zod schemas double as runtime validation on both ends. No PII — only derived credentials
 * (see keys.ts) and opaque tokens. See docs/backend-v1-design.md.
 */
import { z } from 'zod';

/** Credentials the client derives from the recovery key (never the raw key). */
export const CredentialsSchema = z.object({
  accountId: z.string().min(16),
  verifier: z.string().min(16),
});

/** Register-or-login is one call: create the account if `accountId` is new, else verify. A `deviceName`
 *  is a self-chosen label (e.g. "Chrome on Android") — NOT PII, purely for the per-device revoke list. */
export const AuthRequestSchema = CredentialsSchema.extend({
  deviceName: z.string().max(60).optional(),
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

export type Credentials = z.infer<typeof CredentialsSchema>;
export type AuthRequest = z.infer<typeof AuthRequestSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type Device = z.infer<typeof DeviceSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Stable error codes both ends agree on. */
export const ErrorCode = {
  InvalidCredentials: 'invalid_credentials',
  RateLimited: 'rate_limited',
  RefreshInvalid: 'refresh_invalid',
  RefreshReused: 'refresh_reused',
  BadRequest: 'bad_request',
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
} as const;
