# Codex setup for DayEnglish

Project rules live in [AGENTS.md](AGENTS.md). Task-specific skills are checked in
under [.agents/skills](.agents/skills); they require no global installation. Start
a new session after changing instructions, skills, or MCP configuration.

## Local MCP setup (Windows / PowerShell)

Use Node 22.13+ (CI uses Node 22), install the root dependencies with `npm ci`,
and install Content Forge separately:

```powershell
npm --prefix tools/content-forge ci
& ./.codex/setup-mcp.ps1
codex mcp list
```

The setup writes `.codex/config.toml` with absolute paths for this checkout and
the local Node/npm executables. It is gitignored and does not modify global
Codex settings or permissions. It refuses to overwrite an
existing file; `-Force` explicitly regenerates this generated configuration.
After moving the checkout, regenerate it. The tracked
[config.example.toml](.codex/config.example.toml) documents the shape for other
machines/operating systems.

- **content-forge** starts the separately installed local `tsx` runner directly,
  with a fixed repository working directory. No npm install happens at MCP startup.
  Corpora and Piper remain optional local prerequisites for the tools that use them;
  see [its README](tools/content-forge/README.md).
- **chrome-devtools** preserves the former project's `chrome-devtools-mcp@latest`
  setup. Its first launch may download the package. Tool discovery itself does not
  prove browser attachment; verify the browser separately when a task needs it.
- **PixelLab** was found in the owner's global Claude config as an authenticated
  HTTP server. The migration imported that connection into ignored local Codex
  config. On another machine with the same existing Claude connection, use
  `& ./.codex/setup-mcp.ps1 -ImportClaudePixelLab` (add `-Force` to regenerate).
  The credential is copied directly between local files, never printed or added
  to the shared template. Default setup without that flag configures only the two
  STDIO servers. Do not print raw MCP JSON/config when it contains auth headers.
  On October 1, initialization returned HTTP 200, but tool discovery timed out;
  tool usability and subscription balance remain unverified. Recheck in the new
  session before an art task.

Project MCP config is read only for a trusted project. Check trust in Codex if
`codex mcp list` omits the configured servers; do not lower global permissions to fix
discovery. Restart the app/session to load newly configured MCP tools. A server
appearing in the CLI config is different from tools being connected to an already
running chat.

## Migration from Claude Code

| Claude artifact                                      | Codex equivalent                                                                        |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                          | Root `AGENTS.md`, with nested rules for the API and Content Forge                       |
| `.claude/skills/*`                                   | `.agents/skills/*`, adapted for this Vite/Hono project                                  |
| Global UI polish skill                               | Repo-local `make-interfaces-feel-better`                                                |
| Research/plan/implement/debug/review/commit commands | `dayenglish-workflow` skill, invoked in natural language or with `$dayenglish-workflow` |
| Claude named agents, Fable, advisor                  | Independent review only with tools and delegation actually available for the task       |
| `.mcp.json`                                          | Generated project `.codex/config.toml`                                                  |
| Claude permission allowlist / `model: opus`          | Not imported; current Codex runtime policy and model settings apply                     |
| Claude project memory and JSONL chats                | Local private `docs/codex/project-context.md` and `docs/codex/migration-audit.md`       |

Original Claude skills and configuration are preserved. Their copied commands
contain unrelated Jira/NestJS/Next.js assumptions and are not Codex instructions.
Codex skills retain the relevant React guidance and the original source metadata,
but scope it to the installed React version and this SPA. Reviews report findings;
they do not silently refactor everything under review.

Private plans and history stay under ignored `docs/`. Public rules contain only
the technical context needed to work safely. No raw chat logs, secret values, or
personal planning have been copied into tracked documentation.

## Checks

Root: `npm run lint`, `npm run validate:packs`, `npm run build`, `npm test`.
The API has its own typechecks and in-process smokes; see
[server/AGENTS.md](server/AGENTS.md). Content Forge's smoke writes course content,
so it is not a harmless connectivity check.

Configuration format and discovery were checked against official documentation:
[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[skills](https://learn.chatgpt.com/docs/build-skills),
[MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
