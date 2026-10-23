# Design artifacts and review contract

Keep the record small. A default design folder contains `design.md`, an HTML
entry and its assets, `validation.md` and an `evidence/` directory. A feedback
export is optional. Reuse existing records instead of creating a file per stage.
Use the location explicitly requested by the owner when present.

## Decision record

Use these fields as a compact outline, omitting irrelevant detail:

1. **Brief:** person, entry, main task, useful outcome, scope, constraints;
   chosen depth; confirmed requirements versus provisional assumptions/unknowns.
2. **Evidence and synthesis:** current route/code/revision for redesign, or known
   unmet task/workaround for a new feature; real reference flows with source/date,
   covered steps and gaps; evidence → difficulty → principle → hypothesis → test
   for priority changes. Record applicability, tradeoffs and tool access.
   For redesign include the starting state, same task/content, observed outcomes,
   strengths to preserve and comparison criteria. Identify relevant local changes
   as well as the commit; missing observations stay explicit.
3. **UX decision:** alternatives with desktop/mobile wireframes; recommendation
   and tradeoff; actions, transitions, state/recovery contract; task protocol.
4. **UI direction:** existing tokens/components; hierarchy, density, type,
   responsive behavior, focus, meaningful visual references. Include the relevant
   design-system sources/effective values and mappings used by authoring tools.
5. **Version and status:** candidate/owner accepted/rework requested; dated
   feedback, reason, affected stage and next action. Never invent owner approval.

## Validation record

Record artifact version, browser/environment, viewport/text scale, task,
expected and actual result, evidence, defects fixed and untested boundaries.
Distinguish prototype simulation, real product behavior, actual provider response
and observed human behavior. Do not label a checklist PASS without performing it.
List working, simulated and unimplemented interactions. Include the local HTML
entry, assets and opening instructions; a React dev project or canvas alone is
not the review handoff. For automation record tool/version, states/rules tested,
failures, incomplete checks and manual coverage. Owner acceptance requires actual
dated feedback on an identified version, separately from technical verification.

For a user session, give the person a goal without naming the intended controls.
Record completion, help required, wrong turns, recovery, elapsed time if useful,
and what they think the result means. Use the same task on alternatives/baseline.
Label expert walkthrough, browser check and observed user session separately.
Without participants report an exploratory candidate, not a validated improvement.
Track blockers and the stage each sends back to.

## Owner feedback

An HTML review panel, when useful, sits apart from the product flow. It may
export local JSON/text containing:

```json
{
  "artifact": "feature-name",
  "version": "v1",
  "screenOrState": "completed translation",
  "decision": "minor-ui",
  "comment": "Make the saved-word action easier to find",
  "expectedBehavior": "I can save the phrase while retaining the source"
}
```

Supported decisions: `accept-concept`, `minor-ui`, `rework-ux`, `reframe-task`.
For rework, collect the problem and expected result rather than just a rating.
Keep comments intact while the owner changes the decision. Export locally; do
not send feedback externally or treat a prototype button as release permission.

## Implementation handoff

When implementation is requested, carry the selected version, scope, state
contract, proposed-versus-existing capabilities, browser evidence, open issues
and acceptance tasks into `dayenglish-workflow`. Check real data, provider and
account boundaries in code. Generated prototype markup is design evidence, not
an application architecture or a substitute for production verification.
