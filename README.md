# DayEnglish · English for Developers (A2 → B1)

**Live:** https://dayenglish.ru — auto-deploys from `main`.
Public brand **DayEnglish**; the repo/engine keeps its working name *English for Developers*.

An **offline-first PWA** for systematically learning English from A2 to B1, built around the idea of a
**learning day**: a daily route of grammar → reading → listening → practice, closed by a unit
checkpoint. Grammar is taught on material a developer already thinks in — commits, deploys, failing
builds — but the course is general-English A1→B2, not dev-only.

> **Engine and content are fully separated.** The app is a *player* for content packs. No copyrighted
> material ships in the public repo — see [Content & licensing](#content--licensing).

**Docs map:**
- `DESIGN_DOC.md` — source of truth for architecture, scope, data model, design tokens, M0–M9 roadmap.
- `CLAUDE.md` — conventions, gotchas, and a project map for coding agents.
- `docs/plans/GLOBAL_PLAN.md` — product/monetization strategy (**gitignored, private**; not in the repo).

---

## Stack

Vite 6 · React 19 (no `forwardRef`, StrictMode) · TypeScript (strict) · Tailwind v4 (`@theme` in CSS,
no config file) · React Router 7 · Zustand (hand-rolled persist) · Dexie / IndexedDB · Zod · ts-fsrs ·
pdf.js + fflate (reader) · driver.js (onboarding tour) · Vitest + Testing Library · vite-plugin-pwa.
**No backend in v1** — everything runs locally, no account, no personal data leaves the browser.

## Quick start

```bash
npm install
cp .env.example .env   # optional: fill in feedback / analytics / donation config
npm run dev            # http://localhost:5173
```

Open `/kitchen-sink` (dev only) to see the full design system.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `tsc -b` (strict typecheck) + production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier write |
| `npm test` | Vitest run (**run before pushing — CI gates on it**) |
| `npm run validate:packs` | Content-pack validator (structural + logical checks) |

## Project structure

```
src/
  app.css              design tokens (@theme) + semantic component layer
  main.tsx             entry — fonts, router; runs the .online→.ru migration hook before boot
  router.tsx           routes for every screen
  layout/              app shell (top nav, update/install prompts)
  pages/               one file per screen (Dashboard, Day, Grammar, Vocabulary, Review, …)
  content/             Zod schemas, pack loader/store, skill-tag registry
  features/
    practice/          exercise engine (9 types) + shell (hints, reveal, common-errors)
    learn/             vocabulary / reading / grammar section views + day summary
    listen/            listening player (A-B loop, transcript, dictation)
    reader/            book reader: EPUB/PDF import, word/phrase lookup, read-aloud, bookmarks
    srs/ vocab/        FSRS review + personal lexicon (words/phrases, translations cache)
    ai/                BYOK AI layer (providers, hints, in-context word, exercise gen)
    i18n/              hand-rolled UI localization (useUiLang + tr + shared exLabels); RU is default
    migration/         cross-site .online → .ru progress migration (see below)
    analytics/ feedback/ support/ pwa/ onboarding/   growth & platform glue
  shared/ui/           design-system kit (Button, Console, Option, Popover, …)
  shared/lib/          small utilities (cn, audio/read-aloud)
packs/
  dev-english-a2/      the public content pack (the ONLY pack tracked by git)
scripts/
  validate-packs.ts    content validator
  deploy-yc.sh         Yandex Object Storage deploy
docs/plans/            working plans (gitignored)
```

## Content & licensing

Content lives in **packs** (declarative JSON validated by Zod). Two modes:

- **Public pack** (`packs/dev-english-a2/`) — original text + openly licensed material (VOA public
  domain, Tatoeba CC-BY, CC0 images). Ships in the repo, works out of the box. Currently A2 complete
  (u00–u14), B1 (u15–u26) and B2 (u27–u32) authored; every day carries `day.level`.
- **Local pack (BYOC)** — material you legally own, added on your machine. Everything under `packs/` is
  gitignored **except** the whitelisted public pack, so local packs never reach git.

Every content/media object carries `license` + `attribution`; `npm run validate:packs` fails CI if a
public pack contains a `license.type: "local-only"` object. It also runs logical checks (answer-key
range, duplicate options, instruction/answer sanity). Planned licensing: code MIT, public-pack content
CC BY-SA.

---

## Deployment (Yandex Cloud)

Hosted as a **static offline-first PWA** on **Yandex Object Storage** (static-website mode), fronted by
**Yandex CDN**, TLS from **Certificate Manager** (Let's Encrypt, DNS-01). *(Previously Vercel — migrated
because Cloudflare's proxy edge is throttled in RU.)*

**Pipeline** — `.github/workflows/deploy-yc.yml`:
1. Runs on push to `main` (gated on repo **Variable** `YC_DEPLOY_ENABLED=true`) or manual
   `workflow_dispatch`.
2. `npm ci` → `npm run lint` → `npm test` → `npm run build` (ship only green).
3. `bash scripts/deploy-yc.sh` uploads `dist/` to the bucket **in a load-bearing order**: immutable
   hashed assets (long cache) → content packs → `index.html`/`sw.js`/`manifest` **last** (no-cache).
   It also writes **200-route aliases** (`index.html` copied to each public route key) so deep links
   don't soft-404, and uploads `sitemap.xml`/`robots.txt`.

**GitHub Secrets** the workflow needs (Settings → Secrets and variables → Actions):

| Secret | Purpose |
|---|---|
| `YC_S3_KEY_ID`, `YC_S3_SECRET` | Object Storage (S3-compatible) static access key |
| `YC_BUCKET` | Target bucket name |
| `VITE_YANDEX_METRICA_ID` | Yandex Metrica counter (build-time) |
| `VITE_WEB3FORMS_ACCESS_KEY`, `VITE_FEEDBACK_ENDPOINT`, `VITE_FEEDBACK_EMAIL` | Feedback transport |
| `VITE_SUPPORT_URL` | Donation link |

Plus repo **Variable** `YC_DEPLOY_ENABLED=true`. Endpoint is `https://storage.yandexcloud.net`, region
`ru-central1`. Full infra setup (bucket, CDN resource, cert, DNS cutover) is in
`docs/plans/migrate-to-yandex-cloud.md`.

**Manual deploy** (from a machine with the S3 keys):
```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
  AWS_ENDPOINT_URL=https://storage.yandexcloud.net YC_BUCKET=…
npm run build && bash scripts/deploy-yc.sh
```

## Domains, DNS & SEO

- **Canonical:** `https://dayenglish.ru`. Also serving the same app: `www.dayenglish.ru`,
  `dayenglish.online`, `www.dayenglish.online` (legacy). Every page has `<link rel=canonical>` → `.ru`.
- **DNS on Cloudflare, DNS-only (grey cloud).** The proxy is deliberately **off** — Cloudflare's edge is
  throttled in RU; Yandex CDN serves the traffic. Do **not** enable the orange cloud.
- **TLS:** one multi-SAN Let's Encrypt cert (Certificate Manager, **DNS-01** via `_acme-challenge`
  CNAMEs in Cloudflare) covering all four hosts. Renewal is unaffected by HTTP redirects.
- **`.online` → `.ru`:** users' progress is carried over by the in-app migration (below); a hard 301 is
  **deferred** because it would bypass that migration. Search consolidation currently rides on the
  canonical tag + re-crawl.
- **SEO:** `index.html` has title/description/OG/JSON-LD; `public/robots.txt` + `public/sitemap.xml`
  (`/`, `/grammar`, `/library`). Both `.ru` and `.online` are verified in **Yandex.Webmaster** and
  **Google Search Console** (DNS TXT — keep those records). Deep routes answer **200** via the deploy
  route-aliases.

## Configuration (env vars)

Only `VITE_`-prefixed vars reach the client, and **anything the client uses ships in the built JS** —
these are config, not secrets. Set them in a gitignored `.env` (see `.env.example`) or in CI secrets.

| Var | Effect when empty |
|---|---|
| `VITE_SUPPORT_URL` | Donations page shows "coming soon" instead of a live button |
| `VITE_YANDEX_METRICA_ID` | Analytics off (no script, no cookies) |
| `VITE_WEB3FORMS_ACCESS_KEY` | Feedback falls back to the next transport |
| `VITE_FEEDBACK_ENDPOINT` | (takes precedence when set — our own server later) |
| `VITE_FEEDBACK_EMAIL` | No "email us" fallback link |

## Payments / donations

- The **Support** page (`/support`) shows a **CloudTips** ruble donation link from `VITE_SUPPORT_URL`.
  Payments always live on the **PWA/site, never inside a Telegram Mini App** (Telegram ToS) — so it's
  an external link opened in the browser.
- Donations are handled as self-employed (НПД) income (receipt per donation). Recurring subscription,
  clubs, and managed-AI are **future** and require a backend — the strategy/economics live in the
  private `GLOBAL_PLAN.md`, not here.

## Feedback & analytics

- **Feedback** (`/feedback`) transport priority (`src/features/feedback/`): our own endpoint
  (`VITE_FEEDBACK_ENDPOINT`) → **Web3Forms** (`VITE_WEB3FORMS_ACCESS_KEY`, no backend) → `mailto`
  fallback. Submissions are queued (`feedbackOutbox`) so an offline submit survives.
- **Analytics:** **Yandex Metrica** (`VITE_YANDEX_METRICA_ID`), anonymous, off when unset. No Google
  Analytics (privacy positioning).

## Notable features

- **Reader** (`/library`): import EPUB/PDF (pdf.js + fflate), read offline; tap a word → dictionary
  translation + AI in-context meaning; tap-select a phrase to save; read-aloud (Web Speech, chunked for
  long paragraphs); content-anchored bookmarks. Books live in OPFS, never uploaded.
- **AI layer (BYOK):** the user brings their own OpenAI-compatible key (Groq / OpenRouter / Cerebras /
  Gemini / OpenAI / custom). Powers exercise hints, "why is it wrong?", in-context word meaning, and
  chapter exercise generation. Key stays in the browser; requests go straight to the provider.
- **Migration** (`src/features/migration/`): a returning `.online` user's progress is snapshotted and
  carried to `.ru` via a top-level redirect (cross-**site** IndexedDB is partitioned, so an iframe can't
  read it). Receiver lives under `/packs/migrate` so every SW version serves it network-first. `?stay`
  opens a mirror without migrating (support/debug).
- **PWA / offline:** vite-plugin-pwa (`prompt` update flow). The service worker **precaches the app
  shell only** — mp3/packs are runtime-cached (a 50 MB precache once broke prod). Progress export/import
  in Settings.
- **i18n:** UI is RU by default (`useUiLang`); `tr()` for bilingual content, `exLabels()` for repeated
  labels. English *course content* stays English by design.

## Roadmap status

Engine **M0–M9 complete** (offline PWA, BYOK AI, FSRS, 9 exercise types, content packs, placement test,
grammar reference, reader, i18n). Post-M9 growth work shipped: analytics, onboarding tour, install
prompt, feedback, donations, Yandex Cloud migration + SEO. See `DESIGN_DOC.md` §10 and the private
`GLOBAL_PLAN.md` for what's next (content depth backfill, Telegram funnel, community, clubs + backend).
