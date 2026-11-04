# DayEnglish API

Separate **Hono/Node** service for username/password and legacy-key accounts, cross-device sync,
book-file storage, trial/Pro entitlements, Robokassa checkout, managed AI,
TOTP/backup-code recovery, and the owner's admin surface. Production architecture:
Yandex Serverless Containers + API Gateway, YDB, Object Storage, and Lockbox.
This is no longer the original auth-only skeleton.

Project conventions and invariants: [../AGENTS.md](../AGENTS.md) and
[AGENTS.md](AGENTS.md). Detailed design/deployment plans are local and ignored:
`../docs/backend-v1-design.md`, `../docs/deploy-container.md`,
`../docs/yc-backend-setup.md`, `../docs/billing-robokassa.md`.

## Run and verify locally

```powershell
npm ci
npm run dev                 # tsx watch; PORT defaults to 8080
npm run typecheck
npm run typecheck:smoke
npx --no-install tsx src/smoke.ts
```

Without `YDB_DATABASE`, the app uses in-memory stores and local ephemeral keys.
Do not set production storage credentials for ordinary local checks. The root
frontend needs `VITE_API_BASE` set to the local API address to show account UI;
configure `CORS_ORIGINS` for that frontend origin.

Top-level `src/*.smoke.ts` use injected stores and Hono's in-process `app.request()`;
CI installs this package, typechecks production **and smoke** code, then runs those
smokes plus `src/smoke.ts`. Root Vitest does not cover them. Store smokes under
`src/stores/` require configured infrastructure and may mutate data; run them only
for an explicitly scoped integration test. `npm run migrate` also mutates storage.

## Layout and boundaries

- `src/app.ts`: builds the app, CORS/limits, routes, and injectable stores; chooses
  YDB/Object Storage adapters when configured. `src/index.ts` serves HTTP.
- `src/routes/`: auth/device linking, sync, blobs, account deletion, entitlements,
  billing, AI, TOTP/recovery, and admin routes. Health is `/health`; API paths
  start with `/v1`, including `/v1/.well-known/jwks.json`.
- `src/contract.ts`: wire schemas mirrored in
  `../src/features/account/contract.ts`; `src/sync.ts` resolves conflicts in parity
  with `../src/features/sync/resolve.ts`.
- `src/store.ts`, `sync.ts`, `blobs.ts`, `entitlements.ts`, `ai.ts`, `totp.ts`,
  `recoveryName.ts`: cores, store contracts, and in-memory implementations.
  `src/stores/` contains production adapters.
- `src/password.ts`: argon2id verifier hashing; `src/tokens.ts`: Ed25519 access
  JWTs/JWKS. The server never needs the user's raw recovery key. Recovery keeps
  the account id while rotating credentials.
- `src/entitlements.ts`: trial/Pro state, quota units, serialized mutations,
  and payment grants. Sync writes/uploads require trial/Pro; reads are ungated.
- `src/ai.ts`, `aiPrompts.ts`, `aiProvider.ts`: named task registry, built-prompt
  cache keys, quota accounting, bounded upstream calls. The managed key stays
  server-side; BYOK remains a separate frontend path.
- `wordSenses.ts` mirrors the frontend's `features/ai/word-senses.ts`: bounded request/output schema
  and prompt for the `wordSenses` named task (four quota units, 700 output tokens). Malformed fresh
  output is refunded and never cached; cache I/O failures are best-effort for this task. The API must
  support the task before shipping managed vocabulary suggestions in production clients.
- `src/billing.ts` and `routes/billing.ts`: callback signature validation,
  idempotent payment confirmation, account-bound grant lookup/redemption. A browser
  return URL never confirms payment. Recurring billing is a separate planned feature.

## Configuration and deployment

`PORT`/optional `HOST` control serving. `CORS_ORIGINS` is a comma-separated allowlist
(default `.ru` and `www.ru`; local/Capacitor origins must be explicitly supported).
Storage, JWT, AI, billing, and recovery secrets are provided through the local
runbook/Lockbox, not tracked `.env` values. The frontend's `VITE_API_BASE` is public
build-time configuration; if absent, the entire account surface is disabled.

API deployment is **manual and separate from the web deployment**. The local
`.github/workflows/deploy-container.yml` is ignored and is not an active Actions
workflow. Container revisions pin a Lockbox version and do not inherit omitted
secret/env bindings; inspect current revision metadata before an authorized deploy.
In Git Bash, slash-leading `yc` values require `MSYS_NO_PATHCONV=1`.

Do not casually rotate `TOTP_ENC_KEY` or `INDEX_HMAC_KEY`: existing encrypted or
indexed records depend on them. Never put secret values into command output or docs.

## Username/password access rollout

`src/accessContract.ts` and `accessPolicy.ts` mirror the frontend access contracts.
`/v1/access/operation` accepts a client-generated random 256-bit operation secret.
Successful operations have encrypted five-minute receipts; `/v1/access/receipt`
reconciles a lost reply without repeating a mutation or spending another backup code.
Private receipts also require the current account session. Passwords are NFC-normalized
and hashed with Argon2id; username lookup and attempt counters use the existing HMAC
key. Common-password hash provenance and MIT attribution are in `commonPasswords.ts`
and `third-party/SecLists-LICENSE.txt`; this is a bounded common-password check,
not a comprehensive breach database.

The additive migration creates `account_access(record_key, payload, account_id?,
expires_at?)`, its synchronous `by_account` index and expiry TTL. Permanent account
and username rows have no expiry. Apply the migration only to an explicitly authorized
database, verify table/index readiness, then deploy the API with its existing JWT,
`TOTP_ENC_KEY` and `INDEX_HMAC_KEY` bindings. Do not rotate those keys for this rollout.
Capabilities stay disabled without the schema and encryption/HMAC configuration.
The public frontend should follow the backend, and Android has a separate release.

Existing accounts and refresh rows are not rewritten. Missing auth generation means
zero; newly issued refresh tokens and device approvals are indexed with their generation.
Access JWTs are checked against the current account generation. Recovery increments
it, revokes refresh families and disables the old key while preserving account identity.
Ordinary password changes issue a fresh session to the current device and revoke older
sessions while preserving the transition key. Old key clients can keep signing in and
syncing; upgraded accounts use the new protocol for credential/recovery management.
Do not roll the API back to code that ignores generations after new credentials are used:
it cannot enforce the new revocations. Keep the additive schema and use a forward fix.

`accountAccess.smoke.ts` covers actual routes, crypto, concurrency, lost replies,
rollback, legacy upgrade, credential revocation, expiry, backup consumption and identity
preservation. The in-memory checkpoint store and production YDB adapters share atomic
operation boundaries via ambient serializable transactions. In-process tests do not
replace a scoped YDB integration check before production rollout.

## Owner admin

The API mounts `/admin` and `/v1/admin/*` only when `ADMIN_TOKEN` meets the minimum
length in `src/routes/admin.ts`. Rate limiting precedes the token check. The latest
local operations record says it was enabled on production on September 23, 2026;
the old “never deployed” statement was obsolete. Confirm live state separately.

Scope: counts, lookup of one account's plan, and an additive Pro grant. It is served
by the API, outside the SPA bundle and precache. The grant shares transactional
entitlement mutation with payment/quota paths. Payment identity is deliberately
separated from entitlement data; adding payment history/refunds would require
revisiting access rights and the audit design. An admin grant is not an ordinary test.
## Scheduled Pro sales

The permanent catalog contains `pro_month` (30 days, 19900 kopecks), `pro_quarter`
(90 days, 49900 kopecks), and `pro_year` (365 days, 149900 kopecks). Every plan stays
available after a campaign ends. A sale overrides only its prices during the
half-open interval `[startsAt, endsAt)` according to server time. No cron job is needed.

Before deploying this API version, create the `billing_catalog` table using the
migration definition (`catalog_key` Utf8 primary key, `payload` Utf8, no TTL).
Do not query the new production table before migration. An empty table uses the
initial November campaign: 3 November through 10 November 2026 inclusive, Moscow;
15000/39900/99000 kopecks. Persisting `campaign: null` disables it durably. Database
read failures do not fall back to a guessed price.

Use `/admin` on the API host with the existing owner token. The new sale section
loads server settings; edit ID, title, dates in Moscow time, and three ruble prices,
then save. For the next campaign use a new ID. The end field is exclusive: for a
sale through November 10, enter November 11 at 00:00. Dates and prices can be
changed without a new frontend/APK release. Only one campaign is scheduled at a time.
`GET/POST /v1/admin/billing` use the same admin authentication and rate limits as
other admin routes. Saves include `revision`; concurrent edits return 409 and
require a reload. A network failure after save requires a read before retrying.

`GET /v1/billing/plans` sends `Cache-Control: no-store`, server time, the next
scheduled boundary, and optional campaign/regular-price metadata. Old clients can
still consume the monthly plan. New checkout requests send the amount displayed
as `expectedAmountKopecks`: a mismatch returns `billing_price_changed` (409) before
a grant is created. This field verifies consent; it never sets the charged amount.
Existing invoices retain their stored price/days after campaign edits or expiry;
callbacks and redemption keep their existing replay protection. No recurring job
or automatic charging is introduced.

Local verification: `npx tsx src/billingCatalog.smoke.ts`, `billingApi.smoke.ts`,
`admin.smoke.ts`, both server typechecks, and the frontend purchase/catalog tests.
These use in-memory stores and fixture merchant credentials, without live payments.
