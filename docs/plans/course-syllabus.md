# Course syllabus — A2 (full, gap-free) · ~2h/day

**Purpose:** the authoritative contents of the course — units, days, and what a
day contains. Built for **complete CEFR A2 coverage** (no grammar or vocabulary
gaps) so any learner finishes with the full A2 toolkit. Each day = **~2 hours** of
study with **substantial text and a rich vocabulary set** (lexis is the priority).

**References used for the inventory** (scope & sequence only — CEFR bands and
grammar order are not copyrightable; we copy no text): American English File 2,
Oxford Practice Grammar (Basic), Murphy *English Grammar in Use* (Essential/Blue),
CEFR **English Grammar Profile** (A2) and **English Vocabulary Profile** (A2),
Threshold/Waystage. *(Live fetch of the AEF flipbook was rate-limited; the
inventory below is assembled to CEFR A2 completeness and should be audited against
these.)*

---

## 1. The ~2h day template

A day is one complete lesson on a sub-topic. Time budget (~120 min):

| Block | Time | What it is |
|---|---|---|
| **Vocabulary set** | ~20m | 15–25 new words: translation, IPA, example sentence, audio. Presented, then drilled (match, gap, categorize). The core lexis input. |
| **Reading** | ~25m | 200–350-word A2 text that *reuses* the day's vocab. Parallel RU per paragraph, clickable words, paragraph audio. Comprehension: true/false + multiple choice + detail. |
| **Grammar** | ~30m | Rule (EN/RU) + **RU-speaker pitfalls** + patterns + **8–12 exercises** (gap-fill, choice, spot-error, order-words, transform). |
| **Listening** | ~20m | Dialogue/monologue (TTS or sourced) with hidden transcript, A-B loop, speed. Comprehension + **dictation** of key lines. |
| **Pronunciation** | ~10m | One focus: a sound pair, word stress, or -ed/-s endings. Listen-and-choose + minimal pairs. |
| **Production** | ~15m | Practical-English functional dialogue (order, ask, arrange…) + a short **writing/translation** task (5–8 sentences using the day's grammar+vocab). |

**Volume per day (target):** ~20 words, ~300 words of reading, ~30–45 exercises,
1 listening, 1 writing prompt. Current demo days hit ~10% of this — they were
pipeline exemplars; this template is the real target.

## 2. Engine additions this requires (tracked, not yet built)

- **`vocabulary` section type** — a word bank: `{ word, ipa, ru, example, audio? }[]`
  with study + self-test modes (schema + renderer + SRS auto-cards). *This is the
  biggest missing piece — lexis is currently only a reading glossary.*
- **Reading comprehension** — reuse `choice` for T/F and MC; optionally a
  `true-false` shorthand.
- **Pronunciation focus** — minimal-pairs exercise (a `choice` variant with audio).
- **Transform exercise** (rewrite: "He works → He doesn't work") — new exercise type
  or a `gap-fill` with a fuller prompt.
- Longer reading is already supported (`blocks`).

## 3. Complete A2 grammar inventory (the checklist — no gaps)

Every item below MUST be taught and practiced somewhere in the course.

**Be / have** — `be` (present/past), `have got` vs `have`, `there is/are` (+ was/were).
**Present** — present simple (all persons, spelling of -s), adverbs of frequency,
present continuous, **present simple vs continuous**, stative verbs, like/love/hate
+ -ing.
**Past** — past simple (`be`, regular spelling of -ed, common irregulars, negatives,
questions, short answers), past continuous, **past simple vs continuous**, `used to`.
**Present perfect** — for experience (`ever/never`), `just/yet/already`, `for/since`,
**present perfect vs past simple**.
**Future** — `be going to` (plans/predictions), `will` (predictions, instant
decisions, offers, promises), present continuous for arrangements.
**Modals** — `can/could` (ability, permission, requests), `must` / `have to` /
`don't have to`, `should/shouldn't`, `might/may` (possibility), `would like / 'd
like`, `shall` (offers/suggestions), `let's`.
**Nouns/quantifiers** — countable/uncountable, `a/an/the/zero` articles,
`some/any`, `much/many/a lot of/(a) few/(a) little`, `how much/how many`,
plurals (irregular), possessive `'s`.
**Pronouns/determiners** — subject/object pronouns, possessive adjectives &
pronouns, demonstratives, `this/that/these/those`, reflexive (intro), `one/ones`.
**Adjectives/adverbs** — order, `-ed/-ing` adjectives, comparatives & superlatives,
`as…as`, `too/(not) enough`, adverbs of manner, `so/such` (intro).
**Questions** — yes/no + wh- in all tenses, question words, **subject vs object
questions**, `How + adj`, question tags (intro).
**Verb patterns** — `verb + -ing` vs `verb + to-infinitive` (want/need/would
like/like/enjoy/stop), `to` for purpose.
**Prepositions** — time (`at/in/on`), place, movement/direction.
**Connectors** — `and/but/or/so/because/when/while/before/after/then`.
**Conditionals** — zero + **first conditional** (`if + present, … will`).
**Relative clauses** — defining with `who/which/that` (intro).
**Passive** — present & past simple passive (intro, A2/B1 boundary).
**Reported speech** — statements (intro, A2/B1 boundary).
**Imperatives** — affirmative/negative, directions/instructions.

## 4. Complete A2 vocabulary/topic inventory (no gaps)

personal information · countries & nationalities · **family & relationships** ·
**describing people** (appearance, personality) · numbers, dates, time · **daily
routines** · **jobs & work** (incl. developer life — our niche) · **house & home**
(rooms, furniture) · **town & places** (buildings, shops) · **directions &
transport** · **travel & holidays** (airport, hotel, booking) · **food & drink &
restaurant** · **shopping, clothes, money, prices** · **body, health, illness, at
the doctor's** · **feelings & emotions** · **free time, hobbies, sport** ·
**weather & seasons & nature & animals** · **technology** (phone, internet,
computer, apps) · **education/school** · **communication** (phone, email, messages)
· **celebrations & festivals** · common phrasal verbs & collocations · everyday
functional phrases.

**Functions (Practical English):** greet & introduce · order food/drinks · shop &
pay · ask/give directions · make arrangements & suggestions · phone language ·
at the doctor's · make requests/offers · apologize & thank · give opinions & agree/
disagree · describe & compare · small talk.

## 5. Course map — 12 units (grammar spine × topic × functions)

Each unit: a theme, 1–2 core grammar points, 2–3 vocabulary sets, a function.
**~4 days + 1 checkpoint per unit** (see §6 for day composition).

| # | Unit | Core grammar | Vocabulary sets | Function |
|---|---|---|---|---|
| 01 | Nice to meet you | `be`, `have got`, possessives, question forms | personal info, countries/nationalities, family, numbers | introduce yourself |
| 02 | Every day | present simple, adverbs of frequency, prepositions of time | daily routines, jobs, telling time, days/months | small talk about routine |
| 03 | Right now | present continuous, present simple vs continuous, like + -ing | hobbies, sport, free time, feelings | talk about what you're doing |
| 04 | Yesterday | past simple (be, regular, irregular, neg, questions) | life events, work/dev verbs, time expressions | tell what you did |
| 05 | It happened while… | past continuous, past vs continuous, connectors | accidents, travel stories, weather | tell a story |
| 06 | At the table | countable/uncountable, some/any, much/many, would like | food, drink, restaurant, quantities, containers | order a meal |
| 07 | Around town | there is/are, prepositions of place, articles, imperatives | town, buildings, directions, hotel/travel | ask & give directions |
| 08 | Bigger, better | comparatives & superlatives, as…as, too/enough | clothes, shopping, money, adjectives | shop & compare |
| 09 | Making plans | be going to, will, present continuous for future | plans, dates, ambitions, arrangements | make arrangements |
| 10 | You should… | can/could, must/have to/don't have to, should, might | health, body, doctor's, rules | give advice / see a doctor |
| 11 | Have you ever…? | present perfect (ever/never, just/yet/already, for/since), vs past simple | travel, achievements, technology | talk about experiences |
| 12 | Putting it together | first conditional, relative clauses (who/which/that), used to, passive & reported (intro) | nature, celebrations, communication + review | opinions & review |

Sequencing rationale: present → past → future → perfect (the standard tense
build-up), with quantifiers/articles/comparatives interleaved on topic days, and
the harder A2/B1-boundary items (perfect, conditional, passive intro) at the end.

## 6. Unit composition — day-by-day pattern

Each unit follows a rotation so all six blocks and both grammar points are covered
across the week, and vocabulary compounds daily:

- **Day 1 — Vocabulary + Reading:** the unit's first vocab set (~20 words) + a
  reading text that uses it + comprehension. Grammar: light review only.
- **Day 2 — Grammar A + Listening:** the unit's main grammar point (full rule,
  pitfalls, 10+ exercises) + a listening that models it + the second vocab set.
- **Day 3 — Grammar B + Reading:** the second grammar point / extension + a second
  reading (recycles both vocab sets) + comprehension.
- **Day 4 — Practical English + Pronunciation + Writing:** the unit function
  (dialogue), a pronunciation focus, a writing/translation task, and a mixed review
  of the week's grammar+vocab.
- **Checkpoint:** interleaved test (already built) → per-tag report + review plan.

Every day still runs the full ~2h template (§1) — the labels say where the *new*
material sits; the other blocks recycle and consolidate. Recycling is deliberate:
A2 lexis needs ~7 encounters to stick, so each word reappears across days via
reading, exercises, and SRS.

## 7. Coverage guarantee (no gaps)

- **Grammar:** every item in §3 is assigned to a unit in §5 and practiced on that
  unit's Grammar A/B days, then re-tested in later checkpoints (interleaving).
- **Vocabulary:** every topic area in §4 maps to a unit's vocab sets; the frequency
  gate (`level_check`, now on a real 9884-word list) keeps new words at A2, and the
  SRS schedules them for retention.
- **Functions:** every function in §4 lands on a unit's Day 4.
- **Audit:** this document is handed to an independent reviewer to confirm no A2
  grammar point or core topic is missing, sequencing is sound, and the 2h load is
  realistic.

## 8. Migration from the current pack

Current days (u01–u04, thin exemplars) get re-slotted into this map (the dev/past
material → U04; café → U06; small talk → U03; directions → U07) and **expanded to
the full template**. New units are authored via the Content Forge flow
(`docs/plans/content-sources.md`): source reading (Storybooks/VOA) + author
grammar/pitfalls/vocab + TTS + validate.
