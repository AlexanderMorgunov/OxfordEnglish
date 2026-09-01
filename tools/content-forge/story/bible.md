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

## Season 2 → one episode per remaining unit (u01, u03, u05–u28, u30, u31; all `.d90`)

Season 2 filled a `.d90` story day for every A2/B1/B2 unit that Season 1 didn't cover, reusing each
host unit's grammar in a fresh office conflict. Complete. The final breadth episode is **u32.d90**
(host unit u32 = cleft / emphasis / inversion — see the emphasis structures below).

| Episode | Grammar | Host unit | id |
|---|---|---|---|
| The Missing Mug | cleft sentences, emphatic *do*, negative inversion | u32 | u32.d90 |

## Season 3 → depth pass (a SECOND episode per unit, `.d91`)

Once breadth is done, Season 3 adds a second story day (`uNN.d91`) to units that benefit from more
reading, starting with the earliest/highest-traffic units. Same cast & canon, brand-new everyday
conflicts (never reuse a Season 1/2 plot), same host-unit grammar. `insertAt` places it after the
unit's existing `.d90` (a later middle slot — never last, same interleaving rule as `.d90`).

| # | Episode | Grammar | Host unit | id |
|---|---|---|---|---|
| 1 | The Standing Desk | present simple vs continuous | u02 | u02.d91 |
| 2 | The Weekend Stories | past simple | u04 | u04.d91 |

## Production pipeline (DeepSeek → review → build)

Text scales via DeepSeek; audio via Piper; art stays a separate manual pass.

1. **Brief.** Author a small brief in `briefs/<id>.json` (id, unitId, insertAt, tags — use only
   registered `src/content/skill-tags.ts` tags —, level, episode, grammarName, grammarRef, characters,
   scenario paragraph). Example: `briefs/u11.d90.json`.
2. **Generate.** `node tools/content-forge/story/gen-episode.mjs briefs/<id>.json` → writes
   `specs/<id>.json` (leveled TEXT only). Needs `DEEPSEEK_API_KEY` in `.env`; model via
   `DEEPSEEK_MODEL` (default `deepseek-chat`). ~$0.02-0.05/episode.
3. **Review + level-gate.** Read the spec; run `mcp__content-forge__level_check` on the reading
   (ignore the over-flag on names / past-forms — see episodes 1-2). Fix anything off-level or
   out-of-character by editing the spec.
4. **Build.** `FFMPEG=<abs> node tools/content-forge/story/build-episode.mjs specs/<id>.json` →
   synthesizes audio, measures dictation cue timings, attaches any illustrations that exist, writes
   `days/<id>.json`, and registers the day mid-unit. `--dry` prints the Day without writing.
5. **Illustrate (optional, later).** Generate `media/images/<id>.reading.b1.png` / `.b3.png` via the
   locked-character img2img workflow above and rebuild (or just add the PNGs — the harness picks them
   up next build).
6. **Validate + verify.** `npm run validate:packs`, then view the day in the app.

`specs/u04.d90.json` is the gold-standard example fed to DeepSeek as a few-shot.

## Character canon (locked) & art workflow

Freeform generation re-invents faces/clothes each time, so we lock the look.

**Canonical sprites** (PixelLab `create_character`, side view, 4-dir) live in
`tools/content-forge/story/characters/*.png` and define each character's exact
appearance. IDs (reuse via `style_character_id` in pro mode):
- Alex — `08875f8e-ce2d-4a08-ac25-2e208a0fce09` — brown hair, teal-green hoodie,
  white tee, blue jeans.
- Den — `c79f3e70-c166-4a04-a3c1-65dda8a63d0a` — dark hair, coral-red hoodie,
  dark jeans, coffee mug.
- Kate — `fe677aad-8a5a-4aac-8304-9200ad125033` — shoulder-length blonde hair,
  navy blazer (amber cardigan acceptable — amber is a brand token).
- Pol — `8f6eaf7d-482d-46c4-8a6d-c92426229700` — short curly dark hair, round
  glasses, olive-green hoodie, green smoothie cup.
- TODO: Valery, David, Peter.

**Scene workflow (consistency across an episode's scenes):**
1. Generate ONE canonical *base scene* per recurring cast grouping (e.g. the
   Alex+Den two-shot) with `create_image_pixflux`.
2. Derive every other scene for that grouping via **img2img** — pass the base as
   `init_image_url`. `init_image_strength` ≈ 120 when the cast is unchanged
   (keeps faces/clothes/props identical); ≈ 55 when a character must be added or
   the action changes a lot (still carries identity, allows the new element).
   Verified: u02.d90 b3 (Kate reveal) was derived from b1 and the two devs +
   the thermostat stayed consistent.
3. Keep the brand palette (teal/amber/coral/ink/cream) and selective outline in
   every prompt. Recurring props (the wall thermostat) come from the base image.

## Integration recipe (safe interleaving — see DayPage/build.ts)

- Story day id = `uNN.d90`, **no `level` field** (keeps it out of the level-exit
  test), inserted into the middle of the unit's `dayIds` (not last — keeps the
  unit checkpoint on the real last grammar day; keeps placement sampling on the
  grammar days, which come first).
- Audio via Piper (`_build_uNN_*.mjs` template). Reading gets a PixelLab scene in
  `media/images/uNN.d90.reading.png`, license `original`.
