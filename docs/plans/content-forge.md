# Plan — Content Forge (automated content authoring)

**Status:** planned · **Owner:** author · **Source of truth:** `docs/content-forge-design.md`
(design), this file (implementation plan). Reference implementation studied:
`~/Downloads/files/mcp-server.ts`.

## Why

`DESIGN_DOC.md` §11.1 flags the open problem: writing an original A2→B1 course by
hand is a huge amount of work. Content Forge is the answer — a **local MCP server
used at authoring time** (not app runtime, not shipped in the bundle) that lets an
agent assemble a full learning day from freely-licensed sources in one dialog:
Tatoeba sentences, VOA public-domain audio, Openverse CC images, Free Dictionary
IPA/senses, with an NGSL frequency gate for level control and local TTS/alignment.

The defining property: **licenses are attached by the source adapters and enforced
by the writer**, so the agent physically cannot produce an asset without provenance.
This is the M2 safety model (`validate:packs`) moved one step earlier — from publish
time to creation time.

## How it fits our codebase (adaptations to the reference server)

The reference `mcp-server.ts` is a strong scaffold but was written before our M2
decisions. Landing it here requires these concrete changes — this is the core of
the work, not a copy-paste:

1. **Write target.** Reference defaults `PACK_ROOT=./packs/dev-english-a2`. We moved
   the public pack to **`public/packs/dev-english-a2`** (M2 — media resolves at
   runtime). Set `PACK_ROOT=./public/packs/dev-english-a2`; media downloads go to
   that pack's `media/`.
2. **Reuse the schema, don't duplicate it.** Reference redefines `LicenseSchema` and
   `pack_write_day` only walks media for licenses. Our writer must
   `import { Day } from '@/content/schema'` and `Day.parse()` the whole object —
   one source of truth. This also gets us, for free, the **`SkillTag` registry
   check** (unknown tags already fail `Day.parse`) that the reference lacks.
3. **Public-pack `local-only` guard at write time.** Mirror `validate:packs`:
   `pack_write_day` refuses any `license.type: "local-only"` because it writes into
   the public pack. (Media-license + attribution checks from the reference stay.)
4. **`pack_validate` = shell out to our CLI** (`npm run validate:packs`) rather than
   reimplement — keep one validator.

## Placement & wiring

- New workspace `tools/content-forge/` — its own `package.json`
  (`@modelcontextprotocol/sdk`, `zod`, `better-sqlite3`), **not** part of the Vite
  app build. It imports our schema via a path/tsconfig ref, not a bundle import.
- Register in the existing root **`.mcp.json`** (already used for chrome-devtools):
  add a `content-forge` stdio server pointing at the built entry.
- Gitignore: `.cache/`, `tools/content-forge/data/tatoeba.sqlite`,
  `tools/content-forge/data/ngsl.json` (large/derived; fetched by scripts).

## Phases (order from design §6, highest leverage first)

- **P1 — Tatoeba → SQLite.** `scripts/import-tatoeba.ts`: download weekly dumps
  (`sentences.csv`, `links.csv`, `sentences_with_audio.csv`), build local SQLite.
  Biggest payoff: tens of thousands of EN sentences with RU translations at once.
- **P2 — NGSL level gate.** `data/ngsl.json` + `ngsl_rank` / `level_check` tools
  (objective A2≈rank<1500, B1≈<2800; returns offending words so the agent rewrites
  instead of guessing).
- **P3 — MCP skeleton, E2E on one day.** Server with `tatoeba_search` + `level_check`
  + `pack_write_day` (adapted per items 1–3 above); register in `.mcp.json`; assemble
  `u01.d03` end-to-end and confirm `validate:packs` passes.
- **P4 — TTS + alignment (optional/heavier).** Piper/Kokoro (`tts_synthesize`,
  license `original` — text is ours) + Whisper/forced alignment (`align_transcript`
  → `TranscriptCue[]`). One-time local model setup; gate behind availability.
- **P5 — Network adapters.** `voa_list`/`voa_fetch`, `image_search` (Openverse),
  `dict_lookup` (Free Dictionary) — with the reference's disk cache + polite
  throttle (1 req/s, 429 backoff, our User-Agent).
- **P6 — Harden the writer.** Full `Day.parse` + tag registry + local-only guard +
  attribution-required checks; `pack_validate` wrapper.

## Stays manual (design §5 — do not pretend to automate)

Proofreading generated prose (NGSL-valid ≠ natural), multiple-choice distractor
quality, and grammar explanations incl. the RU-speaker "common pitfalls" block.
Collection & plumbing = automated; meaning-level control = human.

## Success criteria

- `u01.d03` assembled entirely through the tools in one agent session.
- Every media object carries a real `license` + `attribution`; `pack_write_day`
  provably refuses a day with a missing license and with a `local-only` license.
- `npm run validate:packs` green on the generated day.
- Zero content-forge code in the shipped app bundle.

## Sequencing vs the main roadmap

Independent tooling track — can run in parallel with M4+ (grammar/reading/listening
renderers). Most useful once M4–M5 renderers exist so generated days are viewable
end-to-end. Recommend P1–P3 after M5, P4–P6 as content scales.
