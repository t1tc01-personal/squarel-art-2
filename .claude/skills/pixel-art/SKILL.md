---
name: pixel-art
description: Use when the user wants to create, edit, convert or export pixel art (sprites, tilesets, avatars, stickers, print designs, bead patterns) with the Squarel MCP tools. Covers sizes, palettes, when to use AI vs deterministic tools, cost rules, Aseprite hand-off and export checklists.
---

# Pixel art with Squarel

You drive the `squarel` MCP tools. Talk to the user in their language (often Vietnamese); tool prompts to image models work best in English.

## Workspace ("Dự án")

If the server instructions name an **active workspace** (or `workspace_info` returns one), the user is working on that project: follow its brief (in `AGENTS.md`, also in `workspace_info`) and its defaults for new art. Don't ask again for what the brief or defaults already decide. `project_list` shows only this workspace's art (`all: true` for everything); `workspace_add_art` moves an older art in. The catalog of its art is `.squarel/arts.md`.

## Workflow

1. **Find or make the project.** `project_list` → `project_open`, or `project_create` with a size that fits the purpose (table below). All later tools use the active project.
2. **Look before and after every change.** Call `canvas_view` (use `coords: true` when you need exact pixels). Keep previews ≤256px unless detail matters: images cost the user's Claude usage.
3. **Prefer free, exact tools.** `draw_pixels`, `recolor`, `add_outline`, `apply_palette`, `reduce_colors`, `remove_background`, `flip`, `rotate90`, `scale`, `crop_to_content`, `shift_hue`, layer/frame tools. Use them whenever the request can be expressed as pixel or palette operations.
4. **Use AI only for content.** `generate_image` (new artwork), `edit_image` (add/change things, optionally in a `region`), `animate` (walk/idle cycles).
   - They return a numbered contact sheet. The canvas does not change yet.
   - Show the sheet, let the user pick, then `accept_variant`. It lands on a **new layer** "AI: …". Offer `layer_merge_down` or hiding afterwards.
   - If every variant has low grid confidence, say so and suggest a simpler prompt, a smaller canvas, or `quality: "high"`.
5. **Hand drawing.** When the user wants to draw themselves, call `open_in_editor`. Aseprite syncs both ways. Their strokes come back as versions with source `editor`; `canvas_view` shows them.
6. **Mistakes are cheap.** `undo` (repeatable) and `restore_version` never delete history. `history` shows who changed what.
7. **Export** with `export` (see checklist). Tell the user the file paths you got back.

## Sizes by purpose

| Purpose | Canvas | Notes |
|---|---|---|
| Game sprite | 16, 32, 48, 64 | Transparent background, 8–16 colors, 1px dark outline helps readability |
| Tiles | 16 or 32 | Keep edges seamless; test by imagining 2×2 tiling |
| Avatar / emoji / sticker | 32–128 | Bold silhouette, few colors; export upsizes cleanly |
| Print (shirt, poster) | 64–128 | Export `print-png` at 300 DPI or `print-svg` (vector) |
| Bead pattern (Perler/Hama) | multiples of 29 (29, 58) | Limit to ~10–15 colors; `craft-beads` counts beads per color |

Palette presets: `pico8`, `sweetie16`, `db16`, `gameboy`, `grayscale4`, `bw`, or a list of hex colors.

## Cost rules (important)

- `quality: "free"` (default) uses free providers: Cloudflare free tier, local GPU, or mock.
- `quality: "high"` uses Retro Diffusion, which is **paid**:
  1. The first call fails with `NEEDS_CONFIRM` and a price.
  2. Tell the user the price and ask.
  3. Call again with `confirm_cost: true` only after a clear yes in this conversation.
- `BUDGET` errors mean the daily cap was hit. Do not try to work around it. `usage_today` shows spend.

## Export checklist

- **Game:** `game-png` (scale 1 for engines), `game-spritesheet` (PNG + Aseprite-style JSON with frame tags), `game-gif` for previews.
- **Print:** `print-png` with `widthMm` set to the real print width (DPI is embedded), or `print-svg` / `print-pdf` for vector. Avoid semi-transparent pixels on shirts.
- **Digital:** `social-avatar` (512/1024), `social-emoji` (128), `social-sticker` (WebP 512), `social-anim` (GIF).
- **Craft:** `craft-beads` with `brand` `perler` or `hama`. The PDF has a legend, bead counts and one page per pegboard. Hex values are approximations: suggest checking against a physical chart.

## Coordinates and colors

- Pixel (0,0) is top-left; x grows right, y grows down.
- Colors are `#rrggbb` / `#rrggbbaa`, a palette index from `palette_view`, or `"transparent"`.
