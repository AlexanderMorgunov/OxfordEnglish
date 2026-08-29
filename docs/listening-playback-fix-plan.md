# Plan — precise segment stop for listening dictation / A-B loop

## Symptom (user, repeatable)
u00.d01 → Listening → Dictation → cue "Where are you from? I am from Poland." The clip plays the phrase
and then bleeds into the **start of the next question** ("Are you a…"). Reported as systemic ("probably
many like this").

## Evidence
`u00.d01.listening.mp3` (ffmpeg silencedetect, -35dB/0.2):
- cue[1] speech "…Poland." ends at **5.247** (silence_start); next cue "Are you a student?" starts at
  **5.687** (silence_end). Pause between = 0.44 s.
- Current cue[1] timing after retiming: **3.07–5.57**. `end=5.57` sits *inside* that pause, 0.117 s
  before the next phrase — so the target is correct.

## Root cause (systemic, not this day's data)
The bounded-playback stop lives in `onTimeUpdate` in `src/features/listen/ListeningSectionView.tsx`
(~L124-136): `if (b !== null && t >= b) { once ? pause() : currentTime = a }`. The HTMLMediaElement
`timeupdate` event fires **coarsely (~200-300 ms)**, and audio keeps playing between events, so the pause
lands **up to ~250 ms past `cue.end`**. When the gap between `cue.end` and the next phrase's onset is
smaller than that overshoot (here 0.117 s), the next phrase has already started → the user hears it.
This affects **every day's** dictation "play phrase" (`playFrom(…, once=true)`) and the A-B loop restart,
i.e. it is a playback-engine bug, independent of per-day timings.

Secondary aggravator: the retiming script sets `cue.end = next cue's start − 0.12 s`, i.e. the stop
target sits right before the next phrase, minimizing the margin against overshoot.

## Fix A — primary (code, fixes all days, no content change)
Replace the coarse `timeupdate` boundary test with a **`requestAnimationFrame` watcher** for bounded
playback. rAF runs ~every 16 ms and reads the real `el.currentTime`, so the stop lands within ~1 frame
(≈16-32 ms) of `cue.end` regardless of `timeupdate` cadence and playbackRate.
- On `playFrom(start, end, once)`: set `loop.current`, `el.play()`, then start an rAF loop that checks
  `el.currentTime >= b`; on reach → `once ? pause() : (currentTime = a)`; keep looping until pause/cleared.
- `onTimeUpdate` keeps only `setTime(t)` (drives the transcript highlight) — remove the boundary logic.
- Cancel the rAF on `pause`, on starting a new `playFrom`, and on unmount (store the id in a ref).
- Rate-agnostic (checks currentTime, not wall-clock), so 0.75/1/1.25× all stop correctly.

## Fix B — optional hardening (content, re-run script)
Make `scripts/retime-listening-cues.mjs` set `cue.end` = **end of this cue's speech** (the `silence_start`
that precedes the next cue's onset), not the next cue's start. This gives the *entire* inter-phrase pause
as margin, so even a stop engine with jitter never bleeds. Re-run over all days; content diff is
timings-only, validated by `validate:packs` + schema test. Not required if Fix A lands, but cheap and
makes the two layers independently safe.

## Non-goals / unaffected
- Reading per-paragraph audio plays whole clips to natural end (no bounded stop) — unaffected.
- Transcript click uses `seek` then plays on — unaffected.
- The earlier retiming (start-of-phrase accuracy) stays; this is strictly about the STOP.

## Test / verify
- Manual: u00.d01 dictation cue[1] and cue[2] stop cleanly with no next-phrase bleed; A-B loop restarts
  cleanly; rates 0.75/1/1.25×.
- Spot-check 2-3 other days (short gaps) e.g. u05.d03, u07.d01.
- `npm run build`, `npm run lint`, `npm test` green.
- Consider a small unit test around the boundary helper if the rAF logic is extracted to a testable fn.

## Rollout
Land Fix A; verify u00.d01 in-app. Decide on Fix B after confirming A is sufficient (likely yes).
Commit is code-only (Fix A) → push on user's go.

## Audit revisions (independent review — applied)
The reviewer CONFIRMED the root cause but flagged a blocking regression + edge cases. Revised Fix A:
- **Drive the watcher by PLAY STATE, not `playFrom`.** The A-B loop is set by mutating `loop.current`
  (A/B buttons) and played via the MAIN play button (plain `el.play()`), never through `playFrom`.
  So start the rAF watcher in **both `onPlay` and `playFrom`** (start-if-not-running via a ref), and read
  `loop.current` **fresh each frame**.
- **Keep the `onTimeUpdate` boundary check as a backstop** (do NOT remove it): rAF is suspended in a
  hidden tab, where `timeupdate` still fires. Factor the boundary logic into one `checkBoundary(el)`
  called from both the rAF tick and `onTimeUpdate`.
- **Self-terminate** the rAF loop on `el.paused || el.ended` (natural end fires `ended`, NOT `pause`).
- **Guard the loop branch on `b > a`** to avoid a ~60 Hz `currentTime=a` seek storm when A/B are reversed.
- **Cleanup**: cancel rAF on `pause`, on unmount (`useEffect`), and it self-cancels on paused/ended.
- Add `onEnded` → `setPlaying(false)` + stop watch (also fixes the pre-existing stuck-"pause"-button
  state after a whole clip plays to its end).
- **Fix B stays OPTIONAL and is NOT done now**: moving `cue.end` to end-of-speech widens the
  transcript-highlight dropout (activeCueIndex needs `time < c.end`) and would require making
  `activeCueIndex` sticky — a coupled content+logic change. Fix A alone resolves the reported case.
