# Reader — saved-phrase awareness (dedup + underline)

Two reported bugs, one root cause.

## Bugs
1. Re-selecting an already-saved phrase offers **+ save** again (misleading; the DB itself
   is safe — `upsert` guards `phrase:<text>`, so no real duplicate, but the UI reads as new).
2. A saved phrase is **not underlined** as *learning* in the reader text.

## Root cause
Words track status in `vocabStore.statuses` (→ `db.wordStatus`); a re-tapped word shows its
underline and `addWordCard` is idempotent. Phrases go **only** through `addPhraseCard` →
an SRS card `phrase:<text>`. Nothing feeds the reader UI: `phraseSaved` is React-local (reset
every `setPhraseText`), and underlines are per-`WordToken` from `statuses` — a phrase has no
status entry and no multi-token highlight.

## Plan — one source of truth
`reader/phrase-marks.ts` (plain, unit-tested):
- `phraseKey(text)` — canonical identity = word tokens (`WORD_SPLIT_RE`/`WORD_TEST_RE`),
  lowercased, single-space joined. Collapses the tap path (keeps punctuation) and the drag path
  (arbitrary `toString`) to the same key. Used in exactly 3 places: Set contents on load,
  `has()` in `setPhraseText`, the sentence matcher.
- `phraseMarkedTokens(sentence, phraseKeys)` — token indices (into `sentence.split(WORD_SPLIT_RE)`)
  inside any saved phrase. Whole word-token runs only (`train` ≠ inside `trainer`),
  case-insensitive, multi-word only. Marks the matched word slots.

`reader/saved-phrases.ts` — `useSavedPhrases` Zustand store: `phrases: Set<string>` of
`phraseKey(card.front)`, loaded from `db.srsCards.where('id').startsWith('phrase:')` (prefix on
the primary key — excludes `err:`/`word:` cards; no version bump). `add(text)` mutates the Set
**only on real change** (stable identity → no needless chapter re-render). `has(text)`.

Wiring in `reading-text.tsx`:
- Load the store in the existing mount effect.
- **Bug 1:** `savePhrase` → `useSavedPhrases.getState().add(phrase)`; `setPhraseText` sets
  `phraseSaved` from `useSavedPhrases.getState().has(text)` → re-selection shows ✓ saved (disabled).
- **Bug 2:** pass the `phrases` Set into `Paragraph`; per sentence compute marks in a `useMemo`
  keyed `[sentences, phrases]`; `WordToken` gains `phrase?: boolean` → forces the *learning*
  underline. **Gated on the `coloring` setting** (a saved-phrase underline is a status underline;
  ungated re-opens the scope-4 "coloring off must hide underlines" fix). Phrase decoration wins
  over a word's own `new` status on the same token.
- **Drag-select hardening:** `onSelect` prefers token-based extraction — resolve anchor+focus to
  their `[data-widx]` tokens and build via `phraseFromRange` when they share a paragraph+sentence
  (also passes sentence context to the AI translator). Falls back to `toString()` only when
  endpoints don't resolve to word tokens. This stops button glyphs (`▶`, `ru`) leaking into a
  saved phrase (a drag overshooting the sentence end would otherwise save `"… ru"`, which no
  matcher could recover).

## Accepted limitation
Cross-sentence drag phrases are not underlined (matching is per-sentence). Bug 1's `has()` still
dedups them, so the two fixes degrade independently.

## Verify
`reader/phrase-marks.test.ts` (sequence match, whole-token, case, adjacent, multi-word-only,
`phraseKey` normalization) + `npm run build` + `npm test`. Independent-agent audit of the diff.
