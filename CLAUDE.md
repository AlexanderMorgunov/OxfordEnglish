# CLAUDE.md

Offline-first PWA for learning English A2 → B1, built around the "learning day".
Engine and content are fully separated (the app is a player for content packs).

**`DESIGN_DOC.md` is the source of truth** for architecture, scope, data model,
design tokens, and the M0–M9 roadmap. Read the relevant section before working an
area rather than restating it here — this file only records conventions and
gotchas that the doc and the code don't already make obvious.

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind v4 · React Router · Zustand ·
Dexie (IndexedDB) · Zod · ts-fsrs · Vitest + Testing Library. No backend in v1.
See `DESIGN_DOC.md` §9.

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

## Skills

- `react-best-practices` — React perf rules. **Note:** its `server-*` and
  `async-api-routes` rules are Next.js/RSC-specific and have no referent in this
  Vite SPA — ignore those; the `rerender-*`, `rendering-*`, `js-*`, `bundle-*`
  categories apply.
- `composition-patterns` — component API design (React 19 variant).
- `web-design-guidelines` — UI/a11y review pass.
- `make-interfaces-feel-better` (global) — micro-interaction polish for M1+.
