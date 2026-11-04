import { z } from 'zod';
import { SessionSchema } from './contract';

export const AccessActionSchema = z.enum([
  'register',
  'login',
  'reauth',
  'attach',
  'recover',
  'reset',
  'change-password',
  'enroll',
  'confirm',
  'cancel-enrollment',
  'codes',
  'acknowledge',
]);
export const AccessPurposeSchema = z.enum([
  'attach',
  'setup',
  'codes',
  'password',
]);
export const AccessTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const AccessRequestSchema = z
  .object({
    action: AccessActionSchema,
    operationToken: AccessTokenSchema,
    login: z.string().max(256).optional(),
    password: z.string().max(2048).optional(),
    credential: z.string().max(2048).optional(),
    credentialType: z.enum(['password', 'key']).optional(),
    code: z.string().max(128).optional(),
    proof: AccessTokenSchema.optional(),
    purpose: AccessPurposeSchema.optional(),
    legacy: z.boolean().optional(),
    enrollmentId: AccessTokenSchema.optional(),
    codesRevision: z.string().max(64).optional(),
    deviceName: z.string().max(60).optional(),
    deviceId: z.string().min(8).max(64).optional(),
  })
  .strict();
export const AccessAccountSchema = z.object({
  login: z.string().nullable(),
  legacyKey: z.boolean(),
  recovery: z.boolean(),
  backupRemaining: z.number().int().nonnegative(),
  backupTotal: z.number().int().nonnegative(),
  codesAcknowledged: z.boolean(),
  codesRevision: z.string().nullable(),
});
export const AccessResultSchema = z.object({
  action: AccessActionSchema,
  accountId: z.string().optional(),
  session: SessionSchema.optional(),
  account: AccessAccountSchema.optional(),
  proof: AccessTokenSchema.optional(),
  expiresAt: z.number().optional(),
  login: z.string().nullable().optional(),
  enrollment: z
    .object({ id: AccessTokenSchema, secret: z.string(), uri: z.string() })
    .optional(),
  codes: z.array(z.string()).optional(),
  completed: z.boolean().optional(),
});
export const AccessCapabilitiesSchema = z.object({
  enabled: z.boolean(),
  passwordMin: z.number(),
  passwordMax: z.number(),
});
export const AccessAvailabilitySchema = z.object({
  login: z.string(),
  available: z.boolean(),
});
export const ACCESS_ROUTES = {
  capabilities: '/v1/access/capabilities',
  availability: '/v1/access/availability',
  status: '/v1/access/status',
  operation: '/v1/access/operation',
  receipt: '/v1/access/receipt',
} as const;
export type AccessAction = z.infer<typeof AccessActionSchema>;
export type AccessPurpose = z.infer<typeof AccessPurposeSchema>;
export type AccessRequest = z.infer<typeof AccessRequestSchema>;
export type AccessResult = z.infer<typeof AccessResultSchema>;
export type AccessAccount = z.infer<typeof AccessAccountSchema>;
