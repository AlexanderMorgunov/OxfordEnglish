# Plan #3 — redo read-aloud highlighting: sync at synthesis time, not by estimate

## Problem (user)
The spoken-word highlight in the reader still lags/drifts behind the audio on Android and Windows.
Multiple fixes (compensated timers, rAF loop, pace calibration) did NOT solve it. The user wants the
feature **completely redone** with the most stable, flexible solution.

## Research finding (root cause — this is decisive)
Independent web research (sources in the notes below) establishes that the browser Web Speech API's
`boundary` (word) event — the ONLY signal that reports which word is being spoken — is **missing or wrong
on exactly the platforms the user hits**:
- **Android Chrome / WebView: `boundary` never fires** (tracked Chromium bug). No word signal at all.
- **iOS Safari/WKWebView: undocumented / unreliable.**
- **Safari: fires per-SENTENCE, not per-word** (and omits `charLength`).
- **Windows local SAPI voices: inconsistent, undocumented.**
- **Chrome "Google"/network voices: no boundary events at all.**
- Only **Chrome-desktop LOCAL voices and Firefox desktop** fire per-word reliably.

So the lag is not a math bug — it's **absent data at the source**. Every estimate-based approach (what we
have) must guess word timing and will always lag/drift where `boundary` is silent. The one peer-reviewed
source on this exact problem (Calliope, arXiv 2026) rejects post-hoc alignment/estimation outright and
states the principle: **capture real timing at synthesis time, from the engine that made the audio —
never reconstruct it afterward.** For *arbitrary imported text*, genuine per-word accuracy is only
achievable by (a) a cloud TTS that returns timestamps, or (b) a local neural TTS exposing its own
duration model — the browser's black-box engine simply does not expose the needed data.

## Design — tiered, "stable base + flexible upgrade"

### Tier 1 — the redo we SHIP: phrase-chunked utterances driven by the `start` event (offline, all platforms)
Stop depending on `boundary` entirely. Restructure read-aloud so timing comes from the engine's
reliably-supported **`start` event** (it fires on every platform, including Android/iOS — basic playback
depends on it):
- **Chunk each paragraph into short phrase/clause units** — split on sentence terminators AND clause
  punctuation (`, ; : — …`) with a length cap, respecting the shared `ABBREVIATIONS` list so "Mr." etc.
  don't split. Each chunk is a phrase of ~2–6 words.
- **Speak chunks sequentially**, one `SpeechSynthesisUtterance` per chunk (as today, but smaller units).
- **On each chunk's `onstart`, highlight that chunk's whole word-range.** Because `start` fires when the
  engine actually begins that phrase, the highlight is **drift-free and on-time on every platform** — no
  timers, no estimate, no `boundary`.
- **Granularity trade (the product decision — see "Decision for the user"):** the highlighted unit becomes
  a **phrase**, not a single word. It is never wrong, everywhere — versus a single-word highlight that is
  only correct on desktop-local-voice and lags elsewhere.
- **Progressive enhancement (optional, no downside):** on platforms where `boundary` DOES fire, narrow the
  highlight from the phrase to the current word using the event's engine-reported `elapsedTime` (an audio
  clock, robust to callback jitter) — so desktop users still get word-level, mobile users get rock-solid
  phrase-level. If `boundary` is silent, the phrase stays highlighted for its duration. Pure upgrade.

This removes the entire estimate machinery added earlier (rAF loop, `cpsEma`/`calibrateCps`,
`wordAtElapsed`) — a net simplification — and directly targets the symptom by taking the worst-supported
event off the critical path.

### Tier 2 — optional accurate word-level via BYOK cloud TTS (flexible upgrade, sends text out — opt-in)
Reuse the existing BYOK pattern to let a user optionally supply a cloud-TTS key for read-aloud with REAL
word timestamps. Prefer **Azure `<bookmark>`** or **Google `<mark>`** (self-placed markers we insert at
our own word boundaries → the returned offsets map exactly to our text, immune to TTS-side normalization)
over Polly/ElevenLabs native marks (which need byte-offset / normalized-char remapping). This yields
genuinely correct, on-time, per-word karaoke for arbitrary text — at the cost of sending the spoken text
to a third party per utterance. **Explicit opt-in with clear messaging**, exactly like the AI hints layer.
Not built now — designed as a future tier so Tier 1 doesn't preclude it.

### Tier 3 — fully-offline accurate (research spike only, NOT committed)
Local neural TTS whose duration predictor exposes real phoneme timing (e.g. `ayutaz/piper-plus` WASM —
claims JSON/TSV timing, unverified beyond docs; no Russian voice; ~38–86 MB opt-in download, must follow
the `CacheFirst`-after-explicit-fetch rule, never precache — cf. the 50 MB precache incident). Requires a
hands-on spike + real-time-factor test on low-end Android before it can be trusted. Park as future work.

## Decision for the user (before implementing Tier 1)
Word-level highlight for arbitrary imported text is **impossible offline** where `boundary` is silent
(Android/iOS/most mobile). The realistic choices:
- **(A) Phrase-level highlight, perfectly synced everywhere, offline, zero setup (Tier 1).** Recommended
  default — fixes the lag for good; the highlighted unit is a short phrase.
- **(B) Keep chasing word-level offline** — not achievable reliably; would stay laggy on the user's own
  devices. Not recommended.
- **(C) Word-level accuracy via opt-in cloud TTS (Tier 1 + Tier 2)** — accurate single-word karaoke, but
  the book text for each spoken phrase leaves the device to the TTS provider (opt-in, keyed).
Recommendation: ship **A** now (with the desktop word-level progressive enhancement), offer **C** later as
an opt-in for users who want word-level on mobile.

## Implementation sketch (Tier 1)
- `shared/lib/audio.ts`: replace the current `speakPassage` internals. New `chunkPhrases(text)` (clause+
  sentence split, abbreviation-aware, length-capped, each with char offset). Speak chunks sequentially;
  fire a new callback `onPhrase({ startWord, endWord })` (paragraph-global word range) from each chunk's
  `onstart`. Keep `onEnd`/resume-by-chunk for pause/resume. Delete `cpsEma`/`calibrateCps`/`wordAtElapsed`/
  the rAF estimate. Optional: keep a `boundary` listener that, when it fires, calls `onWord(idx)` to narrow
  within the current phrase.
- `features/reader/reading-text.tsx`: replace single `activeWord` with an active word RANGE
  `[activeFrom, activeTo)` (phrase); WordToken `highlighted` = `idx >= activeFrom && idx < activeTo`, OR the
  narrowed single word when `onWord` upgrades it. Per-sentence play + paragraph play both use the same
  chunked engine. Keep the existing pause/resume + visibility/chapter-change teardown.
- The reader's "highlight spoken word" setting label likely becomes "highlight while reading" (phrase).
- The day-content LISTENING dictation is unaffected — it uses pre-measured cue timings from the recorded
  mp3, which are already accurate (not TTS).

## Risks / for the audit
- Phrase chunking quality: over-splitting (choppy audio) vs under-splitting (coarse highlight); tune the
  clause split + length cap; ensure abbreviation-awareness reuses the shared list.
- `start`-event timing: does `start` fire at audio onset on Android/iOS, or slightly before (buffering)? A
  small lead is fine for a phrase highlight; verify on-device. Any platforms where `start` is also
  unreliable?
- Chunk gaps: sequential utterances can add tiny pauses between phrases (queue latency) — acceptable? Or
  pre-queue the next utterance. Compare with today's single-utterance smoothness.
- Range-highlight rendering cost (many tokens re-render as the range moves) — keep the memoized WordToken;
  pass range primitives so only affected tokens update.
- Resume/pause semantics move from "resume at sentence chunk" to "resume at phrase chunk" — verify the
  per-sentence replay + A-B-less reader still work.
- Progressive `boundary` upgrade must not reintroduce lag: only narrow WITHIN the already-correct phrase;
  never let it drive the phrase advance.
- Confirm `speakPassage`'s only callers are the reader (and any learn "read passage") — search before
  changing the signature.

## Test / verify
- On-device Android + Windows: highlight tracks the spoken phrase with no drift across a long paragraph and
  at rates 0.75–1.5×; desktop-local-voice shows word-level narrowing. Pause/resume + per-sentence replay
  intact. `build`/`lint`/`test`. Consider a unit test for `chunkPhrases` boundaries.

## Audit revisions (independent review — apply before building Tier 1)
Verdict REVISE (direction confirmed). User chose the phrase-level offline default. Fold in:
- **Chunk size is THE product decision, not a tuning knob — and it reverses a documented choice.**
  `audio.ts:228-231` already says "never per word: natural prose matters more…". One utterance per 2–6-word
  clause gives each fragment its own intonation + leading/trailing silence → choppy audio for
  listening-while-reading; pre-queueing does NOT fix the prosody seam. So:
  - **Gate 0 (go/no-go BEFORE coding):** on a real Android device, speak a real paragraph at 1.0× as
    clause-sized utterances and LISTEN. If audio is unacceptable, Tier-1-as-specified is dead.
  - **Pre-specified fallback (plan B, not buried):** sentence-granularity highlight on `onstart`, reusing
    the existing `chunkPassage` — near-zero new code, drift-free, only coarser. (Sub-sentence granularity
    inherently needs one utterance per unit, so the smoothness cost is intrinsic.)
  - If Gate 0 passes: target clause units with a **minimum length (~6–12 words)**, splitting only at `; : —`
    and at commas where BOTH sides clear the minimum; merge short fragments forward ("Yes, sir." stays one).
- **M1 — move resume-index + highlight-range emission to `u.onstart`, not `onChunk`-at-enqueue
  (audio.ts:271).** Otherwise pre-queueing makes `resumeChunkRef` point a phrase ahead → pause/resume skips
  a phrase. Collapse `onPhrase` into `onChunk(index,{startWord,endWord})` fired from `onstart`.
- **M2 — gate the optional `boundary` narrowing on WORD granularity.** Safari fires `boundary` per-sentence
  w/o `charLength` → would pin the highlight to a phrase's first word (worse than phrase). Narrow only when
  `charLength>0` or after ≥2 boundary events within the same phrase; else keep the phrase highlight.
- **M3 — scope narrowing to the currently-started phrase** (tag events per active phrase); never let
  `boundary` drive phrase advance (advance is `onstart`-only). Drop `elapsedTime` (charIndex→word is enough
  for "narrow to reported word"; no audio clock needed).
- **M4 — preserve the contiguous-slice invariant + pin it.** `chunkPhrases` min-length merge must
  concatenate slices like the abbreviation merge (audio.ts:184-189), keeping chunks contiguous. Test: phrase
  word-ranges TILE `[0, wordSpans(spoken).length)` exactly (first from=0, each to=next from, last to=count) —
  a gap = unhighlighted words, overlap = double-highlight. Guard clause-splitting against digit-adjacent
  punctuation ("3.14", "1,000", "9:30", ranges "1–2") — the `—` split is the risky one (ABBREVIATIONS won't
  protect numbers).
- **M5 — delete `wordAtElapsed`/`calibrateCps` + their tests (audio.test.ts:89-134);** keep `wordSpans` +
  the 1:1 alignment test; add `chunkPhrases` boundary + tiling tests. `speakPassage`'s only callers are the
  reader (`speakFrom`, `readSentence`); the estimate machinery has no other importer — deletion is safe.
- **Framing fix — desktop word-level is oversold.** `pickVoice` (audio.ts:68-73) scores neural/network
  voices (+8/+4) ABOVE `localService` (+1) — i.e. it auto-picks exactly the boundary-LESS engines. So the
  "desktop word-level enhancement" is a rare bonus, not a norm; the real lever for word-level would be the
  VOICE PICKER (weight localService / surface word-sync-capable voices) — note, don't design here. Don't
  advertise word-level in the UI copy.
- **Framing fix — Tier 2 is an exception to a hard guarantee.** Streaming book prose to a cloud TTS breaks
  CLAUDE.md's "books in OPFS, never uploaded" (AI hints only send a word+sentence). Prominent opt-in; and
  synthesize-once + cache audio+timings per paragraph (OPFS/Dexie) to bound cost/exposure. Soften "impossible
  offline" → "infeasible with the browser SpeechSynthesis engine" (Tier 3 shows it's possible at cost).
- **Range model composes cleanly (keep):** `WordToken` gets a computed boolean `highlighted`, so memo stays
  optimal; `sentenceStartWord` + per-sentence replay work by adding `startWord` to both ends of the range.

## Sources (from the research pass)
Web Speech `boundary` support/gaps: MDN boundary event; caniuse (not Baseline); mdn/browser-compat-data
#28419; Chromium 40715888 (Android never fires); Coder's Block "TTS quirks" (Safari per-sentence);
Readium WebSpeech notes (Google voices = no boundary). Synthesis-time timing principle: Calliope, arXiv
2602.10735 (2026) — rejects forced alignment, captures timing at synthesis. Cloud timestamps: Azure
`<bookmark>`/WordBoundary; Google `<mark>` timepoints (Neural2 caveat, issuetracker 243702062); Amazon
Polly Speech Marks (byte offsets); ElevenLabs with-timestamps; OpenAI TTS = no timestamps. Local neural:
ayutaz/piper-plus (claimed timing, unverified), Kokoro-ONNX-timestamped (JS path estimates only),
sherpa-onnx (open request).
