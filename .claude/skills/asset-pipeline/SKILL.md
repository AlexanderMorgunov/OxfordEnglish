---
name: asset-pipeline
description: How to generate, save, and integrate image assets (pixel-art via PixelLab; raster via Gemini) for OxfordEnglish. Read before adding any image asset.
---

# Image asset pipeline

Two tracks. **Pixel-art is the primary track** and the app's visual identity
alongside the editorial/mono system (DESIGN_DOC §8). Keep every generated asset
inside the style contract below so the set stays cohesive.

## Style contract (all pixel art)

- Palette = design tokens: teal `#57c9bd`, amber `#e9a94b`, coral `#e8706a`,
  ink `#12141c`, surface `#1a1d29`, cream content `#ece8dd`. Name these in the
  prompt; for strict palette lock pass a swatch PNG via `color_image_base64`.
- Developer/terminal theme; dark background (blends with the ink surface).
- `outline: selective outline`, `detailed shading`, `highly detailed`.
- Sprites/icons: `no_background: true`. Scenes/banners: `no_background: false`.
- Canvas must be divisible by 4 (e.g. 96×96, 240×132). 16:9-ish for banners.

## Track A — pixel art (PixelLab MCP) · primary

1. **Generate.** `mcp__pixellab__create_image_pixflux` for freeform art
   (icons, scene banners, mascot). Returns a job id — poll `get_image(job_id)`.
   Characters that must rotate → `create_character`. Cost: 1 generation/image
   (subscription; check `get_balance`).
2. **Save.** Download the result URL to disk:
   - Brand assets (mascot, section/tag icons): `public/assets/pixel/<name>.png`
   - Content illustrations for a pack: inside that pack's `media/images/`
   PixelLab output is already tiny (3–12 KB) — no optimization step needed.
3. **Integrate.** Render with the `PixelImage` component
   (`@/shared/ui`) — it sets `image-rendering: pixelated` and degrades
   gracefully if the file is missing. Pack illustrations go through a
   `MediaRef` (with `license`) and are drawn by the reading renderer (M4).
4. **Verify.** `npm run validate:packs` (for pack media) + view the surface via
   the chrome-devtools MCP before committing.

## Track B — raster (Gemini) · dormant until a key exists

For painterly/photographic images pixel art can't cover. **Not wired yet** —
needs `GOOGLE_GEMINI_API_KEY` in `.env` (gitignored). When enabled:
`gemini-2.5-flash-image` (Nano Banana), then downscale + re-encode to WebP
before committing (raw output is multi-MB). Add a playwright-based
`scripts/optimize-images.mjs` at that point (see the pirates project for the
reference implementation). Do not add playwright speculatively.

## Rules

- Every pack media object carries `license` + `attribution`; generated art is
  `license.type: "original"`. Never commit a `.env` key.
- View each generated image before committing — style-consistent? no baked-in
  text? reads at display size?
