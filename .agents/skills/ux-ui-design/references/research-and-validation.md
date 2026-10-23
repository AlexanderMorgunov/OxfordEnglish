# From reference flows to a testable UX decision

Keep evidence tied to unresolved decisions. Reuse collected findings when their
scope/date still apply. Quick work may reuse a known pattern and baseline without
new competitor research; say why that resolves the local question. It does not
turn missing reference evidence into a claim of new research.

## Flow capture

Start with a task or transition, such as understanding a result, selecting a
phrase, confirming a save, editing without loss or returning to unfinished work.
Use competitors and analogous products when their mechanism fits.

For each useful reference capture source/date/platform/version when known,
entry context and goal, ordered screens/actions, result and return, actual
images/live behavior, covered states and gaps, transferable mechanism and cost.
A preview does not establish hidden branches, persistence or recovery. Separate
UI composition references from interaction evidence.

Research is sufficient when relevant journeys were actually inspected, structural
choices have evidence, conflicting patterns have a reasoned resolution and further
browsing no longer changes the decision. Hypotheses can cover specific gaps, not
replace all source work. If no relevant flow is accessible, mark research incomplete
and any exploration as assumption-based. A fixed screen quota is not a quality criterion.

## Synthesis

Use a short chain per priority issue:

| Evidence/certainty | Difficulty mechanism | Principle | Hypothesis | Check |
|---|---|---|---|---|
| Observed navigation loses a populated draft | Secondary task irreversibly interrupts main work | Preserve resumable work | Return restores source, edits and position | Complete secondary task and continue without re-entry |

This justifies preserving work. It does not justify a reading-first journey,
showing every feature together or adding a second dictionary. Apply the same
discipline to a new feature: assumed needs remain assumptions. Say what would
make you reject the hypothesis.

## UX walkthrough

Define realistic goals and observable completion before the layout. Use the same
content/goals across alternatives; redesign also compares the current path.

For each step check discovery of the next action, prediction of its effect,
recognition/interpretation of the result and correction/return without loss.
Compare decisions, context switches, mistakes and recovery, not just click count.

Trace defects to the right stage: uncertain task priority → brief; confusing
order/hidden result → UX; weak visual emphasis → UI; broken control → prototype.
Known blocking failures return to their stage before further styling.

## Three distinct checks

| Method | What it answers | What it does not establish |
|---|---|---|
| Expert walkthrough, independent when authorised | Likely discovery, interpretation and recovery issues | Actual behavior or preferences of users |
| Browser/accessibility checks | Whether the artifact renders and behaves as specified | Whether people understand it or the task is right |
| Observation of actual/likely users | Success, hesitation, errors, help, misunderstanding | Population-wide superiority from a small qualitative sample |

Give participants context and goals rather than button instructions. Examples:
"Send the Russian meaning of this paragraph to a friend"; "Remember this
expression and then continue reading." Record completion, wrong turns,
assistance, interpretation and recovery. Explain participant selection and
limits. Owner review is product feedback, not automatically representative
user research.

Without participants complete expert/browser work and deliver an exploratory
candidate with remaining risks and a ready protocol. Do not invent people or
create an artificial approval stop. When observed tasks fail, rework the relevant
stage and check again.

## Runtime verification matrix

Select checks from the actual task/state risks. Reuse available automation for
consequential transitions; a manual browser pass remains valid when a framework
or scanner is unavailable. Do not add application dependencies for a prototype
check or write tests that merely match the implementation's wording.

| Check | Expected outcome / useful evidence |
|---|---|
| Main task and return | Completion is recognizable; navigating to a secondary task and back preserves relevant input, edits and position |
| Async/recovery, when relevant | Cancel/partial/continue/retry do not lose or duplicate work; stale completion cannot replace newer input or manual edits |
| Keyboard and dialogs | Forward/reverse navigation, activation, Escape, visible focus and focus return work; order makes sense |
| Reflow and long content | Desktop/360px and enlarged text keep the task usable; long RU/EN text and unbroken tokens do not hide essential actions |
| Accessibility semantics | Names, roles, states and feedback match the interaction; inspect the accessibility tree and manual behavior |
| Optional automated rules | Run available axe-core or equivalent in material states such as an open dialog/error, recording version, scope, findings and incomplete results |

Use Playwright or another available browser driver for repeatable outcome checks;
the tool name is not a required dependency. Add intermediate widths or a 320px
reflow diagnostic where layout/zoom risk warrants it; DayEnglish's product minimum
remains 360px. Manually inspect hierarchy, focus visibility/order, feedback and
contrast cases the scanner cannot determine. A passing scan does not establish
WCAG conformance or task understanding.

Classify concrete defects by effect: blocks task/loses work, materially hinders,
or cosmetic. After a fix repeat the affected task and a small shared-path
regression where relevant; broaden only for failures or new uncertainty. Record
pass/fail/untested/not-applicable with evidence. A dry run of this skill is not a
runtime PASS for an artifact that has not been built.

## Method sources

- [Design Council: Framework for Innovation](https://www.designcouncil.org.uk/resources/framework-for-innovation/): understand/define before developing; test and iterate.
- [GOV.UK: Moderated usability testing](https://www.gov.uk/service-manual/user-research/using-moderated-usability-testing): observe actual/likely users completing tasks.
- [NN/g: Task scenarios](https://www.nngroup.com/articles/task-scenarios-usability-testing/): realistic actionable goals without giving away the path.
- [Playwright: Accessibility testing](https://playwright.dev/docs/accessibility-testing): state-specific automated rules complement manual and user checks.

These inform the process; they do not prove a particular DayEnglish design.
