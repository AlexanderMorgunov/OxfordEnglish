# DayEnglish API

Separate **Hono/Node** service for recovery-key accounts, cross-device sync,
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
