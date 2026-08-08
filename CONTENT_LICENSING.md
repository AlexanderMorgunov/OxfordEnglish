# Content licensing — what may go into a pack

This project separates the **engine** (open source) from **content packs**. The
engine ships empty of copyrighted material; you bring content. Read this before
adding anything to a pack.

## The one rule the tooling enforces

Every media and content object carries a `license` (`type` + `attribution`).
`npm run validate:packs` (and the Content Forge writer) **fail** if:

- a media object has no license,
- an attribution-required license (`CC-BY`, `CC-BY-SA`, `public-domain`) has no
  `attribution`,
- a **public** pack (`visibility: "public"`) contains any `license.type:
  "local-only"` object.

This last check is the safety net: it makes it impossible to accidentally publish
material you only hold a personal license to.

## Public pack (`public/packs/…`, committed) — allowed

| Source | License | Notes |
|---|---|---|
| Your own text/exercises | `original` | The core asset — original sentences on your themes. |
| TTS you generated (Piper) | `original` | The text is yours, so the audio is too. |
| VOA Learning English | `public-domain` | Credit `learningenglish.voanews.com`. |
| Tatoeba sentences | `CC-BY` | Per-sentence attribution. Audio license is **per-recorder** — verify it, don't assume it from the text. |
| Openverse / Wikimedia images | `CC0` / `CC-BY` | Prefer `cc0,by`; keep the attribution string. |
| kaikki / Wiktionary (IPA, senses) | `CC-BY-SA` | ShareAlike — carry it forward. |
| LibriVox | `public-domain` | Recordings are PD. |

**ShareAlike note:** combining several `CC-BY-SA` sources (Wiktionary, NGSL,
CEFR-J) makes the pack ShareAlike-encumbered as a whole. The project content
license is **CC BY-SA** to match; code is **MIT**.

## Public pack — NOT allowed

- Text, images, or audio from a commercial course (e.g. a published textbook).
  Following the same *scope & sequence* (grammar order, CEFR level) is fine —
  copying its *content* is not.
- Anything `NC` (non-commercial) or `ND` (no-derivatives) if it would restrict
  redistribution — flag and avoid (watch OPUS/OpenSubtitles/TED subsets, KELLY).
- Any asset without a clear, verifiable license.

## Local pack (`packs/…`, gitignored) — your machine only

Material you legally own (e.g. a textbook you bought) goes in a **local** pack:
mark those objects `license.type: "local-only"`. The root `packs/` directory is
gitignored, and the `local-only` guard blocks such objects from ever entering a
public pack. This is the standard BYOC ("bring your own content") model — the app
plays your material locally; you publish only the engine and the open pack.
