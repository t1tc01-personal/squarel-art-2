# Security policy

## Supported versions

Only the latest release receives security fixes.

| Version | Supported |
|---|---|
| 0.4.x (latest) | Yes |
| < 0.4 | No |

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability** ([direct link](https://github.com/t1tc01-personal/squarel-art-2/security/advisories/new)). Include:

- what is affected (MCP server, bridge, Aseprite extension, launcher, release workflow);
- steps to reproduce, or a proof of concept;
- the impact you expect;
- the version or commit you tested.

You can expect an acknowledgement within 7 days and a status update at least every 14 days until the issue is resolved. Fixes are released as a new version and credited in the advisory unless you prefer to stay anonymous.

## Scope

In scope:

- **The bridge** (`ws://127.0.0.1:4321/bridge`): it must only accept local, non-browser clients (no `http(s)://`, `file://` or `null` origins).
- **The launcher**: command execution, path validation, IPC between the renderer and the main process, update handling, and secret masking in the UI and logs.
- **Secret handling**: API keys in `.env` must never be logged or shown unmasked.
- **The release workflow** and published installers.

Out of scope:

- Attacks that require an attacker who already runs code as your user on your machine.
- Vulnerabilities in third-party services (Cloudflare, Retro Diffusion, GitHub) or in Aseprite itself; please report those to their vendors.
- The installer not being code-signed (a known limitation, see [docs/release.md](docs/release.md)).
