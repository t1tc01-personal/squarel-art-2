# Danh mục tool (tự sinh)

> File này được sinh bởi `pnpm docs:tools` từ schema zod trong `src/tools`. Đừng sửa tay.

Tổng cộng **42 tool**. Mọi tool đều nhận `project` (slug, mặc định là project đang mở) nếu có liên quan.

## `art_list` — List arts

List the arts of the current project, most recently changed first. With legacy: true, list the older arts that still wait in DATA_DIR/projects (works outside a project too).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `legacy` | boolean |  | List the legacy arts in DATA_DIR/projects instead |

_chỉ đọc_

## `art_create` — Create art

Create a new pixel-art canvas in the current project and make it the active art. Width, height, purpose and palette default to the project's defaults. Typical sizes: game sprites 16/32/64, print 64–128, avatars/emoji 32–128, bead patterns 29/58 (pegboard multiples). Palette presets: pico8, sweetie16, db16, gameboy, grayscale4, bw.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `name` | string | ✓ |  |
| `width` | integer |  | Required unless the project has a default |
| `height` | integer |  | Required unless the project has a default |
| `purpose` | "game" \| "print" \| "digital" \| "craft" |  | Default: the project default, else game |
| `palette` | string \| string[] |  | Preset name or list of "#rrggbb" colors (default: the project default, else pico8) |
| `max_colors` | integer |  | Keep the palette at most this big |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `art_open` — Open art

Make an art the active one for later tool calls and show it.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

_chỉ đọc_

## `art_info` — Art info

Size, palette, layers, frames, head version and folder of an art (text only).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |

_chỉ đọc_

## `canvas_view` — View canvas

Render the canvas as an image so you can see it. Use grid/coords to point at exact pixels (x right, y down, 0-based). Keep size small to save context.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `size` | integer |  | Longest side in px (default 256) |
| `layer` | string |  | Show only this layer |
| `frame` | integer |  | Frame index (default 0) |
| `grid` | boolean |  |  |
| `coords` | boolean |  | Add rulers with pixel coordinates |

_chỉ đọc_

## `palette_view` — View palette

Show palette colors with their indices (index 0 is transparent and not shown).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |

_chỉ đọc_

## `project_info` — Project info

The current project ("Dự án": a folder whose squarel_art/ holds the arts of one game, sticker set or print): name, folder, description, brief, defaults for new art, repos, export folder and its arts.

_chỉ đọc_

## `draw_pixels` — Draw pixels

Draw directly on a layer: set points, lines, rectangles, ellipses, flood fill. Coordinates are 0-based, x right, y down. Use canvas_view with coords first. Free and exact — prefer this for small, precise edits.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `layer` | string |  | Layer id or name (default: top layer) |
| `frame` | integer |  | Frame index (default 0) |
| `ops` | object[] | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `layer_add` — Add layer

Add an empty layer (on top, or above a given layer).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `name` | string | ✓ |  |
| `above` | string |  | Layer id or name (default depends on the tool) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `layer_remove` — Remove layer

Delete a layer (it stays recoverable through history/undo).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `layer` | string | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `layer_merge_down` — Merge layer down

Merge a layer into the one below it (e.g. after accepting an AI proposal).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `layer` | string | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `layer_reorder` — Reorder layer

Move a layer to an index (0 = bottom).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `layer` | string | ✓ |  |
| `to_index` | integer | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `layer_set` — Set layer properties

Rename, hide/show, change opacity (0-255) or lock a layer.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `layer` | string | ✓ |  |
| `name` | string |  |  |
| `visible` | boolean |  |  |
| `opacity` | integer |  |  |
| `locked` | boolean |  |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `frame_add` — Add frame

Append an animation frame (empty or copied from another frame).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `duration_ms` | integer |  |  |
| `copy_from` | integer |  | Frame index (default 0) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `frame_remove` — Remove frame

Delete an animation frame by index.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `frame` | integer | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `frame_set` — Set frame duration

Change how long a frame shows (ms).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `frame` | integer | ✓ |  |
| `duration_ms` | integer | ✓ |  |

## `palette_set_color` — Change palette color

Change one palette entry; every pixel using that index changes color.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `index` | integer | ✓ |  |
| `color` | string | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `recolor` — Recolor

Replace one color with another on one or all layers. Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `from` | string \| integer | ✓ | Color as "#rrggbb" / "#rrggbbaa", a palette index, or "transparent" |
| `to` | string \| integer | ✓ | Color as "#rrggbb" / "#rrggbbaa", a palette index, or "transparent" |
| `layer` | string |  | Only this layer (default all) |
| `tolerance` | number |  | OKLab distance to also catch similar shades (e.g. 0.05) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `apply_palette` — Apply palette

Map the artwork onto a palette preset (pico8, sweetie16, db16, gameboy, grayscale4, bw) or a list of colors, optionally with ordered dithering. Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `palette` | string \| string[] | ✓ |  |
| `dither` | boolean |  |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `reduce_colors` — Reduce colors

Reduce the artwork to at most n colors (perceptual k-means). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `n` | integer | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `add_outline` — Add outline

Draw a 1px outline around the visible sprite (outer) or along its inner edge. Written into the given layer (default top). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `color` | string \| integer | ✓ | Color as "#rrggbb" / "#rrggbbaa", a palette index, or "transparent" |
| `mode` | "outer" \| "inner" |  |  (mặc định `"outer"`) |
| `diagonal` | boolean |  | Also outline diagonally (thicker look) |
| `layer` | string |  | Layer id or name (default depends on the tool) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `remove_background` — Remove background

Clear the flat background color connected to the canvas edges. Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `layer` | string |  | Only this layer (default all) |
| `tolerance` | number |  |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `resize_canvas` — Resize canvas

Change canvas size without scaling the art (crop or pad around an anchor). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `width` | integer | ✓ |  |
| `height` | integer | ✓ |  |
| `anchor` | "center" \| "top-left" \| "top" \| "top-right" \| "left" \| "right" \| "bottom-left" \| "bottom" \| "bottom-right" |  |  (mặc định `"center"`) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `scale` — Scale artwork

Nearest-neighbor scale the whole artwork (integer factor or exact size). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `factor` | number |  |  |
| `width` | integer |  |  |
| `height` | integer |  |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `flip` — Flip

Mirror horizontally or vertically (one layer or all). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `axis` | "horizontal" \| "vertical" | ✓ |  |
| `layer` | string |  | Layer id or name (default depends on the tool) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `rotate90` — Rotate 90°

Rotate the whole canvas 90° clockwise or counter-clockwise. Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `direction` | "cw" \| "ccw" |  |  (mặc định `"cw"`) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `crop_to_content` — Crop to content

Trim empty borders (optionally keep padding). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `padding` | integer |  |  (mặc định `0`) |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `shift_hue` — Shift hue

Rotate the hue of all palette colors (or selected indices). Deterministic, instant and free (no AI).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `degrees` | number | ✓ |  |
| `indices` | integer[] |  |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `photo_to_pixel` — Photo → pixel art

Convert a local image (photo, drawing, screenshot) into pixel art without AI: resize, reduce colors, clean specks. Creates a new art or adds a layer to the active one. Free.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `path` | string | ✓ | Absolute path, or a file name inside DATA_DIR/inbox |
| `width` | integer | ✓ |  |
| `height` | integer |  | Default keeps the aspect ratio |
| `colors` | integer |  |  (mặc định `16`) |
| `palette` | string \| string[] |  | Force a preset or color list |
| `remove_background` | boolean |  |  (mặc định `false`) |
| `as_new_project` | boolean |  |  (mặc định `true`) |
| `name` | string |  |  |
| `purpose` | "game" \| "print" \| "digital" \| "craft" |  | Purpose of a new art (default: the workspace default, else digital) |
| `art` | string |  | Target art when as_new_project is false |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `generate_image` — Generate pixel art (AI)

Generate pixel-art variants for the active art's canvas size. Results are cleaned to a true pixel grid and palette and stored as a PROPOSAL (canvas unchanged until accept_variant). quality "free" uses free providers (Cloudflare free tier / local GPU / mock). quality "high" uses Retro Diffusion (paid): the first call returns a price, ask the user, then call again with confirm_cost: true.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `prompt` | string | ✓ | Subject and style, in English for best results |
| `palette` | string \| string[] |  | "auto" (default), "doc" = current palette, a preset name, or colors |
| `max_colors` | integer |  |  (mặc định `16`) |
| `variants` | integer |  |  (mặc định `4`) |
| `quality` | "free" \| "high" |  |  (mặc định `"free"`) |
| `provider` | "cloudflare" \| "retrodiffusion" \| "local-sd" \| "mock" |  | Force a provider (normally chosen automatically) |
| `confirm_cost` | boolean |  | Required true for paid providers, after the user approved the quoted price |
| `seed` | integer |  |  |

_có thể tốn tiền_

## `edit_image` — Edit with AI

Change the current artwork from an instruction ("give him a red cape"), optionally only inside a rectangle. Output is cleaned and stored as a PROPOSAL; accept_variant adds it as a new layer. Prefer the free deterministic tools (recolor, add_outline, draw_pixels…) when they can do the job. quality "free" uses free providers (Cloudflare free tier / local GPU / mock). quality "high" uses Retro Diffusion (paid): the first call returns a price, ask the user, then call again with confirm_cost: true.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `instruction` | string | ✓ |  |
| `region` | object |  | Only change this rectangle (pixels outside stay untouched) |
| `keep_palette` | boolean |  | Snap the result to the current palette (mặc định `true`) |
| `strength` | number |  |  (mặc định `0.6`) |
| `variants` | integer |  |  (mặc định `2`) |
| `quality` | "free" \| "high" |  |  (mặc định `"free"`) |
| `provider` | "cloudflare" \| "retrodiffusion" \| "local-sd" \| "mock" |  | Force a provider (normally chosen automatically) |
| `confirm_cost` | boolean |  | Required true for paid providers, after the user approved the quoted price |
| `frame` | integer |  |  (mặc định `0`) |

_có thể tốn tiền_

## `animate` — Animate with AI

Generate an animation (walk cycle, idle, attack…) at the canvas size. Stored as a PROPOSAL; accept_variant adds the frames on a new layer. Needs a provider that can animate (quality "high" = Retro Diffusion, or provider "mock" for testing). quality "free" uses free providers (Cloudflare free tier / local GPU / mock). quality "high" uses Retro Diffusion (paid): the first call returns a price, ask the user, then call again with confirm_cost: true.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `prompt` | string | ✓ | What the character looks like |
| `action` | string | ✓ | e.g. "walking", "idle", "attack" |
| `frames` | integer |  |  (mặc định `4`) |
| `direction` | string |  |  |
| `variants` | integer |  |  (mặc định `1`) |
| `quality` | "free" \| "high" |  |  (mặc định `"free"`) |
| `provider` | "cloudflare" \| "retrodiffusion" \| "local-sd" \| "mock" |  | Force a provider (normally chosen automatically) |
| `confirm_cost` | boolean |  | Required true for paid providers, after the user approved the quoted price |

_có thể tốn tiền_

## `accept_variant` — Accept AI variant

Put a proposal variant onto the canvas as a NEW layer (never overwrites existing pixels). Animation proposals fill frames on that layer, adding frames if needed.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `proposal` | string | ✓ |  |
| `variant` | integer | ✓ |  |
| `layer_name` | string |  |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `discard_proposal` — Discard proposal

Mark an AI proposal as discarded (files are kept for reference).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `proposal` | string | ✓ |  |

## `proposal_list` — List proposals

List AI proposals of an art (open ones first).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `status` | "open" \| "accepted" \| "discarded" |  |  |

_chỉ đọc_

## `history` — History

List recent versions (newest first) with who changed what.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `limit` | integer |  |  (mặc định `15`) |

_chỉ đọc_

## `undo` — Undo

Go back one step. Creates a new version with the previous content; history is never lost (call again to keep going back).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `restore_version` — Restore version

Bring back any earlier version (as a new version on top).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `version` | string | ✓ |  |
| `preview` | integer |  | Size (px, longest side) of the preview image returned; 0 = no image. Default 256. |

## `export_presets` — Export presets

List export presets and their options, grouped by purpose (game, print, digital, craft).

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `purpose` | "game" \| "print" \| "digital" \| "craft" |  |  |

_chỉ đọc_

## `export` — Export files

Write production-ready files to the art exports/ folder: sprite sheets + JSON, GIF, 300-DPI print PNG, SVG, PDF, avatars, WebP stickers, bead patterns. When the art belongs to a workspace with an export folder, the files are also copied there. Returns absolute file paths.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |
| `preset` | string | ✓ | One of: game-png, game-spritesheet, game-gif, print-png, print-svg, print-pdf, social-avatar, social-emoji, social-sticker, social-anim, craft-beads |
| `options` | object |  |  |
| `name` | string |  | Base file name (default: art id) |

## `open_in_editor` — Open in Aseprite

Show the art in Aseprite for hand drawing. Changes made there sync back automatically (with the Squarel extension) or when the file is saved.

| Tham số | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `art` | string |  | Art id in this project. Defaults to the art opened with art_open / art_create. |

## `usage_today` — Image API usage

Spend on image providers today / this month, Cloudflare free neurons left, daily cap, configured providers.

_chỉ đọc_

## Preset xuất file

| id | Mục đích | Mô tả | Tuỳ chọn |
|---|---|---|---|
| `game-png` | game | PNG (transparent), one file per frame | `scale`=1 |
| `game-spritesheet` | game | Sprite sheet PNG + Aseprite-style JSON (array) | `scale`=1, `columns` |
| `game-gif` | game | Animated GIF | `scale`=4 |
| `print-png` | print | Print PNG (nearest-neighbor upscale, DPI embedded) | `widthMm`=300, `dpi`=300, `frame`=0 |
| `print-svg` | print | SVG vector (crisp at any size) | `widthMm`, `frame`=0 |
| `print-pdf` | print | Vector PDF sized for print | `widthMm`=200, `marginMm`=10, `frame`=0 |
| `social-avatar` | digital | Square avatar PNG | `size`=512, `frame`=0 |
| `social-emoji` | digital | Emoji PNG 128×128 | `size`=128, `frame`=0 |
| `social-sticker` | digital | Sticker WebP 512×512 | `size`=512, `frame`=0 |
| `social-anim` | digital | Animated GIF for chat/social | `scale`=8 |
| `craft-beads` | craft | Fuse-bead pattern PDF + CSV (Perler/Hama), split into pegboards | `brand`="perler", `boardSize`=29, `frame`=0 |
