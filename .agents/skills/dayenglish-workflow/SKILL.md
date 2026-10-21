---
name: dayenglish-workflow
description: Research, plan, implement, debug, or review substantial DayEnglish changes using private local plans, appropriate tests, browser evidence, and the owner's commit/release conventions.
---

# DayEnglish development workflow

Root `AGENTS.md` defines architecture, retention rules, tools, and authorization.
This skill replaces Claude's research/plan/implement/iterate/validate/debug/review/
commit commands. Do not copy their tool names, model choices, Jira prefix, NestJS
assumptions, or mandatory pauses into Codex.

## Research and planning

Trace the trigger through the relevant code, mirrored contracts/resolvers, tests,
and affected UI. Read the relevant private plan and `docs/work-queue.md` if present;
historical summaries and old pending-ops lists can be stale. Separate implemented,
deployed-at-a-known-date, planned, deliberately deferred, and unknown states.

For substantial work, write a concrete plan under ignored `docs/`: problem,
observable intended behavior, touched boundaries, ordered steps, and verification.
Read enough relevant context to resolve the task; do not load every file or demand
a ticket number. A small fix may need only a concise plan in the conversation.

The owner's recurring flow includes independent plan and implementation review
for substantial changes. When requested or authorized for this task, use available
Codex delegation and give the reviewer the raw request and code without steering
it to the desired verdict. Do not assume Fable/advisor exists or claim an
independent review when only self-review ran. Otherwise review directly and state
the limitation when it matters. Routine docs/setup edits do not need delegation.

## Implementation and debugging

For UI flow creation/rework, use the owner's Open Design-first workflow:
evidence-based audit → task/interaction plan → actual Open Design prototype →
rendered critique/refinement → product implementation → DevTools verification.
Use available `ux-audit`, `product-ux`, `frontend-design`, and `web-accessibility`
skills as appropriate. Existing palette, fonts and navigation take precedence
over generic visual examples. Prototype generation/testing and product browser
testing are distinct evidence. Translation's main action belongs at initial
input; optional acquisition settings must not hide it. Define error, offline,
manual-edit, cancellation and ownership behavior before implementing async UI.

Proceed through the authorized scope without artificial per-phase pauses. Adapt
routine details to the code; clarify material product decisions that cannot be
inferred. Keep completed work and private plan status current.

Reproduce a bug at the boundary that matters: an API-only check once passed while
the production account UI was disabled by missing `VITE_API_BASE`. UI errors need
real browser verification. For sync, distinguish sign-out, same-account return,
cross-account handover, anonymous work, retries, and late network completion.
For billing, distinguish active plan from successful extension, pending callback,
spent local token, second purchase, and return in a browser with no session.

Run the checks required by changed areas (root/API/authoring checks are in
`AGENTS.md`). A regression test should fail for the original bug or a realistic
mutation, not merely restate implementation. Do not create production test
accounts, purchase subscriptions, run migrations, or deploy merely for validation.
An explicitly authorized test-account scenario is a different scope.

## Review and delivery

Review the full requested scope and sibling call sites. Report actionable defects
with location, trigger, impact, evidence, and a fix. Check historical claims
against current code before repeating them. “Review” does not mean silently apply
every stylistic refactor. Keep review findings local unless publication is requested.

Summarize what changed, verification actually performed, remaining limits, and any
pending product decision. Do not mark unperformed manual/live tests complete.

Commit and push only when requested for the concrete work. Stage explicit paths;
use English conventional subjects without Jira `TD-XXX` or AI trailers. Keep
logical tasks separable. Before push run required checks including `npm test`;
remember pushing `main` deploys the website, while the API and Android release have
separate delivery steps. Do not import secrets or private plans into commits.
