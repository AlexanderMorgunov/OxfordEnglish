# Content Forge guidance

Authoring-time STDIO MCP server, separate from the SPA. Root `AGENTS.md` applies.

- Install this package separately with `npm ci` in this directory. Node's built-in
  `node:sqlite` requires Node 22.13+ (the project CI uses Node 22).
- `src/lib/paths.ts` resolves corpora/cache/vendor paths from the module location;
  maintain that property. `pack_write_day` writes content and registers a day in
  the public course: it is a mutation, not a read-only preview.
- Reuse app Zod schemas and attach provenance in each source adapter. Writer
  validation must continue rejecting `local-only` and unattributed public material.
- Corpora, caches, vendored binaries, and throwaway `_build_*.mjs` scripts remain
  ignored. Do not replace a full local corpus by importing bundled sample data.
- Piper produces authoring audio. Ship MP3 and measure transcript cue boundaries;
  old manually guessed timings caused clipped dictation. No ASR/alignment MCP is
  currently configured.
- For exercise semantics read `.agents/skills/exercise-logic-review/SKILL.md` at
  the repository root. Inspect the MCP's advertised tools instead of hardcoding
  Claude-specific tool identifiers.
- `npm run smoke` assembles a day and writes the pack; run it only when its content
  mutation is in scope. Use MCP initialization/list-tools and read-only tools to
  check connectivity, then root `npm run validate:packs` for authored content.
