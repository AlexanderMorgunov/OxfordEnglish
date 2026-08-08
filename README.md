# English for Developers · A2 → B1

**Live:** https://oxford-english.vercel.app/ — auto-deploys on merge to `main`.

An **offline-first PWA** for systematically learning English from A2 to B1, built
around the idea of a **learning day**: a daily route of grammar → reading →
listening → practice, closed by a unit checkpoint. Grammar is taught on material
a developer already thinks in — commits, deploys, failing builds.

> **Engine and content are fully separated.** The app is a *player* for content
> packs. No copyrighted material ships in the public repository — see
> [Content & licensing](#content--licensing).

`DESIGN_DOC.md` is the source of truth for architecture, scope, the data model,
design tokens, and the M0–M9 roadmap.

## Stack

Vite · React 19 · TypeScript (strict) · Tailwind v4 · React Router · Zustand ·
Dexie (IndexedDB) · Zod · ts-fsrs · Vitest + Testing Library. No backend in v1 —
everything runs locally, no account, no personal data.

## Quick start

```bash
npm install
npm run dev        # dev server at http://localhost:5173
```

Open `/kitchen-sink` to see the full design system.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | `tsc -b` (strict typecheck) + production build |
| `npm run lint` | ESLint |
| `npm run format` | Prettier write |
| `npm test` | Vitest run |
| `npm run validate:packs` | Content-pack validator (wired in M2) |

## Project structure

```
src/
  app.css            design tokens (@theme) + semantic component layer
  main.tsx           entry — self-hosted fonts, router
  router.tsx         routes for every screen (§3.2)
  layout/            app shell
  pages/             one file per screen
  shared/ui/         design-system kit (Button, Console, Option, …)
  shared/lib/        small utilities (cn)
packs/
  dev-english-a2/    the public content pack (only pack tracked by git)
```

## Content & licensing

The app reads content from **content packs** (declarative JSON validated by Zod).
Two modes:

- **Public pack** — original text plus openly licensed material (VOA public
  domain, Tatoeba CC-BY, CC0 images). Ships in the repo, works out of the box.
- **Local pack (BYOC)** — material you legally own, added on your own machine.
  Everything under `packs/` is gitignored **except** the whitelisted public pack,
  so local packs never reach git.

Every content and media object carries a `license` + `attribution`; the pack
validator fails CI if a public pack contains any `license.type: "local-only"`
object. Details in `DESIGN_DOC.md` §1 and (from M9) `CONTENT_LICENSING.md`.

Planned project licensing: code under MIT, public-pack content under CC BY-SA.

## Deployment

Hosted on **Vercel** — every merge to `main` triggers an automatic production
deploy to https://oxford-english.vercel.app/. `vercel.json` rewrites all paths to
`index.html` so client-side routes (`/kitchen-sink`, `/progress`, …) resolve on
direct load and refresh instead of 404-ing.

## Roadmap status

- [x] **M0** — engine shell (build, routing, tokens, CI)
- [x] **M1** — design system (`shared/ui` kit + `/kitchen-sink`)
- [x] **M2** — content as data (Zod schemas, pack loader, validator, demo pack)
- [x] **M3** — exercise engine (7 types, answer normalization, attempts)
- [x] **M4** — grammar + reading (EN/RU toggle, word popover + status)
- [ ] **M5** — listening · **M6** — SRS (FSRS)
- [ ] **M7** — progress & checkpoints · **M8** — AI layer (BYOK) · **M9** — offline & release

See `DESIGN_DOC.md` §10 for the full plan.
