# SEO recovery plan — dayenglish.ru (audited)

Offline-first React 19 SPA (Vite, no SSR) on Yandex Object Storage + CDN. ONE bucket serves all
four hosts (`.ru`, `www.ru`, `.online`, `www.online`). `scripts/deploy-yc.sh` already copies
`index.html` to per-route object keys. Independent audit applied.

## Verified findings

1. **Every route serves byte-identical static HTML that canonicalizes to `/`.** `/`, `/grammar`,
   `/library` all serve the same `index.html`: same `<title>`, description, OG, empty `#root`, and a
   hardcoded `<link rel="canonical" href="https://dayenglish.ru/">`. Two problems compound:
   - Pre-canonical (before commit 4d831dd) the routes were ALREADY byte-identical, so search engines
     deduped them by content similarity anyway. The root canonical is an **aggravator that made the
     collapse explicit**, not the sole new cause. → Per-route canonical alone won't fix indexing
     unless the served HTML also **differs per route** (title/description/content).
2. **Four nav-linked routes 404 to crawlers.** `AppLayout` links `/review`, `/progress`,
   `/vocabulary`, `/settings`; none are in the deploy alias loop, so they return 404 status. A crawler
   following homepage nav hits four 404s — plausibly a worse signal than the canonical collapse.
3. **`.online` is a live, indexable, byte-identical duplicate.** Same bucket → same HTML, md5
   identical, `robots: index,follow`. The hardcoded `https://dayenglish.ru/` canonical is ALSO the
   cross-domain consolidation signal for `.online` — so it must NOT be removed or made origin-relative.
4. **SPA, no SSR.** Empty `#root`; crawler-visible content = `<head>` + ~1490-char `<noscript>`.
   Yandex DOES render JS but on a delayed/unreliable queue, so anything set only by client JS
   (e.g. a React canonical hook) is not authoritative for crawlers.
5. **Sitemap thin & stale:** 3 URLs, `lastmod 2026-08-25`; `/grammar/:id` and `/library/:id` soft-404
   today (not aliased), so they can't be added without also creating their object keys.

## Diagnostics to request (baseline first)

Earlier Metrica: ~31 visitors / 3 days, ~2 from search — a drop from ~2 organic is noise. Ask:
- **What dropped** — Metrica visits, a Webmaster position, or "I searched and didn't see us"?
- **Webmaster → Indexing → Pages** count + `site:dayenglish.ru` result count (screenshot).
  Note: "only `/` indexed" is *consistent with* findings 1+2+5 but does not single one out — don't
  gate the fix on it.

## Fixes (audited ordering)

**P0 — bake correct per-route static HTML in the deploy script (crawler-visible, no JS).**
`scripts/deploy-yc.sh` already writes per-route object keys. Extend it to, for each key, `sed`-rewrite
the shell so each route is self-describing:
- `<link rel="canonical">` and `og:url` → the route's OWN absolute URL, but **always on the `.ru`
  origin** (`https://dayenglish.ru/grammar`, etc.) — this self-canonicals on `.ru` AND cross-domain-
  canonicals `.online` in one tag. Never remove it or switch to `location.origin`.
- per-route `<title>` + `meta description` (distinct copy per route, so pages differ in served HTML).
- **Add the four nav routes** (`/review`, `/progress`, `/vocabulary`, `/settings`) to the alias loop
  so they stop 404ing, and give them `<meta name="robots" content="noindex,follow">` (app-state pages,
  not landing content) with a self canonical. This subsumes the earlier "React head manager" idea —
  a client hook is unnecessary for these static routes and would be invisible to crawlers anyway.

**P1 — decide `.online` explicitly (binary — no conditional third door).** A server 301 and the
in-app `.online`→`.ru` progress migration are mutually exclusive for the same request (the migration
SENDER runs on `.online` at `/`; a 301 kills it before its JS runs). Choose ONE:
- (a) **Clean 301 `.online/* → .ru/*`** at the CDN edge — accepts that the one-time progress handoff
  is dropped. Aligns with the existing WIP `scripts/online-redirect-sw.js` (a self-destruct SW that
  already redirects with no snapshot). Simplest, strongest SEO.
- (b) **Canonical-only + set `.ru` as the main mirror (главное зеркало) in Webmaster** — keeps the
  migration path, relies on Yandex honouring the cross-domain canonical (slower, less certain).
Given traffic is tiny (few `.online` users to migrate), (a) is the pragmatic default — **user decides.**

**P1 — sitemap, only paired with alias keys.** Expand the sitemap ONLY for routes whose object key is
actually written (never submit soft-404s). Minimum: `/`, `/grammar`, `/library` with fresh `lastmod`.
To add `/grammar/:id` + `/library/:slug`, the deploy must first write an alias key per article/book id
(from `grammar.json` + catalog slugs) — do both in one change or neither. Resubmit in Webmaster.

**P2 — per-route content depth.** Give `/`, `/grammar`, `/library` genuinely different static copy
(hero/`<noscript>`) targeting real queries, so they're not near-duplicates even beyond the canonical.

**P2 — prerender** key routes to full static HTML: durable but a large change to a client-only app
(Zustand + IndexedDB). Separate scoped decision, LAST — only if per-key static HTML proves insufficient.

## Realistic expectations

Head terms («учить английский», «английский онлайн», «английский бесплатно») are held by Skyeng /
Duolingo / Puzzle English and are **not reachable** for a new site on any honest timeline. Target
**brand + long-tail**: «бесплатный офлайн курс английского», «английский для разработчиков»,
«английский по 15 минут в день», «учить английский по дням», «читалка книг на английском с переводом».
Top-3 is realistic for those, not for head terms. And timing: expect **weeks** for Yandex to re-crawl
and consolidate mirrors, **months** for ranking to move — with ~1 indexed page and no backlinks even
long-tail is slow.

## Sequencing
(a) deploy-script per-key static HTML (canonical + title/description per route; nav routes aliased +
noindex) → deploy → verify each route emits its own canonical/title in served HTML.
(b) `.online` decision (301 vs canonical-only) → apply.
(c) sitemap expansion only alongside alias keys.
(d) per-route content depth.
(e) prerender (last, if needed).
Each step: `npm run build`, curl each prod route's served HTML to confirm, resubmit sitemap.
