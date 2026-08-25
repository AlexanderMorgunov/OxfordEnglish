---
name: exercise-logic-review
description: Review language-course exercise JSON for logical/pedagogical errors a schema can't catch — wrong answer keys, illogical or impossible distractors, ambiguous items, instruction/prompt defects, incomplete accepted answers, and level mismatch. Use when asked to "проверь задания на логические ошибки", "review exercise logic", "check exercises", or when given a day/unit pack path to audit.
metadata:
  version: "1.0.0"
  argument-hint: <day-or-unit JSON path or glob, e.g. public/packs/dev-english-a2/days/u02.*.json>
---

# Exercise logic review

Review exercise JSON for **logical and pedagogical** defects — the kind that need language and
teaching judgment, not a schema. This is the semantic layer on top of `npm run validate:packs`
(authoritative for CI), which already handles the **structural + deterministic** class:
`correctIndex` range, `correctOrder` permutation, duplicate options, and the **explicit-set
mismatch** (instruction names a set like "Do или Does?" but options add out-of-set items — reported
there, do NOT re-report it here). This skill owns only the judgment calls below.

## Input & scope
Exercises live in `public/packs/<pack>/days/uNN.dNN.json` (and BYOC `packs/`). Run on a single day, a
glob, or a unit. If no path is given, ask for one — never audit the whole 161-day pack in one read.

Primary targets: **`choice`, `spot-error`** (full rule set), and **free-input**
(`gap-fill`/`translate`/`transform`/`dictation` — rules L4/L5/L6/L9/L10). **Out of scope for v1:**
audio↔text checks for `minimal-pairs`/`dictation` (a text pass can't hear the mp3).

## Fields you read (src/content/schema.ts)
- `instruction: {en, ru?}` — the task line.
- `prompt: string` — the sentence with the gap (choice/gap-fill/translate/transform).
- `options: string[]` + `correctIndex` — choice, minimal-pairs.
- `variants: string[]` + `correctIndex` — spot-error.
- `answers: string[]` — gap-fill/translate/transform. `answer: string` (singular) — dictation.
- `tags: SkillTag[]` — the skill point it claims to test (see `src/content/skill-tags.ts`).

## Solve-first protocol (mandatory — do this before flagging anything)
For every exercise, FIRST, silently:
1. State the intended correct answer and confirm it matches `correctIndex` / `answers`.
2. For each distractor, name the specific learner misconception it targets.
Only then apply the rules. You may flag a distractor as "weak" **only if you can name a concrete,
more plausible replacement**. This discipline is what keeps the review from over-flagging.

## Rules
Cite the rule id, quote the exact offending text, and give one concrete fix per finding.

- **L1 implicit-set mismatch** *(error)* — the instruction implies a target category and an option
  violates it in a way no set-parser catches: e.g. "Выбери время" (choose the tense) with a past-tense
  option under "Tomorrow", or an option of the wrong grammatical class for the stated point.
- **L2 trivially-eliminable / impossible distractor** *(error/warn)* — an option no learner would pick:
  tense clash with a time marker ("Tomorrow … celebrated"), ungrammatical construction
  ("have celebrate"), wrong part of speech, or semantic absurdity. It tests nothing.
- **L3 multiple correct / ambiguous** *(error)* — more than one option is defensibly correct in the
  prompt as written. This **includes an out-of-set option that is also correct** (e.g. instruction
  "whose or who's?" but "Which keys are these?" is grammatical too): Layer A only flags an out-of-set
  *key*, so an out-of-set *distractor that also solves the prompt* falls to you — claim it here.
- **L4 wrong answer key** *(error)* — the marked answer is wrong or not the best. (Comes free from
  solve-first; always check it.)
- **L5 prompt/stem defect** *(error/warn)* — the `prompt` is ungrammatical, ambiguous, missing the
  gap, or doesn't actually set up the target point.
- **L6 instruction wording** *(warn)* — awkward or incorrect RU/EN ("Спроси через «be»." → "Задай
  вопрос с глаголом to be."), or the instruction misdescribes the task.
- **L7 distractor craft** *(warn/nit)* — options not the same grammatical category; a length/format
  giveaway (only the key fits the blank); inconsistent casing.
- **L8 tag↔content mismatch** *(warn)* — `tags` don't match what the item actually tests.
- **L9 answers-completeness (free-input only)** *(error/warn)* — `checkAnswer`'s normalization
  (`src/features/practice/normalize.ts`) folds ONLY smart-quotes, whitespace, trailing punctuation,
  and case. It does NOT expand contractions, articles, or word order — so every valid variant must be
  listed in `answers`. Flag missing valid forms (e.g. "He's cooking…" absent when "He is cooking…" is
  listed). **Do NOT flag** differences that normalization already folds (case, a trailing period,
  smart vs straight quotes) — verify against that file before flagging.
- **L10 level/vocabulary appropriateness** *(warn)* — the item's vocabulary/structure is off-level for
  the pack's stage (A2→B1). Do NOT judge by feel: use the Content Forge MCP tools
  `mcp__content-forge__level_check`, `mcp__content-forge__ngsl_rank`, `mcp__content-forge__dict_lookup`
  for evidence, and cite it.

Severity: **error** = the item is broken or misleading · **warn** = it works but is weak · **nit** =
cosmetic.

## Output
Terse, grouped by file → exercise. Report NOTHING for clean exercises (signal, not noise). Every
finding carries a machine-addressable locator — `file` + exercise `id` + field path
(`options[2]`, `instruction.ru`, `answers`) — so a follow-up fix pass acts without re-searching. Do
NOT emit auto-patches: the fix is often a genuine choice (broaden the instruction vs. drop the
option), so a fabricated "new value" would be wrong half the time.

```
public/packs/dev-english-a2/days/u14.d01.json
  u14.d01.ex.c.01 · choice · [error] L2 impossible distractor — options[2]="have": "we have celebrate" is ungrammatical
      intended answer: options[0] "are going to". → replace "have" with a plausible future form (e.g. "will")
  u14.d01.ex.c.01 · choice · [warn]  L1 instruction — "Выбери время" but "celebrated" clashes with "Tomorrow"
      → either drop "celebrated" or change the sentence's time marker
```

End each file with a one-line count by severity.
