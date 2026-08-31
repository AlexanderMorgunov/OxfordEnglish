# Plan — remove read-aloud highlight + fix choppy playback (#1); word-coloring off must hide learning/new (#2)

## #1 — read-aloud is choppy; drop the spoken highlight and smooth the audio
**User:** the word/phrase highlight during read-aloud breaks the continuity (audio is choppy), and the
by-chunk highlight is unwanted. Remove the read-aloud highlight entirely and fix the choppy playback.

**Root cause of the choppiness (my change).** Commit 45ab723 made `chunkPassage` split paragraphs into
~72-char CLAUSE fragments (extra splits at `, ; : —`) so the highlight could advance by line. That means
many short `SpeechSynthesisUtterance`s spoken back-to-back, each with the engine's leading/trailing
silence + a JS `onend→speak` gap → audibly choppy. Before the highlight redo, chunks were sentence-sized
(smooth). The choppiness is intrinsic to fine chunking, and we no longer need fine chunks once the
highlight is gone.

**Fix.**
- `shared/lib/audio.ts`:
  - Revert `chunkPassage` to **sentence-level** (drop the clause split + min-merge; `maxLen` back to the
    original ~160, hard-split only over-long sentences at a space). KEEP the abbreviation/initial merge
    (the "Mr." fix — unrelated to clause-splitting).
  - `speakPassage`: drop `onWord`, the word-range emission, and `chunkWordRanges`. Keep sequential chunk
    playback with `onChunk(index)` (resume point, fired from `onstart`) and `onEnd`. Remove
    `chunkWordRanges` + its `boundary`/narrowing code + the tiling test.
- `features/reader/reading-text.tsx`: remove the highlight entirely —
  - state `activeFrom/activeTo` + `setRange`; the `onChunk(from,to)`/`onWord` range wiring in `speakFrom`
    and `readSentence` (keep `onChunk(index)` → `resumeChunkRef`); the `highlightSpokenRef` + its effect;
  - the token highlight (`bg-teal-dim`/`highlighted` on WordToken and the empty-key span);
  - the Paragraph props `speaking` (now unused), `activeFrom`, `activeTo`, and their pass-through;
  - the "highlight spoken word" settings toggle.
- `features/reader/settings.ts`: remove `highlightSpoken` + `toggleHighlightSpoken` (Persisted/DEFAULTS/
  persist/type). A stale key in localStorage self-heals (persist only writes enumerated keys).
- Keep intact: paragraph ▶/❚❚ + pause/resume (`resumeChunkRef`), per-sentence ▶ replay, scroll-into-view,
  visibility/chapter teardown, the ▶-on-its-line fix (#1 earlier), AI/free sentence+phrase translation.

**Open question for the audit:** is sentence-level chunking smooth enough, or does the inter-sentence
`onend→speak` gap still read as choppy? If so, consider pre-queuing the next utterance (speak N+1 before
N ends) — but weigh it against pause/resume correctness (resume-from-chunk). Recommend shipping the
sentence-level revert first (it restores the pre-redo behaviour the user didn't complain about) and only
pre-queue if still choppy.

## #2 — "word coloring: off" must also hide learning/new underlines
**User:** with reader "word coloring" OFF, words added to the vocabulary as *learning* are still
underlined.

**Root cause.** `WordToken` (reading-text.tsx:170-173):
```
const classified = coloring && freq ? classifyWord(...) : undefined;
const raw = classified ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined);
```
When `coloring` is off, `classified` is undefined so `raw` falls through to the **status-based**
underline — learning/new still show. The status underline isn't gated by the `coloring` setting.

**Fix.** Gate the whole `raw` on `coloring`:
```
const raw = coloring
  ? (classified ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined))
  : undefined;
```
So with coloring off, no word underline at all (LingQ-style coloring AND the learning/new status).
`coloring` already reaches `WordToken` via `ReaderContext` (line 149), and toggling it re-renders
tokens (context value change).

**Verify (audit points):** confirm `coloring` off removes ALL underlines (learning, unknown, freq-based)
and nothing else regresses (the word popover's learning/known/ignore buttons still work; the settings
legend under the coloring toggle only shows when coloring is on). Confirm no other consumer depends on
`raw`/`visible` when coloring is off.

## Risks / for the audit
- Removing `onWord`/ranges/`chunkWordRanges`: confirm no other `speakPassage` caller (grep: only
  `speakFrom` + `readSentence` in the reader) and that pause/resume still works with `onChunk(index)`
  fired from `onstart` (resume index must not point a chunk ahead).
- Reverting `chunkPassage` must keep the abbreviation-merge test + the "sliceable at offset" +
  "hard-split long sentence" tests green; remove only the tiling test.
- Removing the `speaking` prop / highlight must not break the memoized `Paragraph` (fewer props) or the
  per-sentence ▶ state (`activeSentence` stays).
- #2: make sure the gate doesn't accidentally hide the *selection*/phrase highlight (violet) or the
  read-aloud highlight (being removed anyway) — those are separate classNames.

## Test / verify
- `npm run build`, `npm run lint`, `npm test`. Manual: read-aloud plays smoothly with NO word highlight;
  pause/resume + per-sentence replay work; toggling "word coloring" off removes learning/new underlines;
  turning it back on restores them.
