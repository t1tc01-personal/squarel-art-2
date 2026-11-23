# Contributing to Squarel Art

Thanks for taking the time to help. This guide covers how to set up the project, what a good change looks like, and the few rules that keep the repository safe to publish.

## Ways to help

- **Report a bug** with the [bug report form](https://github.com/t1tc01-personal/squarel-art-2/issues/new/choose). Include the steps, what you expected and what happened.
- **Suggest a feature** with the feature request form. Describe the problem first, then the idea.
- **Send a pull request.** For anything larger than a small fix, open an issue first so we can agree on the approach.
- **Security issues** go through [SECURITY.md](SECURITY.md), never through public issues.

## Development setup

Requirements: Node.js ≥ 22.18 (CI uses Node 24), pnpm 11, Git. The launcher is Windows-only.

```powershell
git clone https://github.com/t1tc01-personal/squarel-art-2.git
cd squarel-art-2
pnpm install
Copy-Item .env.example .env   # IMAGE_PROVIDER=mock works offline
pnpm check
```

Launcher:

```powershell
pnpm --dir launcher install    # approve the electron build script if pnpm asks
pnpm --dir launcher check
pnpm --dir launcher build
pnpm --dir launcher e2e
```

The end-to-end tests run Electron against a temporary profile and fake dependencies; they never touch your real `%APPDATA%`.

## Before you open a pull request

1. `pnpm check` passes (typecheck, Biome, Vitest). If you touched `launcher/`, `pnpm --dir launcher check` and the e2e tests pass too.
2. New behavior has tests. Bug fixes come with a test that failed before the fix.
3. User-facing changes are noted under **Unreleased** in [CHANGELOG.md](CHANGELOG.md).
4. Docs are updated when behavior changes. The detailed docs in `docs/` are written in Vietnamese; English is fine in a PR, and a maintainer can help translate.
5. Files use LF line endings (`.gitattributes` enforces this) and pass `pnpm format`.

### Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) with an optional scope:

```
feat(launcher): tray, single instance, autostart
fix(bridge): reconnect after the editor drops the socket
docs: explain the Cloudflare token scope
```

Common types: `feat`, `fix`, `docs`, `test`, `refactor`, `build`, `ci`, `chore`.

## Rules that keep the repository safe

This repository is public. Pull requests that break these rules cannot be merged:

- **No secrets or personal data.** Never commit `.env`, API keys, tokens, log files, personal email addresses or absolute paths from your machine. `test/repo-hygiene.test.ts` checks for the common cases.
- **No Aseprite binaries or sources.** `vendor/` holds a personal Aseprite build; the Aseprite EULA does not allow redistributing it.
- **Never accept terms on the user's behalf.** Install commands must not hide `--accept-package-agreements`, `--accept-source-agreements`, `--passive`, `--quiet` or `--silent`. The user answers license prompts in a visible window.
- **Every install needs an explicit click.** Nothing downloads or runs a file silently.
- **Secrets stay masked.** UI and logs show at most `••••` plus the last 4 characters, and only for values of 8 characters or more.
- **AI never overwrites artwork.** AI tools create proposals; only an accepted variant is added, as a new layer.

## License of contributions

Squarel Art is licensed under [PolyForm Shield 1.0.0](LICENSE.md). By submitting a contribution, you agree that it is provided under the same license and that you have the right to submit it.
