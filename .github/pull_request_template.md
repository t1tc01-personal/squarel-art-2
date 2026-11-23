## What and why

<!-- What does this change, and what problem does it solve? Link the issue: Closes #… -->

## How it was tested

<!-- Commands you ran, screenshots for UI changes. -->

## Checklist

- [ ] `pnpm check` passes
- [ ] If `launcher/` changed: `pnpm --dir launcher check` and `pnpm --dir launcher e2e` pass
- [ ] Tests added or updated (bug fixes include a test that failed before the fix)
- [ ] `CHANGELOG.md` updated under **Unreleased** for user-facing changes
- [ ] Docs updated if behavior changed
- [ ] No secrets, `.env`, logs, `vendor/` files, personal emails or local paths
- [ ] No install command accepts terms on the user's behalf (`--accept-*`, `--passive`, `--quiet`, `--silent`)
