/**
 * Wire contract — MUST stay identical to the client's `src/features/account/contract.ts`. It only
 * depends on zod, so the intended end-state is a shared package both import; until then this is a
 * deliberate mirror (keep the two in sync on any change). See ../../docs/backend-v1-design.md.
 */
import { z } from 'zod';

export const CredentialsSchema = z.object({
  // Upper bounds as well as lower: unbounded strings on an unauthenticated route are a free way to make
  // a 512 MB container buffer megabytes per request, next to argon2 already holding 19 MiB per hash.
  accountId: z.string().min(16).max(256),
  verifier: z.string().min(16).max(256),
});

/** The client mints a device id ONCE and reuses it, so one physical device keeps one entry in the
 *  revoke list. Without it the server minted a fresh id per call and "devices" was really a login log —
 *  a new row and a new token family every sign-in, neither ever cleaned up. Scoped to the caller's own
 *  account, so a chosen value can only ever collide with the caller's own device. */
export const AuthRequestSchema = CredentialsSchema.extend({
  deviceName: z.string().max(60).optional(),
  deviceId: z.string().min(8).max(64).optional(),
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

// --- Abuse throttles (rate-limit) ---
// register is the one unauthenticated, cost-unlocking create path (each account unlocks a 300 MB quota), so
// it gets a persisted per-IP fixed-window cap that holds across serverless instances.
//
// 20/day was far too tight for the actual audience: Russian mobile operators put very large subscriber
// pools behind one egress address, so the cap was a per-CARRIER limit, not a per-person one, and the 21st
// honest signup of the day would have been refused with no way to explain it. 300 still kills bulk
// creation — the hard bound on a farmed account is the one-time trial budget, not this.
export const REGISTER_MAX_PER_IP = 300;
export const REGISTER_WINDOW_MS = 24 * 60 * 60 * 1000;
// login / device-start: an in-memory per-IP token bucket (per instance) — cheaper abuse, higher legit
// frequency, so a YDB write per request isn't worth it. Burst = capacity, sustained = refill/sec.
export const IP_BUCKET_CAPACITY = 15;
export const IP_BUCKET_REFILL_PER_SEC = 0.2; // ~12/min sustained

// --- Book file blobs (slice 3, opt-in) ---
export const BLOB_MAX_BYTES = 20 * 1024 * 1024; // per book
export const BLOB_ACCOUNT_MAX_BYTES = 300 * 1024 * 1024; // per account

/** Ask for an upload target for a book file. `size` is the client's declared size (re-verified at commit). */
export const BlobUploadRequestSchema = z.object({ bookId: z.string().min(1).max(200), size: z.number().int().nonnegative() });
/** Where + how to upload. In prod this is a presigned Object Storage POST/PUT with a content-length-range;
 *  the dev skeleton returns a same-API PUT endpoint. `url` may be absolute (prod) or API-relative (dev). */
export const BlobUploadTargetSchema = z.object({
  url: z.string(),
  method: z.enum(['PUT', 'POST']),
  headers: z.record(z.string()),
  key: z.string(),
  maxBytes: z.number(),
});
/** Finalize an upload: the server HEADs the object, verifies size, and records the blob (or rolls back). */
export const BlobCommitRequestSchema = z.object({ bookId: z.string().min(1).max(200), key: z.string().min(1), size: z.number().int().nonnegative() });
export const BlobMetaSchema = z.object({ bookId: z.string(), size: z.number(), uploadedAt: z.number() });
export const BlobListResponseSchema = z.object({ blobs: z.array(BlobMetaSchema), usedBytes: z.number(), limitBytes: z.number() });
export const BlobDownloadResponseSchema = z.object({ url: z.string(), method: z.literal('GET') });

export type BlobUploadTarget = z.infer<typeof BlobUploadTargetSchema>;
export type BlobMeta = z.infer<typeof BlobMetaSchema>;

// --- Entitlements (paid plan) ---
export const PlanSchema = z.enum(['free', 'trial', 'pro']);
export const EntitlementSchema = z.object({
  plan: PlanSchema,
  active: z.boolean(),
  trialEndsAt: z.number().optional(),
  paidUntil: z.number().optional(),
  ai: z.object({ used: z.number(), limit: z.number(), resetsAt: z.number().optional() }),
});
/** Claiming the trial passes the device's install id so a re-registered account on the same install
 *  doesn't get a second trial. A weak signal by construction (the client can mint a new one) — the
 *  hard bound on trial cost is the one-time AI budget, not this. */
export const TrialClaimRequestSchema = z.object({ installId: z.string().min(8).max(200) });
/** Redeem a paid grant minted by the billing callback. The token is the ONLY thing that crosses from
 *  the payment side; it carries no payment identifiers (see backend-v1-design §Privacy). */
export const RedeemRequestSchema = z.object({ grantToken: z.string().min(16).max(200) });
/** Start a checkout. The plan code is validated against the server-side catalog (billing.ts PLANS) —
 *  the amount is never taken from the client. */
export const CheckoutRequestSchema = z.object({ plan: z.string().min(1).max(40) });

export type Plan = z.infer<typeof PlanSchema>;
export type Entitlement = z.infer<typeof EntitlementSchema>;

// --- Managed AI (server key) ---
/** The proxy takes a NAMED TASK, never raw `messages`: prompts are assembled server-side so the endpoint
 *  stays a product feature instead of a general-purpose LLM gateway billed to us. The model, temperature,
 *  token ceiling and reasoning-off flag are pinned per task on the server and are not client inputs. */
export const AiTaskRequestSchema = z.discriminatedUnion('task', [
  z.object({ task: z.literal('translate'), text: z.string().min(1), sentence: z.string().optional() }),
  z.object({ task: z.literal('simplify'), sentence: z.string().min(1), level: z.string().optional(), stepDown: z.number().int().min(0).max(3).optional() }),
  z.object({ task: z.literal('grammar'), sentence: z.string().min(1), level: z.string().optional() }),
  z.object({ task: z.literal('wordInContext'), word: z.string().min(1), sentence: z.string().min(1) }),
  z.object({ task: z.literal('explain'), prompt: z.string().min(1), userAnswer: z.string(), correct: z.string(), topic: z.string(), attempts: z.array(z.string()).max(20).optional() }),
  z.object({ task: z.literal('hint'), prompt: z.string().min(1), topic: z.string(), userAnswer: z.string().optional() }),
  z.object({ task: z.literal('exercises'), text: z.string().min(1), targets: z.array(z.string()).max(40), count: z.number().int().min(1).max(12).optional() }),
]);
/** `cached` is reported for transparency; it does NOT mean the request was free — see AI_COST_PER_CALL. */
export const AiCompleteResponseSchema = z.object({
  content: z.string(),
  cached: z.boolean(),
  ai: z.object({ used: z.number(), limit: z.number(), resetsAt: z.number().optional() }),
});

/** Total characters across a request's string inputs. Output is already bounded by the per-task token
 *  ceiling; INPUT is what a malicious client inflates, so it is capped here. */
export const AI_MAX_INPUT_CHARS = 8000;

export type AiTaskRequest = z.infer<typeof AiTaskRequestSchema>;
export type AiTaskName = AiTaskRequest['task'];
export type AiCompleteResponse = z.infer<typeof AiCompleteResponseSchema>;


// --- TOTP recovery ---
/** Enrollment happens while logged in. The secret is returned once, for the QR and for manual entry;
 *  it is NOT retrievable afterwards. Backup codes are withheld until `confirm` proves the authenticator
 *  actually works — handing them out for an abandoned enrollment would leave live credentials in a
 *  screenshot for an account that ends up with no second factor at all. */
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
export const TotpStatusSchema = z.object({
  available: z.boolean(),
  enrolled: z.boolean(),
  backupCodesLeft: z.number(),
  /** A setup started and never confirmed. Required rather than optional: every constructed status has to
   *  declare it, which is the compile-time pressure that stops an object literal from quietly dropping
   *  it — the same class of bug as the status patches that used to be rebuilt from scratch. */
  pending: z.boolean().default(false),
  /** Failed recovery attempts in the current window — the owner's only sign that someone is trying. */
  recoverFailures: z.number().optional(),
  /** Whether a recovery name is set. Never the name itself — it is stored as a keyed hash. */
  recoveryName: z.boolean().optional(),
});
/**
 * Recovery runs WITHOUT a session — the caller has lost the recovery key, which is the only credential.
 * `accountId` comes from the authenticator entry's label, `code` is a TOTP or a backup code, and
 * `verifier` is derived from the NEW key the client just generated. The server keeps `accountId` and
 * replaces only the stored verifier, so synced data, blobs and the paid plan stay attached.
 */
export const TotpRecoverRequestSchema = z.object({
  accountId: z.string().min(16).max(256),
  code: z.string().min(6).max(20),
  verifier: z.string().min(16).max(256),
  deviceName: z.string().max(60).optional(),
});

/**
 * The same thing, addressed by a name the user chose instead of the account id nobody remembers. The
 * name is not a credential and resolves to several accounts on purpose; the code picks between them.
 * Bounded generously here and judged properly server-side, after normalisation.
 */
export const TotpRecoverByNameRequestSchema = z.object({
  name: z.string().min(1).max(120),
  code: z.string().min(6).max(20),
  verifier: z.string().min(16).max(256),
  deviceName: z.string().max(60).optional(),
});

export const RecoveryNameRequestSchema = z.object({ name: z.string().min(1).max(120) });

/**
 * Issue a new recovery key while signed in, proved by an authenticator code. Distinct from recovery:
 * that one assumes the old key may be stolen and burns every session; someone who still has access does
 * not need that, so ending other sessions is their choice rather than a consequence.
 */
export const TotpRotateKeyRequestSchema = z.object({
  code: z.string().min(6).max(20),
  verifier: z.string().min(16).max(256),
  revokeOthers: z.boolean().optional(),
});

/** Separator between the account id and the key in a post-recovery composite credential. Neither half
 *  can contain it: the id is base64url and the key is Crockford base32. */
export const COMPOSITE_KEY_SEPARATOR = '.';
export const ErrorCode = {
  InvalidCredentials: 'invalid_credentials',
  AccountExists: 'account_exists',
  RateLimited: 'rate_limited',
  RefreshInvalid: 'refresh_invalid',
  RefreshReused: 'refresh_reused',
  BadRequest: 'bad_request',
  Unauthorized: 'unauthorized',
  BlobTooLarge: 'blob_too_large',
  QuotaExceeded: 'quota_exceeded',
  SizeMismatch: 'size_mismatch',
  BlobNotFound: 'blob_not_found',
  TrialAlreadyClaimed: 'trial_already_claimed',
  NoPlan: 'no_plan',
  GrantInvalid: 'grant_invalid',
  QuotaExhausted: 'quota_exhausted',
  InputTooLarge: 'input_too_large',
  AiUnavailable: 'ai_unavailable',
  BillingUnavailable: 'billing_unavailable',
  /** Deliberately covers "no such account", "not enrolled" and "wrong code" alike on the recovery
   *  path: distinguishing them would turn it into an account-id oracle. */
  TotpInvalid: 'totp_invalid',
  TotpAlreadyEnrolled: 'totp_already_enrolled',
  TotpNotEnrolled: 'totp_not_enrolled',
  TotpUnavailable: 'totp_unavailable',
  /** The name is too short, too long, or nothing once normalised. */
  RecoveryNameInvalid: 'recovery_name_invalid',
  /** Already at the cap of accounts sharing this name. Refusing at write time is what keeps the lookup
   *  complete — accepting and truncating on read would leave the next holder unrecoverable in silence. */
  RecoveryNameCrowded: 'recovery_name_crowded',
  /** Admin only: no account with that id. Safe to say there, where the caller already holds the owner
   *  token — on any user-facing path this answer would be an account-id oracle (see `TotpInvalid`). */
  NoSuchAccount: 'no_such_account',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
