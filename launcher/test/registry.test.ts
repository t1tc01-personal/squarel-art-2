import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeps } from '../src/main/deps'
import { parseEnv } from '../src/main/env-store'
import { detectIntegration, loadRegistry, viewComponents } from '../src/main/registry/registry'
import type { LauncherState } from '../src/main/state'

const repoRoot = join(__dirname, '..', '..')
const fx = join(__dirname, 'fixtures', 'integrations')
const state: LauncherState = {
  schema: 1,
  setupStep: 'done',
  selected: [],
  installChoice: {},
  closeToTray: true,
  autostart: false,
}
const ctx = { launcherVersion: '0.2.0', isDev: false }
const selState: LauncherState = { ...state, selected: ['aseprite'] }
const read = (p: string) => readFile(p, 'utf8')
const asepriteManifest = () => read(join(repoRoot, 'integrations/aseprite/integration.json'))

async function loadFixtureRegistry(folder: string, id: string) {
  const d = createDeps('fake', {})
  await d.fs.writeFile(`/user/${id}/integration.json`, await read(join(fx, folder, 'integration.json')))
  return loadRegistry({ userIntegrationsDir: '/user', platform: 'win32' }, d)
}

describe('registry', () => {
  it('loads the real Squarel aseprite manifest and catalog', async () => {
    const reg = await loadRegistry(
      { squarelDir: repoRoot, userIntegrationsDir: join(repoRoot, 'does-not-exist'), platform: 'win32' },
      createDeps('real'),
    )
    expect(reg.problems).toEqual([])
    expect(reg.integrations.find((i) => i.manifest.id === 'aseprite')?.source).toBe('squarel')
    expect(reg.comingSoon.length).toBeGreaterThan(0)
    expect(reg.core.map((c) => c.id)).toEqual(
      expect.arrayContaining(['launcher', 'squarel', 'claude-code', 'node', 'pnpm', 'git']),
    )
  })

  it('user integration overrides a Squarel one with the same id and is reported', async () => {
    const d = createDeps('fake', {})
    await d.fs.writeFile('/sq/integrations/aseprite/integration.json', await asepriteManifest())
    await d.fs.writeFile(
      '/user/aseprite/integration.json',
      await read(join(fx, 'user-aseprite/integration.json')),
    )
    const reg = await loadRegistry({ squarelDir: '/sq', userIntegrationsDir: '/user', platform: 'win32' }, d)
    const hits = reg.integrations.filter((i) => i.manifest.id === 'aseprite')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.source).toBe('user')
    expect(hits[0]?.manifest.name).toBe('Aseprite (của tôi)')
    expect(reg.problems.some((p) => /aseprite/.test(p.error))).toBe(true)
  })

  it('schema 2 manifest is listed as incompatible, not loaded into the rail', async () => {
    const reg = await loadFixtureRegistry('future', 'future')
    expect(reg.integrations.find((i) => i.manifest.id === 'future')?.incompatible).toBe(
      'Cần launcher mới hơn',
    )
    const d = createDeps('fake', {})
    const v = (await viewComponents(reg, state, parseEnv(''), d, ctx)).find((c) => c.id === 'future')
    expect(v?.incompatible).toBe('Cần launcher mới hơn')
    expect(v?.actions).toEqual([])
    expect(reg.problems).toEqual([])
  })

  it('broken JSON goes to problems', async () => {
    const reg = await loadFixtureRegistry('broken', 'broken')
    expect(reg.integrations).toEqual([])
    expect(reg.problems).toHaveLength(1)
    expect(reg.problems[0]?.path).toContain('broken')
  })

  it('a bad catalog is a problem with empty comingSoon', async () => {
    const d = createDeps('fake', {
      files: { '/sq/integrations/catalog.json': '{"schema":1,"comingSoon":[{}]}' },
    })
    const reg = await loadRegistry({ squarelDir: '/sq', userIntegrationsDir: '/user', platform: 'win32' }, d)
    expect(reg.comingSoon).toEqual([])
    expect(reg.problems).toHaveLength(1)
  })

  it('detectIntegration prefers ASEPRITE_PATH from .env, then candidates with %ProgramFiles(x86)% expanded, parses "Aseprite 1.3.18.6-dev"', async () => {
    const base = { '/sq/integrations/aseprite/integration.json': await asepriteManifest() }
    const envPath = 'D:\\Tools\\Aseprite\\Aseprite.exe'
    const cand = 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Aseprite\\Aseprite.exe'
    const runFx = (exe: string) => ({
      [`${exe} -b --version`]: { code: 0, lines: ['Aseprite 1.3.18.6-dev'] },
    })
    const first = async (d: ReturnType<typeof createDeps>) => {
      const reg = await loadRegistry({ squarelDir: '/sq', userIntegrationsDir: '/u', platform: 'win32' }, d)
      return reg.integrations[0] as NonNullable<(typeof reg.integrations)[number]>
    }

    const d1 = createDeps('fake', {
      files: { ...base, [envPath]: 'x', [cand]: 'x' },
      run: { ...runFx(envPath), ...runFx(cand) },
      env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    })
    expect(await detectIntegration(await first(d1), parseEnv(`ASEPRITE_PATH=${envPath}\n`), d1)).toEqual({
      installed: true,
      version: '1.3.18.6-dev',
      path: envPath,
    })

    const d2 = createDeps('fake', {
      files: { ...base, [cand]: 'x' },
      run: runFx(cand),
      env: { 'programfiles(x86)': 'C:\\Program Files (x86)' },
    })
    expect(await detectIntegration(await first(d2), parseEnv(''), d2)).toMatchObject({
      installed: true,
      path: cand,
      version: '1.3.18.6-dev',
    })

    // unknown %VAR% leaves the candidate unmatched, no throw
    const d3 = createDeps('fake', { files: base, env: {} })
    expect((await detectIntegration(await first(d3), parseEnv(''), d3)).installed).toBe(false)

    // version run fails: installed, version undefined, with a note
    const d4 = createDeps('fake', {
      files: { ...base, [cand]: 'x' },
      env: { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    })
    const r4 = await detectIntegration(await first(d4), parseEnv(''), d4)
    expect(r4).toMatchObject({ installed: true, path: cand })
    expect(r4.version).toBeUndefined()
    expect(r4.note).toBeTruthy()
  })

  it('node 22.17 is installed but level=error with label "Cần Node ≥ 22.18"', async () => {
    const d = createDeps('fake', { run: { 'node --version': { code: 0, lines: ['v22.17.0'] } } })
    const reg = await loadRegistry({ userIntegrationsDir: '/u', platform: 'win32' }, d)
    const n = (await viewComponents(reg, state, parseEnv(''), d, ctx)).find((v) => v.id === 'node')
    expect(n).toMatchObject({
      installed: true,
      version: '22.17.0',
      level: 'error',
      levelLabel: 'Cần Node ≥ 22.18',
    })
  })

  it('viewComponents marks latest > installed as warn "Có bản mới", latest offline as idle "Không kiểm tra được"', async () => {
    const exe = 'C:\\Program Files\\Aseprite\\Aseprite.exe'
    const files = { '/sq/integrations/aseprite/integration.json': await asepriteManifest(), [exe]: 'x' }
    const baseRun = {
      [`${exe} -b --version`]: { code: 0, lines: ['Aseprite 1.3.18.6'] },
      'git --version': { code: 0, lines: ['git version 2.50.0.windows.1'] },
    }
    const env = { ProgramFiles: 'C:\\Program Files' }
    const tags = 'git ls-remote --tags --refs https://github.com/aseprite/aseprite.git'
    const view = async (d: ReturnType<typeof createDeps>, id: string) => {
      const reg = await loadRegistry({ squarelDir: '/sq', userIntegrationsDir: '/u', platform: 'win32' }, d)
      return (await viewComponents(reg, selState, parseEnv(''), d, ctx)).find((v) => v.id === id)
    }

    const a = await view(
      createDeps('fake', {
        files,
        env,
        run: { ...baseRun, [tags]: { code: 0, lines: ['abc\trefs/tags/v1.3.19'] } },
      }),
      'aseprite',
    )
    expect(a).toMatchObject({
      installed: true,
      version: '1.3.18.6',
      latest: '1.3.19',
      level: 'warn',
      levelLabel: 'Có bản mới',
    })
    expect(a?.actions.map((x) => x.kind)).toEqual(expect.arrayContaining(['launch', 'update']))

    const b = await view(
      createDeps('fake', {
        files,
        env,
        run: { ...baseRun, [tags]: { code: 128, lines: ['fatal: Could not resolve host: github.com'] } },
      }),
      'aseprite',
    )
    expect(b).toMatchObject({ level: 'idle', levelLabel: 'Không kiểm tra được' })
    expect(b?.latestError).toBeTruthy()

    const c = await view(
      createDeps('fake', {
        files,
        env,
        run: { ...baseRun, [tags]: { code: 0, lines: ['abc\trefs/tags/v1.3.18.6'] } },
      }),
      'aseprite',
    )
    expect(c).toMatchObject({ level: 'ok', levelLabel: 'Mới nhất' })

    const dNone = createDeps('fake', { files, env: {} })
    const e = await view(dNone, 'aseprite')
    expect(e).toMatchObject({ installed: false, level: 'idle', levelLabel: 'Chưa cài' })
    expect(e?.actions.some((x) => x.kind === 'install')).toBe(true)
    const g = await view(dNone, 'git')
    expect(g).toMatchObject({ installed: false, level: 'error', levelLabel: 'Chưa cài' })
    expect(g?.actions[0]?.needsConsent?.command).toContain('winget install')
  })
})

describe('registry hardening', () => {
  const exeOf = (extra: string) =>
    `{ "schema": 1, "id": "tool", "name": "T", "description": "d", "icon": "icon.png", "accent": "#112233", "platforms": ["win32"], ${extra}, "install": [], "launch": [{ "id": "open", "label": "Mở", "default": true, "run": ["{exe}"] }], "checks": [] }`
  const PNG = '\x89PNG\r\n\x1a\n'
  const setup = async (
    detect: string,
    files: Record<string, string> = {},
    run: Record<string, { code: number; lines?: string[] }> = {},
  ) => {
    const spy: string[] = []
    const d = createDeps('fake', {
      files: { '/sq/integrations/tool/integration.json': exeOf(`"detect": ${detect}`), ...files },
      run,
      env: { ProgramFiles: 'C:/Program Files' },
    })
    const realRun = d.run
    d.run = async (spec) => {
      spy.push(spec.argv.join(' '))
      return realRun(spec)
    }
    const reg = await loadRegistry({ squarelDir: '/sq', userIntegrationsDir: '/u', platform: 'win32' }, d)
    if (reg.problems.length) throw new Error(JSON.stringify(reg.problems))
    return { d, reg, spy }
  }
  const ver = ',"version": {"args": ["--version"], "pattern": "([0-9]+)"}'

  it('never executes an integration that is not selected', async () => {
    const exe = 'C:/Program Files/Tool/tool.exe'
    const { d, reg, spy } = await setup(
      `{"candidates": ["${exe}"]${ver}}`,
      { [exe]: 'x' },
      { [`${exe} --version`]: { code: 0, lines: ['1'] } },
    )
    const v = (await viewComponents(reg, state, parseEnv(''), d, ctx)).find((c) => c.id === 'tool')
    expect(v).toMatchObject({ installed: false, level: 'idle', levelLabel: 'Chưa chọn' })
    expect(spy.filter((a) => a.includes('tool'))).toEqual([])
    const v2 = (await viewComponents(reg, { ...state, selected: ['tool'] }, parseEnv(''), d, ctx)).find(
      (c) => c.id === 'tool',
    )
    expect(v2).toMatchObject({ installed: true, version: '1' })
    expect(spy.filter((a) => a.includes('tool'))).toEqual([`${exe} --version`])
  })

  it('rejects powershell, node, .cmd and relative paths: never executed', async () => {
    const bad = [
      'C:/Windows/System32/WindowsPowerShell/v1.0/PowerShell.exe',
      'C:/Program Files/nodejs/node.exe',
      'C:/Tools/tool.cmd',
      'tool.exe',
      './tool.exe',
    ]
    const files = Object.fromEntries(bad.map((b) => [b, 'x']))
    const cands = bad.map((b) => JSON.stringify(b)).join(',')
    const { d, reg, spy } = await setup(`{"candidates": [${cands}]${ver}}`, files)
    const r = await detectIntegration(reg.integrations[0] as never, parseEnv(''), d)
    expect(r.installed).toBe(false)
    expect(spy).toEqual([])
  })

  it('rejects secret and malformed detect.env names', async () => {
    const exe = 'C:/Secrets/x.exe'
    for (const name of ['CLOUDFLARE_API_TOKEN', 'retro_diffusion_api_key', 'BAD NAME']) {
      const { d, reg, spy } = await setup(`{"env": "${name}"}`, { [exe]: 'x' })
      const r = await detectIntegration(reg.integrations[0] as never, parseEnv(`${name}=${exe}\n`), d)
      expect(r.installed).toBe(false)
      expect(spy).toEqual([])
    }
  })

  it('integration icon becomes a data URL; core icons are names', async () => {
    const { d, reg } = await setup('{"candidates": ["C:/a.exe"]}', {
      '/sq/integrations/tool/icon.png': `${PNG}abc`,
    })
    const views = await viewComponents(reg, state, parseEnv(''), d, ctx)
    const t = views.find((c) => c.id === 'tool')
    expect(t?.iconKind).toBe('data')
    expect(t?.icon).toBe(`data:image/png;base64,${Buffer.from(`${PNG}abc`, 'latin1').toString('base64')}`)
    expect(views.find((c) => c.id === 'node')).toMatchObject({ iconKind: 'name', icon: 'box' })
  })

  it('icon falls back to box with a note when missing, not PNG, or too large', async () => {
    for (const files of <Record<string, string>[]>[
      {},
      { '/sq/integrations/tool/icon.png': 'not a png' },
      { '/sq/integrations/tool/icon.png': PNG + 'a'.repeat(70 * 1024) },
    ]) {
      const { d, reg } = await setup('{"candidates": ["C:/a.exe"]}', files)
      const t = (await viewComponents(reg, state, parseEnv(''), d, ctx)).find((c) => c.id === 'tool')
      expect(t).toMatchObject({ iconKind: 'name', icon: 'box' })
      expect(t?.note).toBeTruthy()
    }
  })

  it('incompatible stub with a traversal icon falls back to icon.png', async () => {
    const d = createDeps('fake', {
      files: {
        '/u/future/integration.json': JSON.stringify({
          schema: 2,
          id: 'future',
          name: 'F',
          icon: '..' + String.fromCharCode(92) + '..' + String.fromCharCode(92) + 'x.png',
        }),
      },
    })
    const reg = await loadRegistry({ userIntegrationsDir: '/u', platform: 'win32' }, d)
    expect(reg.integrations[0]?.manifest.icon).toBe('icon.png')
  })

  it('rejects a candidate whose realpath is a denylisted exe, and 8.3 names', async () => {
    const link = 'C:/Tools/harmless.exe'
    const short = 'C:/Windows/System32/POWERS~1.EXE'
    const { d, reg, spy } = await setup(`{"candidates": ["${link}", "${short}"]${ver}}`, {
      [link]: 'x',
      [short]: 'x',
    })
    d.fs.realpath = (async (p: unknown) =>
      String(p) === link ? 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' : String(p)) as never
    const r = await detectIntegration(reg.integrations[0] as never, parseEnv(''), d)
    expect(r.installed).toBe(false)
    expect(spy.filter((a) => a.includes('.exe') || a.includes('.EXE'))).toEqual([])
  })

  it('rejects UNC candidates before any filesystem call', async () => {
    const bs = String.fromCharCode(92)
    const cands = [
      `${bs}${bs}host${bs}share${bs}tool.exe`,
      `${bs}${bs}?${bs}UNC${bs}host${bs}share${bs}tool.exe`,
      '//host/share/tool.exe',
      `${bs}${bs}.${bs}C:${bs}tool.exe`,
    ]
    const { d, reg, spy } = await setup(`{"candidates": ${JSON.stringify(cands)}${ver}}`)
    const calls: string[] = []
    for (const k of ['stat', 'realpath', 'readFile'] as const) {
      const orig = d.fs[k] as (...a: unknown[]) => Promise<unknown>
      ;(d.fs as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => {
        calls.push(`${k}:${String(a[0])}`)
        return orig(...a)
      }
    }
    const r = await detectIntegration(reg.integrations[0] as never, parseEnv(''), d)
    expect(r.installed).toBe(false)
    expect(calls).toEqual([])
    expect(spy).toEqual([])
  })

  it('icon whose realpath escapes the integration dir falls back to box', async () => {
    const { d, reg } = await setup('{"candidates": ["C:/a.exe"]}', {
      '/sq/integrations/tool/icon.png': `${PNG}abc`,
      '/secret/x.png': `${PNG}zzz`,
    })
    d.fs.realpath = (async (p: unknown) =>
      String(p).endsWith('icon.png') ? '/secret/x.png' : String(p)) as never
    const t = (await viewComponents(reg, state, parseEnv(''), d, ctx)).find((c) => c.id === 'tool')
    expect(t).toMatchObject({ iconKind: 'name', icon: 'box' })
    expect(t?.note).toBeTruthy()
  })
})
