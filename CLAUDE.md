# CLAUDE.md

Offline-first PWA for learning English A2 → B1, built around the "learning day".
Engine and content are fully separated (the app is a player for content packs).

**`DESIGN_DOC.md` is the source of truth** for architecture, scope, data model,
design tokens, and the M0–M9 roadmap. Read the relevant section before working an
area rather than restating it here — this file only records conventions and
gotchas that the doc and the code don't already make obvious.

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind v4 · React Router · Zustand ·
Dexie (IndexedDB) · Zod · ts-fsrs · pdf.js + fflate (reader) · Vitest + Testing Library.
No backend in v1. See `DESIGN_DOC.md` §9.

## Project map (current state)

DESIGN_DOC is the *plan*; this is *what exists now* and where it lives, for fast orientation.
`README.md` has the full deploy/domains/payments/SEO runbook.

**Feature areas** (`src/features/…`): `practice` (9 exercise types + `ExerciseShell`), `learn`
(vocabulary/reading/grammar section views, `DaySummary`), `listen` (player, A-B loop, dictation),
`reader` (EPUB/PDF import, word/phrase lookup, read-aloud, bookmarks; books in OPFS, never uploaded),
`srs`+`vocab` (FSRS queue, personal lexicon, translation cache), `ai` (BYOK OpenAI-compatible layer —
hints, `wordInContext`, exercise gen), `i18n` (`useUiLang`+`tr`+shared `exLabels`; **RU is the default
UI language**), `migration` (`.online`→`.ru` progress carry-over), plus `analytics`/`feedback`/`support`/
`pwa`/`onboarding`. Pages in `src/pages/`, routes in `router.tsx`, content schema+loader in `src/content/`.

**State/data:** Zustand stores use **hand-rolled localStorage persist**, NOT the `persist` middleware
(e.g. `ai/store.ts`, `i18n/uiLang.ts`, `ai/limits.ts`). IndexedDB via Dexie, db `oxford-english` (v6),
`src/db/db.ts` — a non-indexed optional field needs no version bump. Skill tags: `src/content/skill-tags.ts`
(add there before use).

**Ops (not in DESIGN_DOC):** hosting is Yandex Object Storage (static website) + Yandex CDN + Certificate
Manager (LE, DNS-01); DNS on **Cloudflare, grey-cloud only** (proxy off — RU throttling). Deploy =
`.github/workflows/deploy-yc.yml` → `scripts/deploy-yc.sh` (gated on repo var `YC_DEPLOY_ENABLED`).
Canonical host `dayenglish.ru`; `www`/`.online` serve the same app; `.online`→`.ru` handled by the in-app
migration hook in `main.tsx`, **not a 301** (a 301 would bypass progress migration). Client config is
build-time `VITE_*` (see `.env.example`).

## Commands

```bash
npm run dev        # dev server
npm run build      # tsc -b + vite build (strict typecheck is part of the build)
npm run lint       # eslint
npm test           # vitest run
npm run validate:packs  # content-pack validator (wired in M2)
```

## Conventions (always apply)

- **Comments are sparse and English-only.** Default is zero comments — prefer
  clearer names and smaller functions. A comment is earned only by a non-obvious
  *why* (corner case, workaround, constraint) and stays one line. No `what`-narration,
  no `// 1. … // 2. …`, no section dividers, no commented-out code (git is authoritative).
  Cyrillic belongs only in product strings / JSX text / content JSON / i18n — never in comments.
- **No `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck`** — fix the type. Enforced by ESLint.
- **Imports at the top of the file**, never inside functions.
- **Path alias `@/`** maps to `src/` (`@/shared/ui/...`).
- **Type-only imports** use `import type` (enforced by `consistent-type-imports`).
- **React 19, no `forwardRef`.** Pass `ref` as a normal prop; use `use()` over
  `useContext()`. Follow the `composition-patterns` skill — avoid boolean-prop
  proliferation, prefer compound components and lifted state. (This overrides the
  older `React.FC`/`forwardRef` habit from other repos.)
- **Design tokens only** — colors/spacing/typography come from the `@theme` block
  in `src/app.css` (DESIGN_DOC §8.2). No arbitrary hex or off-scale values when a
  token exists. Semantic component classes live in the `@layer components` block
  (`.card-exercise`, `.console`, `.opt`, `.eyebrow`), DESIGN_DOC §8.4.
- **Quality floor (DESIGN_DOC §8.5) is reviewed per component**, not optional:
  responsive from 360px, visible focus ring, `prefers-reduced-motion` disables
  animation, keyboard-reachable, ARIA on exercises (`role="group"` + `aria-live`).

## Gotchas

- **Content-pack safety:** everything under `packs/` is gitignored except the
  whitelisted public pack. Local (BYOC) packs must never be committed — DESIGN_DOC §1.3.
  Every content/media object carries `license` + `attribution`; the validator fails
  CI on a public pack containing `license.type: "local-only"`.
- **Tailwind v4:** config lives in the `@theme` CSS block via `@tailwindcss/vite` —
  there is no `tailwind.config.js` and no PostCSS config. The §8.3 v3 config is an
  unused fallback; do not create it.
- **Fonts are self-hosted** via `@fontsource/*` (imported in `main.tsx`), not the
  Google Fonts CDN — required for offline-first.
- **Contrast (verified):** `--color-muted` on `--color-surface` ≈ 5.3:1 (passes body
  text). `--color-faint` ≈ 2.8:1 — disabled/placeholder only, never body text.
- **SW precaches the app shell only.** Never precache mp3/packs — content is
  runtime-cached (a ~50 MB precache once broke prod loading). vite-plugin-pwa,
  `registerType: 'prompt'`. Runtime caching is split (vite.config): pack **JSON**
  (`course.json`, `days/*.json`) is `NetworkFirst` so new/edited days actually
  appear — it was `CacheFirst` once and pinned a stale `course.json`, hiding all
  new content; pack **media** (audio/images) stays `CacheFirst` (immutable names).
- **Run `npm test` before pushing.** CI (`ci.yml`) and the deploy both gate on
  vitest, not just build+lint. Tests run with UI language pinned to `en`
  (`src/test/setup.ts`), so assert against English labels.
- **Cross-site storage is partitioned.** The `.online`→`.ru` migration must use a
  **top-level navigation**, not an iframe (an iframe gets partitioned IndexedDB). The
  receiver lives under `/packs/migrate` so every SW version serves it network-first
  (a stale SW would 404 a top-level `/migrate`).
- **Read-aloud:** Chrome silently drops long utterances (>~15 s) → chunk by sentence
  (`shared/lib/audio.ts`); many voices never emit `boundary` events → a time-estimate
  fallback drives the spoken-word highlight.
- **Reader translation** is client-side MyMemory (free, no key), limited per user IP
  and cached in Dexie; contextual single-word meaning is the BYOK AI path
  (`wordInContext`) — there is no reliable free non-LLM alignment for RU.

## Skills

- `react-best-practices` — React perf rules. **Note:** its `server-*` and
  `async-api-routes` rules are Next.js/RSC-specific and have no referent in this
  Vite SPA — ignore those; the `rerender-*`, `rendering-*`, `js-*`, `bundle-*`
  categories apply.
- `composition-patterns` — component API design (React 19 variant).
- `web-design-guidelines` — UI/a11y review pass.
- `make-interfaces-feel-better` (global) — micro-interaction polish for M1+.
