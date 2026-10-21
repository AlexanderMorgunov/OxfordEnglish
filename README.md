# DayEnglish · English course and book reader (A1 → B2)

**Live:** https://dayenglish.ru — auto-deploys from `main`.
Public brand **DayEnglish**; the repo/engine keeps its working name _English for Developers_.

An **offline-first PWA** for systematically learning English from A1 to B2, built around the idea of a
**learning day**: a daily route of grammar → reading → listening → practice, closed by a unit
checkpoint. Grammar is taught on material a developer already thinks in — commits, deploys, failing
builds — but the course is general-English A1→B2, not dev-only.

> **Engine and content are fully separated.** The app is a _player_ for content packs. No copyrighted
> material ships in the public repo — see [Content & licensing](#content--licensing).

**Docs map:**

- `AGENTS.md` — current project map, conventions, invariants, and checks for coding agents.
- `CODEX_SETUP.md` — repo-local Codex skills and MCP setup.
- `DESIGN_DOC.md` — original engine/content design, design tokens, and M0–M9 roadmap;
  backend, monetization, and delivery assumptions there are historical.
- `server/README.md` — the separate Hono API and its local checks.
- `CLAUDE.md` — compatibility entrypoint for Claude Code.
- `docs/plans/GLOBAL_PLAN.md` — product/monetization strategy (**gitignored, private**; not in the repo).

---

## Stack

Vite 6 · React 19 (no `forwardRef`, StrictMode) · TypeScript (strict) · Tailwind v4 (`@theme` in CSS,
no config file) · React Router 7 · Zustand (hand-rolled persist) · Dexie / IndexedDB · Zod · ts-fsrs ·
pdf.js + fflate (reader) · driver.js (onboarding tour) · Vitest + Testing Library · vite-plugin-pwa.
Core study works locally without an account. The optional **Hono API** (`server/`)
provides recovery-key accounts, TOTP/recovery, cross-device sync, Robokassa subscriptions,
and managed AI. It uses YDB, Object Storage, and Lockbox on Yandex Cloud.
**Android** uses Capacitor 8, native TTS and English dictation. Sync, managed AI, feedback, and analytics
make network requests when enabled; user-imported books stay local unless book-file sync is enabled.

## Quick start

```bash
npm ci                 # Node 22.13+; CI uses Node 22
cp .env.example .env   # optional: fill in feedback / analytics / donation config
npm run dev            # http://localhost:5173
```

Open `/kitchen-sink` (dev only) to see the full design system.

## Scripts

| Command                  | What it does                                         |
| ------------------------ | ---------------------------------------------------- |
| `npm run dev`            | Dev server                                           |
| `npm run build`          | `tsc -b` (strict typecheck) + production build       |
| `npm run lint`           | ESLint                                               |
| `npm run format`         | Prettier write                                       |
| `npm test`               | Vitest run (**run before pushing — CI gates on it**) |
| `npm run validate:packs` | Content-pack validator (structural + logical checks) |

## Vocabulary entry and chapter words

`/vocabulary` keeps the English term, Russian answer and optional context together.
**AI meanings** is a separate expandable tool: opening/reopening it or typing does
not request AI. An explicit request proposes up to four meanings and examples;
choosing one edits the draft. A custom context requires an explicit keep/replace
choice. The Russian answer becomes required, and Add creates a new card without
overwriting an existing card or its review schedule. New managed requests cost
four quota units; device-cache results are free and cancellation does not guarantee
a quota refund. BYOK uses the provider's billing.

**From Russian** offers an explicit free MyMemory lookup, followed by Use to fill
an editable English term and Russian answer. It proposes one translation, not a
list of dictionary senses. Applying the proposal collapses the helper; reopening
retains the source without another request. Switching input language or closing
the form preserves the draft and its validation rules; Start over clears it.

In `/vocabulary/text`, Open text starts reading and word saving; whole-text
translation requires a separate Translate action. Keyboard focus moves to the
visible source. Dictation results require deliberate acceptance. Translate is
available next to the initial English input; reading is a separate action.

The reader's **Words from this chapter** lists explicitly saved terms with their
source sentence beside chapter exercises. Optional matching practice requires
at least two distinct translations and does not grade cards or change FSRS.

Book reading and the text workbench expose **Book text size** inside collapsed
reading settings. Books also expose **Aa Text appearance** through quick actions,
with the same A−/A+ buttons, native slider, quiet percentage and reset action.
There are 13 sizes from 15 to 34 px at the ordinary browser scale; 17 px is 100%.
Sizes use rem units and preserve browser text scaling. Existing 15/17/21 px choices
retain their size after migration. Text size and other device preferences remain
local; only word coloring and AI translation toggles sync between devices.
Application text uses a separate local90–150% preference in Settings. UI text
tokens are larger by2nominalpx; book15–34px choices remain independent, and
both support browser/root text scaling. Saved word-card answers remain available
in reader lookup without a translation-cache/provider dependency; exact matching
source sentences prefer their saved contextual meaning.

New translation, microphone and scan sprites were generated with PixelLab;
[asset provenance](public/assets/pixel/ui/generated-provenance.json) records the
prompts, provider IDs and checksums. Icons accompany text labels. The document
language follows the selected UI language; English material and Russian answers
carry their own language metadata.

## Text input and Android development

`/vocabulary/text` accepts typed/pasted English up to2000characters or explicitly
accepted English dictation. Translation starts directly from the initial input,
offers free/AI modes, cancellation/retry and an editable Russian result. Reading
and term saving remain independent. Image OCR was removed at the owner's request;
Tesseract assets and native MLKit/Exif dependencies are no longer bundled.

For Android development use Java 21 and the Android SDK, then `npm run build`,
`npx cap sync android`, and `android/gradlew.bat -p android :app:assembleDebug`.
Native instrumentation runs with `:app:connectedDebugAndroidTest` on an isolated
emulator/device. Signing and publishing remain separate operations.

## English dictation

The text workbench and manual vocabulary form offer **Dictate in English**.
Opening the panel only checks capabilities. Explicit Start requests the microphone
for a single en-US utterance (up to 30 seconds), with interim preview, Stop to ask
for a final result, Cancel to discard, and editable review before replace/append.
Nothing is saved or translated automatically. Existing text survives errors.
Typing, changing input adapter, closing, account changes and backgrounding discard
pending input. Dictation and app playback cancel each other; native output must
acknowledge its stop before microphone acquisition.

On-device mode is the default; there is no automatic remote fallback. Web uses
`SpeechRecognition`/`webkitSpeechRecognition`, requiring real `processLocally`
support plus an English availability check for local use. When supported, an
explicit button downloads the browser-owned model; closing cannot cancel that
download. System service must be selected explicitly and may send audio to the
browser/Android recognition provider and require connectivity. No audio history,
DayEnglish audio upload endpoint, AI quota or pronunciation scoring is introduced.

Android has an owned `EnglishSpeech` Capacitor bridge, RECORD_AUDIO permission,
RecognitionService package visibility, and main-thread bounded session ownership.
Local mode uses `createOnDeviceSpeechRecognizer` on API31+; API33+ queries English
model readiness. API31/32 readiness is unverified until an explicit attempt. Native
language models are managed in OS/provider settings; the app does not download them.
Old APKs lacking the bridge retain ordinary typed/keyboard input. A new APK is
required for the native button. Browser/provider availability and speech accuracy
vary by device. Debug instrumentation uses injected engines to verify lifecycle,
not provider accuracy; run `:app:connectedDebugAndroidTest` on an isolated device.

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
  ...                  ignored BYOC/local content only
public/packs/
  dev-english-a2/      tracked public pack (A1–B2; directory name is historical)
server/                separate Hono API package (own dependencies/typechecks/smokes)
android/               Capacitor Android shell
tools/content-forge/   separate authoring-time MCP package
.agents/skills/        repo-local Codex skills
.codex/                MCP setup script/template; generated config stays local
scripts/
  validate-packs.ts    content validator
  deploy-yc.sh         Yandex Object Storage deploy
docs/plans/            working plans (gitignored)
```

## Content & licensing

Content lives in **packs** (declarative JSON validated by Zod). Two modes:

- **Public pack** (`public/packs/dev-english-a2/`) — original text + openly licensed material (VOA public
  domain, Tatoeba CC-BY, CC0 images). Ships in the repo, works out of the box. Currently A2 complete
  (u00–u14), B1 (u15–u26) and B2 (u27–u32) authored; every day carries `day.level`.
- **Local pack (BYOC)** — material you legally own, added on your machine. Root `packs/` is
  entirely gitignored; public packs live separately under `public/packs/`.

Every content/media object carries `license` + `attribution`; `npm run validate:packs` fails CI if a
public pack contains a `license.type: "local-only"` object. It also runs logical checks (answer-key
range, duplicate options, instruction/answer sanity). Planned licensing: code MIT, public-pack content
CC BY-SA.

---

## Deployment (Yandex Cloud)

Hosted as a **static offline-first PWA** on **Yandex Object Storage** (static-website mode), fronted by
**Yandex CDN**, TLS from **Certificate Manager** (Let's Encrypt, DNS-01). _(Previously Vercel — migrated
because Cloudflare's proxy edge is throttled in RU.)_

**Pipeline** — `.github/workflows/deploy-yc.yml`:

1. Runs on push to `main` (gated on repo **Variable** `YC_DEPLOY_ENABLED=true`) or manual
   `workflow_dispatch`.
2. `npm ci` → `npm run lint` → `npm test` → `npm run build` (ship only green).
3. `bash scripts/deploy-yc.sh` uploads `dist/` to the bucket **in a load-bearing order**: immutable
   hashed assets (long cache) → content packs → `index.html`/`sw.js`/`manifest` **last** (no-cache).
   It also writes **200-route aliases** (`index.html` copied to each public route key) so deep links
   don't soft-404, and uploads `sitemap.xml`/`robots.txt`.

**GitHub Secrets** the workflow needs (Settings → Secrets and variables → Actions):

| Secret                                                                       | Purpose                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------ |
| `YC_S3_KEY_ID`, `YC_S3_SECRET`                                               | Object Storage (S3-compatible) static access key |
| `YC_BUCKET`                                                                  | Target bucket name                               |
| `VITE_YANDEX_METRICA_ID`                                                     | Yandex Metrica counter (build-time)              |
| `VITE_WEB3FORMS_ACCESS_KEY`, `VITE_FEEDBACK_ENDPOINT`, `VITE_FEEDBACK_EMAIL` | Feedback transport                               |
| `VITE_SUPPORT_URL`                                                           | Donation link                                    |

Plus repo **Variable** `YC_DEPLOY_ENABLED=true`. Endpoint is `https://storage.yandexcloud.net`, region
`ru-central1`. Full infra setup (bucket, CDN resource, cert, DNS cutover) is in
`docs/plans/migrate-to-yandex-cloud.md`.

The API is deployed separately by the local container runbook (`docs/deploy-container.md`,
private); the ignored `deploy-container.yml` is not an active GitHub Actions workflow.
Android updates require rebuilding/syncing the web bundle and publishing a signed APK;
deploying the website does not update the installed APK.

**Manual web deploy** (from a machine with the S3 keys):

```bash
export AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… \
  AWS_ENDPOINT_URL=https://storage.yandexcloud.net YC_BUCKET=…
npm run build && bash scripts/deploy-yc.sh
```

## Domains, DNS & SEO

- **Canonical:** `https://dayenglish.ru`; `www.dayenglish.ru` also serves the app.
  The latest local ops record says legacy `.online`/`www.online` redirect to `.ru`
  with path-preserving 301s (August 28, 2026). Verify live DNS/CDN before changing infrastructure.
- **DNS on Cloudflare, DNS-only (grey cloud).** The proxy is deliberately **off** — Cloudflare's edge is
  throttled in RU; Yandex CDN serves the traffic. Do **not** enable the orange cloud.
- **TLS:** one multi-SAN Let's Encrypt cert (Certificate Manager, **DNS-01** via `_acme-challenge`
  CNAMEs in Cloudflare) covering all four hosts. Renewal is unaffected by HTTP redirects.
- **`.online` → `.ru`:** in-app migration code remains for old clients; a server 301 bypasses it.
  Do not treat the remaining migration hook as evidence that the redirect is still deferred.
- **SEO:** `scripts/build-seo.mjs` emits route-specific HTML, grammar articles, catalog pages,
  canonicals, JSON-LD, and `dist/sitemap.xml`. `robots.txt` explicitly allows the public
  pack's `grammar.json` so crawlers can also render the SPA. Both `.ru` and `.online` were verified in **Yandex.Webmaster** and
  **Google Search Console** (DNS TXT — keep those records). Deep routes answer **200** via the deploy
  route-aliases.

## Configuration (env vars)

Only `VITE_`-prefixed vars reach the client, and **anything the client uses ships in the built JS** —
these are config, not secrets. Set them in a gitignored `.env` (see `.env.example`) or in CI secrets.

| Var                         | Effect when empty                                              |
| --------------------------- | -------------------------------------------------------------- |
| `VITE_API_BASE`             | Account UI, sync, billing, and managed API access are disabled |
| `VITE_SUPPORT_URL`          | Donations page shows "coming soon" instead of a live button    |
| `VITE_YANDEX_METRICA_ID`    | Analytics off (no script, no cookies)                          |
| `VITE_WEB3FORMS_ACCESS_KEY` | Feedback falls back to the next transport                      |
| `VITE_FEEDBACK_ENDPOINT`    | (takes precedence when set — our own server later)             |
| `VITE_FEEDBACK_EMAIL`       | No "email us" fallback link                                    |

## Payments / donations

- The **Support** page (`/support`) shows a **CloudTips** ruble donation link from `VITE_SUPPORT_URL`.
  Payments always live on the **PWA/site, never inside a Telegram Mini App** (Telegram ToS) — so it's
  an external link opened in the browser.
- Robokassa checkout and subscription grants are implemented. The server callback confirms
  payment; the signed-in client redeems the grant. Trial/Pro unlock sync writes and managed AI;
  read access remains after expiry. Default trial is 14 days; AI budgets are 1,000 trial units
  and 10,000 Pro units (tasks have different costs). See `server/src/entitlements.ts`.
  Recurring billing and clubs remain separate plans; implemented checkout does not imply auto-renewal.

## Feedback & analytics

- **Feedback** (`/feedback`) transport priority (`src/features/feedback/`): our own endpoint
  (`VITE_FEEDBACK_ENDPOINT`) → **Web3Forms** (`VITE_WEB3FORMS_ACCESS_KEY`, no backend) → `mailto`
  fallback. Submissions are queued (`feedbackOutbox`) so an offline submit survives.
- **Analytics:** **Yandex Metrica** (`VITE_YANDEX_METRICA_ID`), anonymous, off when unset. No Google
  Analytics (privacy positioning).

## Notable features

- **Russian vocabulary entry** (`/vocabulary`): switch to From Russian, explicitly request a free
  MyMemory RU→EN suggestion, then use it in the editable English-term/Russian-answer draft and Add.
  A suggestion may miss the intended meaning; refine the source or correct the draft. No AI quota
  is used. Valid local suggestions work offline for seven days. Existing cards keep their schedule;
  Start over clears the whole draft and restores ordinary English input.
- **Vocabulary meanings** (`/vocabulary`): explicitly request up to four AI meaning suggestions with
  Russian distinctions and original English examples. Choose one to populate editable fields, then
  press Add. Trial/Pro requests cost four AI units; BYOK uses provider billing. Valid device caches
  are readable offline for seven days. Selected meanings create only new term cards; existing cards
  and their SRS schedules are protected. Ordinary automatic translation remains available.
- **Reader** (`/library`): import EPUB/PDF/DOCX/FB2 (pdf.js + fflate), read offline; tap a word → dictionary
  translation + AI in-context meaning; tap-select a phrase to save; read-aloud (Web Speech, chunked for
  long paragraphs); content-anchored bookmarks, sentence translation/simplification/grammar lenses.
  Explicitly saved words and phrases appear beside chapter exercises, with live translations and
  optional offline matching rounds. Matching does not grade SRS or change review history; legacy
  cards need an explicit save from the chapter to gain a source association.
  Books live in OPFS; optional account-wide book-file sync uploads them to Object Storage.
- **Translate text** (`/vocabulary/text`): type or paste an English passage of up to 2000 characters,
  translate immediately or separately read with word/phrase saving and read-aloud.
  Free translation and optional trial/Pro/BYOK AI keep paragraphs and offer cancellation. Translation
  results are cached locally; drafts have no document history. English dictation
  provides deliberately accepted input. Saved terms retain sentence context without creating book/chapter associations.
- **AI layer (BYOK):** the user brings their own OpenAI-compatible key (Groq / OpenRouter / Cerebras /
  Gemini / OpenAI / custom). Powers exercise hints, "why is it wrong?", in-context word meaning, and
  chapter exercise generation. BYOK keys stay in the browser; those requests go to the provider.
  Trial/Pro can instead use the managed server path with named tasks, caching, and quota accounting.
- **Migration** (`src/features/migration/`): legacy top-level progress handoff (an iframe cannot read
  cross-site partitioned IndexedDB). Receiver lives under `/packs/migrate`. Infrastructure's 301 now
  normally bypasses the sender; the hooks remain for old clients/support.
- **PWA / offline:** vite-plugin-pwa (`autoUpdate`, checked on focus/visibility). The service worker **precaches the app
  shell only** — mp3/packs are runtime-cached (a 50 MB precache once broke prod). Progress export/import
  in Settings.
- **Android:** Capacitor uses the packaged web bundle and native text-to-speech;
  `initAppUpdate` deliberately skips service-worker registration on native platforms.
- **i18n:** UI is RU by default (`useUiLang`); `tr()` for bilingual content, `exLabels()` for repeated
  labels. English _course content_ stays English by design.

## Roadmap status

Engine **M0–M9 complete** (offline PWA, BYOK AI, FSRS, 9 exercise types, content packs, placement test,
grammar reference, reader, i18n). Post-M9 growth work shipped: analytics, onboarding tour, install
prompt, feedback, donations, Yandex Cloud migration and prerendered SEO. Accounts, sync, TOTP/recovery,
managed AI, subscription checkout, and the Android shell are also implemented. Release 1.0.0 is in
`main`; local history records RuStore moderation submission, not a confirmed store publication.
See private `docs/work-queue.md`, `docs/plans/GLOBAL_PLAN.md`, and `docs/codex/project-context.md`
for dated decisions and remaining work. Verify current production/store status separately.
