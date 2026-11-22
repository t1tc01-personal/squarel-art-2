import { describe, expect, it } from 'vitest'
import { createDeps } from '../src/main/deps'
import { compareVersions, latestGithubRelease, latestGitTag, satisfiesMin } from '../src/main/versions'

const LS = [
  'a1\trefs/tags/v1.3.9',
  'a2\trefs/tags/v1.3.18.6',
  'a3\trefs/tags/v1.3.19',
  'a4\trefs/tags/v1.3.20-beta1',
  'a5\trefs/tags/v1.3.19-rc1',
  'a6\trefs/tags/nightly',
]
const REPO = 'https://example.test/aseprite.git'
const GH = 'https://api.github.com/repos/o/r/releases/latest'

describe('versions', () => {
  it('compareVersions orders aseprite-style 4-part versions and strips v', () => {
    expect(compareVersions('1.3.18.6', '1.3.19')).toBeLessThan(0)
    expect(compareVersions('v1.3.19', '1.3.18.6')).toBeGreaterThan(0)
    expect(compareVersions('v1.3', '1.3.0')).toBe(0)
    expect(compareVersions('1.3.9', '1.3.10')).toBeLessThan(0)
    expect(compareVersions('1.3.19-dev', '1.3.19')).toBe(0)
  })

  it('satisfiesMin("v24.19.0","22.18") is true; "v22.17.1" is false', () => {
    expect(satisfiesMin('v24.19.0', '22.18')).toBe(true)
    expect(satisfiesMin('v22.17.1', '22.18')).toBe(false)
    expect(satisfiesMin('22.18.0', '22.18')).toBe(true)
  })

  it('latestGitTag picks newest stable tag from ls-remote output', async () => {
    const d = createDeps('fake', {
      run: { [`git ls-remote --tags --refs ${REPO}`]: { code: 0, lines: LS } },
    })
    expect(await latestGitTag(REPO, d)).toEqual({ ok: true, version: '1.3.19' })
  })

  it('latestGitTag maps unresolved host to offline', async () => {
    const d = createDeps('fake', {
      run: {
        [`git ls-remote --tags --refs ${REPO}`]: {
          code: 128,
          lines: ['fatal: unable to access: Could not resolve host: example.test'],
        },
      },
    })
    expect(await latestGitTag(REPO, d)).toMatchObject({ ok: false, reason: 'offline' })
  })

  it("network failure → { ok:false, reason:'offline' }", async () => {
    const d = createDeps('fake') // no fixture → fetch throws
    expect(await latestGithubRelease('o/r', d)).toMatchObject({ ok: false, reason: 'offline' })
  })

  it('latestGithubRelease reads tag_name', async () => {
    const d = createDeps('fake', { fetch: { [GH]: { status: 200, body: '{"tag_name":"v0.3.1"}' } } })
    expect(await latestGithubRelease('o/r', d)).toEqual({ ok: true, version: '0.3.1' })
  })

  it("HTTP 403 with x-ratelimit-remaining:0 → 'rate-limited'", async () => {
    const d = createDeps('fake', {
      fetch: { [GH]: { status: 403, headers: { 'x-ratelimit-remaining': '0' } } },
    })
    expect(await latestGithubRelease('o/r', d)).toMatchObject({ ok: false, reason: 'rate-limited' })
  })

  it("404 → 'not-found'", async () => {
    const d = createDeps('fake', { fetch: { [GH]: { status: 404 } } })
    expect(await latestGithubRelease('o/r', d)).toMatchObject({ ok: false, reason: 'not-found' })
  })

  it('other statuses → error', async () => {
    const d = createDeps('fake', { fetch: { [GH]: { status: 500 } } })
    expect(await latestGithubRelease('o/r', d)).toMatchObject({ ok: false, reason: 'error' })
  })
})
