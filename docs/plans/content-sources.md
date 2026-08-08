# Content sourcing — free open materials & population flow

Where to get **coherent, openly-licensed A2 content** so we stop hand-writing
everything. Verified against primary sources (2026-08). Constraint: free, no card,
license allows redistribution (CC0 / CC-BY / CC-BY-SA / public domain), automatable.

## The honest gap

We already have isolated sentences (Tatoeba) and our own TTS. We LACK **coherent
leveled reading passages and everyday dialogues at A2**. Those currently come from
hand-authoring. The sources below fill that gap.

## Top sources to integrate (ranked)

1. **VOA "Let's Learn English"** — **public domain** (credit
   `learningenglish.voanews.com`). A 52-lesson graded A1→A2 narrative course
   (character Anna in DC) with text **+ audio + transcript**, structured by
   grammar+topic — nearly an AEF-shaped syllabus already. Closes two gaps at once
   (dialogue + audio/transcript). Access: per-lesson scrape (no bulk API);
   **strip embedded AP/Reuters photos/video — those are NOT PD**, keep VOA text/audio.
   Index: https://www.manythings.org/voa/lessons/1/
2. **Global Digital Library** (digitallibrary.io) — mostly **CC-BY / CC-BY-SA**,
   **real no-auth REST API** (`content.digitallibrary.io/api/wp-json/content-api/v1/…`,
   `/books/en`, `/contentsearch`, `/topics`) with an explicit **Level 1–4** taxonomy.
   Best-automatable leveled reader. **Must read the per-item license field** — some
   titles are CC-BY-NC-SA and must be excluded. API docs: https://content.digitallibrary.io/api/
3. **StoryWeaver** (Pratham Books) — blanket **CC-BY 4.0**, huge catalog, level
   filter in the URL (`/en/stories?level=2`). No content API → scrape (returns 403
   to plain GET; needs a real browser/scraper). https://prathambooks.org/cc/
4. **Global Storybooks** (global-asp) — **CC-BY 4.0**, stories as **git-clonable
   Markdown + audio**. Best automation ergonomics; smaller English-native catalog.
   https://github.com/global-asp

Utility layers (not narrative, wire in as support):
- **Mozilla Common Voice** — **CC0** read sentences **+ audio** (like Tatoeba but
  CC0). Good for arbitrary-sentence audio; no topic/CEFR tags.
- **Openverse** (images, filter CC0/BY), **Openclipart** (CC0 icons).
- **CEFR-J wordlist** (`openlanguageprofiles/olp-en-cefrj`) — open, for level checks.

## Topic → source → item (worked, AEF reference topics)

- **Food & restaurants:** VOA "How to Order at an American Restaurant" (PD) ·
  StoryWeaver "Healthy Food is IMPORTANT", Level 2 (CC-BY 4.0).
- **There is/are · city & directions:** VOA Let's Learn English L6 "Where Is the
  Gym?", L11 "This Is My Neighborhood" (PD) — built around there is/are +
  prepositions of place.
- **Comparatives · places:** GDL API `/books/en?topic=level-2`, hand-vet 3–5 titles
  for comparative-adjective density; check per-item license.

## Reference-only (do NOT import — license fails redistribution)

Communication Beginnings (**CC-BY-NC**), Breaking News English / News in Levels
(free but copyrighted), LibriVox source texts (classic lit, not A2). Use for
pedagogy inspiration, never verbatim.

## Population flow (per topic)

1. **Find** — GDL API (`/contentsearch?language=en`) + StoryWeaver level-filtered
   list + VOA lesson index (already a topic→grammar map).
2. **Vet license (per item, never the platform banner)** — GDL: read the license
   field; StoryWeaver: CC-BY 4.0 uniform; VOA: strip AP/Reuters media. Record
   `license.type` + `attribution` at ingestion.
3. **Vet level** — use the source's level tag (GDL/SW) or a readability + CEFR-J
   coverage check for ungraded sources; `level_check` gates it.
4. **Adapt** — trim/simplify sentences over A2, re-segment dialogue into turns.
5. **Author on top (stays hand-written)** — grammar rule, **RU-speaker pitfalls**,
   exercise distractors. No open source provides Russian-L1-aware pedagogy — that
   effort doesn't disappear.
6. **Import** — into pack JSON with `license`+`attribution`; the validator's
   local-only guard is the same discipline that must catch a stray NC/ND import.

## License traps

- Aggregator labels lie by omission (OER Commons, African Storybook, GDL host
  mixed licenses) — resolve to the per-item license.
- **NC / ND = out** for redistribution.
- **VOA PD carve-out:** embedded AP/Reuters media is not PD.
- **CC-BY-SA is share-alike:** a rewritten derivative must stay SA-compatible and
  can pull the pack toward CC-BY-SA. Prefer pure **CC-BY / CC0 / PD** when equal.
- The best narrative sources (VOA, StoryWeaver) need a **browser-driven scraper**
  (403 on plain GET); only GDL + Global Storybooks are cleanly API/git-automatable.

## Recommended first integration

**GDL adapter** (real API + level taxonomy + per-item license) → biggest
automation win for coherent reading passages. Then a **VOA lesson adapter**
(graded dialogue + audio + transcript). Both feed `pack_write_day`; grammar +
pitfalls + distractors stay hand-authored.
