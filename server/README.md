# DayEnglish API (backend v1)

Hono service for **accounts + cross-device sync**, deployed to **Yandex Serverless Containers**. Full
design: `../docs/backend-v1-design.md`. **Slice 1 = auth only** (no sync yet). No PII — accounts are a
random recovery key; the client derives `accountId` + `verifier` (see `../src/features/account/keys.ts`).

## Run locally
```
npm install
npm run dev          # tsx watch, listens on PORT (default 8080)
npm run typecheck
npx tsx src/smoke.ts # in-process auth flow test (register/refresh/reuse/devices/login) — ALL PASS
```
`src/smoke.ts` exercises the app via Hono's `app.request()` in-process, which is the reliable way to test
the logic. (A network `serve()` on Windows/Node24 was observed to accept TCP but hang on HTTP — an adapter
quirk of that env, not the app; verify `serve()` on the Alpine container at deploy.)

## Layout
- `src/app.ts` — `createApp(store?)` builds the Hono app (CORS, health, JWKS, auth routes). Storage is
  injectable → tests/YDB swap it.
- `src/index.ts` — starts the HTTP server (`serve`), reads `PORT`/`HOST`.
- `src/routes/auth.ts` — `/v1/auth/register|login|refresh|logout|devices`.
- `src/store.ts` — `AuthStore` interface + `InMemoryAuthStore` (skeleton). Verifier scrypt-hashed
  (prod: argon2id); refresh tokens stored by SHA-256 hash; rotation + reuse-detection revokes the family.
  **Replace with a YDB implementation of `AuthStore`** (slice 2 infra).
- `src/tokens.ts` — Ed25519 (EdDSA) access JWTs + `/v1/.well-known/jwks.json`. Verify via JWKS (SSO seam).
- `src/contract.ts` — wire schemas; MUST mirror `../src/features/account/contract.ts` (later: shared pkg).

## Endpoints (`/v1`)
`POST /v1/auth/register` · `POST /v1/auth/login` · `POST /v1/auth/refresh` · `POST /v1/auth/logout` ·
`GET /v1/auth/devices` (Bearer) · `GET /v1/.well-known/jwks.json` · `GET /health`.

## Env
- `PORT` (default 8080), `HOST` (optional bind, local only).
- `CORS_ORIGINS` — csv of allowed SPA origins (default `https://dayenglish.ru,https://www.dayenglish.ru`;
  add the Vercel preview origin for staging).
- `JWT_PRIVATE_JWK` — Ed25519 private JWK (JSON) from **Lockbox** in prod; unset → ephemeral dev key.
- `JWT_KID`, `JWT_ISS` (default `https://api.dayenglish.ru`), `JWT_AUD` (default `dayenglish`),
  `ACCESS_TTL_S` (default 3600).
- `ADMIN_TOKEN` — **local only, never set in production.** Mounts the admin surface below; must be at
  least 24 characters or nothing is mounted. A CI deploy replaces the container's whole environment, so
  one added by hand in the console does not survive the next deploy.

## Admin (owner only, never deployed)

Counts of accounts/trials/subscriptions, and granting Pro by account id.

**It is not part of the deployed API.** The routes and the page are mounted only when `ADMIN_TOKEN` is
set, and production does not set it — so there is nothing to reach there, and a mistake in the auth check
cannot expose a surface that was never mounted. The page is served by this process rather than built into
the web app: a lazy route in the client bundle still ships the chunk, and the service worker would
precache it onto every user's device.

The numbers you want are production numbers, so run this against the production database exactly the way
`migrate.ts` and `inspectGrants.ts` already do. Started with no `YDB_DATABASE` it answers 0 for
everything, truthfully and uselessly.

```bash
MSYS_NO_PATHCONV=1 \
  YDB_ENDPOINT=… YDB_DATABASE=… \
  YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) \
  ADMIN_TOKEN=$(openssl rand -hex 24) PORT=8799 \
  npx tsx src/index.ts
```

Then open <http://localhost:8799/admin> and paste the token (kept in `sessionStorage`, so it does not
outlive the tab). A token shorter than 24 characters mounts nothing and says so in the log.

- `GET /v1/admin/stats` — accounts that exist NOW (delete-account purges the row, so this is not "ever
  registered"), trials started/active, subscriptions ever/active.
- `GET /v1/admin/accounts/:id` — one account's plan.
- `POST /v1/admin/grant` `{ accountId, days }` — adds days through the same `applyPayment` a purchase
  uses, so a grant and a later payment stack rather than truncate each other. **There is no undo**, and
  the only record is the entitlement row plus a line in this process's log.

Reads every entitlement row to count, on purpose: the "is this a trial" rule lives in `planOf`, and a
second copy in YQL could not be tested (the store smokes need a live database, so CI never runs them).
That makes this a small-table convenience, not a metrics endpoint.

## Deploy (later, with infra)
`docker build` (see `Dockerfile`) → push to Yandex Container Registry → Yandex Serverless Containers.
Domain `api.dayenglish.ru`; secrets via Lockbox + service account; swap `InMemoryAuthStore` for YDB.
Prod on `main`, a separate staging instance for `dev`.
