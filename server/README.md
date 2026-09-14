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

## Deploy (later, with infra)
`docker build` (see `Dockerfile`) → push to Yandex Container Registry → Yandex Serverless Containers.
Domain `api.dayenglish.ru`; secrets via Lockbox + service account; swap `InMemoryAuthStore` for YDB.
Prod on `main`, a separate staging instance for `dev`.
