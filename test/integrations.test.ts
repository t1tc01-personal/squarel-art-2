import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  Catalog,
  IntegrationManifest,
  type IntegrationManifestT,
  SUBST_VARS,
  substitute,
} from '../integrations/schema/integration.schema.ts'
import { decodePng } from '../src/core/png.ts'

const ROOT = join(import.meta.dirname, '..')
const INTEGRATIONS = join(ROOT, 'integrations')
const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'))

const manifestDirs = readdirSync(INTEGRATIONS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(INTEGRATIONS, d.name, 'integration.json')))
  .map((d) => d.name)

const aseprite = (): IntegrationManifestT => readJson(join(INTEGRATIONS, 'aseprite', 'integration.json'))

/** Smallest valid manifest; tests mutate copies of it. */
const minimal = (): any => ({
  schema: 1,
  id: 'tool',
  name: 'Tool',
  description: 'A tool.',
  icon: 'icon.png',
  accent: '#29ADFF',
  platforms: ['win32'],
  detect: { env: 'TOOL_PATH' },
  install: [{ id: 'existing', label: 'Have it', pickFile: 'tool.exe', setEnv: 'TOOL_PATH' }],
  launch: [{ id: 'open', label: 'Open', default: true, run: ['{exe}'] }],
  checks: [{ id: 'installed', label: 'Installed', builtin: 'detect' }],
})

const issues = (doc: unknown) => {
  const r = IntegrationManifest.safeParse(doc)
  return r.success ? [] : r.error.issues.map((i) => i.message)
}

describe('integration manifests', () => {
  it('finds at least the aseprite manifest', () => {
    expect(manifestDirs).toContain('aseprite')
  })

  it('every integrations/*/integration.json validates and its icon is a 16x16 PNG', () => {
    for (const dir of manifestDirs) {
      const doc = readJson(join(INTEGRATIONS, dir, 'integration.json'))
      const r = IntegrationManifest.safeParse(doc)
      expect(r.success, `${dir}: ${r.success ? '' : JSON.stringify(r.error.issues)}`).toBe(true)
      expect(doc.id).toBe(dir)
      const png = decodePng(readFileSync(join(INTEGRATIONS, dir, doc.icon)))
      expect([png.width, png.height]).toEqual([16, 16])
    }
  })

  it('aseprite manifest matches the spec example', () => {
    const m = aseprite()
    expect(m.accent).toBe('#FF77A8')
    expect(m.bridge).toEqual({ client: 'aseprite' })
    expect(m.launch.map((l) => l.id)).toEqual(['open', 'open-project', 'open-recent', 'open-plain', 'folder'])
    expect(m.checks.map((c) => c.id)).toEqual(['installed', 'connected', 'extension', 'roundtrip'])
    expect(m.launch.find((l) => l.id === 'open-plain')?.env).toEqual({ SQUAREL_NO_SYNC: '1' })
    expect(existsSync(join(ROOT, m.extension!.version.source))).toBe(true)
  })

  it('aseprite manifest matches the build/pack scripts that exist', () => {
    const scripts = Object.keys(readJson(join(ROOT, 'package.json')).scripts)
    const m = aseprite()
    const runs = [
      ...m.install.map((i) => i.run),
      m.update?.run,
      m.extension?.install.run,
      ...m.launch.map((l) => l.run),
      ...m.checks.map((c) => c.run),
    ].filter((r): r is string[] => !!r)
    const pnpmRuns = runs.filter((r) => r[0] === 'pnpm')
    expect(pnpmRuns.length).toBeGreaterThanOrEqual(4)
    for (const r of pnpmRuns) expect(scripts, r.join(' ')).toContain(r[1])
  })

  it('accepts the minimal manifest', () => {
    expect(issues(minimal())).toEqual([])
  })

  it('rejects unknown keys, duplicate ids, two defaults, launch with both run and bridgeTool', () => {
    expect(issues({ ...minimal(), extra: 1 })).not.toEqual([])
    const nestedExtra = minimal()
    nestedExtra.launch[0].shell = true
    expect(issues(nestedExtra)).not.toEqual([])

    for (const key of ['install', 'launch', 'checks'] as const) {
      const dup = minimal()
      dup[key].push({ ...dup[key][0], ...(key === 'launch' ? { default: false } : {}) })
      expect(issues(dup).join(' '), key).toMatch(/duplicate id/i)
    }

    const twoDefaults = minimal()
    twoDefaults.launch.push({ id: 'other', label: 'Other', default: true, reveal: '{exeDir}' })
    expect(issues(twoDefaults).join(' ')).toMatch(/default/i)
    const noDefault = minimal()
    noDefault.launch[0].default = false
    expect(issues(noDefault).join(' ')).toMatch(/default/i)

    const both = minimal()
    both.launch[0].bridgeTool = 'open_in_editor'
    expect(issues(both).join(' ')).toMatch(/exactly one of run \| bridgeTool \| reveal/)
    const none = minimal()
    delete none.launch[0].run
    expect(issues(none).join(' ')).toMatch(/exactly one of run \| bridgeTool \| reveal/)
  })

  it('rejects bad ids, accents, platforms, checks and substitution variables', () => {
    expect(issues({ ...minimal(), id: 'Tool' })).not.toEqual([])
    expect(issues({ ...minimal(), id: 'x' })).not.toEqual([])
    expect(issues({ ...minimal(), accent: 'pink' })).not.toEqual([])
    expect(issues({ ...minimal(), platforms: ['beos'] })).not.toEqual([])
    expect(issues({ ...minimal(), platforms: [] })).not.toEqual([])
    expect(issues({ ...minimal(), schema: 2 })).not.toEqual([])
    expect(issues({ ...minimal(), detect: {} })).not.toEqual([])

    const badBuiltin = minimal()
    badBuiltin.checks[0].builtin = 'magic'
    expect(issues(badBuiltin)).not.toEqual([])
    const emptyCheck = minimal()
    delete emptyCheck.checks[0].builtin
    expect(issues(emptyCheck)).not.toEqual([])
    const runCheck = minimal()
    runCheck.checks[0] = { id: 'test', label: 'Test', run: ['pnpm', 'test'], manual: true }
    expect(issues(runCheck)).toEqual([])

    const shellString = minimal()
    shellString.launch[0].run = '{exe} --foo'
    expect(issues(shellString)).not.toEqual([])
    const emptyRun = minimal()
    emptyRun.launch[0].run = []
    expect(issues(emptyRun)).not.toEqual([])

    const unknownVar = minimal()
    unknownVar.launch[0].run = ['{exe}', '{home}']
    expect(issues(unknownVar).join(' ')).toMatch(/\{home\}/)
    const unknownVarLabel = minimal()
    unknownVarLabel.launch[0].label = 'Open {user}'
    expect(issues(unknownVarLabel).join(' ')).toMatch(/\{user\}/)
  })
})

describe('substitute', () => {
  it('lists exactly the fixed variables', () => {
    expect([...SUBST_VARS]).toEqual(['toolsDir', 'exe', 'exeDir', 'version', 'recentProject'])
  })

  it('substitute fills known vars, rejects unknown {foo} and missing values', () => {
    expect(substitute('{exe}', { exe: 'C:\\A\\a.exe' })).toBe('C:\\A\\a.exe')
    expect(substitute('--src={toolsDir}/{version}', { toolsDir: 'D:\\t', version: 'v1.3' })).toBe(
      '--src=D:\\t/v1.3',
    )
    expect(substitute('Mở {recentProject}', { recentProject: 'cat' })).toBe('Mở cat')
    expect(substitute('plain -b', {})).toBe('plain -b')
    // replacement values are inserted literally, never re-expanded
    expect(substitute('{exe}', { exe: '{version}$&' })).toBe('{version}$&')
    expect(() => substitute('{foo}', {})).toThrow(/\{foo\}/)
    expect(() => substitute('{exe}', {})).toThrow(/exe/)
  })
})

describe('catalog', () => {
  it('catalog.json validates and contains libresprite, pixelorama, godot, export-folder', () => {
    const doc = readJson(join(INTEGRATIONS, 'catalog.json'))
    const r = Catalog.safeParse(doc)
    expect(r.success, r.success ? '' : JSON.stringify(r.error.issues)).toBe(true)
    expect(doc.comingSoon.map((c: { id: string }) => c.id)).toEqual([
      'libresprite',
      'pixelorama',
      'godot',
      'export-folder',
    ])
    expect(doc.comingSoon.map((c: { accent: string }) => c.accent)).toEqual([
      '#29ADFF',
      '#00E436',
      '#FFA300',
      '#C2C3C7',
    ])
    for (const c of doc.comingSoon) expect(c.status, c.id).toBe('coming-soon')
    // coming-soon entries must not collide with a real integration
    for (const c of doc.comingSoon) expect(manifestDirs).not.toContain(c.id)
  })

  it('rejects unknown keys, duplicate ids and entries without status coming-soon', () => {
    const entry = {
      id: 'tool',
      name: 'Tool',
      description: 'x',
      icon: 'T',
      accent: '#000000',
      status: 'coming-soon',
    }
    expect(Catalog.safeParse({ schema: 1, comingSoon: [entry] }).success).toBe(true)
    expect(Catalog.safeParse({ schema: 1, comingSoon: [entry], x: 1 }).success).toBe(false)
    expect(Catalog.safeParse({ schema: 1, comingSoon: [{ ...entry, x: 1 }] }).success).toBe(false)
    expect(Catalog.safeParse({ schema: 1, comingSoon: [entry, entry] }).success).toBe(false)
    const { status: _status, ...noStatus } = entry
    expect(Catalog.safeParse({ schema: 1, comingSoon: [noStatus] }).success).toBe(false)
    expect(Catalog.safeParse({ schema: 1, comingSoon: [{ ...entry, status: 'available' }] }).success).toBe(
      false,
    )
  })
})
