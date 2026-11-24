---
name: pixel-export
description: Export the active Squarel pixel-art as production-ready files (game sprite sheets, 300-DPI print files, SVG/PDF, avatars, WebP stickers, bead patterns). Use when the user says "/pixel-export" or asks for final/print/game files.
---

Follow the `pixel-art` skill's export checklist.

1. `art_info` (and `canvas_view` if unsure) to confirm what is being exported.
2. Ask for the target if it is not clear. Examples:
   - which game engine;
   - print width in mm and the product;
   - which platform's sticker size;
   - which bead brand.
3. Check the art first:
   - semi-transparent pixels on print → suggest `apply_palette` or `reduce_colors`;
   - too many colors for beads → suggest `reduce_colors` to ~12;
   - missing outline on small sprites → offer `add_outline`.
4. `export_presets` if you need the option names, then `export` once per needed preset.
5. Reply with the absolute file paths and one line per file on what it is for (e.g. "PNG 3543×3543 = 300mm at 300 DPI").
