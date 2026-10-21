---
name: asset-pipeline
description: Generate or integrate DayEnglish pixel-art and pack images while preserving its palette, PixelImage rendering, provenance, and the owner's provider preference.
---

# DayEnglish image assets

Pixel art is the project's existing visual identity alongside its dark editorial
and monospace UI. Inspect nearby assets and `src/app.css` before making a new one.

## Style and placement

- Palette: teal `#57c9bd`, amber `#e9a94b`, coral `#e8706a`, ink `#12141c`,
  surface `#1a1d29`, cream `#ece8dd`. Use selective outlines, detailed shading,
  and the existing developer/terminal theme where appropriate.
- Transparent backgrounds for sprites/icons; opaque scenes/banners. Canvas
  dimensions divisible by four (e.g. 96×96 or 240×132). No baked-in UI text.
- Shared brand art: `public/assets/pixel/`. Pack art: the pack's `media/images/`.
  Render through `PixelImage` in `src/shared/ui/`, or a licensed `MediaRef` in content.

## Provider and workflow

The owner chose PixelLab for icons/art while their subscription is active. Check
actual tools and balance before a generation batch. Historical Claude tool names
are not proof of a live Codex connection. The migration imported PixelLab HTTP
settings into ignored local config; a fresh checkout needs its own credential.
Preserve existing assets and report a missing connection rather than silently
switching providers. Do not print auth headers or raw local MCP config.

If the user authorizes another raster provider, use the available image-generation
skill/tool and preserve this style contract. The old Gemini path was only a plan;
do not add an API key, model dependency, or image optimizer speculatively. Existing
vector/code-native assets can be edited as such when that is the user's task.

Inspect the resulting image at its real display size, and verify the affected UI
in the available browser. Generated pack art uses `license.type: "original"` with
appropriate attribution; sourced art retains its source license. Run
`npm run validate:packs` for pack additions. Never put credentials in tracked files.
