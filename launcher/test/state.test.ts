import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appPaths } from '../src/main/paths'
import { type LauncherState, loadState, saveState } from '../src/main/state'

const dirs: string[] = []
const tmp = async (name: string) => {
  const d = await mkdtemp(join(tmpdir(), `${name}-`))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const DEFAULTS: LauncherState = {
  schema: 1,
  setupStep: 1,
  selected: [],
  installChoice: {},
  closeToTray: true,
  autostart: false,
}

describe('state', () => {
  it('state in a profile with Vietnamese/space characters loads and saves', async () => {
    const root = await tmp('Nguyễn Văn A')
    const p = appPaths({ APPDATA: join(root, 'Roaming x'), LOCALAPPDATA: join(root, 'Local x') })
    expect(await loadState(p.stateFile)).toEqual(DEFAULTS)
    const s: LauncherState = {
      ...DEFAULTS,
      squarelDir: join(root, 'Dự án'),
      mode: 'clone',
      setupStep: 'done',
      selected: ['aseprite'],
      installChoice: { aseprite: 'build' },
      autostart: true,
      theme: 'system',
    }
    await saveState(p.stateFile, s)
    expect(await loadState(p.stateFile)).toEqual(s)
    expect((await readdir(dirname(p.stateFile))).filter((f) => f.endsWith('.tmp'))).toEqual([])
    await saveState(p.stateFile, { ...s, setupStep: 3 })
    expect((await loadState(p.stateFile)).setupStep).toBe(3)
  })

  it('corrupt state.json falls back to defaults', async () => {
    const root = await tmp('state')
    const f = join(root, 'state.json')
    for (const bad of ['{not json', '', '[]', 'null', '{"schema":2}']) {
      await writeFile(f, bad)
      expect(await loadState(f)).toEqual(DEFAULTS)
    }
    await writeFile(f, '{"schema":1,"setupStep":9,"selected":"x","closeToTray":"no"}')
    expect(await loadState(f)).toEqual(DEFAULTS)
    await writeFile(f, '{"schema":1,"setupStep":1,"theme":"neon"}')
    expect((await loadState(f)).theme).toBeUndefined()
    expect(JSON.parse(await readFile(f, 'utf8')).schema).toBe(1)
  })
})

describe('appPaths', () => {
  it('joins APPDATA/LOCALAPPDATA without touching the filesystem', () => {
    const p = appPaths({ APPDATA: join('x', 'R'), LOCALAPPDATA: join('x', 'L') })
    expect(p.stateFile).toBe(join('x', 'R', 'SquarelArt Launcher', 'state.json'))
    expect(p.userIntegrations).toBe(join('x', 'R', 'SquarelArt Launcher', 'integrations'))
    expect(p.defaultInstall).toBe(join('x', 'L', 'SquarelArt', 'app'))
    expect(p.toolsDir('aseprite')).toBe(join('x', 'L', 'SquarelArt', 'tools', 'aseprite'))
  })

  it('throws a clear error when the variables are missing', () => {
    expect(() => appPaths({ LOCALAPPDATA: 'x' })).toThrow(/APPDATA/)
    expect(() => appPaths({ APPDATA: 'x' })).toThrow(/LOCALAPPDATA/)
  })
})
