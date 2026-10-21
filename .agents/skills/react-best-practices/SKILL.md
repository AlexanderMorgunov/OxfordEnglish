---
name: react-best-practices
description: Improve React performance in the DayEnglish Vite SPA when changing data loading, rerenders, rendering, or bundle size. Use for relevant React implementation and performance reviews.
license: MIT
metadata:
  author: vercel
  source: .claude/skills/react-best-practices
---

# React performance for DayEnglish

Adapted from the project's Vercel Engineering rules. Root `AGENTS.md` takes
precedence. This is a client-side Vite SPA; the separate backend is Hono, not RSC
or Next.js. Do not introduce Next imports, server actions, hydration machinery,
SWR, or new dependencies just to follow an upstream example.

Start with the actual data flow and a concrete bottleneck. Use existing lazy
routes, Dexie, Zustand selectors, and local caches. Do not mechanically add memo,
useMemo, or effects; preserve semantics and optimize where it matters.

Read individual `rules/*.md` only as needed:

- `async-*`: independent work, deferred awaits, real dependency waterfalls.
  Suspense guidance applies only where a supported Suspense data source exists.
- `bundle-*`: conditional loading, direct imports, deferred third-party code.
  Replace `next/dynamic` examples with React `lazy` or native dynamic imports.
- `client-*`: listeners and localStorage schema/size discipline.
- `rerender-*`: narrow subscriptions, derived state, functional state updates,
  event-driven work, transient refs, and transitions.
- `rendering-*`: conditionals, static JSX, SVG, loading feedback.
- `js-*` and `advanced-init-once`: relevant hot-path JavaScript and startup work.
- `rendering-activity`, `advanced-use-latest`, `advanced-event-handler-refs`:
  optional React 19.2 APIs. The current lockfile/install has React 19.2.8, while
  package.json declares `^19.1.0`; check the installed version before using them.

Next/RSC/server rules, hydration rules, and SWR were excluded from this copy.
Check installed runtime versions before importing any API. The original full collection remains under
`.claude/skills/react-best-practices/` for provenance, not automatic instructions.

For a review, report defects with file/line, impact, and evidence. Apply fixes
when implementation is requested; a review alone does not authorize rewriting
all reviewed files. Verify changed behavior with relevant tests and browser checks.
