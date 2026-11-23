# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Dự án (workspaces):** a project groups many arts and is tied to a folder. Open Claude Code in that folder, or in any subfolder, and Squarel recognises the project on its own.
  - The folder holds `AGENTS.md`, which carries the project's brief for every coding agent. It also holds `CLAUDE.md` with an `@AGENTS.md` import, `.squarel/project.json` (defaults, repos, export folder) and `.squarel/arts.md`, an art catalog Squarel keeps up to date.
  - Squarel's MCP server describes the project in its instructions.
  - `project_list` shows only the project's art; pass `all: true` to see everything.
  - `project_create` fills in the project's purpose, size and palette.
  - New tools `workspace_info` and `workspace_add_art`.
  - `export` also copies files into the project's export folder.
  - Each art gets a `thumb.png`.
- Launcher:
  - A new **Dự án** page with a project list and an Unassigned card (Chưa phân loại).
  - A **Dự án mới** form: folder, description, brief for AI, defaults, attached repos, export folder, and a preview of the files to be written.
  - A project page with Overview, Brief and Settings tabs (Tổng quan, Brief, Cài đặt).
  - **Mở Claude** opens a terminal in the project folder and adds outside repos with `--add-dir`.
  - Sessions in the connections panel show the project name.
  - The launcher never overwrites the user's own text in `AGENTS.md` or `CLAUDE.md`. Removing a project from the launcher keeps its files and art.

### Fixed

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

[Unreleased]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/t1tc01-personal/squarel-art-2/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/t1tc01-personal/squarel-art-2/releases/tag/v0.2.0
[0.1.0]: https://github.com/t1tc01-personal/squarel-art-2/commits/main
