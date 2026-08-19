# Reader improvements — analysis & prioritized backlog

Grounded in a reference survey of the best reading tools for language learners (LingQ,
Readlang, Kindle Word Wise, Beelinguapp, Language Reactor/Migaku, Yomitan, Satori Reader)
and the extensive-reading evidence base (Nation; Krashen; Mason; Brown, Waring &
Donkaewbua 2008; Webb & Chang 2012). Costs are estimated against **our actual code**, so
they are checkable. Constraint throughout: offline-first PWA, Dexie/IndexedDB, no backend.

## 0. Current reader — what already exists

- **Import + read** EPUB/FB2/DOCX (`parse/`), stored in OPFS (`storage.ts`), metadata in
  Dexie `books`. Curated free-license catalog by level (`catalog.ts`, `RecommendedShelf`,
  bundled + remote).
- **Word tap** (`reading-text.tsx` `WordToken`): translation (MyMemory, `translate.ts`) →
  save to FSRS review (`srs/service`) → optional AI "meaning in context".
- **Word-status underline**: `WordToken` already underlines `learning`/`unknown` words from
  the vocab store; `known` is not visually distinguished, and never-seen words are unstyled.
- **Read-aloud with word highlight** (`speakPassage` in `audio.ts`): boundary events where
  they fire, self-calibrating per-word fallback on iOS.
- **Chapter difficulty** (`difficulty.ts`, `ChapterStudy`): "you know ~X%" (personal vocab +
  frequency band by level, suffix stripper + irregulars).
- **Generated exercises** from the chapter (`exercises.ts`), deterministic + AI.
- **Per-paragraph show/hide translation** (`reading-text.tsx`, MyMemory, cached).
- **Progress**: `lastChapter` per book is persisted; scroll offset within a chapter is not.

## 1. What the reference tools do (condensed, cited)

- **LingQ** — every unknown word is colored; saving/confirming a meaning recolors it, and it
  fades to no-highlight once known, so the whole text is a live map of "what's left to
  learn". LingQs store the source sentence as context. Sentence Mode isolates one sentence +
  its translation + its audio clip. [lingq.com/blog/introducing-lingq-5-0]
- **Readlang** — click a word → inline translation; **drag a span → phrase translation**;
  every lookup saved with its sentence, exported to SRS. [readlang.com/features]
- **Kindle Word Wise** — short gloss rendered **inline above** hard words (no tap), full
  popup on tap, fully offline; Vocabulary Builder auto-captures every lookup.
- **Beelinguapp** — parallel L1/L2 columns, **karaoke** sentence highlight in both as audio
  plays.
- **Migaku / Language Reactor** — click a line → mine the **whole sentence** into an SRS card
  (i+1: one unknown in known context); a sidebar filters to lines containing unknown words.
- **Yomitan/10ten** — hover popups that **lemmatize** inflected forms, show frequency/level,
  one-click card export.
- **Satori Reader** — hint density is **computed from the learner's known-word profile**
  (known kanji show no furigana, unknown get it); separate inline **grammar-note** layer;
  human audio.
- **Extensive-reading research** — **98% coverage** is the target for incidental vocabulary
  acquisition (95% floor for comprehension); **reading-while-listening beats reading-only**
  because synchronized audio segments the stream; **narrow reading** (same author/topic/
  series) and **repeated reading** compound acquisition; learner-choice volume is the master
  variable. [Nation 2006; Krashen "Narrow Reading"; Brown/Waring/Donkaewbua 2008]

## 2. Prioritized backlog (impact × cheapness, grounded in our code)

### P0 — high impact, low cost, reuse what we have

**A. In-text word-status coloring (LingQ-style), driven by our existing vocab/FSRS state.**
Color every word by its status from the vocab store: never-seen, learning, known (dim/none).
- *Reuses*: `WordToken` already reads `useVocabStore` status and applies underline classes;
  the data (statuses + FSRS cards) is already in Dexie. This is a rendering pass over tokens.
- *Cost*: **low-med** — mostly design-token colors + a11y (not color-alone: keep an underline
  weight; honor `--color-faint` contrast note in CLAUDE.md) + a toggle to turn it off.
- *Why*: operationalizes the 95–98% coverage rule **visually and per-chapter, in real time**;
  repeated cross-book exposure of "learning" words is itself spaced practice.

**B. Sentence-level translation (augment the paragraph toggle).**
Tap a sentence (or an end-of-sentence marker) to reveal just that sentence's Russian, auto-
collapsing the previous one.
- *Reuses*: `toSentences` (parse/text), `translateText` (already chunks by sentence), the
  Paragraph toggle pattern. Mostly a granularity/state change.
- *Cost*: **low**.
- *Why*: a whole-paragraph flip invites skipping to L1; sentence-level keeps the "notice the
  gap → infer → confirm" cycle that drives incidental acquisition (Krashen/Nation).

**C. Reading-comfort controls** (font size, line-height, column width, serif toggle) — **not
in the reference survey but table-stakes for any reader**, and we have none.
- *Reuses*: a small Zustand store (like `useUiLang`) + design tokens; applied in `BookView`.
- *Cost*: **low**. *Why*: sustained reading volume (the master variable for gains) depends on
  physical comfort; missing controls suppress volume.

**D. Steer recommendations by *personal* coverage, not just static level.**
`RecommendedShelf` sorts by CEFR band; instead (or additionally) compute each book's coverage
for *this* learner (personal known set) and prioritize books in the 95–98% comprehensible
band; flag ones below 95% as "hard for you now".
- *Reuses*: `estimateCoverage` + the learner's known set (already used in `ChapterStudy`).
- *Cost*: **low-med** (compute over catalog on load; cache). *Why*: directly implements the
  coverage rule as an adaptive recommender, not a static label. Note 92% (our current typical
  estimate) is *below* the 95% comprehension floor — worth surfacing honestly.

### P1 — high impact, medium cost

**E. Adaptive hint density (Satori-style).** Auto-surface the sentence translation on
sentences whose unknown-word count (from feature A's per-word status) exceeds a threshold;
leave all-known sentences untouched. A policy layer over A + B.
- *Cost*: **low-med**. *Why*: removes the guesswork of when to check a translation; keeps most
  of the text as productive i+1 work.

**F. Tap/drag-to-define phrases, not just single words.** Extend `WordToken` selection to
multi-word spans → same translation/AI pipeline; save phrase-as-unit to SRS.
- *Reuses*: the course reader (`ReadingSectionView`) already has phrase-selection → `addPhraseCard`;
  port it into the book reader's `ReadingText`.
- *Cost*: **low-med**. *Why*: English is phrasal-verb/idiom-heavy; word-by-word mishandles these,
  a known false-friend trap for Russian speakers.

**G. Reading position (scroll) + lightweight stats.** Persist scroll/paragraph offset per book;
add a small "words read / known-word growth / days read" view.
- *Reuses*: `books` table + Progress page + FSRS review counts.
- *Cost*: **low**. *Why*: visible progress is a proven adherence lever; volume precondition.

**H. Offline durability for remote catalog books.** Remote catalog books re-fetch on each open;
cache the parsed book (OPFS/Dexie) after first open so rereads work offline.
- *Cost*: **low**. *Why*: offline-first promise; also enables repeated reading (below).

### P2 — good, but sequence after the above

**I. Tighter listen-while-read + auto-scroll.** Our highlight is already word-level (boundary
+ iOS per-word fallback); add auto-scroll to keep the spoken word in view, and verify drift.
Human-narrator audio + forced alignment is a separate content-pipeline project — defer.
- *Cost*: **low** for auto-scroll; **high** for human audio. *Why*: segmentation is the
  mechanism behind the reading-while-listening advantage — accuracy has outsized payoff.

**J. "More like this" / narrow reading.** Surface same-author/topic catalog titles after a book.
- *Cost*: **low** (catalog metadata + sort). *Why*: narrow reading compounds vocab repetition.

**K. "Reread this chapter" prompt** when the difficulty estimator shows a chapter got easier,
audio on by default (assisted repeated reading).
- *Cost*: **low** (reuse estimator + TTS). *Why*: assisted repeated reading boosts fluency +
  incidental vocab beyond a single read.

### Deprioritize (high cost or overlap)
- Full sentence-mining into standalone cards **with per-sentence audio clips** — needs reliable
  per-sentence audio; layer on B + I later.
- **X-Ray** entity cross-referencing — needs NLP/manual tagging; low vocab payoff.
- **Word Wise-style pre-rendered inline glosses** — overlaps our tap model; don't build both
  without validating which A2/B1 Russian learners prefer (pre-rendered vs on-demand).

## 3. Recommended near-term slice

Ship **A (word-status coloring) + B (sentence translation) + C (comfort controls)** as the
first wave — all P0, all reuse existing data/pipelines, together they most move reading from
"decode" toward "acquire". Then **D (personal-coverage steering)** and **G+H (position/stats/
offline)**. Treat **I's auto-scroll** as a small polish rider on A/B.

## 4. Open questions / risks (for the reviewer)

- **MyMemory limits**: sentence-level translation multiplies request count; anonymous MyMemory
  has a daily cap and per-request length limit. Does per-sentence lookup blow the quota on a
  long chapter? Mitigation: cache aggressively (already do), lazy per-tap (not bulk), consider
  an email param or a fallback.
- **Color a11y**: word-status coloring must not rely on color alone and must pass contrast in
  both themes; risk of visual clash with the paragraph/sentence translation affordances.
- **Coverage honesty**: if we steer by personal coverage and most books read <95% for an early
  learner, the shelf could look empty/discouraging — need graceful framing.
- **Scope creep**: several items (E, F, I) are policy/UX layers that are easy to over-engineer;
  keep each behind the simplest possible toggle first.
- **Does word-status coloring belong in the *course* reader too**, or only the book reader?
  (`WordToken` is shared — a change affects both.)
