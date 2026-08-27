# Story bible — "Office Stories" (English for Developers)

A light, warm sitcom (think *The Office*) woven through the grammar course as
lexical/reading episodes. Learners study grammar, then read an episode that
reuses that grammar in everyday office life. Humour is gentle, never mean.
Vocabulary is controlled to the episode's CEFR tier (A1–B1).

## Cast

- **Kate** — team lead. Wants everyone to be "one big family", runs pointless
  team-buildings, says clichés. Warm, a bit dramatic. Husband **Mark** (cooks,
  drops pans during her video calls). *Archetype: Michael Scott.*
- **Den** — backend dev. Rule-follower, loves order, hates when people touch his
  desk or mug. Sure he knows best. *Archetype: Dwight.*
- **Alex** — frontend dev. Tired father of **4 kids** (Danil, Mary, Poly, Tim),
  wife **Marina**. Comes to the office to *rest*. Quietly trolls Den. *Archetype: Jim.*
- **Pol** — devops. The nice one everyone talks to. Smoothies, healthy-living
  advice nobody asked for. *Archetype: the office sweetheart.*
- **Valery** — QA. Older, strictly 9–18, grumbles, collects stamps, "I'm retiring
  on Friday." *Archetype: Stanley.*
- **David** — product owner / client from the US. Calls at 8 AM. Once ate Pol's
  yoghurt during a video call.
- **Peter** — junior tester. Shy new guy, tries to help, gets it wrong at first.

## Tone & rules

- Setting: a small software company office (and homes/cafés for variety).
- Conflicts are ordinary and universal: the thermostat war, a stolen yoghurt, an
  early call in pyjamas, casual-Friday dress code, a dying office plant, a loud
  sneeze, a birthday, a Wi-Fi outage, karaoke — NOT code/tech jargon.
- Keep sentences short and level-appropriate. Introduce the grammar of the
  episode's host unit naturally in the reading + dialogue.
- Every character stays consistent across episodes (relationships, quirks).
- RU translations for every EN line/word; IPA on vocab; a pixel-art scene per
  episode on the reading section.

## Season 1 → grammar / host unit (interleaved, `level` omitted on story days)

| # | Episode | Grammar | Host unit | id |
|---|---|---|---|---|
| 1 | The Thermostat War | present simple vs continuous | u02 | u02.d90 |
| 2 | The Yoghurt Thief | past simple | u04 | u04.d90 |
| 3 | The 8 AM Call | modals (must/should) | u11 | u11.d90 |
| 4 | Casual Friday | comparatives | u09 | u09.d90 |
| 5 | The Dead Plant | present perfect | u12 | u12.d90 |
| 6 | The New Coffee Machine | quantifiers (much/many) | u07 | u07.d90 |
| 7 | The Parking Spot | prepositions of place | u08 | u08.d90 |
| 8 | Kate's Birthday | going to / will | u10 | u10.d90 |
| 9 | The Wi-Fi Outage | present perfect continuous | u17 | u17.d90 |
| 10 | Karaoke Party | reported speech | u29 | u29.d90 |

## Integration recipe (safe interleaving — see DayPage/build.ts)

- Story day id = `uNN.d90`, **no `level` field** (keeps it out of the level-exit
  test), inserted into the middle of the unit's `dayIds` (not last — keeps the
  unit checkpoint on the real last grammar day; keeps placement sampling on the
  grammar days, which come first).
- Audio via Piper (`_build_uNN_*.mjs` template). Reading gets a PixelLab scene in
  `media/images/uNN.d90.reading.png`, license `original`.
