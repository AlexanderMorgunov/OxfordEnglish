# Plan — per-sentence replay in the book reader (drop read-mode setting)

## Goal (user)
Reading complex literature, the user wants to **replay individual sentences** on demand. Today the reader
only plays whole paragraphs (with a paragraph/sentence *mode* setting). Change to:
- **Remove** the read-mode setting (paragraph / sentence toggle).
- Every **sentence** gets a **small** ▶ that plays just that sentence (replayable).
- Every **paragraph** gets a **bigger** ▶ that plays the whole paragraph.
- Design how the two work together.

## Current architecture (facts)
- `src/shared/lib/audio.ts › speakPassage(text, {rate, startChunk, single, onWord, onChunk, onEnd})`:
  splits `text` into **chunks** and speaks them back-to-back. `onWord(idx)` reports a word index into
  `wordSpans(text)` — i.e. **global to the whole `text` passed in**. `single:true` stops after **one
  chunk**.
- **Chunk ≠ sentence.** `chunkPassage` splits by sentence *and then sub-splits a long sentence into
  ≤maxLen pieces*. So `startChunk`/`single` operate on chunks, and a long sentence spans several chunks.
- `src/features/reader/reading-text.tsx`: paragraph-level engine. `speakFrom(i, startChunk)` speaks
  `toSentences(paragraphs[i]).join(' ')` with `single: readModeRef==='sentence'`. State: `speakingIdx`
  (para), `speakingActive` (utterance in flight → ❚❚), `activeWord` (para-global word idx),
  `resumeChunkRef`, `playingRef`/`activeRef`. Each `Paragraph` has ONE ▶/❚❚ (`onRead(index)`); sentences
  have only a "ru" translate toggle.
- `src/features/reader/settings.ts`: `readMode: 'paragraph'|'sentence'` (+ type, setter, persist).

## UX design
**Paragraph button (bigger ▶, keep where it is — before the paragraph):** UNCHANGED behavior —
continuous read from this paragraph onward, auto-advancing across paragraphs (the "read the book aloud"
flow). ▶↔❚❚ with pause/resume-from-current-sentence, as today. "Play the whole paragraph" is satisfied
and cross-paragraph continuation is preserved (removing it would regress literature reading).
*Open question for audit/user: should it instead stop at paragraph end? Recommend keep continuous.*

**Sentence button (small ▶, at the start of each sentence, subtler than the paragraph one):** plays
exactly that one sentence and stops (no advance). Click again → **replays** from the sentence start (the
core use-case). While that sentence is speaking, its button shows ❚❚; clicking it then **stops**.

**Working together (exclusivity):** SpeechSynthesis is a single global queue; `cancelSpeech()` stops
everything. So **only one thing plays at a time** — any new play (sentence or paragraph) cancels the
current one first. Starting a sentence cancels an in-progress paragraph read and vice-versa.

**Highlight & button state:**
- The spoken-word highlight (`activeWord`, para-global) works for both. During a sentence play we
  highlight within that sentence (see offset below).
- The **paragraph** ▶/❚❚ reflects ONLY paragraph (continuous) playback. A sentence play does NOT flip the
  paragraph button to ❚❚ — they're distinct controls; while a sentence plays the paragraph button stays
  idle ▶. Only the active **sentence** button shows ❚❚. This keeps the two unambiguous.

## Implementation
**`settings.ts`:** remove `readMode`, `ReadMode`, `setReadMode`, and its `Persisted`/`DEFAULTS`/`persist`
entries. No migration needed: `load()` merges then `persist()` only re-writes enumerated keys, so a stale
`readMode` in localStorage is dropped on the next write.

**`reading-text.tsx`:**
- Remove the mode-toggle UI (the `role="group" … Режим озвучки` block) and `readModeRef`.
- `speakFrom(i, startChunk, single=false)` — `single` becomes a **parameter**. `onEnd`: if `single`,
  `stopReading()` (no advance); else auto-advance to `i+1` (continuous), as today. Delete the old
  sentence-mode "pause-after-each / one-sentence-per-play" branch.
- `read(idx)` (paragraph) → `speakFrom(idx, resume, /*single*/ false)` with the existing
  pause/resume/fresh logic.
- **`readSentence(paraIdx, sIdx)` (NEW):** the robust path is to speak the **sentence text itself**
  (not the whole-paragraph string with `startChunk`), because chunk≠sentence and a long sentence would
  otherwise only play its first chunk under `single`. Highlight stays para-global by adding a
  **word offset** = count of `WORD_TEST_RE` tokens in sentences `[0..sIdx-1]` (same tokenisation the
  render uses to compute `wordIndex`). So:
  `speakPassage(sentenceText, { rate, onWord: idx => setActiveWord(offset+idx), onEnd: stopReading })`,
  after `cancelSpeech()` + setting `speakingIdx=paraIdx`, `speakingSentence=sIdx`. Clicking the same
  speaking sentence → stop; clicking a different one → cancel + play the new one.
- New state `speakingSentence: number | null` (which sentence is a single-play, or null for paragraph
  play). Pass to `Paragraph` so it renders the active sentence's small button as ❚❚. Reset it in
  `stopReading` and whenever a paragraph play starts.
- Pass `onReadSentence` (stable via ref, like `onRead`) to `Paragraph`.

**`Paragraph`:** render a small ▶/❚❚ **before each sentence** (inside the sentence `<span>`, ahead of the
first word), wired to `onReadSentence(index, si)`; show ❚❚ when `speakingSentence===si && speaking`.
Keep the bigger paragraph ▶ as-is. Ensure the small button has no `data-widx` (so `onPickTap`'s
`closest('[data-widx]')` ignores it) and its `onClick` doesn't bubble into word/phrase handlers.

## Interaction matrix
| Action | Nothing playing | Paragraph P playing | Sentence S playing |
|---|---|---|---|
| Click paragraph ▶ (P) | continuous from P | pause/resume P (as today) | cancel S, continuous from P |
| Click sentence ▶ (S) | play S once | cancel P, play S once | if same S: stop; else cancel, play new S |
| Sentence ends | — | auto-advance next para | stop (idle) |

## Risks / for the audit
1. **Sentence-text vs paragraph-render tokenisation.** The offset must be computed with the *same*
   `sentence.split(WORD_SPLIT_RE)` + `WORD_TEST_RE` filter the render uses, and `toSentences(text)` must
   be the sentence list the buttons are built from — verify the offset lines up so the highlight doesn't
   drift (esp. across sentence boundaries, apostrophes, punctuation-only tokens).
2. **Long sentence** (chunkPassage sub-splits): confirm speaking the sentence *standalone* plays it fully
   (it will — the whole sentence is the passage; sub-chunks are spoken back-to-back, no `single`).
3. **iOS/Safari** never emits `boundary`; the estimate fallback already covers standalone sentences.
4. **Exclusivity races**: rapid clicks — `cancelSpeech()` bumps `speechToken`, so stale `onEnd`/`onWord`
   from a cancelled utterance must no-op (they check `alive()` / `playingRef`). Verify a cancelled
   sentence's `onEnd` can't call `stopReading()` and clobber a just-started new play.
5. **`playingRef`/`activeRef` semantics** were built around the paragraph engine; a one-shot sentence
   play must set/clear them so the paragraph pause/resume path isn't confused afterwards.
6. **Visibility/chapter-change** teardown (`stopReading` on hide + on `paragraphs` change) must also clear
   `speakingSentence`.
7. **Button density / a11y**: a small ▶ before every sentence adds many controls — keep them subtle
   (opacity, small), keyboard-reachable, with clear aria-labels; must not disrupt word-tap or phrase
   selection. Confirm tap targets are usable on mobile without mis-hitting words.

## Test / verify
- Manual (real browser): sentence ▶ plays exactly one sentence, replays on re-click, ❚❚ stops it;
  paragraph ▶ still reads continuously and pause/resumes; starting one cancels the other; highlight
  tracks the right words in both; long sentence plays fully; chapter change / tab-hide stop cleanly.
- `npm run build`, `npm run lint`, `npm test` green (jsdom can't exercise real TTS — logic/tokenisation
  offset could get a small unit test).

## Rollout
Code-only (reader). Land after audit; verify in-app; commit → push on user's go.

## Audit revisions (independent review — applied)
CONFIRMED the three core choices; REVISE with must-fixes, all folded into the implementation:
1. **No offset recompute** — capture `sentenceStartWord = wordIndex + 1` inside `Paragraph`'s
   `sentences.map` (that value *is*, by construction, the render's own global index for the sentence's
   first word) and pass it through `onReadSentence(index, si, startWord, sentence)`. Zero duplicated
   tokenisation, drift impossible.
2. **`readSentence` calls `stopReading()` first** (and `stopReading` now also `setSpeakingSentence(null)`)
   — otherwise a paused paragraph's `playingRef`/`resumeChunkRef` leak and both ❚❚ glyphs can light.
3. **Drop `single` entirely** — `readSentence` calls `speakPassage(sentenceText, …)` directly, so the
   `single` option in `audio.ts` (reader is its sole caller) becomes dead → remove it + its `done(ci)`
   branch. `speakFrom` gains NO `single` param; its `onEnd` always auto-advances (continuous).
4. **Sentence `onWord` gates on `highlightSpokenRef.current`** (mirror the paragraph path).
5. **Glyph separation:** paragraph big-❚❚ = `speakingActive && speakingIdx===i && speakingSentence===null`;
   the small sentence-❚❚ = active only for `speakingSentence===si`. Pass
   `activeSentence = (speakingActive && speakingIdx===i && speakingSentence!=null) ? speakingSentence : null`
   to `Paragraph` (memo-stable: null for inactive paragraphs).
6. Deferred (pre-existing, non-blocking): a popover/phrase 🔊 during a read cancels speech but leaves a
   stuck glyph; recoverable by re-click. Note only.
