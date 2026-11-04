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
provides username/password accounts, legacy-key compatibility, TOTP/recovery, cross-device sync, Robokassa subscriptions,
and managed AI. It uses YDB, Object Storage, and Lockbox on Yandex Cloud.
**Android** uses Capacitor 8, native TTS and English dictation. Sync, managed AI, feedback, and analytics
make network requests when enabled; user-imported books stay local unless book-file sync is enabled.

### Account access

The account flow at `/account/register` and `/account/login` uses a unique username
(4–24 ASCII letters, digits or underscores; starts with a letter) and a password
(15–128 NFC Unicode code points, including spaces). No email, phone or security
question is collected. Ordinary signup offers an unchecked free-trial option.
Signup from a Pro invitation has an explicit **Create account and try Pro** action
and a separate free-account action. Login and legacy-key upgrades never start a
trial. Registration and activation use separate API operations: partial failure
keeps the account and retries activation only; lost replies are reconciled before
retrying. Confirmed Pro access returns to the original task with its actual expiry.
Optional recovery uses an authenticator and eight one-use backup codes. Recovery
keeps the account id, subscription and synced data, and revokes previous sessions
and the legacy key. An ordinary password change keeps the current device signed
in, signs other sessions out and preserves a legacy key if one exists.

Existing key accounts can attach a username to the same identity; their old recovery
names remain separate, nonunique locators. The UI checks `/v1/access/capabilities`
and keeps the legacy settings flow when the API has not been upgraded. Production
rollout requires the additive `account_access` YDB table and its `by_account` index
before the separate API deployment; see [server/README.md](server/README.md).
Source integration alone does not deploy the API or update the shipped Android APK.

### Contextual help

A two-step welcome opens automatically on first app entry until dismissed or completed:
product overview, then five theme previews, interface text size and an optional
14-day Pro trial. Its own completion marker is independent of old onboarding,
progress and settings. Closing or continuing completes it; interruption before
that allows another automatic attempt. Daylight is only the new-install default;
saved appearance and old history preserve the previous look. Appearance preview
is reversible until saved. Storage failure supports
retry or an explicitly temporary session-only choice.

The trial checkbox starts selected where potentially eligible, with an explicit
trial action and a separate free path. Account creation uses the existing access
flow; signing in requires a separate trial decision. Existing/expired access and
device refusals never grant another trial. A pending activation is remembered by
owner and can be checked after reload without repeating the mutation. The welcome
opens automatically; **?** remains page help.

The header's **?** opens help for the current page and always starts at its first
step. The reader has its own help button. Only the first lesson and reader visit
show a short three-step introduction automatically; dismissal and completion are
remembered separately for each local data owner. Manual help remains available
when storage is unavailable. Historical `onboarding.seen` data is unchanged.

Optional recorded examples load only after **Show example**. They support stop,
replay, reduced motion, small screens and missing-file recovery. Versioned media
under `public/onboarding/` is excluded from the PWA app-shell precache and cached
only when requested. Its manifest records synthetic-fixture provenance and hashes.
Tours suspend reading statistics and position writes, restore the reading place
and focus, and never submit exercises, save words or make paid AI requests.

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

## Page layout and navigation

Header, page shell, footer and app notices share the 1160px `.app-container`.
Overview grids adapt to available space and the interface text size; books,
exercises and long-form pages use a centered `.reading-column`.
Navigation uses the supplied DayEnglish book/sun mark and local SVG icons in
`src/assets/brand/`. Wide screens show five study destinations, a Settings link
and More; Progress is also visible when space permits and otherwise moves into
More. Compact screens move the five labelled study links to a bottom bar.
If large text cannot fit those labels, or the viewport is short, a non-sticky
Sections disclosure contains all destinations. Pro stays in More/Sections.

Actual font and viewport measurements choose the layout. Each destination has one
accessible link; resizing preserves navigation focus. More names the current
secondary section, supports keyboard/outside dismissal, and stays inside the
visible viewport. Nested lessons, articles, readers, translator, settings and
subscription returns retain their parent navigation context.

Measured top/bottom insets keep anchors, keyboard focus, sticky controls, floating
reader controls and footer links clear of the bars, including safe areas. Reader
position and visible-paragraph accounting use the same insets. A skip link moves
keyboard users directly to the main content.

## About DayEnglish

`/about` introduces the learning path, reader, vocabulary and reviews with the
shared brand/icons and theme tokens. Its connected reading → save → recall demo
uses labelled prepared meanings and memory-only records. Looking up does not save;
partial phrase ranges remain unavailable, reverse selection works, and replacing
a demo rating does not create an extra entry. The example never writes real
vocabulary, schedules, exercise history or learning milestones. Pronunciation uses
the existing app engine with stop, page/route cleanup and unavailable feedback.

Native FAQ disclosures work independently. Page anchors support keyboard focus
and separate browser history scroll restoration; Pro, data, feedback and legal
links stay within the app. Copy and the static search fallback distinguish local
storage from optional cloud book sync, cached offline materials from network
requests, and free study from optional Pro without inventing prices/eligibility.

## Today and the course overview

`/` shows a single topic's day path, with a desktop preview or a mobile dialog.
On desktop, the selected day card links directly to its lesson; selecting another
card previews it first. Mobile cards open the day overview with its lesson link.
`/syllabus` lists levels as independent disclosures; topics link back to
`/?unit=<id>`. Browsing topics or previewing a day does not change the working day.
Opening a lesson records that day locally. Returning preserves browsing selections,
expanded levels, scroll and focus; account data resets clear this context.

Completion counts come from saved practice/listening answers. Wrong-only attempts
mark a day as started; a day with no scored exercises is never completed by 0/0.
Without a valid working day, continuation uses started days, then the placement
recommendation and remaining course order. Progress-read failures offer retry while
keeping lessons accessible. Working-day persistence is device-local; synced answers
still contribute to continuation suggestions on other devices.

## Grammar reference

`/grammar` loads its own reference JSON independently of the full course. Search
matches both languages, topic aliases, headings and examples; CEFR and category
filters retain their session state. Cards show real levels and examples. Unknown
future topic IDs remain visible under Other topics.

Articles retain all original blocks, examples, translations, pitfalls and related
topics. The table of contents follows the actual blocks, with a desktop sidebar
and a mobile disclosure. Returning preserves the original filtered card and focus.
Fresh header navigation opens the reference at the top; article/list and browser
returns restore their context. The header disclosure stays above page artwork.
Lesson/reader context survives related topics and list navigation; a lesson return
is validated using only the course index (reusing it when already loaded).
Loading, cancellation, failure, empty reference and missing article are separate
states; late cancelled requests cannot replace a retry. Reading a rule does not
change exercise completion or SRS progress.

## Progress

`/progress` separates lifetime exercise/vocabulary figures from local-date
reading periods (today, 7/30 days and 12 months). Exercise streaks and the 14-day
calendar retain UTC semantics. Skill accuracy uses the first attempt per unique
exercise; small samples are labelled and do not imply mastery or a CEFR level.

Reading shows actual time, word/save/review events and book totals. Zero days have
zero-height bars; a date selector and table provide the same values without
requiring precise pointer input. Vocabulary counts learning/known entries;
reviews count answers, and known marks count actions rather than learned words.

Independent local reads distinguish loading, cancelled, empty and unavailable
data, with retry and stale-result guards. Account changes reset data and browsing
context. Local data remains usable offline even when course loading fails.
Skill/checkpoint dialogs lead to available rules/tests and preserve return focus;
opening a checkpoint does not save a result. Legacy malformed checkpoint data
shows unavailable history without modifying or deleting its records. No new
database schema, AI evaluation or server contract is introduced.

## Library

The imported and catalog book readers use a dedicated reading header, chapter
contents, a reserved desktop help rail and native mobile help sheets. A single
bottom dock controls the existing speech session and actual book position.
Word/phrase lookup is separate from saving; sentence translation, simplification,
grammar and exact bookmarks retain their real provider, entitlement and storage
paths. Chapter words, matching and exercises open from explicit reading actions.
Practice does not grade FSRS implicitly.

Active Pro/trial book help starts the cached contextual word meaning automatically
after a short dismissal debounce, without requiring a personal key or another
tap. Cancel/retry remain explicit; free lookup remains available on AI failure.
Unknown plans and BYOK-only book help keep an explicit context action. Cached
answers remain readable when quota is spent; new managed calls retain the existing
quota checks. Saving uses the displayed meaning unless the user edits it.

Reading appearance previews font, size, spacing, highlights, five themes and actual
device voices before Save/Cancel. Fresh books use 22px serif text; existing saved
sizes and the 17px course default are preserved. Logical word anchors account for
the measured reader header and occupied dock area. Bookmark and chapter writes
are atomic with sync markers and fenced against late owner changes.

`/library` shows imported books and a continuation card. `/library/catalog` has
the free-license catalog with its actual CEFR levels. Each shelf retains separate
search, sort and filters during navigation; reading returns to a visible card.
Desktop uses decorative fallback covers and mobile uses compact rows. Details
contain reading actions and an explicit deletion confirmation.

Import supports cancellation before the metadata commit, scoped to the current
data owner. Errors, empty lists and loading are distinct. Device availability is
checked against OPFS or a parsed-book cache; browser catalog books become available
offline after opening and caching them. Native bundled stories ship in the APK.
The catalog manifest is cached for offline browsing. Upload issues remain separate
from local availability; download failures use the existing reader recovery flow.
“Mark as read” is device-local and preserves the actual reading position.

## Review sessions

`/review` shows the actual due queue, a preview and separate first-use, nothing-due,
loading, cancelled and retryable read-error states. Start opens `/review/session`;
its membership is fixed until a new session. Words, phrases, grammar patterns and
legacy mistake cards retain their existing FSRS behavior. Usefulness/CEFR remains
visible before and after reveal; unknown levels receive no invented score.

Pause and route changes retain the current card, revealed answer, skips and grade
receipts in memory. Restart/reload begins a new session; committed schedules and
review history remain in IndexedDB. Skipping does not grade or reschedule. The
summary counts persisted ratings separately from skipped/removed/unavailable
cards; correcting the last rating replaces its history event without another
repetition. Failed writes keep the current position and offer retry. Account
handover clears private session state and fences late requests.

Space reveals and 1–4 rate only outside interactive controls, after a usable answer
is shown. Missing translations cannot be graded; lookup can be cancelled, retried
or replaced by a manual answer. The native answer editor separates general and
contextual meanings. AI uses the existing plan/key routing and proposes a draft
field value; an explicit Save commits it. Manual editing works offline. Real
browser/native speech supports stop and route cleanup; prototype clips are absent.
Legacy removals require confirmation, and bulk cleanup at 20+ cards is atomic and
does not remove vocabulary, exercise history or course progress.

## Vocabulary entry and chapter words

`/vocabulary` shows aligned term/translation rows with separate pronunciation
buttons, counted overlapping filters, search, sorting and eight-row disclosure.
CEFR dots are an approximate level-based usefulness guide; unrated words and
phrases are not assigned an invented rarity. Search, filters, order, visible limit
and the originating row's focus survive detail/Back navigation. Detail URLs use
opaque device-local identifiers, keeping saved terms out of page URLs.

Details keep the original example, contextual gloss and word forms separate from
the dictionary answer. Known status and a review card are independent; hiding a
word excludes it from All and review. Removing a card requires confirmation:
status-only words remain, card-only words leave the list, and tombstones are not
silently recreated. Translation edits guard against concurrent card changes.
Loading/read failures show unknown counts and explicit retry/cancel, rather than
an invented empty dictionary; a transient read failure retains an open editor.

Adding uses a native dialog with live preview, explicit save confirmation,
Add another/View/Done, preserved cancelled/failed drafts and duplicate detection
without overwriting an existing answer or schedule. The card is saved atomically
before optional translation; late lookups enrich only their own unchanged record.
From Russian and English dictation remain under More ways to add.
AI examples reuse the existing meanings service: choosing an example fills an
empty answer with that meaning and preserves a manually entered answer. Subsequent
edits require checking the example/meaning agreement. Manual examples remain free.
Pronunciation uses the existing browser/native engine, with stop/switch, route
cleanup and explicit failure feedback; prototype audio clips are not shipped.

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

In `/vocabulary/text`, Translate sits beside the initial English input. The
result workspace pairs a readable, tappable source with its Russian translation;
mobile users switch between Source and words and Translation. More input options
include reading without translation and dictation with explicit acceptance.
Source changes can be cancelled, a cleared field can be restored, and manual
translation edits require confirmation before replacement. Failed or cancelled
requests retain completed parts for an explicit retry or continuation. Retry uses
the selected mode; changing it restarts the full source without mixing results.
AI without an available plan/key shows the shared access guidance and offers a
cache-only lookup; a cache miss never starts a remote AI request.

Yandex Metrica receives named milestones for first exercise answers, resolved book
opens, newly saved words/phrases, review sessions with persisted answers, completed
free/AI passage translations and server-confirmed trial starts. Tour completion
requires the final Done action; dismissal is tracked separately. Milestone payloads
contain event names, not terms, text, book titles or account identifiers. Counts
include cached translation success and do not measure paid AI consumption. Existing
analytics opt-out and Do Not Track apply. New Android events require an APK update.

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

Settings use six deep-linked sections under `/settings`: appearance, learning,
AI, account, data and privacy. Desktop has a side menu; mobile starts with a
section index. Legacy `#ai-section` links still open AI settings. Optional provider
credentials stay in a disclosure; unsaved provider drafts survive section changes
but are cleared on account handover. A failed local save is reported without
activating an unsaved key. Account recovery and billing still use the real API.

Five device-local palettes (Daylight, Lime, Peony, Lagoon and Studio) apply through
semantic colour tokens throughout the app. Theme selection previews immediately;
Apply persists it, while Cancel, Escape, Back or navigation discard the preview.
Without a saved choice, Studio preserves the familiar dark appearance. Today has
a dismissible invitation, and the picker remains available in Settings. Reader
text size stays independent; the current reader uses the app palette. Theme
preferences are not account data or a separate book-page colour setting.

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

For local web development and `vite preview`, an absolute `VITE_API_BASE` is
proxied through `/__dayenglish_api` on localhost with a port. This avoids production
CORS restrictions without changing the API's allowed origins. Restart Vite after
changing its config or env. Production web and Capacitor keep the configured API
URL; leaving it empty still disables account features. The proxy talks to the
configured backend, so use test accounts for local flows that write data.

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

- **Feedback** (`/feedback`, `src/features/feedback/`) uses the configured endpoint
  (`VITE_FEEDBACK_ENDPOINT`) or, otherwise, **Web3Forms** (`VITE_WEB3FORMS_ACCESS_KEY`, no backend).
  An optional `VITE_FEEDBACK_EMAIL` link opens the mail client. The responsive form validates optional email, explains its diagnostic payload,
  and distinguishes confirmed delivery from a durable local queue (`feedbackOutbox`). Offline and
  failed requests keep the same submission ID for retries; database leases coordinate foreground,
  startup/online and other-tab attempts. Web3Forms must acknowledge `success: true`. A timeout or
  stopped attempt cannot recall a message already accepted by the provider, so delivery after a
  lost acknowledgement is not guaranteed exactly once. Unsubmitted drafts remain in memory across
  navigation; queued messages survive a restart. Device handover clears both; ordinary logout does not.
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
- **Reading help in lessons and books:** contextual word meanings, sentence AI translation,
  simplification/grammar, and phrase translation share the same engine. Confirmed Trial/Pro
  words resolve automatically; BYOK offers an explicit word action without requiring a plan.
  Select AI for sentence/phrase translation; free translation remains available. Course recordings,
  authored translations and glossary are preserved. Phrase selection stays within its reading block;
  manual edits are protected and a card is created only by an explicit save.
  Mobile book help closes with a downward pull from its header or from content already at the top.
  Native scrolling, nested quotes and text editing keep priority for their entire gesture; a first-use
  grip hint respects reduced motion. The close button and keyboard dismissal remain available.
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
  Native startup retires historical workers before opening the app bundle, without
  clearing learning data or caches. The internal `/packs/native-app-bootstrap-v1.html`
  path bypasses historical SPA navigation fallbacks and must remain bundled.
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
