# Programmatic SEO — per-grammar-topic landing pages

## Problem
Only 3 URLs are indexable (`/`, `/grammar`, `/library`). The grammar reference has **47 topics**
(`grammar.json`: id, title{en,ru}, level, summary{en,ru}, blocks, pitfalls) each already rendered by the
SPA route `/grammar/:articleId` (`GrammarArticlePage`, standalone by id, no auth). They are invisible to
search: not prerendered with per-topic meta, not in the sitemap. This is the biggest free acquisition
lever — RU long-tail ("present perfect правила", "английские артикли a an the").

## How routing works here (verified)
`build-seo.mjs` clones `dist/index.html` into `dist/<key>.html` with per-route canonical/title/desc;
`deploy-yc.sh` uploads each to object key `<key>` (no extension), so a clean URL returns prerendered
HTML 200 (static hosting soft-404s any missing key). The SPA JS then hydrates the real content (Google
renders JS). Nested keys `grammar/<id>` coexist with the `grammar` index key — no conflict.

## Plan (meta-first v1; body-prerender is a deliberate v2)
**`scripts/build-seo.mjs`**
- Read `public/packs/dev-english-a2/grammar.json` (guard: if missing, warn + skip topics, don't fail build).
- Factor a `renderPage({ url, title, desc, index, ldjson })` helper reused by the flat routes and topics;
  it also now replaces `og:title`/`og:description` (currently left generic — a free win) and, when
  `ldjson` is given, injects an extra `<script type="application/ld+json">` before `</head>` (additive —
  keeps the site `@graph`).
- Generate `dist/grammar/<id>.html` for each topic (mkdir `dist/grammar` recursive):
  - canonical + og:url = `https://dayenglish.ru/grammar/<id>`
  - `<title>` = `${title.ru} — правила и примеры | DayEnglish`
  - description/og:description = `summary.ru` + short shared tail ("Понятное объяснение с примерами,
    бесплатно, без регистрации."), trimmed ≤ ~160 chars
  - JSON-LD `LearningResource` (name, description, inLanguage ru, educationalLevel=level,
    isAccessibleForFree, url, isPartOf #website)
  - robots stays `index, follow`
  - HTML-escape all meta values (`& < > "`); JSON.stringify all JSON-LD values.
- Sitemap: home + `/grammar` + `/library` + 47 `/grammar/<id>` (priority 0.7, changefreq monthly) → ~50 urls.

**`scripts/deploy-yc.sh`**
- After the existing route loop, upload every `dist/grammar/*.html` to key `grammar/<basename>` (strip
  `.html`), `text/html`, `$NOCACHE`. Guard on the dir existing.

## Out of scope (note only)
- Body prerender (real article text in the static HTML, not just meta) — the highest follow-up lever;
  matches nothing here yet (all current routes are meta-only). v2.
- Per-book and per-unit landing pages. Home copy says "A1 → B1" but there's no A1 tier (separate call).

## Verify
`npm run build` → assert `dist/grammar/*.html` count = 47, each has its own canonical/title, sitemap lists
50 urls, JSON-LD parses. `npm test` still green. Independent-agent audit of the diff. Post-deploy ops:
resubmit sitemap in Yandex Webmaster / Google Search Console; the topic pages are `NOCACHE` at the edge.
