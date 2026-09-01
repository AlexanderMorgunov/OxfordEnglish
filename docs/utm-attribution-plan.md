# UTM attribution — see which channels convert

## State (verified)
- **Metrica** (`metrica.ts`) is the only LIVE analytics: minimal init + explicit `hit` page-views. It
  natively captures utm_* and referrer per VISIT (last-touch) — so channel *traffic* is already visible.
- **Custom queue** (`analytics.ts` `track()`) is INERT: `ANALYTICS_ENDPOINT === ''` → `active()` false →
  nothing stored/sent. All conversions go only here: `day_complete`, `placement_done`, `onboarding_end`,
  `pwa_installed`, `book_open` (6 call sites across features).
- **Gap:** conversions are NOT Metrica goals, so Metrica can't attribute them to a source; and there is no
  persisted FIRST-touch (Metrica default is last-non-direct).

## Plan (v1 — no endpoint needed; rides Metrica)
1. **`consent.ts`** (new, breaks an import cycle): move `isAnalyticsEnabled`/`setAnalyticsEnabled`/opt-out
   key + `dntOff()`. `analytics.ts` re-exports them (keep existing imports working); `metrica.ts` imports
   from `consent.ts` (no longer from `analytics.ts`). Now `analytics.ts` can import `metrica.ts` safely.
2. **`attribution.ts`** (new): `captureAttribution()` — on load parse `location.search` utm_source/medium/
   campaign/term/content + `document.referrer` **hostname only** (never the full URL — privacy) + landing
   path + ts. Persist FIRST-touch once to `localStorage['analytics.attribution']` (never overwrite).
   `getAttribution()`. Gated on `isAnalyticsEnabled() && dntOff()` (opt-out/DNT respected; localStorage
   only, no network).
3. **`metrica.ts`**: `metricaGoal(name, params?)` = `ym(id,'reachGoal',…)`. On `initMetrica()`, after init,
   send first-touch as `ym(id,'userParams',{ firstTouch: {...} })` (visitor-level, so it sticks).
4. **`analytics.ts` `track()`**: fire `metricaGoal(event)` for a whitelist of CONVERSION events
   (day_complete, placement_done, onboarding_end, pwa_installed, book_open) BEFORE the `active()` queue
   gate — so conversions reach Metrica even with the endpoint empty. Also add `attribution` to the `flush()`
   POST body (future-proofs the queue when an endpoint exists).
5. `main.tsx`: `captureAttribution()` before `initAnalytics()/initMetrica()`.

## Privacy
utm + referrer-hostname + landing path are non-PII. No new egress beyond Metrica (already present); custom
queue stays inert. Store referrer hostname only; respect opt-out + DNT everywhere.

## Ops (after deploy)
Metrica goals are JS-goals keyed by identifier — the user must create goals in the Metrica dashboard with
ids matching the event names (day_complete, placement_done, onboarding_end, pwa_installed, book_open) for
them to show in reports. reachGoal with an unconfigured id is a harmless no-op until then. First-touch shows
under visitor params.

## Verify
build + `npm test` (extend analytics.test if it asserts the queue path); manually: load `/?utm_source=x&
utm_medium=y` → localStorage attribution set once; verify no cycle / no import errors. Advisor audit.
