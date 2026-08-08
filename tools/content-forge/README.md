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
`voa_list` (VOA RSS), `librivox_search` (LibriVox). Speech: `tts_synthesize`
(Piper, our own text → WAV, license "original"). Assembly: `pack_write_day`
(schema-validated, downloads remote media, registers the day), `pack_validate`.

## TTS (Piper) setup

`tts_synthesize` shells out to a local Piper binary + voice. The binaries and
model live in `vendor/` (gitignored — re-download per machine):

```bash
cd tools/content-forge
mkdir -p vendor/piper vendor/voices
# Piper (Windows amd64; pick the right asset for your OS)
curl -sL -o vendor/p.zip https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip
cd vendor && unzip -oq p.zip && rm p.zip && cd ..
# American-English voice
curl -sL -o vendor/voices/en_US-lessac-medium.onnx https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx
curl -sL -o vendor/voices/en_US-lessac-medium.onnx.json https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/en_US-lessac-medium.onnx.json
```

Paths default to those locations; override with `PIPER_BIN` / `PIPER_VOICE`.

Registered in the repo-root `.mcp.json` as `content-forge`; run `/mcp` in Claude
Code to connect after importing the data above.

## Notes

- Uses Node's built-in `node:sqlite` (Node ≥ 22) — no native module to compile.
- Data/cache (`data/*.sqlite`, `data/wordlists.json`, `.cache/`) are gitignored.
- `pack_write_day` reuses the app's `src/content/schema.ts` (`Day.parse`) so the
  SkillTag registry and media-license checks are the single source of truth.
- Not yet wired (see plan P4): ASR/forced alignment (faster-whisper) to auto-time
  transcripts. Until then, TTS audio uses hand-authored cue timings.
