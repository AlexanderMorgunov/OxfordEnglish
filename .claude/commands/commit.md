---
description: Create git commits with user approval and no Claude attribution
---

# Commit Changes

You are tasked with creating git commits for the changes made during this session.

## Commit Message Format (MANDATORY)

All commits **MUST** follow this format:

```
TD-XXX тип: краткое описание на английском

Опциональное тело коммита с деталями.
```

### Rules:
- **Task ID first** — every commit starts with `TD-XXX` (Jira task number). No exceptions.
- **Conventional Commits** — use standard types after the task ID
- **English** — description in imperative mood ("add", "fix" — not "added", "fixed")
- A commit without a `TD-` prefix is **invalid**

### Commit types:
- `feat:` — new feature
- `fix:` — bug fix
- `refactor:` — refactoring without behavior change
- `docs:` — documentation only
- `test:` — tests
- `chore:` — dependencies, configs, scripts (no production code changes)

### Examples:
```
TD-456 feat: add user avatar upload to profile page
TD-789 fix: correct pagination offset on dashboard table
TD-234 refactor: extract auth middleware to separate module
TD-870 chore: update eslint config for stricter rules
```

## Process:

1. **Determine the Jira task ID:**
   - Check the current branch name — it usually contains `TD-XXX`
   - If not obvious, ask the user for the task number
   - **Never commit without a task ID**

2. **Think about what changed:**
   - Review the conversation history and understand what was accomplished
   - Run `git status` to see current changes
   - Run `git diff` to understand the modifications
   - Consider whether changes should be one commit or multiple logical commits

3. **Plan your commit(s):**
   - Identify which files belong together
   - Draft clear, descriptive commit messages following the format above
   - Use imperative mood in commit messages
   - Focus on why the changes were made, not just what

4. **Present your plan to the user:**
   - List the files you plan to add for each commit
   - Show the commit message(s) you'll use
   - Ask: "I plan to create [N] commit(s) with these changes. Shall I proceed?"

## Important:
- **NEVER add co-author information or Claude attribution**
- Commits should be authored solely by the user
- Do not include any "Generated with Claude" messages
- Do not add "Co-Authored-By" lines
- Write commit messages as if the user wrote them
- **ALWAYS include TD-XXX prefix** — extract from branch name or ask the user

## Remember:
- You have the full context of what was done in this session
- Group related changes together
- Keep commits focused and atomic when possible
- The user trusts your judgment - they asked you to commit
