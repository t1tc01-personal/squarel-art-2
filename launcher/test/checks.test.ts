import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { BridgeState } from '../src/main/bridge/types'
import { type CheckCtx, runChecks, smokeTestMcp } from '../src/main/checks/runner'
import { createDeps, type Fixtures } from '../src/main/deps'
import { parseEnv } from '../src/main/env-store'
import type { Registry } from '../src/main/registry/registry'
import { regWithBuiltins, regWithManual } from './checks-fixtures'

const VERIFY = 'https://api.cloudflare.com/client/v4/user/tokens/verify'
const SQ = 'D:/sq'
const bridge: BridgeState = { mode: 'own', port: 4321, clients: [], since: '2026-01-01T00:00:00Z' }
const noReg: Registry = { core: [], integrations: [], comingSoon: [], problems: [] }
const noSmoke = async () => ({ ok: true, tools: 41, ms: 5 })

function ctx(over: Partial<Omit<CheckCtx, 'env'>> & { env?: string } = {}): CheckCtx {
  const { env, ...rest } = over
  return { dataDir: 'D:/data', env: parseEnv(env ?? ''), bridge, selected: [], smoke: noSmoke, ...rest }
}

function deps(fx: Fixtures = {}) {
  return createDeps('fake', { run: { 'claude --version': { code: 0, lines: ['2.1.0'] } }, ...fx })
}

interface R {
  result: string
  detail: string
  fix?: { id: string }
  label: string
  description: string
}
const find = (rs: { id: string }[], id: string) => rs.find((r) => r.id === id) as unknown as R

const verifyBody = (status: string) => ({
  status: 200,
  body: JSON.stringify({ success: true, result: { status } }),
})

describe('health checks', () => {
  it('token verify active → pass, inactive → fail with fix opening Settings', async () => {
    const env = 'CLOUDFLARE_API_TOKEN=cf-secret-token\n'
    const ok = await runChecks(noReg, ctx({ env }), deps({ fetch: { [VERIFY]: verifyBody('active') } }))
    const a = find(ok, 'cloudflare-token')
    expect(a.result).toBe('pass')
    expect(a.detail).toMatch(/^verify · \d+ ms$/)
    const bad = await runChecks(noReg, ctx({ env }), deps({ fetch: { [VERIFY]: verifyBody('expired') } }))
    const b = find(bad, 'cloudflare-token')
    expect(b.result).toBe('fail')
    expect(b.fix?.id).toBe('open-settings')
    expect(JSON.stringify([ok, bad])).not.toContain('cf-secret-token')
  })

  it('falls back to the account endpoint on 404', async () => {
    const acc = 'https://api.cloudflare.com/client/v4/accounts/abc123/tokens/verify'
    const rs = await runChecks(
      noReg,
      ctx({ env: 'CLOUDFLARE_API_TOKEN=t\nCLOUDFLARE_ACCOUNT_ID=abc123\n' }),
      deps({ fetch: { [VERIFY]: { status: 404, body: '{}' }, [acc]: verifyBody('active') } }),
    )
    expect(find(rs, 'cloudflare-token').result).toBe('pass')
  })

  it('retro diffusion without key is warn not fail and never calls the network', async () => {
    let calls = 0
    const d = deps()
    const orig = d.fetch
    d.fetch = ((...a: Parameters<typeof fetch>) => {
      calls++
      return orig(...a)
    }) as typeof fetch
    const rs = await runChecks(noReg, ctx(), d)
    expect(find(rs, 'retrodiffusion-key').result).toBe('warn')
    const withKey = await runChecks(noReg, ctx({ env: 'RETRO_DIFFUSION_API_KEY=rd-key-1234\n' }), d)
    expect(find(withKey, 'retrodiffusion-key').result).toBe('pass')
    expect(JSON.stringify(withKey)).not.toContain('rd-key-1234')
    expect(calls).toBe(0)
  })

  it('manual checks are skipped by runChecks', async () => {
    const reg = regWithManual()
    const rs = await runChecks(
      reg,
      ctx({ selected: ['demo'], squarelDir: SQ }),
      deps({ run: { 'echo auto': { code: 0 } } }),
    )
    expect(find(rs, 'integration:demo:auto').result).toBe('pass')
    expect(rs.some((r) => r.id === 'integration:demo:slow')).toBe(false)
    const unselected = await runChecks(reg, ctx({ squarelDir: SQ }), deps())
    expect(unselected.some((r) => r.id.startsWith('integration:demo'))).toBe(false)
  })

  it('a throwing check becomes a fail result, others still run', async () => {
    const d = deps()
    d.statfs = async () => {
      throw new Error('boom')
    }
    const rs = await runChecks(noReg, ctx(), d)
    const disk = find(rs, 'disk-space')
    expect(disk.result).toBe('fail')
    expect(disk.detail).toContain('boom')
    expect(find(rs, 'claude-installed').result).toBe('pass')
  })

  it('bridge-client and extension-version builtins', async () => {
    const reg = regWithBuiltins()
    const now = '2026-01-01T00:00:00Z'
    const files = {
      [`${SQ}/integrations/demo/ext/package.json`]: '{"version":"0.1.1"}',
      'C:/Roaming/Demo/package.json': '{"version":"0.1.0"}',
    }
    const rs = await runChecks(
      reg,
      ctx({
        selected: ['demo'],
        squarelDir: SQ,
        bridge: { ...bridge, clients: [{ name: 'demo', app: 'thu-sync', connectedAt: now, lastSeen: now }] },
      }),
      deps({ files, env: { APPDATA: 'C:/Roaming' } }),
    )
    expect(find(rs, 'integration:demo:connected').result).toBe('pass')
    const ext = find(rs, 'integration:demo:extension')
    expect(ext.result).toBe('warn')
    expect(ext.detail).toBe('0.1.0 ≠ 0.1.1')
    const rs2 = await runChecks(reg, ctx({ selected: ['demo'], squarelDir: SQ }), deps({ files }))
    expect(find(rs2, 'integration:demo:connected').result).toBe('warn')
  })

  it('claude-sees-squarel parses claude mcp list', async () => {
    const mk = (line: string) =>
      runChecks(noReg, ctx(), deps({ run: { 'claude mcp list': { code: 0, lines: [line] } } }))
    expect(find(await mk('squarel: node x - ✓ Connected'), 'claude-sees-squarel').result).toBe('pass')
    expect(find(await mk('squarel: node x - ✗ Failed'), 'claude-sees-squarel').result).toBe('fail')
  })

  it('every result has a Vietnamese label and description', async () => {
    const rs = await runChecks(noReg, ctx({ squarelDir: SQ }), deps())
    for (const r of rs) {
      expect(r.label.length).toBeGreaterThan(3)
      expect(r.description.length).toBeGreaterThan(3)
    }
  })
})

describe('smokeTestMcp', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  it('mcp smoke test against the real Squarel server lists ≥ 40 tools', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sq-smoke-'))
    dirs.push(dataDir)
    const r = await smokeTestMcp(resolve(__dirname, '..', '..'), createDeps('real'), { dataDir })
    expect(r.error).toBeUndefined()
    expect(r.ok).toBe(true)
    expect(r.tools).toBeGreaterThanOrEqual(40)
  }, 30_000)
})
