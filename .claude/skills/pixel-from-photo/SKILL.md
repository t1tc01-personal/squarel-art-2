---
name: pixel-from-photo
description: Turn a photo or picture into pixel art with Squarel (free, no AI) and clean it up. Use when the user says "/pixel-from-photo", drops an image, or asks to pixelate a picture.
---

Follow the `pixel-art` skill.

1. Get the image path. Two options:
   - the user drops the file into `DATA_DIR/inbox` and gives the file name;
   - the user gives an absolute path.
2. Pick a width from the purpose:
   - avatar: 48–64;
   - bead pattern: 29 or 58;
   - print: 64–128.

   Pick 8–16 colors, or a palette preset if the user wants a retro look.
3. `photo_to_pixel`:
   - `remove_background: true` when the subject is on a plain background;
   - `as_new_project: true` unless they want it as a layer in the current art.
4. `canvas_view` and propose clean-ups:
   - `remove_background`, `reduce_colors`, `add_outline`;
   - `draw_pixels` for small fixes (eyes, highlights).
5. Offer `open_in_editor` for hand touch-ups, then `/pixel-export`.
