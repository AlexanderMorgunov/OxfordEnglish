# Plan — Content Forge (automated content authoring)

**Status:** P1–P3 done (samples wired, E2E green) · P4–P6 pending · **Owner:** author · **Source of truth:** `docs/content-forge-design.md`
(design), this file (implementation plan). Reference implementation studied:
`~/Downloads/files/mcp-server.ts`. Source stack revised after a free-sources
research pass (2026-08, primary-source-verified) — see "Source stack" below.

## Why

`DESIGN_DOC.md` §11.1 flags the open problem: writing an original A2→B1 course by
hand is a huge amount of work. Content Forge is the answer — a **local MCP server
used at authoring time** (not app runtime, not shipped in the bundle) that lets an
agent assemble a full learning day from freely-licensed sources in one dialog.

The defining property: **licenses are attached by the source adapters and enforced
by the writer**, so the agent physically cannot produce an asset without provenance.
This is the M2 safety model (`validate:packs`) moved one step earlier — from publish
time to creation time. Constraint for every source: **free, no paid tier, no card;
automatable via API/dump/MCP; license clean for redistribution (CC0/CC-BY/CC-BY-SA/PD).**

## How it fits our codebase (adaptations to the reference server)

The reference `mcp-server.ts` is a strong scaffold but predates our M2 decisions.
Landing it here requires these changes — this is the core of the work, not a copy:

1. **Write target.** Reference defaults `PACK_ROOT=./packs/dev-english-a2`. We moved
   the public pack to **`public/packs/dev-english-a2`** (media resolves at runtime).
   Set `PACK_ROOT=./public/packs/dev-english-a2`; media downloads to that pack's `media/`.
2. **Reuse the schema, don't duplicate it.** Reference redefines `LicenseSchema` and
   `pack_write_day` only walks media. Our writer must `import { Day }` from
   `src/content/schema.ts` and `Day.parse()` the whole object — one source of truth,
   and it gets the **`SkillTag` registry check** (unknown tags already fail `Day.parse`)
   the reference lacks.
3. **Public-pack `local-only` guard at write time.** Mirror `validate:packs`:
   `pack_write_day` refuses any `license.type: "local-only"`.
4. **`pack_validate` = shell out to `npm run validate:packs`** — one validator.
5. **License for generated text (NEW — gap found in the design itself).** The design
   assigns `license: original` to TTS output but never says what license the
   **LLM-generated prose** (reading passages, exercises) carries. Given the whole
   thesis is "provenance can't be forgotten," the writer must stamp generated text as
   `license: { type: "original", attribution: "Project authors (LLM-assisted)" }`
   and refuse day content that has neither a source license nor this marker.

## Source stack — keep / replace / add (post-research)

Free + automatable options, verified against primary sources.

| Category | Decision | Source | License | Access |
|---|---|---|---|---|
| EN-RU sentences | **KEEP** | Tatoeba | CC BY 2.0 FR (audio per-author) | weekly dumps → SQLite |
| Dictionary/IPA/audio | **REPLACE** | **kaikki.org (Wiktextract) English dump → SQLite** | CC BY-SA (ShareAlike) | one-time JSONL download → local |
| Images | **KEEP** | Openverse (anon, **1 req/s**; free OAuth raises it) | filter `cc0,by` | REST API |
| Authentic text+audio | **KEEP + ADD** | VOA (PD) **+ LibriVox** (PD, JSON API) **+ Wikinews / Simple English Wikipedia** | PD / CC BY 2.5 / CC BY-SA 4.0 | RSS · LibriVox JSON API · MediaWiki MCP |
| Level gate | **KEEP + ADD** | NGSL (**use `newgeneralservicelist.com`**) **+ CEFR-J wordlist** | CC BY-SA 4.0 | CSV/JSON |
| TTS | **KEEP** | **Kokoro** (primary, Apache-2.0) · Piper (fast fallback, MIT) | open model | local / existing MCP |
| ASR + alignment | **REPLACE** | **faster-whisper + wav2vec2 forced alignment** (WhisperX approach) | MIT / BSD-2 | local / existing MCP |
| LLM generation | **KEEP + ADD** | Gemini AI Studio · Groq · **+ Cerebras** | free tier | HTTP |

**Highest-leverage single change:** dictionary → kaikki dump→SQLite. Offline-first
friendly (no live API), wider coverage, and it already carries IPA **and**
pronunciation-audio refs — which also removes the separate Wikimedia Commons hop.

## The "via MCP" answer — processing vs sourcing

The useful split is not "does an MCP exist" but **what the tool returns**:

- **Processing tools → adopt an existing MCP directly.** TTS and ASR outputs are
  *ours* (`license: original`, no provenance question). Wire these in as-is:
  - `tts_synthesize` → a Kokoro-TTS MCP server
  - `align_transcript` / ASR → a faster-whisper MCP server
  This is the concrete win and saves real work.
- **Sourcing tools → keep our thin adapter.** Community image/dictionary/corpus MCPs
  hand back data with **no `LicenseInfo`** — they can't enforce the design's central
  invariant. Use them only as reference code; our adapter stitches license before
  anything reaches `pack_write_day`. (`mediawiki-mcp-server`, MIT, is a fine *fetch*
  layer for Wikinews/Simple Wikipedia — license-stitching still happens on the way in.)
  No Tatoeba MCP exists — stays fully custom.

## Placement & wiring

- New workspace `tools/content-forge/` — own `package.json` (`@modelcontextprotocol/sdk`,
  `zod`, `better-sqlite3`), **not** in the Vite build; imports our schema via tsconfig ref.
- Register in the root **`.mcp.json`** (already used for chrome-devtools): a
  `content-forge` stdio server, plus the adopted Kokoro-TTS and faster-whisper MCPs.
- Gitignore: `.cache/`, `tools/content-forge/data/tatoeba.sqlite`,
  `tools/content-forge/data/dictionary.sqlite`, `tools/content-forge/data/ngsl.json`.

## Phases (order = highest leverage first)

- **P1 — Local corpora → SQLite.** (a) Tatoeba dumps import; (b) **kaikki.org English
  Wiktextract dump import** (dictionary/IPA/pronunciation). Two `import-*.ts` scripts.
- **P2 — Level gate.** NGSL (`.com` domain) + **CEFR-J** as a second, CEFR-labeled
  signal; `ngsl_rank` / `level_check` (A2≈rank<1500, B1≈<2800) returning offenders.
- **P3 — MCP skeleton, E2E on one day.** `tatoeba_search` + `dict_lookup` (kaikki) +
  `level_check` + `pack_write_day` (adapted per items 1–5); register in `.mcp.json`;
  assemble `u01.d03` end-to-end; `validate:packs` green.
- **P4 — TTS + alignment via existing MCPs.** Adopt a Kokoro-TTS MCP and a
  faster-whisper MCP (word-level timing for `TranscriptCue`); output `license: original`.
  Skip diarization (gated models). Do NOT use XTTS (non-commercial) or default to edge-tts.
- **P5 — Network sourcing adapters.** VOA (RSS) + Openverse (`cc0,by`, 1 req/s, cache,
  polite throttle) + **LibriVox** (JSON API, PD) + Wikinews/Simple Wikipedia (via
  MediaWiki MCP as fetch, our adapter stitches license). Each stamps `LicenseInfo`.
- **P6 — Harden the writer.** Full `Day.parse` + tag registry + `local-only` guard +
  attribution-required + generated-text license stamp (item 5); `pack_validate` wrapper.

## Stays manual (design §5)

Proofreading generated prose (NGSL-valid ≠ natural), multiple-choice distractor
quality, and grammar explanations incl. the RU-speaker "common pitfalls" block.

## Gotchas & license traps (from research)

- **NGSL domain hijack:** `newgeneralservicelist.org` now serves gambling — use `.com`.
- **ShareAlike accumulation:** NGSL + kaikki/Wiktionary + SUBTLEX + CEFR-J are all
  ShareAlike; a pack built from all of them is SA-encumbered as a whole — decide this
  consciously (it sits oddly next to the `cc0,by` image filter). Pick the project
  content license (DESIGN_DOC §11.5 suggests CC BY-SA) with this in mind.
- **Avoid:** Coqui XTTS (non-commercial + company defunct); EVP (not an open dataset);
  KELLY (some sub-lists NC — verify before use); OPUS OpenSubtitles/TED subsets
  (ND/NC traps — open each sub-corpus's own license, no blanket use).
- **Fake-free MCPs:** some "whisper" MCPs call OpenAI's **paid** API; some Kokoro MCPs
  upload to S3. Vet each before wiring.
- **Free LLM tiers:** Gemini/Mistral free tiers may train on your input; Gemini quotas
  were cut in Dec 2025; Cerebras free tier caps context at **8K tokens** (a passage +
  exercises in one call may not fit). Add one disclosure line since this is content gen.

## Success criteria

- `u01.d03` assembled entirely through the tools in one agent session.
- Every media/content object carries a real `license` + `attribution`; `pack_write_day`
  provably refuses a day with a missing license, a `local-only` license, or unlabelled
  generated prose.
- `npm run validate:packs` green on the generated day.
- Zero content-forge code in the shipped app bundle.

## Sequencing vs the main roadmap

Independent tooling track — parallel with M4+. Most useful once M4–M5 renderers exist
so generated days are viewable end-to-end. Recommend P1–P3 after M5, P4–P6 as content
scales.
