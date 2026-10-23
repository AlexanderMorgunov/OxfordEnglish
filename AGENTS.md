# DayEnglish — project instructions

Offline-first English course (A1–B2), book reader, and Android app. Public brand:
**DayEnglish**; repository/package names retain OxfordEnglish. Respond to the owner
in Russian. Code identifiers, comments, and commit subjects are English.

## Context and sources

- Read the relevant code and tests first. `README.md` describes the current system;
  `DESIGN_DOC.md` retains the original engine/content design, tokens, and M0–M9 plan.
  Its “no backend”, BYOK-only, and future-roadmap statements are historical.
- Local `docs/` and `skinBagNotes/` are private and gitignored. For substantial work,
  consult the relevant plan and `docs/work-queue.md`, if present. Do not force-add
  them. Missing private docs on a clean checkout do not block ordinary work.
- Local `docs/codex/project-context.md` records the Claude history handover,
  decisions, and unresolved items. Historical “shipped” claims are dated evidence,
  not proof of the current production state. Do not reload raw chats for every task.

## Architecture

- Frontend: Vite 6, React 19, strict TypeScript, Tailwind v4 (`@theme` in
  `src/app.css`), React Router 7, Zustand, Dexie, Zod, ts-fsrs.
- `src/content/`: pack schema, loader, skill tags. Public content is in
  `public/packs/dev-english-a2/`; root `packs/` is the ignored BYOC drop zone.
- `src/features/practice`, `learn`, `listen`, `srs`, `vocab`: learning engine.
  `reader`: EPUB/PDF/DOCX/FB2 import, OPFS book files, dictionary, sentence AI lenses,
  bookmarks, speech. `shared/lib/audio.ts` handles browser/native TTS.
- `src/features/account`, `sync`, `ai`: recovery-key accounts, TOTP/recovery,
  cross-device sync, subscriptions, managed AI with BYOK fallback.
- `server/`: separate npm package, Hono API; YDB, Object Storage, Lockbox in production,
  injected in-memory stores for local smokes. `server/src/app.ts` builds the app.
- `tools/content-forge/`: separate authoring-time MCP package, Node SQLite, Piper.
  Never import it into the application bundle.
- `android/` + `capacitor.config.ts`: Capacitor shell (`ru.dayenglish.app`). Its
  bundle is shipped in the APK; it does not register a service worker.

## Implementation conventions

- Use `@/` for `src/` imports and `import type` for types. Keep imports at file top.
  Do not add TypeScript suppression directives; fix the type.
- Keep comments sparse, English, and about non-obvious reasons. No commented-out
  code, numbered narration, or section dividers.
- React 19: pass `ref` as a prop rather than adding `forwardRef`; use `use()` for
  context. Prefer composition to multiplying mode booleans. Check the installed
  React version before adopting APIs from newer React releases.
- Follow the existing hand-written localStorage persistence in Zustand stores.
  Dexie database `oxford-english` is currently v8 (`src/db/db.ts`). Optional
  non-indexed fields alone do not require a schema version bump.
- Use design tokens and existing components in `src/shared/ui/`. Tailwind v4 has
  no `tailwind.config.js` or PostCSS configuration. Fonts are self-hosted.
- UI defaults to Russian: use `useUiLang`, `tr`, and shared exercise labels.
  Course material remains English. Tests pin UI language to English.
- UI must work from 360px, with keyboard access, visible focus, reduced-motion
  support, and exercise feedback announced via appropriate ARIA. Inspect overlays
  at screen edges in a real browser when changing their placement.

## Invariants worth preserving

- Keep engine and content separate. Public content/media need license and
  attribution; never ship `local-only` content or privately owned BYOC material.
  Add skill tags to `src/content/skill-tags.ts` before using them.
- Web PWA uses `autoUpdate`, app-shell-only precache, NetworkFirst for pack JSON,
  CacheFirst for immutable media. Pack JSON must revalidate at the CDN too.
- Client/server contracts and sync resolvers are deliberate mirrors; sweep both
  sides when changing fields, error codes, or merge semantics. Test conflicts and
  account changes, including in-flight work, rather than only a happy-path merge.
- Ordinary sign-out and device/account handover have different data-retention
  semantics. Do not move handover resets into ordinary logout or indiscriminately
  clear OPFS, review history, translation caches, or unsent feedback.
- Sync writes and book uploads require trial/Pro; reads remain available after
  expiry. Entitlement and subscription state helpers drive UI consistently.
- Payment success is confirmed by the server callback and grant redemption, not
  the checkout return URL. Keep replay/idempotency and concurrent quota/payment
  mutations intact. Recovery rotates credentials while preserving account identity.
- Never expose keys, recovery credentials, signing passwords, or tokens in logs,
  docs, or chat. `VITE_*` values ship to the browser and are not secrets.
  `TOTP_ENC_KEY` and `INDEX_HMAC_KEY` cannot be casually rotated: they protect
  existing encrypted/indexed data. The owner handles signing passwords and admin
  token generation outside chat.

## Working and verification

- For substantial changes: research → concrete plan → implementation → relevant
  tests and browser verification → review. Use the `dayenglish-workflow` skill.
  For new or reworked UI flows, use `ux-ui-design` for task evidence, real reference
  flows, synthesis and a UX walkthrough before UI styling. Use `ux-audit` for
  existing flows, `product-ux`, `frontend-design`, and relevant `web-accessibility`
  guidance. Create and inspect an HTML
  prototype in the selected design tool before product UI implementation; use
  explicitly requested research tools in practice. Open Design is available but
  does not replace a requested external provider or UX validation.
  Keep its simulation separate from real provider/runtime evidence, and verify
  the implemented screens with Chrome DevTools, including narrow/large-text,
  keyboard, offline/error and recovery states. A generated prototype is not
  production verification. Preserve DayEnglish tokens and existing navigation.
  Independent agent review is used when requested or authorized for the task;
  do not assume Claude's Fable/advisor tools or model names exist in Codex.
- Do not turn every small edit into a planning ceremony or stop after each phase
  when the user has authorized the whole task. Preserve existing user work and
  running test servers; stop only processes you started when appropriate.
- Root checks: `npm run lint`, `npm run validate:packs`, `npm run build`, `npm test`.
  Pick checks relevant to the change; documentation/config changes need link,
  syntax, and startup verification, not a speculative product refactor.
- Server changes also need `npm --prefix server run typecheck`,
  `npm --prefix server run typecheck:smoke`, and relevant in-process smokes.
  Root Vitest does not run `*.smoke.ts`; CI runs top-level server smokes separately.
  `server/src/stores/*.smoke.ts` require live infrastructure and are not ordinary CI.
- Before a requested push, run the checks required by the changed areas, including
  `npm test`. For a new regression test, demonstrate it catches the original bug
  (or an intentional mutation) when practical.
- Commit/push only when requested; “го” authorizes the concrete action currently
  under discussion, not every future release. Use explicit staging paths, never
  blanket `git add -A`. Commit subjects follow existing history, e.g.
  `fix(reader): keep the popup inside the viewport`; no `TD-XXX` requirement and no
  AI attribution/session trailers. Do not publish reviews or merge by implication.

## Operations and tools

- `main` is production: pushes trigger web deployment via `deploy-yc.yml` when
  enabled. Normal features branch from `dev`; hotfixes may branch from `main`.
  Read local `docs/branching-and-deploy.md` for the agreed release flow.
- Web hosting: Yandex Object Storage/CDN, Cloudflare DNS-only. Canonical `.ru`;
  historical ops report `.online` already redirects with 301. Migration code still
  exists for old clients; do not infer live DNS/CDN state solely from that code.
- API deployment is separate and manual; the local `deploy-container.yml` stays
  ignored. A container revision pins a Lockbox version and does not inherit omitted
  environment/secrets. Inspect current revision metadata before a requested deploy.
  In Git Bash use `MSYS_NO_PATHCONV=1` for slash-leading `yc` arguments.
- Native commands in this workspace use PowerShell. `python.exe` may be a Windows
  Store stub; Node is available. Prefer PowerShell literal paths and UTF-8 I/O.
- Codex reads this file and repo skills under `.agents/skills/`; Claude's commands,
  agents, permission allowlists, and `.mcp.json` are not Codex configuration.
- Codex MCP setup: `.codex/setup-mcp.ps1` creates ignored, machine-local
  `.codex/config.toml` for `content-forge` and `chrome-devtools`. See
  `CODEX_SETUP.md`. Check actual tool availability after restarting the session.
  When an MCP is unavailable, report the limit and use available browser/shell
  tools; do not pretend the missing tool was used.
- PixelLab remains the preferred pixel-art provider while the owner's subscription
  is active. Its global Claude HTTP connection was imported into ignored local
  Codex config; confirm actual tool availability/balance for an art task. Never
  print raw MCP JSON or config containing authorization headers.
- Open Design is installed locally; global Codex config contains its MCP command.
  Confirm current callable tools/daemon availability rather than assuming a
  saved configuration is active. Its project artifacts and critique are design
  evidence; keep private plans/screenshots ignored and never copy credentials or
  live account data into a prototype. Preserve other Open Design projects.

## Task-specific skills

Read only the skill needed by the task in `.agents/skills/`:
`react-best-practices`, `composition-patterns`, `web-design-guidelines`,
`make-interfaces-feel-better`, `asset-pipeline`, `exercise-logic-review`,
`dayenglish-workflow`, `ux-ui-design`. Project conventions override generic
upstream examples. Use `ux-ui-design` for research, separate UX/UI decisions and
a reviewable HTML prototype before substantial new or reworked UI flows.
