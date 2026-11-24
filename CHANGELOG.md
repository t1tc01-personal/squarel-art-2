# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.4.4] - 2026-11-24

### Changed

- README: the Squarel Art logo heads every language version (`docs/images/logo.svg`).
- Launcher: once Aseprite is installed, its rows and pages show Aseprite's own logo, read from the install folder (`data/icons/ase64.png`). Squarel does not ship the logo; without a readable file the old icon stays. Integration manifests can do the same with the new optional `installedIcon` field.

## [0.4.3] - 2026-11-24

### Fixed

- Launcher: "Art gần đây" on Home shows each art's own `thumb.png` instead of a fixed example sprite. The example sprite is only shown for art that has no thumbnail yet.

## [0.4.2] - 2026-11-24

### Fixed

- Launcher: the Squarel row no longer offers "Cập nhật" when Squarel already matches the launcher. Squarel only moves to the launcher's own tag, so the button did nothing and still reported success. The row now says "Cập nhật launcher trước", and the task text explains it.
- Launcher: a launcher update found by the update check shows on the launcher row right away ("Đang tải bản mới") while it downloads, not only once the download has finished.

## [0.4.1] - 2026-11-24

### Fixed

- Cloudflare Workers AI: `generate_image` no longer sends `seed` to `flux-1-schnell`, whose input schema rejects it ("Additional or unevaluated properties '/seed' … not allowed"). Every free generation failed with that error. Variants from this model are random and report no seed.

## [0.4.0] - 2026-11-24

### Changed (breaking)

- **Art lives in the project folder.** Each art is now `<project folder>/squarel_art/<art id>/`, with the same layout as before (`project.json`, `versions/`, `proposals/`, `exports/`, `work.aseprite`, `thumb.png`). Squarel creates `squarel_art/` on the first write, together with a `.gitignore` that tracks `project.json` and `versions/` and ignores proposals, exports, the Aseprite work file and thumbnails. Git is a backup only: keep one writer per art. `DATA_DIR` keeps only logs, `usage.jsonl`, session files, `inbox/` and the project registry. The old `DATA_DIR/projects` is now read-only legacy art.
- **A project is required for art tools.** Art can only be created, edited or exported while Claude (or the CLI) runs inside a project folder. Outside one, art tools fail with instructions to create a project in the launcher (Dự án → Dự án mới) and open Claude in its folder. Tools that do not touch art (`usage_today`, `export_presets`) and `art_list { legacy: true }` still work.
- **Tools renamed** to match the interface wording (Dự án = project, Art = art):

  | Old | New |
  |---|---|
  | `project_list` | `art_list` (art of the current project; `legacy: true` lists old art waiting to move) |
  | `project_create` | `art_create` |
  | `project_open` | `art_open` |
  | `project_info` | `art_info` |
  | `workspace_info` | `project_info` (describes the Dự án) |
  | `workspace_add_art` | `art_import` `{ slug }` (moves one legacy art into the current project) |

  `project_list { all: true }` is gone: `art_list` shows the current project's art only.
- **The `project` parameter is now `art`** on every tool that took an art slug. The old name is not accepted.
- **Bridge protocol 2 and Aseprite extension 0.4.0.** Messages carry `ref` = `<project id>/<art id>` instead of `slug`, and one bridge serves art from many project folders. An extension that does not declare protocol 2 is refused with `extension-outdated`. Update the extension (launcher Health offers the button), restart Aseprite, and reopen any sprite you had linked with the old extension from the Squarel menu, because its link was a slug.
- Art that is still in `DATA_DIR/projects` cannot be opened in Aseprite until it is moved into a project.

### Added

- `art_import` tool and an equivalent CLI command: moves a legacy art, with its history, into the current project. It copies to a temporary folder, verifies file count, size and `head`, renames into `squarel_art/<id>` (adding `-2`, `-3` on a clash), drops the old `workspace` field, and only then deletes the source. Any failure removes the temporary folder and keeps the source.
- Launcher: the **Art cũ** card (it replaces the Unassigned card, Chưa phân loại) appears while `DATA_DIR/projects` still holds art. Each art has **Chuyển vào dự án…**, which runs the move as a task with progress.
- Launcher: art lists read from `<folder>/squarel_art`. "Project gần đây" on Home became "Art gần đây", and the Aseprite page picker became "Mở art…". Both gather art from every project, each with its project name, and open art by `ref`. Connections show the open art as `<project>/<art>`.
- Launcher: new projects get `squarel_art/` and its `.gitignore` (listed in "Launcher sẽ ghi"). Removing a project confirms that art stays in the folder's `squarel_art/`.
- Git worktree support: a session in a worktree of the project (for example `claude --worktree`) is the same project, and art is written to `squarel_art/` of the main checkout. Server instructions in a worktree say where the real art is.
- Duplicate project id guard: when two different folders (a copied folder or a second clone) declare the same id, the bridge refuses that id, MCP write tools are blocked and the instructions warn, and the launcher card shows a warning. Fix it by changing the id.
- Launcher: Settings of a project can change its id, and the registry is updated.
- Launcher Health checks that the Aseprite extension supports protocol 2, with an update button.
- **Dự án (workspaces):** a project groups many arts and is tied to a folder. Open Claude Code in that folder, or in any subfolder, and Squarel recognises the project on its own.
  - The folder holds `AGENTS.md`, which carries the project's brief for every coding agent. It also holds `CLAUDE.md` with an `@AGENTS.md` import, `.squarel/project.json` (defaults, repos, export folder) and `.squarel/arts.md`, an art catalog Squarel keeps up to date.
  - Squarel's MCP server describes the project in its instructions.
  - `art_list` shows the project's art.
  - `art_create` fills in the art's purpose, size and palette from the project.
  - `export` also copies files into the project's export folder.
  - Each art gets a `thumb.png`.
- Launcher:
  - A new **Dự án** page with a project list.
  - A **Dự án mới** form: folder, description, brief for AI, defaults, attached repos, export folder, and a preview of the files to be written.
  - A project page with Overview, Brief and Settings tabs (Tổng quan, Brief, Cài đặt).
  - **Mở Claude** opens a terminal in the project folder and adds outside repos with `--add-dir`.
  - Sessions in the connections panel show the project name.
  - The launcher never overwrites the user's own text in `AGENTS.md` or `CLAUDE.md`. Removing a project from the launcher keeps its files and art.

### Migration from 0.3.x

1. Update Squarel and the launcher to 0.4.0, then update the Aseprite extension (launcher Health, or reinstall the integration) and restart Aseprite.
2. Create a project for your art in the launcher (Dự án → Dự án mới), or use an existing one.
3. Move old art in. Either open the **Art cũ** card in the launcher and press **Chuyển vào dự án…** on each art, or open Claude in the project folder and ask it to run `art_import` with the art's slug (find slugs with `art_list { legacy: true }`).
4. Update anything of yours that calls the old tool names or the `project` parameter, using the table above.
5. Reopen sprites in Aseprite: in Aseprite use the Squarel menu **Open art…**, or in the launcher use the Aseprite page **Mở art…**.
6. Backups: art now lives in each project's `squarel_art/`, so back up the project folders (for example with git: `project.json` and `versions/` are tracked). `DATA_DIR` keeps only logs, usage and legacy art that has not been moved yet; it no longer needs to hold your backup of finished art.

### Fixed

- Launcher: Health checks that Squarel is not older than the launcher ("Squarel cùng phiên bản với launcher") and offers "Cập nhật Squarel". Before, a Squarel clone left on an older tag silently kept saving art in DATA_DIR, and the launcher showed none.
- When no AI provider is configured, `generate_image` and `animate` (and the skills) tell Claude to explain it and stop. Claude no longer writes its own pixel generator or pushes pixels through the CLI. It offers a Cloudflare token, `photo_to_pixel`, `draw_pixels` or Aseprite instead.
- CLI preview images go to `<temp>/squarel-cli/` instead of the current folder, so they no longer land in a project folder.
- Launcher: an open Claude session no longer shows "Rảnh" while Claude works outside Squarel. It now shows when Squarel was last called ("Đang mở · gọi Squarel 3 phút trước").
- Launcher: after a fix button (Đăng ký lại, Chép skill, …) succeeds, Health runs its checks again. Before, the row kept showing the old failure until you pressed "Chạy lại tất cả".
- Launcher: Health now checks that the `pixel-*` skills (`/pixel-new`, `/pixel-export`, …) are in `~/.claude/skills` and match the Squarel folder. When they are missing or outdated, a button copies them. Before, a setup that never reached step 4 left Claude Code without the skills, and no check reported it.
- Launcher: the "Claude Code thấy squarel" check runs `claude mcp list` outside the Squarel folder. That folder's own `.mcp.json` no longer stands in for the user-scope registration that Claude Code needs in other folders.

## [0.3.0] - 2026-11-24

### Added

- Project README in English, Vietnamese, Japanese, Simplified Chinese and Korean.
- `CONTRIBUTING.md`, `SECURITY.md`, issue and pull request templates.
- CI workflow that runs the Squarel and launcher checks on every push to `main` and every pull request.
- Launcher: progress card for building Aseprite. It shows the overall percent, the current step with its file counter and estimated time left, the duration of every step, the last output line, and the full log on demand. It has Huỷ (with confirmation) and Thử lại buttons. The card appears in setup step 3 and, in a compact form, in the integration page banner. Toasts for long tasks now include a progress bar and open the tool's page when clicked.
- `pnpm aseprite:build --json-progress` also reports the weighted overall percent, the compiled-file counter and the list of steps.

### Fixed

- Launcher: the Aseprite build progress no longer jumps back to about 0% when compiling starts. Before, it looked stuck or reset.

## [0.2.0] - 2026-11-24

### Added

- **Squarel Art Launcher**, a Windows desktop app (Electron):
  - 4-step first-run setup: install Git, Node.js and pnpm through `winget` in a visible window, get Squarel (fresh clone or an existing checkout), fill in `.env`, register the MCP server and skills with Claude Code;
  - connections panel showing Claude Code sessions, Aseprite, the bridge and AI services;
  - pages for Home, Library, each integration (built from its manifest), System (components, health checks, logs) and Settings;
  - updates for the launcher (GitHub Releases), Squarel (moves to the tag matching the launcher) and tools such as Aseprite;
  - tray icon, single instance, optional start with Windows, graceful shutdown of the bridge it owns.
- Integration manifests (`integrations/<id>/integration.json`) with a shared schema, so new tools can be added without launcher code changes.
- Bridge `status` message listing connected clients; MCP presence files for the launcher.
- `--json-progress` output for `pnpm aseprite:build`.
- Release workflow that builds the installer on a `v*` tag and uploads it to a draft GitHub Release.

### Changed

- License set to PolyForm Shield 1.0.0.
- `pnpm aseprite:build -- --install-deps` no longer installs Visual Studio Build Tools with `--passive`; the Visual Studio Installer window asks you to accept its terms.

### Security

- The bridge accepts only local, non-browser WebSocket clients.
- The launcher masks secrets in the UI and logs, validates every path and command it runs, and never installs anything without an explicit click.

## [0.1.0] - 2026-11-22

### Added

- MCP server with 41 pixel-art tools for Claude Code: drawing, deterministic edits, photo to pixel art, AI generation, editing and animation as proposals, version history with undo, exports.
- Pixel normalizer for AI images (grid detection, per-cell majority color, OKLab palette snapping, transparency).
- Image providers: Cloudflare Workers AI, Retro Diffusion (with price quotes and a daily budget), local Stable Diffusion, mock.
- Export presets: sprite sheets with JSON, GIF, 300 DPI print PNG, SVG, PDF, avatars, emoji, WebP stickers, Perler/Hama bead patterns.
- Aseprite extension with two-way live sync over a local WebSocket bridge, merge of concurrent edits, and a heartbeat for reconnects.
- `pnpm aseprite:build` to build Aseprite from source for personal use.
- CLI and Claude Code skills (`/pixel-new`, `/pixel-from-photo`, `/pixel-export`).

[Unreleased]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.4.4...HEAD
[0.4.4]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.4.3...v0.4.4
[0.4.3]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.4.2...v0.4.3
[0.4.2]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/t1tc01-personal/squarel-art-2/releases/tag/v0.2.0
[0.1.0]: https://github.com/t1tc01-personal/squarel-art-2/commits/main
