---
name: ux-ui-design
description: Design new DayEnglish features or redesign existing UX/UI through task research, real-flow references, evidence synthesis, UX validation before UI, and a browser-verified HTML prototype. Use for feature discovery or confusing interactions; skip routine visual fixes and implementation of an agreed design.
---

# DayEnglish UX and UI design

Turn a feature idea or usability problem into a reasoned, reviewable proposal.
Work in order: task/evidence → reference flows → synthesis → UX and walkthrough
→ UI → interactive HTML → review and revision. Follow root AGENTS.md and
dayenglish-workflow for product constraints and any later implementation.

Use Russian with the owner. Keep private research, screenshots, feedback and
prototypes under ignored docs/ux-lab/<date>-<feature>/ unless specified otherwise.
Keep the reusable skill free of case-specific decisions. Announce the skill and
deliverable. Scale the work to the uncertainty; routine visual fixes skip this flow.

Quality comes from justified decisions and observed task completion. A different
agent, generated screen, library or completed checklist does not establish usability.
Choose tools to close an evidence gap; do not turn design into installing agents
or trying a chain of generators.

Choose the smallest sufficient depth and state it briefly:

- **Quick:** a local interaction design question; reuse relevant evidence and compare
  only the affected path. No mandatory competitor search or alternative concepts.
- **Standard:** a new feature or substantial screen redesign; use the full flow.
- **Deep:** uncertain task priorities or several connected journeys; investigate
  those uncertainties and add targeted observation/review when available.

Depth changes effort, not the requested deliverable or evidence honesty. Ordinary
CSS fixes and implementation bugs with agreed expected behavior skip this skill.
Escalate when a local repair exposes a structural
problem. Discover tools by the capability needed, using the contract in
[Tool selection](references/tools.md); missing optional services do not block work.

## 1. Establish the task and evidence

Choose the entry mode:

- **New feature:** establish the unmet task, current workaround if known, entry
  point and nearby application conventions. Do not invent an existing-flow audit.
- **Redesign:** capture the current end-to-end path, concrete friction, task
  outcomes and what works. Preserve useful behavior; a whole-screen replacement
  is not the default remedy.

State the person/context, main and secondary tasks, useful outcome, scope,
constraints and unknowns. Separate confirmed needs from assumed priorities:
an educational brand does not prove that learning comes before quick translation.
Ask only about material missing decisions; continue independent research.
A labelled exploratory assumption is acceptable, invented user evidence is not.

For an existing flow inspect relevant code, tests and the rendered interface;
use ux-audit for a substantive audit. Separate owner reports, observed code,
browser behavior, inference and hypotheses. For new features inspect the closest
product conventions.
Read current code/decisions rather than freezing today's dimensions in this skill.

For redesign, record a compact baseline in design.md: source revision and relevant
local changes, starting state, task/content, observed result/friction, strengths
to preserve and comparison criteria. A commit alone does not describe a dirty
working tree. When no concrete UX failure is established, mark the work as an
experiment or visual refresh rather than inventing a redesign justification.

**Ready:** task and observable success are stated; evidence/assumptions are
distinguished; scope and existing strengths are explicit.

## 2. Research actual flows and relevant practices

Search for the unresolved task or transition, not a visual theme. Use Mobbin
flows, accessible live products or documented recordings. Inspect actual screens
and their order: entry → action → result → next step/return, with recovery when
observable. A screenshot shows a state; marketing supports capability; neither
proves an unobserved interaction or superior usability.

Record source/date/platform, covered steps, missing states, the mechanism to
adapt, its cost and why it fits DayEnglish. Read primary sources and a small set
of relevant products; deepen research while an important question remains open.
UI composition references are useful separately from evidence of an interaction.

Use [Tool selection](references/tools.md) for capability/access and
[Research and validation](references/research-and-validation.md) for capture
fields and task protocols. Practical use of a requested source must be real;
reading its landing page is not using its library. Do not silently substitute
Open Design or local generation for requested research. When access is missing,
report the specific gap and continue independent work without inventing results.

**Ready:** references answer structural questions and expose tradeoffs; gaps are
visible. A collection of attractive screens or links alone is insufficient.

## 3. Synthesize before proposing a layout

For each priority problem connect:
**evidence → mechanism of difficulty → principle → change hypothesis → test**.
Explain why the change should help and what would make you reject it. Resolve
conflicting references in our task's context. Decide what to show first, reveal
later or omit; do not combine every attractive pattern.

An observed loss of work justifies preserving context. It does not prove a
reading-first priority or a need to show every feature simultaneously.

**Ready:** substantial changes have traceable rationale, tradeoffs and checks.
Unsupported priorities remain explicit assumptions.

## 4. UX: decide and walk the interaction

Use product-ux. Define the user-facing entities, information order, entry,
primary action, completion, correction and return. Distinguish preview/apply/save
and network or paid actions. Preserve input and edits across transitions.

When structure is uncertain, compare two or three materially different paths
with simple desktop/mobile wireframes against the same tasks. Avoid cosmetic
alternatives and mandatory variants for a clear repair. Recommend provisionally,
explain the cost and preserve a baseline for redesign.

Define relevant states and recovery: empty/input/validation, loading, partial,
success, failure/retry, offline, cancellation, manual changes, navigation/return
and long content. Include quota/ownership/stale completions when relevant.
Describe behavior at transitions, not just a list of screen names.

Before styling, walk realistic tasks from first use. At each step ask whether
the person can find the next action, predict its effect, recognize/understand the
result and recover or return. Compare the same tasks with the current path for
redesign. Count forced decisions/context changes and their meaning; fewer clicks
does not by itself mean easier understanding. Include keyboard and narrow screens.

Use independent expert review when authorised. Observing actual/likely users is
a separate check: neutral goals, no hints naming the intended controls, record
wrong turns, assistance, interpretation and recovery. Do not invent participants
or numerical usability scores.

**Ready for UI:** the main task and return work in the wireframes; known blocking
failures in discovery, interpretation or recovery are resolved. If user evidence
is unavailable, proceed with a labelled expert-reviewed exploratory candidate,
remaining risks and a task protocol. Do not claim validated improvement or create
artificial per-stage approval stops.

## 5. UI: make the chosen flow legible

Use frontend-design and relevant web-accessibility guidance. Preserve DayEnglish
tokens, navigation, terminology and useful shared controls. Specify hierarchy,
type, spacing/density, controls, content, responsive behavior and visual states.
Check Cyrillic readability, long content, focus and reduced motion.

Before authoring, record the relevant design-system contract in design.md. Read
src/app.css, applicable src/shared/ui components and the current route/shell;
capture token/component sources, effective fonts/fallbacks, spacing, content width,
responsive rules and control states. Verify important values in the browser when
the render differs from code. Supply this compact contract to external authoring
tools; reuse it rather than copying another product's design system.

Do not mask UX problems with extra cards, colors, modes or more visible buttons.
A structural/action-order change returns to UX with a reason.

**Ready:** first action and result are legible, secondary actions discoverable,
reflow/focus are specified and the direction fits the existing product.

## 6. Build and inspect interactive HTML

Author with suitable available tools using the research, UX/state contract and
UI direction. Reference retrieval, authoring and validation are different jobs:
using Mobbin does not require another generation-service account. Honour a named
tool for its intended role. Create a separate project, preserve existing work,
record provenance and refine observed defects. If a required provider cannot run,
state the limit instead of presenting a substitute as its output.

Deliver a local HTML entry with assets present; prefer self-contained HTML.
For complex state, an isolated React/TypeScript authoring project is acceptable;
provide its built HTML entry/assets and exact local opening instructions. A dev
server or editable canvas alone does not satisfy an HTML deliverable. If a single
standalone .html was requested, preserve that format. Do not install dependencies
in or modify production code merely to build a design prototype.
Make task-relevant actions work. Label fixtures and simulated services; never
present a prepared answer as a response to arbitrary input. Use no credentials
or account data. Keep demo controls and review notes outside the product flow.
Use synthetic/redacted fixtures with external design/reference tools. Do not send
confidential texts or account-bearing screenshots/configuration without explicit
authorisation for that purpose.

Inspect the actual HTML in Chrome at desktop and 360px, enlarged text and
keyboard-only; walk the tasks and relevant failure/offline recovery. Check
dialogs at edges, focus entry/return, overflow and preserved work. Fix observed
defects and recheck affected tasks. Browser checks, AI critique and human
observation have separate evidence boundaries; none replaces product verification.
Use available automation for consequential state transitions and automated a11y
rules where useful; retain manual keyboard/visual checks. See the focused matrix
in [Research and validation](references/research-and-validation.md). Do not add
application dependencies or claim WCAG conformance just to complete a checklist.

## 7. Review, rework and handoff

Deliver the HTML, decision record, actual checks, limits and concrete tasks to
try. Use [Artifact contract](references/artifacts.md). Classify feedback:

- **Accept concept:** record exact version/scope; no implied implementation or
  deployment permission beyond the existing request.
- **Minor UI:** refine wording, hierarchy, spacing or presentation and recheck.
- **Rework UX:** revisit order, missing actions, context loss or recovery.
- **Reframe task:** return to brief/research when audience or outcome was wrong.

Preserve accepted versions and reasons. Continue through authorised work without
stopping at each phase. For later implementation carry decisions, state contract,
risks and acceptance tasks into dayenglish-workflow.
Each further research/generation iteration should address an unresolved decision
or observed defect. Stop novelty-only regeneration and reuse valid evidence. When
access stalls, report the specific gap and proceed with an available path or a
labelled assumption; preserve the requested scope and deliverable.
