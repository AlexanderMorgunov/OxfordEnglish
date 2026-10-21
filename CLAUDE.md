# DayEnglish — Claude Code compatibility entrypoint

Read `AGENTS.md` at the repository root for the maintained project map,
conventions, data/operation invariants, and verification commands. Also read
`server/AGENTS.md` or `tools/content-forge/AGENTS.md` when working in those packages.

`README.md` describes the current system. `DESIGN_DOC.md` preserves the original
engine/content design; its no-backend and BYOK-only scope is historical.
Private plans and the dated agent handover live in ignored `docs/`.

Claude-specific `.mcp.json`, `.claude/skills/`, commands, and settings remain
available. Their commands were originally copied from other projects: root project
rules override unrelated Jira `TD-XXX`, NestJS, Next.js/RSC, and old deployment
assumptions. Use current project rules when following any legacy skill.

Codex-native skills and setup live in `.agents/skills/` and `CODEX_SETUP.md`.
No AI attribution/session trailers in commits. Do not commit private docs,
credentials, BYOC packs, or machine-local configuration.
