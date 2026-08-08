---
description: Analyze feature branch code and simplify/refactor for readability
---

# Code Review & Simplify

You are tasked with reviewing all code changes in the current feature branch, then simplifying and refactoring them for clarity and readability.

## Process

### 0. Ensure correct branch

If the user provides a ticket ID (e.g. `TD-123`):

1. Check the current branch with `git branch --show-current`
2. If NOT already on `feature/TD-123-*`:
   - `git checkout master && git pull`
   - `git checkout feature/TD-123-<short-description>` (find the existing branch with `git branch -a --list '*TD-123*'`)
   - If no branch exists, ask the user whether to create one: `git checkout -b feature/TD-123-<short-description>`
3. If already on the correct branch, continue

### 1. Identify what changed

Run these commands to understand the full scope of changes:

```bash
git diff master...HEAD --name-only
git log master..HEAD --oneline
```

If on master and no ticket ID was provided, ask which branch or files to review.

### 2. Read every changed file

Read the **full file** for each changed path (not just the diff). You need surrounding context to make good refactoring decisions.

### 3. Classify changes

Split files into:
- **Frontend** (`frontend/`) — apply React, Next.js, composition, and Tailwind rules
- **Backend** (`nestjs-backend/`) — apply NestJS architecture and patterns rules

### 4. Review against best practices

For **frontend** files, load and apply:
- `react-best-practices` skill — re-render optimization, bundle size, async patterns, rendering performance
- `composition-patterns` skill — avoid boolean prop proliferation, compound components, state management

For **backend** files, load and apply:
- `nestjs-best-practices` skill — architecture, DI, error handling, security, performance, API design

### 5. Simplify & refactor

For every file, apply these general principles **in addition** to the skill-specific rules:

**Readability**
- Rename unclear variables/functions to say what they do
- Break long functions into smaller ones with descriptive names
- Remove dead code, unused imports, commented-out blocks
- Flatten deeply nested conditionals (early returns, guard clauses)

**Simplicity**
- Replace complex logic with simpler equivalents
- Remove unnecessary abstractions that add indirection without value
- Inline trivial one-use helper functions
- Prefer explicit over clever

**Consistency**
- Match naming conventions used elsewhere in the codebase
- Use existing utility functions instead of reimplementing
- Follow the project's import alias patterns (`@/` for frontend)
- Keep consistent formatting with surrounding code

**TypeScript**
- Add missing types where they improve clarity (not everywhere)
- Replace `any` with proper types when straightforward
- Use discriminated unions over boolean flags where appropriate

### 6. Make the changes

Actually edit the files. Do not just list suggestions — apply every improvement directly.

For each file:
1. Read the file
2. Identify improvements
3. Apply edits
4. Briefly note what you changed and why

### 7. Verify

After all edits:
- Run `npx tsc --noEmit` in `frontend/` to check for type errors
- Run `npx tsc --noEmit` in `nestjs-backend/` to check for type errors (ignore pre-existing errors in `app.controller.spec.ts`, `get-actual-timeframes.tool.ts`, `render-chart.tool.ts`)
- If any errors were introduced by the refactoring, fix them

### 8. Summary

Present a summary of all changes:
- Which files were modified
- What categories of improvements were made (readability, performance, consistency, etc.)
- Any trade-offs or decisions worth noting

## Important

- Do NOT change behavior or functionality — only improve code quality
- Do NOT add new dependencies
- Do NOT refactor code outside the feature branch diff
- If unsure whether a change preserves behavior, skip it and note it as a suggestion instead
- Keep changes minimal and focused — better to make 5 confident improvements than 20 risky ones
