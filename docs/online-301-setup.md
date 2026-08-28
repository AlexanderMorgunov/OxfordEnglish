# 301 redirect `dayenglish.online` → `dayenglish.ru` (Yandex Cloud)

Goal: consolidate the `.online` duplicate into `.ru` so Yandex indexes `.ru`. Yandex refused the
"Переезд" move because a cross-domain move needs a real server **301** (canonical alone hasn't worked
for ~3 years). This is host-level infra in the Yandex Cloud console — it cannot live in the app repo,
because **one bucket + one CDN resource (`bc8rvswg6egkv56qxcpa`) currently serve all 4 hosts identically**,
so `.online` must be split off before it can redirect while `.ru` keeps serving the app.

The `scripts/online-redirect-sw.js` service-worker approach is NOT enough here — a SW only runs in
browsers that already installed it; crawlers and new visitors need a server 301.

## First: is there `.online` equity to transfer?
Check `site:dayenglish.online` in Yandex.
- If `.online` still has indexed pages/traffic → use **Option A (301)** so that equity moves to `.ru`.
- If `.online` is also empty (likely) → Option A is still cleanest, but **Option B (retire `.online`)**
  is a faster, acceptable fallback.

## Option A — proper 301 (recommended): redirect bucket + own CDN resource for `.online`

1. **Create a redirect bucket** (e.g. `dayenglish-online-redirect`). Enable static website hosting and
   set the website config to redirect everything to `.ru`:
   ```xml
   <WebsiteConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
     <RedirectAllRequestsTo>
       <HostName>dayenglish.ru</HostName>
       <Protocol>https</Protocol>
     </RedirectAllRequestsTo>
   </WebsiteConfiguration>
   ```
   (In the console: bucket → Website → "Redirect all requests" → host `dayenglish.ru`, protocol HTTPS.)
2. **Create a NEW CDN resource** for the two `.online` hosts:
   - Domains (CNAMEs): `dayenglish.online`, `www.dayenglish.online`.
   - Origin: the **redirect bucket** from step 1 (its website endpoint).
   - TLS certificate: reuse the existing multi-SAN cert `dayenglishsert` (it already covers `.online`).
   - Enable "redirect HTTP→HTTPS" so http `.online` also lands on https before the 301.
3. **Move DNS**: point `dayenglish.online` and `www.dayenglish.online` CNAMEs (Cloudflare, grey-cloud)
   to the NEW CDN resource's endpoint.
4. **Remove `dayenglish.online` + `www.dayenglish.online` from the OLD CDN resource**
   `bc8rvswg6egkv56qxcpa`, so it fronts only `dayenglish.ru` + `www.dayenglish.ru`.

Result: any request to `.online/<path>` → 301 → `https://dayenglish.ru/…`, while `.ru` keeps serving
the app unchanged.

## Option B — retire `.online` (fastest, lossy): only if `.online` has no index/equity
Remove `dayenglish.online` + `www.dayenglish.online` from CDN resource `bc8rvswg6egkv56qxcpa` and drop
their DNS. `.online` stops resolving; Yandex drops the dead duplicate and `.ru` becomes the only
candidate. No redirect for old `.online` links (they 404 / don't resolve) — acceptable only if there's
nothing indexed there to preserve.

## Verify (after either option)
```
curl -sI https://dayenglish.online/            # Option A: expect HTTP/… 301 + Location: https://dayenglish.ru/
curl -sI https://dayenglish.online/grammar     # ideally 301 → https://dayenglish.ru/grammar (path kept)
curl -sI https://dayenglish.ru/                 # unchanged: 200
```
Note: `RedirectAllRequestsTo` may redirect to the ROOT (dropping the path). Path-preserving is nicer
but root-consolidation is still fine given `.online` has ~no deep-indexed pages. Confirm with the curl
above; if paths aren't kept and it matters later, switch to per-prefix routing rules.

## Then, in Yandex.Webmaster
1. Retry **Индексирование → Переезд сайта** from the `.online` property → target `https://dayenglish.ru`
   (now that the 301 exists it should be accepted). Not strictly required — the 301 alone consolidates —
   but it speeds things up.
2. On `.ru`: **Переобход страниц** for `/`, `/grammar`, `/library`; confirm the sitemap re-fetches.
3. Expect days-to-weeks for Yandex to re-crawl, drop `.online`, and index `.ru`.

## Repo side
No app/deploy change is required (the deploy still targets the `.ru`-serving bucket). Once the 301 is
live and stable, the in-app `.online` migration path (`src/main.tsx` sender / `scripts/online-redirect-sw.js`)
is dead and can be removed in a later cleanup.
