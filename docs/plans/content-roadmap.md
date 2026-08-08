# Content roadmap — A2 course sequence

**Goal:** a coherent A2 → early-B1 course. Grammar is the spine (sequenced like a
standard A2 syllabus); topics are mixed — a developer also orders lunch, makes
small talk, travels, and gives opinions. Not every day is about code.

**Legal (DESIGN_DOC §1.2):** we follow the *scope & sequence* of a standard A2
course (grammar order + CEFR level — not copyrightable, published openly). We use
American English File 2 only as a **sequence reference**. We never copy its texts,
images, or audio — every sentence is original or openly licensed.

## Level rule

A2 target: NGSL rank < 1500 for most words, average sentence ≤ 14 words. Dev jargon
(deploy, branch, standup…) sits above A2 frequency on purpose and is always
taught via glossary + audio. `level_check` gates every generated passage; flagged
words get rewritten or glossed, not left to chance.

## Unit sequence (grammar spine × topic)

| Unit | Grammar focus | Topic & functions | Register |
|---|---|---|---|
| **U01** | Past Simple (reg/irreg, neg, questions) | Yesterday at work — commits, deploys | dev ✅ shipped |
| **U02** | Countable/uncountable · some/any · *would like* | Food & ordering at a café | everyday |
| **U03** | Present Continuous (now) vs Present Simple | Small talk & meeting people | everyday |
| **U04** | there is/are · prepositions of place · directions | Getting around a new city | everyday |
| **U05** | Comparatives & superlatives | Choosing (places, tools, plans) | mixed |
| **U06** | *be going to* / present continuous for future | Making plans & arrangements | mixed |
| **U07** | Present Perfect (ever/never) vs Past Simple | Experiences (travel, life, projects) | mixed |
| **U08** | *have to* / *should* — obligation & advice | Health & sorting out problems | everyday |

Notes:
- Present Simple foundations are assumed and reviewed inside U03; a light **U00
  "present simple / routines"** can be prepended later if a true zero-start is
  wanted.
- Each unit = 3–5 days (grammar → reading → listening → practice) + a checkpoint.
- Topic mix keeps motivation: a dev-flavoured day, then a café day, then small
  talk — the grammar carries over even when the topic changes.

## RU-speaker pitfalls to seed per grammar point (stays hand-written)

articles (a/the/∅), word order, `did + base form`, missing `be`, countable vs
uncountable (`information`, `advice`), `some/any`, present continuous for *now* vs
present simple for habits. These are the added value no language-neutral course
gives — always author them by hand.

## Build flow (semi-automatic, via Content Forge)

Per day, in one MCP session: `tatoeba_search` (level-gated example sentences) →
author grammar rule + RU pitfalls (by hand) → draft reading, run `level_check`,
rewrite → `dict_lookup` for glossary IPA → `tts_synthesize` for listening +
paragraph audio → build exercises (Tatoeba + authored distractors) →
`pack_write_day` → `pack_validate`. Proofread the generated prose by hand.

## Next

Build **U02 (café / food)** as the first non-dev exemplar, then U03–U04.
