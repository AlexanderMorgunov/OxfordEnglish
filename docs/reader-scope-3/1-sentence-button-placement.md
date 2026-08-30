# Plan #1 — sentence play button: keep it on its sentence's line, make it a touch bigger

## Problem (user)
The small ▶ that plays a single sentence sometimes sits **one line ABOVE** the sentence it belongs to,
and it's a little too small.

## Research / analysis (code)
In `src/features/reader/reading-text.tsx`, the `Paragraph` renders one `<p>` whose sentences are inline
`<span>`s laid out continuously. Each sentence span begins with the small button:
`<button … className="mr-0.5 align-baseline font-mono text-[0.65em] text-teal opacity-45 …">▶</button>`
followed by the word tokens. Because everything is inline, the line-wrap algorithm can place a break
**between the button and the sentence's first word** — the button fits at the end of line N, the words
flow to line N+1. Result: the button appears above its sentence. (The break is fine BEFORE the button —
then button + sentence start together on the new line.)

## Fix
1. **Never break between the button and the first word.** Wrap the button together with the sentence's
   FIRST rendered word token in an inline `white-space: nowrap` group (`<span className="whitespace-nowrap">
   {button}{firstToken}</span>`), then render the remaining tokens normally so the rest of the sentence
   still wraps. A nowrap group of {▶ + firstWord} guarantees they stay on the same line; if the pair
   doesn't fit, the whole pair wraps down together.
   - Edge: the "first token" must be the first WORD token, not a leading punctuation/space span. Compute
     the index of the first `WORD_TEST_RE` token and group the button with it (leading non-word chars, if
     any, go inside the nowrap group too so nothing is orphaned).
   - Must NOT change the paragraph-global `wordIndex` numbering (the highlight offset depends on it) — the
     grouping is purely a wrapper around the same emitted tokens, in the same order.
2. **Make it a touch bigger + a clearer control.** Bump from `text-[0.65em]` to ~`text-[0.78em]`, raise
   the idle opacity (≈0.55) so it's findable, keep the teal, and give it a small padding / rounded hit
   area so the tap target is comfortable on mobile (≥ the 24px guideline where the line-height allows).
   Keep `❚❚` when playing.

## Non-goals / unaffected
- The bigger paragraph ▶, bookmark, and the per-sentence "ru" toggle stay as-is.
- No change to playback logic or the highlight offset.

## Risks / for the audit
- A very long first word + button could still overflow a narrow (360px) line — nowrap would push the pair
  to the next line (acceptable) but must not cause horizontal scroll; verify at 360px.
- The nowrap wrapper must not break `onPickTap`'s `closest('[data-widx]')` (the first WordToken keeps its
  `data-widx`) or the highlight background on that first token.
- Confirm grouping doesn't insert stray whitespace that shifts word spans vs. `wordSpans` (the button and
  wrapper are non-text nodes; spacing between sentences is unchanged).
- Reduced-motion / RTL: n/a (LTR reading), but check the button's `align-baseline` vs the larger size
  doesn't misalign vertically.

## Test / verify
- Manual at 320–768px: the ▶ always sits on the same line as (or wraps down with) its sentence's first
  word; never orphaned above. Tap plays that sentence; highlight still tracks. `build`, `lint`, `test`.

## Audit revisions (independent review — corrects the diagnosis; MUST implement)
Verdict REVISE. The symptom is real but the stated cause was WRONG:
- **Corrected cause.** `toSentences` trims each sentence and JSX emits no whitespace text node between the
  button and the token map, so for a normal sentence there is NO break opportunity there — it can't orphan.
  The bug reproduces ONLY when the sentence's FIRST `WORD_SPLIT_RE` token ends in whitespace: em-dash/
  en-dash dialogue (`"— Hello"` → `['— ', 'Hello', …]`), a leading number (`"5 apples"`), or a leading
  ellipsis. The break opportunity is the space INSIDE that leading non-word token, i.e. AFTER the button.
  Em-dash dialogue is common in public-domain EPUBs → genuine bug, but narrow.
- **M1 — the nowrap group must span the button THROUGH the first WORD token inclusive, wrapping any
  intervening non-word token(s) and their whitespace.** Grouping only `{button}{firstWord}` leaves the
  break in the `"— "` token and fixes nothing. Implement as a SINGLE pass over the tokens with a
  "first word not seen yet" flag (accumulate leading tokens + first word into the nowrap span), NOT by
  slicing the array.
- **M2 — preserve every token's ORIGINAL `i`** as its React key and `tokenId` (`${index}:${si}:${i}`).
  Re-indexing a slice silently corrupts phrase-selection (`phraseFromRange` re-splits and slices by the
  parsed `.t`) and `data-widx` identity — uncaught by build/lint/tests. Keep `wordIndex += 1` running once
  per word token in original order (so `sentenceStartWord` stays correct).
- **M3 — handle a zero-word sentence** (e.g. `"123 — 456!"` → no word token): fallback to rendering the
  button alone / grouping all tokens; don't index out of bounds.
- **M4 — no vertical padding, drop the 24px target.** WCAG 2.5.8 exempts targets inline in text, so the
  24px goal doesn't apply; vertical padding inflates that line's line-box (uneven leading) and shifts the
  `align-baseline` glyph. Bump size (~text-[0.78em]) + opacity for findability only; horizontal-only hit
  area if any.
- **M5 — the alignment test gives ZERO coverage** here (it's string-only, no DOM). Verify manually at
  360px including a dash-dialogue paragraph; don't treat that test as a safety net.
- Highlight `bg-teal-dim` + `onPickTap` stay safe as long as the inner `button[data-widx]` (WordToken) is
  untouched — the change is only an outer wrapper.
