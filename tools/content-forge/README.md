# content-forge

Authoring-time **local MCP server** that assembles learning days for OxfordEnglish
from free, correctly-licensed sources. Not part of the app bundle. Plan &
rationale: `../../docs/plans/content-forge.md`.

**Core rule:** every source adapter attaches `LicenseInfo`, and `pack_write_day`
refuses anything that fails the app schema, uses a `local-only` license, or lacks
required attribution — provenance can't be forgotten.

## Setup

```bash
cd tools/content-forge
npm install

# P1 — local corpora → SQLite (bundled samples; drop --sample for real dumps)
npm run import:tatoeba -- --sample     # or TATOEBA_SENTENCES=… TATOEBA_LINKS=… npm run import:tatoeba
npm run import:dict -- --sample        # or KAIKKI_JSONL=… npm run import:dict

# P2 — level lists (real CEFR-J download + NGSL; falls back to the bundled sample)
npm run fetch:wordlists

# P3 — end-to-end proof: assemble u01.d03 and validate the pack
npm run smoke
```

## Full-data sources (free)

- **Tatoeba** weekly dumps → https://tatoeba.org/en/downloads (`sentences.csv`,
  `links.csv`, `sentences_with_audio.csv`). CC BY 2.0 FR (audio per-author).
- **kaikki.org** English Wiktextract JSONL → https://kaikki.org/dictionary/English/
  (IPA, senses, pronunciation audio). CC BY-SA.
- **CEFR-J** wordlist (fetched) + **NGSL** (`newgeneralservicelist.com` — the `.org`
  domain is hijacked). Both CC BY-SA.

## MCP tools

Local corpora: `tatoeba_search`, `dict_lookup`, `level_check`, `ngsl_rank`.
Network sourcing (each stitches its own license): `image_search` (Openverse),
`voa_list` (VOA RSS), `librivox_search` (LibriVox). Assembly: `pack_write_day`
(schema-validated, downloads remote media, registers the day), `pack_validate`.

Registered in the repo-root `.mcp.json` as `content-forge`; run `/mcp` in Claude
Code to connect after importing the data above.

## Notes

- Uses Node's built-in `node:sqlite` (Node ≥ 22) — no native module to compile.
- Data/cache (`data/*.sqlite`, `data/wordlists.json`, `.cache/`) are gitignored.
- `pack_write_day` reuses the app's `src/content/schema.ts` (`Day.parse`) so the
  SkillTag registry and media-license checks are the single source of truth.
- Not yet wired (see plan P4): TTS (Kokoro MCP) and ASR/alignment (faster-whisper
  MCP) for generating our own listening audio + timed transcripts.
