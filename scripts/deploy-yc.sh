#!/usr/bin/env bash
# Deploy dist/ to a Yandex Object Storage bucket (S3-compatible), CDN-fronted.
# Ordering + Content-Type + Cache-Control are load-bearing (see docs/plans/migrate-to-yandex-cloud.md §9):
#   1. immutable hashed assets first (--size-only), 2. content packs, 3. index.html/sw.js/manifest LAST.
# A wrong Content-Type on sw.js makes serviceWorker.register() reject silently → no offline / no update prompt.
set -euo pipefail

: "${YC_BUCKET:?set YC_BUCKET}"
: "${AWS_ENDPOINT_URL:?set AWS_ENDPOINT_URL}"

DIST="dist"
S3=(aws s3 --endpoint-url "$AWS_ENDPOINT_URL")
IMMUTABLE="public,max-age=31536000,immutable"
PACK="public,max-age=604800"
NOCACHE="no-cache"

# One extension → one Content-Type, size-only (hashed content is size-distinct when it changes).
sync() { # <glob> <content-type> <cache-control>
  "${S3[@]}" sync "$DIST" "s3://$YC_BUCKET" --size-only \
    --exclude "*" --include "$1" --content-type "$2" --cache-control "$3" --no-progress
}
# Mutable content (pack JSON): compare by size AND mtime (NOT --size-only — a same-length edit must
# still upload), and never let the CDN pin it (a 7-day max-age once hid all new days behind a stale
# course.json). no-cache = CDN revalidates via ETag (cheap 304s); the SW's NetworkFirst does the rest.
syncfull() { # <glob> <content-type> <cache-control>
  "${S3[@]}" sync "$DIST" "s3://$YC_BUCKET" \
    --exclude "*" --include "$1" --content-type "$2" --cache-control "$3" --no-progress
}
put() { # <relative-path> <content-type>  — always overwrite (same name, changed content)
  [ -f "$DIST/$1" ] && "${S3[@]}" cp "$DIST/$1" "s3://$YC_BUCKET/$1" \
    --content-type "$2" --cache-control "$NOCACHE" --no-progress || true
}

echo "1/3 immutable hashed assets…"
sync "assets/*.js"    "text/javascript; charset=utf-8" "$IMMUTABLE"
sync "assets/*.css"   "text/css; charset=utf-8"        "$IMMUTABLE"
sync "assets/*.woff2" "font/woff2"                     "$IMMUTABLE"
sync "assets/*.woff"  "font/woff"                      "$IMMUTABLE"
sync "assets/*.svg"   "image/svg+xml"                  "$IMMUTABLE"
sync "assets/*.png"   "image/png"                      "$IMMUTABLE"
sync "assets/*.jpg"   "image/jpeg"                     "$IMMUTABLE"
sync "assets/*.webp"  "image/webp"                     "$IMMUTABLE"
sync "workbox-*.js"   "text/javascript; charset=utf-8" "$IMMUTABLE"
sync "icons/*.png"    "image/png"                      "$IMMUTABLE"

echo "2/3 content packs (on-demand cached)…"
sync "packs/*.mp3"  "audio/mpeg"       "$PACK"
syncfull "packs/*.json" "application/json" "$NOCACHE"
sync "packs/*.png"  "image/png"        "$PACK"
sync "packs/*.jpg"  "image/jpeg"       "$PACK"
sync "packs/*.svg"  "image/svg+xml"    "$PACK"
# Reader catalog/wordlist assets, if present.
"${S3[@]}" sync "$DIST/reader" "s3://$YC_BUCKET/reader" --size-only --cache-control "$PACK" --no-progress 2>/dev/null || true

echo "3/3 entry files LAST (no-cache, explicit type)…"
put "index.html"          "text/html; charset=utf-8"
put "sw.js"               "text/javascript; charset=utf-8"
put "registerSW.js"       "text/javascript; charset=utf-8"
put "manifest.webmanifest" "application/manifest+json"
[ -f "$DIST/robots.txt" ] && "${S3[@]}" cp "$DIST/robots.txt" "s3://$YC_BUCKET/robots.txt" \
  --content-type "text/plain; charset=utf-8" --cache-control "public,max-age=3600" --no-progress || true
[ -f "$DIST/sitemap.xml" ] && "${S3[@]}" cp "$DIST/sitemap.xml" "s3://$YC_BUCKET/sitemap.xml" \
  --content-type "application/xml; charset=utf-8" --cache-control "public,max-age=3600" --no-progress || true

# Static hosting maps a missing key to the error doc but keeps the 404 status (soft-404), which
# de-indexes shared deep links. Upload the per-route HTML that scripts/build-seo.mjs generated (each
# with its OWN canonical/title, and noindex on app-state pages) so every route answers 200 and is not
# a duplicate of the homepage. Keep this list in sync with build-seo.mjs ROUTES / src/router.tsx.
echo "3b/3 SPA route aliases (200, per-route canonical/title, not soft-404)…"
for route in grammar library support credits feedback review progress vocabulary settings; do
  src="$DIST/$route.html"
  [ -f "$src" ] || src="$DIST/index.html" # fall back to the shell if build-seo didn't run
  "${S3[@]}" cp "$src" "s3://$YC_BUCKET/$route" \
    --content-type "text/html; charset=utf-8" --cache-control "$NOCACHE" --no-progress
done

echo "Done. NOTE: CDN must honor origin Cache-Control (or force-revalidate sw.js/index.html/manifest),"
echo "otherwise the edge serves a stale sw.js and PWA updates stall. No --delete (orphans pruned separately)."
