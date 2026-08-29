# Plan — fix the spoken-word highlight lag in read-aloud

## Symptom (user, cross-platform)
During reader read-aloud the highlighted word trails the audio. Reproduced on **Windows** (local voice)
AND **Android** (Google TTS). Both platforms commonly do NOT emit `boundary` events, so the highlight is
driven by the **estimate fallback** — that's where the lag lives.

## Root cause (verified in `src/shared/lib/audio.ts › speakPassage`)
Two independent lag sources in the fallback (`onstart` handler, ~L243-256):
1. **Constant ~220 ms offset.** The fallback is armed with `setTimeout(…, 220)` (a window to detect
   whether `boundary` fires). Inside it, each word is scheduled at `delayMs = (s.start - chunk.offset)/
   charsPerSec` measured **from the chunk start**, but the timers are created 220 ms *after* speech
   started and the elapsed 220 ms is never subtracted. → every word highlights ~220 ms late.
2. **Fixed pace guess.** `charsPerSec = 15 * rate` (L211) is a constant. Real voices vary; when the
   voice is faster than ~15 char/s the per-word delays are overestimated, so the lag **grows through the
   sentence** (resets each chunk). No re-sync to actual progress.
Per-sentence replay (new) makes both worse: a short single-chunk utterance is dominated by the 220 ms.

The precise `boundary` path (Chrome desktop *remote* voices) is on-time and needs no change.

## Fixes
**Fix 1 — compensate the elapsed time (removes the ~220 ms baseline).** In `u.onstart`, stamp
`const t0 = performance.now();` BEFORE the detection `setTimeout`. Inside it, schedule each word at
`Math.max(0, delayMs - (performance.now() - t0))`. Words already spoken during the detection window fire
immediately (correct catch-up); the rest land at their true absolute time `t0 + delayMs`.
(`performance.now()` is fine in app code — the Date.now/now restriction is Workflow-scripts-only.)

**Fix 2 — self-calibrate the pace from measured chunk duration.** Keep a module-level EMA of the real
speaking rate, seeded at the current 15 char/s. When a chunk ends, compute
`measured = chunk.text.length / ((performance.now() - chunkStart) / 1000) / rate` (chars/s at rate 1)
and fold into the EMA (e.g. `cps = cps*0.6 + measured*0.4`), guarding against absurd values (skip if the
chunk was cut short / errored). Use the EMA as `charsPerSec` for the NEXT chunk's fallback estimate.
Because the EMA is module-level it also improves per-sentence replay after the first bit of reading.
- Only measure on completed (`onend`, not `onerror`) chunks; ignore the very short ones (< ~0.3 s) to
  avoid noise; clamp `cps` to a sane band (e.g. 6-40).

**Fix 3 (small) — shorten the detection window** from 220 ms to ~120 ms so the fallback engages sooner
(less initial blind period). Still long enough that a real `boundary` sets `boundarySeen` first and the
estimate stands down (the existing `boundarySeen` guard prevents double-driving).

## Non-goals / unaffected
- The `boundary` (precise) path — unchanged.
- Chunking, word-span mapping, the reader's offset logic — unchanged.
- Both the paragraph read and the new per-sentence replay use `speakPassage`, so both benefit.

## Risks / for the audit
1. **Over-correction:** could Fix 1 + a too-high calibrated `cps` make the highlight *lead* the audio?
   (Leading is as bad as lagging.) Is the clamp + EMA smoothing enough? Should we bias slightly slow?
2. **Calibration validity:** `onend` time vs actual audio end (trailing silence, engine buffering);
   does `performance.now()` at `onstart`/`onend` reflect real speech start/stop closely enough on
   Android WebView / iOS? Is a per-(voice,rate) key needed instead of one global EMA (rate is already
   divided out; voice differences remain)?
2. **Module-level state leakage** across passages/voices — resets, and whether a stale calibration from a
   very different voice hurts the first chunk after a voice switch.
3. **`speechToken`/`alive()`** interplay — the new timing must still no-op on cancelled utterances; the
   EMA update must not run for a chunk cancelled mid-way (`chunkAlive`/`alive()` guards).
4. **Reduced-motion / highlight-off** must still fully bypass (the `onWord` gate on
   `highlightSpokenRef` is in the reader, not here — confirm nothing regresses).
5. Any interaction with the estimate timers being created inside a `setTimeout` (drift of setTimeout
   itself under load) — is scheduling absolute-from-t0 better than nested relative timeouts?

## Test / verify
- Manual on Android + Windows local voice: highlight tracks the spoken word within ~1 word; no growing
  drift through a long sentence; per-sentence replay highlight is tight; rates 0.75-1.5× all reasonable.
- Sanity that a `boundary`-firing voice (Chrome desktop remote) is unchanged.
- `npm run build`, `npm run lint`, `npm test` green (jsdom can't run TTS; consider a unit test for the
  EMA/clamp helper if extracted).

## Rollout
Code-only (`audio.ts`). Land after audit; verify in-app on a real Android device; commit → push on go.

## Audit revisions (independent review — applied)
CONFIRMED the root cause; REVISE. Implemented the reviewer's recommended mechanism + must-fixes:
- **rAF-driven estimator instead of N setTimeouts.** A single `requestAnimationFrame` loop per chunk
  re-derives the word from *elapsed since `chunkStart`* each frame (subsumes Fix 1's elapsed
  compensation intrinsically and is immune to per-timer jitter; one cancel point). Walks a precomputed
  per-chunk word list (`chunkWords`) for O(1)-amortised frames. Armed after a ~120 ms window so a
  boundary-capable voice stands it down first (`boundarySeen`), and `onboundary` also cancels it.
- **Fix 2 must-fixes:** `charsPerSec = cpsEma * rate` (rate re-applied at use, divided out at measure);
  `chunkStart` stamped in `onstart` (real speech start, reused as the estimate anchor); EMA updated
  ONLY on natural `onend` with `alive() && chunkAlive && chunkStart>0 && dur≥0.3s && measured∈(3,60)`,
  clamped to 6–40 — so pause/cancel/error chunks never poison it. `chunkStart`/`rafId` are
  utterance-local; the EMA is module-level (one speech in flight at a time, so no concurrent writers).
- Kept the precise `boundary` path unchanged; day reading section (same `speakPassage`) benefits too.
