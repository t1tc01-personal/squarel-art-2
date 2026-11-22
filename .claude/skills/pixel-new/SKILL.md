---
name: pixel-new
description: Start a new pixel-art piece with Squarel — asks for purpose and subject, creates the canvas and offers AI drafts or a blank canvas. Use when the user says "/pixel-new" or asks to start a new sprite/avatar/print/bead design.
---

Follow the `pixel-art` skill.

1. Work out from the user's words (ask only for what is missing, one question at a time):
   - **purpose**: game, print, digital or craft;
   - **subject**;
   - **size**: suggest from the purpose table;
   - **palette**: preset, colors, or auto.
2. `project_create` with a short readable name.
3. If they described a subject:
   1. `generate_image` with `variants: 4` and `quality: "free"`.
   2. Show the sheet and ask which number to keep.
   3. `accept_variant`.
   4. `canvas_view`.
4. Otherwise show the empty canvas and offer `draw_pixels` or `open_in_editor` (Aseprite).
5. End by suggesting the next useful step: outline, palette tweak, animation, or export.
