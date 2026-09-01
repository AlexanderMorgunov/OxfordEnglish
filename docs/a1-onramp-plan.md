# A1 on-ramp — full beginner tier (scope B)

Goal: a real CEFR **A1** tier before the A2 course so an absolute beginner can start from zero and
reach u01 ready. Opens the biggest RU search segment ("английский с нуля") and makes the site's
"A1 → B1" claim honest. User picked the full-tier option: **3 units × 6 days = 18 days** (a 4th unit
optional later), with an A1 checkpoint per unit and an automatic A1 level-exit test.

## Bridge target (verified)
A2/u01 opens gently — d01 "be questions & my/your/his/her", d02 "have got", d03 object pronouns,
d04 possessive pronouns. So A1 must leave the learner able to read simple English and handle
pronouns + be + a/an + plurals + basic present simple + numbers/colours/everyday words.

## Syllabus (18 days)
Reuse existing grammar articles where they exist; the day's own `level:"A1"` is independent of the
article's tag. Each day = vocab + grammar + short reading + listening + practice (same section shape
as every other day).

**A1.1 — «Привет» (be + знакомство)**
- d01 subject pronouns + **be** (am/is/are), affirmative — refs `pronouns`,`verb-be`; vocab: greetings, countries
- d02 **be** negatives & questions (Are you…? Yes/No) — `verb-be`; vocab: jobs
- d03 **a/an** + regular **plurals** (-s/-es) — `articles` + NEW `plurals`; vocab: everyday objects
- d04 **this/that/these/those** — `demonstratives`; vocab: things, colours
- d05 numbers 0–100, age, "how old…?" — `verb-be`; vocab: numbers
- d06 review + reading + checkpoint

**A1.2 — «Мой мир» (have got + дом/семья)**
- d01 **have got** — `have-got`; vocab: family
- d02 possessive adjectives my/your/… + **'s** — `possessives`; vocab: possessions
- d03 **there is / there are** — `there-is`; vocab: house, rooms
- d04 prepositions of place (in/on/under/next to) — `prepositions-place`; vocab: furniture, places
- d05 **some / any** (basic) — `some-any`; vocab: food, drink
- d06 review + reading + checkpoint

**A1.3 — «Каждый день» (present simple)**
- d01 present simple affirmative (+ he/she/it **-s**) — `present-simple`; vocab: routine verbs
- d02 present simple negative & questions (**do/does**) — `present-simple`; vocab: time, routine
- d03 like/love/hate + adverbs of frequency — `present-simple`; vocab: hobbies, food
- d04 **can / can't** (ability) — `modals-can`; vocab: abilities
- d05 telling the time, days, prepositions of time (at/on/in) — `prepositions-place`(time note); vocab: time, days
- d06 review + reading + **bridge to u01** + checkpoint

## New grammar reference + tags
- Add ONE grammar.json article: **`plurals`** (A1) — regular -s/-es/-ies + common irregulars, RU.
- Register any missing skill tags before use (`src/content/skill-tags.ts`): likely `grammar.plurals`
  (+ confirm `grammar.numbers`/functions tags exist or reuse existing `vocab.*`/`functions.*`). All
  other grammar refs already exist and are registered.

## Course + engine integration
- Create 3 units at the FRONT of `course.units` (after u00): ids `a11,a12,a13` (opaque strings — no code
  parses unit ids numerically except the `exit-` checkpoint prefix; ordering is array position).
  Each unit: `title{en,ru}`, empty `dayIds`, and a `checkpoint{id,title,questionCount:12}` (cosmetic —
  `unitCheckpointOf` fires on the last day regardless, but keep it for consistency with u00–u14).
- Every A1 day carries `level:"A1"`. `levelExitOf` already offers an exit test on the last A1 day once a
  level has ≥5 days (`MIN_EXIT_DAYS`) — so the A1 exit test comes for free.
- Placement: extend `BAND_SOURCES` with a pre-easy A1 band (source the new A1 units) and map the lowest
  score to the A1 start (`recommendedUnitId`), so a true beginner is routed into A1, not A2.

## Build pipeline (reuse story `build-episode.mjs`)
It's content-agnostic (spec → day: Piper audio + measured cue timings + assembles vocab/grammar/reading/
listening/practice) BUT (a) requires the unit to pre-exist in course.json (create units first) and
(b) omits `level` (story-specific) — **add `level` passthrough** so A1 days ship `level:"A1"`. Then per
unit: author brief → DeepSeek gen (A1-controlled) → review + level_check → build-episode (append d01..d06,
insertAt = end) → `validate:packs`. Batch by unit (like the story track), commit per batch on "пуш".

## Follow-ups (not this pass)
- SEO: programmatic A1 unit/day landing pages ("английский с нуля") once the tier exists.
- Optional A1.4 unit (+past of be was/were, going-to intro) to reach ~24 days.
- Optional A1 story episodes (a1x.d90).
- Flip the "A1 → B1" copy to reflect real A1 (already claimed in meta; becomes true).

## Verify
Per unit: `validate:packs`, all exercises answerable, day reaches complete, checkpoint builds, A1 exit test
appears on the last A1 day, placement routes a min-score beginner into A1. Independent audit of the plan +
each batch.
