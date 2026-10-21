# API-specific guidance

This is a separate Hono/Node npm package, not NestJS. Root `AGENTS.md` also applies.

- `src/app.ts` selects injected/in-memory stores or YDB/Object Storage adapters;
  exercise HTTP behavior through `createApp(...).request(...)` in smokes.
- Wire schemas in `src/contract.ts` mirror frontend
  `../src/features/account/contract.ts`. Sync resolution in `src/sync.ts` mirrors
  frontend `../src/features/sync/resolve.ts`. Update and check both sides.
- Preserve serialized/transactional entitlement mutations, callback and grant
  idempotency, paginated sync snapshots, and credential-reuse detection.
- Admin routes mount only with a sufficiently long `ADMIN_TOKEN`; rate limiting
  precedes authentication. They are intentionally in the API, outside the SPA
  bundle/precache. Do not join payment identity into ordinary entitlement/admin
  views without revisiting the established data separation.
- Run `npm run typecheck` and `npm run typecheck:smoke` here. Run affected
  top-level `src/*.smoke.ts` with `npx --no-install tsx <path>`. CI runs all of
  these plus `src/smoke.ts`, but not `src/stores/*.smoke.ts`.
- Store smokes and `npm run migrate` need infrastructure and can mutate data;
  do not run them as a default local check. Never load production credentials just
  to run in-memory tests. Follow the local deployment runbook for authorized ops.
