---
name: composition-patterns
description: Design or refactor React 19 component APIs in DayEnglish when mode booleans, shared context, or sibling state call for composition.
license: MIT
metadata:
  author: vercel
  source: .claude/skills/composition-patterns
---

# React composition patterns

Adapted from the existing Vercel skill. Use project conventions in root
`AGENTS.md` and existing `src/shared/ui/` components before adding abstractions.

Read only the reference matching the design problem:

- `rules/architecture-avoid-boolean-props.md`: replace growing combinations of
  mode flags with explicit variants or composition; ordinary boolean state is fine.
- `rules/architecture-compound-components.md`: shared context for a component
  family when independent composition is useful.
- `rules/state-lift-state.md`, `state-context-interface.md`, and
  `state-decouple-implementation.md`: sibling coordination and provider boundaries.
- `rules/patterns-explicit-variants.md` and `patterns-children-over-render-props.md`:
  understandable public APIs; do not replace useful render props mechanically.
- `rules/react19-no-forwardref.md`: React 19 ref-as-prop and `use()` for context.

Keep keyboard, focus, ARIA, language, and controlled/uncontrolled behavior intact
while refactoring. Preserve ownership of account and subscription state rather
than duplicating it in presentation components. Reviews report findings; perform
refactors only within the user's implementation scope.
