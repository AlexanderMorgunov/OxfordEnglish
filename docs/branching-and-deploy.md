# Branching & deploy

Two long-lived branches; features never land straight on prod.

## Branches
- **`main` = production.** Push here deploys to **dayenglish.ru** (Yandex Object Storage + CDN via
  `.github/workflows/deploy-yc.yml`) and to **Vercel Production**. Release cadence: ~weekly, only tested
  features.
- **`dev` = staging/integration.** Push here deploys a **Vercel Preview** (stable per-branch URL). It does
  NOT touch Yandex prod (`deploy-yc.yml` triggers on `main` only).

## Flow
1. Branch a feature off `dev`: `git switch dev && git switch -c feat/x`.
2. Open a PR into `dev`. CI (`ci.yml`: lint → validate:packs → build → test) runs on the PR.
3. Merge to `dev` → auto-deploys to the Vercel staging URL. Test there.
4. Weekly: open a PR **`dev` → `main`**, review the accumulated diff, merge → prod (Yandex + Vercel Prod).
   Keep `dev` in sync afterwards (`git switch dev && git merge main`), or fast-forward.

Hotfix: branch off `main`, PR into `main`, then merge `main` back into `dev`.

## CI / deploy triggers (in-repo)
- `ci.yml`: runs on push to `main` and `dev`, and on every `pull_request` (target any branch).
- `deploy-yc.yml`: runs on push to `main` only (gated on repo var `YC_DEPLOY_ENABLED`) — prod is
  `main`-exclusive; `dev` can never reach Yandex prod.
- Vercel (its own Git integration, not a workflow): `main` = Production, every other branch = Preview.

## One-time dashboard steps (NOT in code — do these once)
1. **GitHub → branch protection on `main`**: require a PR, require the `ci` check to pass, require branch
   up-to-date, no direct pushes. (Optional: same on `dev`.) CLI:
   ```
   gh api -X PUT repos/AlexanderMorgunov/OxfordEnglish/branches/main/protection \
     -F required_status_checks.strict=true -f 'required_status_checks.contexts[]=build' \
     -F enforce_admins=true -F required_pull_request_reviews.required_approving_review_count=0 \
     -F restrictions=
   ```
2. **Vercel — keep staging OUT of the analytics + search index:**
   - Set `VITE_YANDEX_METRICA_ID` **only for the Production scope** (leave Preview empty) so staging
     traffic doesn't pollute prod Metrica. Do the same for any future backend/API base URL (Preview →
     staging API, Production → prod API).
   - Vercel Preview URLs already ship `X-Robots-Tag: noindex` — good. The app's canonical is hardcoded to
     `https://dayenglish.ru`, so preview pages cross-canonical to prod anyway (no duplicate-index risk).
3. **Optional stable staging domain**: assign `dev.dayenglish.ru` to the `dev` branch in Vercel + a DNS
   CNAME (Cloudflare, grey-cloud). If you do, add an explicit `noindex` for that host (a Vercel header
   rule) — a custom domain does NOT get Vercel's automatic preview noindex.

## Notes
- The Yandex↔Vercel dual-host stays as today; only `main` publishes to both.
- Content packs / SEO / sw.js behaviour is unchanged — see README runbook and the SW/CDN gotchas in
  CLAUDE.md.
