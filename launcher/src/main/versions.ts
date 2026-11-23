import { tmpdir } from 'node:os'
import type { Deps } from './deps'

function parts(v: string): number[] {
  // Strip leading "v", then any "-suffix" (e.g. "-dev") which counts as the base release.
  const core = v.trim().replace(/^v/i, '').split(/[-+]/)[0] ?? ''
  return core.split('.').map((p) => {
    const n = Number.parseInt(p, 10)
    return Number.isFinite(n) ? n : 0
  })
}

/** Numeric dotted compare ("1.3.18.6" < "1.3.19"); leading "v" ignored; "-dev" suffix equals the base. */
export function compareVersions(a: string, b: string): number {
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0)
    if (d) return d < 0 ? -1 : 1
  }
  return 0
}

export function satisfiesMin(version: string, min: string): boolean {
  return compareVersions(version, min) >= 0
}

export type Latest =
  | { ok: true; version: string }
  | { ok: false; reason: 'offline' | 'rate-limited' | 'not-found' | 'error'; message: string }

const OFFLINE_CODES = /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH/

/**
 * Newest stable tag (/^v?\d+(\.\d+)+$/) of a git remote via `git ls-remote --tags --refs`.
 * Returns the tag without a leading "v" (e.g. "1.3.19").
 */
export async function latestGitTag(repo: string, deps: Pick<Deps, 'run'>): Promise<Latest> {
  const lines: string[] = []
  let code: number
  try {
    ;({ code } = await deps.run({
      argv: ['git', 'ls-remote', '--tags', '--refs', repo],
      cwd: tmpdir(),
      onLine: (l) => lines.push(l),
    }))
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e as Error)?.message ?? e) }
  }
  if (code !== 0) {
    const out = lines.join('\n')
    if (/Could not resolve host/i.test(out)) return { ok: false, reason: 'offline', message: out.trim() }
    return { ok: false, reason: 'error', message: `git ls-remote exited with ${code}: ${out.trim()}` }
  }
  const tags = lines
    .map((l) => l.split('\t')[1]?.replace('refs/tags/', '').trim())
    .filter((t): t is string => !!t && /^v?\d+(\.\d+)+$/.test(t))
    .map((t) => t.replace(/^v/, ''))
  if (tags.length === 0) return { ok: false, reason: 'not-found', message: `no stable tags in ${repo}` }
  tags.sort(compareVersions)
  return { ok: true, version: tags[tags.length - 1] as string }
}

/** GET /repos/{o}/{r}/releases/latest; returns tag_name minus a leading "v". */
export async function latestGithubRelease(ownerRepo: string, deps: Pick<Deps, 'fetch'>): Promise<Latest> {
  let res: Response
  try {
    res = await deps.fetch(`https://api.github.com/repos/${ownerRepo}/releases/latest`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'squarel-art-launcher' },
      signal: AbortSignal.timeout(15_000),
    })
  } catch (e) {
    const err = e as Error & { cause?: { code?: string } }
    const text = `${err?.name ?? ''} ${err?.message ?? ''} ${err?.cause?.code ?? ''}`.trim()
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    // fetch rejects with TypeError for any network-level failure.
    if (timeout || OFFLINE_CODES.test(text) || err instanceof TypeError)
      return { ok: false, reason: 'offline', message: text }
    return { ok: false, reason: 'error', message: text }
  }
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0'))
    return { ok: false, reason: 'rate-limited', message: `GitHub rate limit (HTTP ${res.status})` }
  if (res.status === 404) return { ok: false, reason: 'not-found', message: `${ownerRepo}: no release` }
  if (!res.ok) return { ok: false, reason: 'error', message: `HTTP ${res.status}` }
  try {
    const body = (await res.json()) as { tag_name?: unknown }
    if (typeof body.tag_name !== 'string' || !/^v?\d+(\.\d+)+/.test(body.tag_name))
      return { ok: false, reason: 'error', message: 'unexpected release payload' }
    return { ok: true, version: body.tag_name.replace(/^v/, '') }
  } catch (e) {
    return { ok: false, reason: 'error', message: String((e as Error).message) }
  }
}
