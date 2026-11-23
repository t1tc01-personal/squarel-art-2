/**
 * Fake world for e2e runs (SQUAREL_LAUNCHER_FAKE=fixtures/<name>): main runs on createDeps('fake')
 * built from `test/<fixture>/fixture.json`, plus a fixed bridge state and launcher state. Only
 * index.ts enables it, and only in an unpackaged build together with the isolated test profile.
 *
 * Fixture paths use `{root}`, a virtual drive folder that exists only in the in-memory fs, so the
 * fixture never names a real path on anyone's machine.
 */
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { BridgeState } from './bridge/types'
import type { CheckCtx } from './checks/runner'
import { createDeps, type Deps, type Fixtures } from './deps'
import { appPaths } from './paths'
import type { LauncherState } from './state'

/** Accepted values of SQUAREL_LAUNCHER_FAKE. */
export const FAKE_FIXTURE = /^fixtures\/[a-z0-9-]{1,40}$/

const ROOT = 'Z:\\squarel-fixture'

/** Files a fixture puts in the in-memory fs: objects are stored as JSON. */
type FileMap = Record<string, string | object>

interface FixtureFile {
  now: string
  /** false = no Squarel folder yet (first-run wizard); default true (`{root}\squarel`). */
  squarel?: boolean
  /** Result of the MCP smoke test (checks), instead of starting a real server. */
  smoke?: { tools: number; ms: number }
  state?: Partial<
    Pick<LauncherState, 'setupStep' | 'selected' | 'installChoice' | 'closeToTray' | 'autostart'>
  >
  /** `.env` of the fake Squarel folder (`{root}\squarel\.env`). */
  env?: Record<string, string>
  /** In-memory files; objects are stored as JSON. */
  files?: FileMap
  /** In-memory files copied from the repo, source relative to the fixture folder (.png as binary). */
  copy?: Record<string, string>
  /** Commands; `files` / `copy` (same format as above) are written when the command runs. */
  run?: Record<string, { code: number; lines?: string[]; files?: FileMap; copy?: Record<string, string> }>
  fetch?: Fixtures['fetch']
  alivePids?: number[]
  running?: string[]
  bridge: BridgeState
}

export interface FakeWorld {
  deps: Deps
  squarelDir: string
  state: Partial<LauncherState>
  bridge: BridgeState
  /** Fake home folder (skills are copied there, in memory). */
  homeDir: string
  smoke?: CheckCtx['smoke']
}

/** Copy sources may only come from the launcher's test fixtures or the repo's integrations folder. */
const COPY_ROOTS = (testDir: string) => [
  join(testDir, 'fixtures'),
  resolve(testDir, '..', '..', 'integrations'),
]

function within(root: string, full: string): boolean {
  const rel = relative(root, full)
  return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`)
}

/**
 * Placeholders: `{root}` (virtual fixture drive), `{install}` (the default install folder of the
 * isolated profile) and `{local}` (%LOCALAPPDATA%\SquarelArt of that profile).
 */
function substituter(env: NodeJS.ProcessEnv): (s: string) => string {
  let install = '{install}'
  let local = '{local}'
  try {
    install = appPaths(env).defaultInstall
    local = dirname(install)
  } catch {}
  return (s) => s.split('{root}').join(ROOT).split('{install}').join(install).split('{local}').join(local)
}

/**
 * @param testDir the launcher's `test` folder
 * @param name    SQUAREL_LAUNCHER_FAKE value, e.g. `fixtures/basic`
 * @param env     APPDATA / LOCALAPPDATA of the (isolated) profile
 */
export async function loadFakeWorld(
  testDir: string,
  name: string,
  env: NodeJS.ProcessEnv,
): Promise<FakeWorld> {
  if (!FAKE_FIXTURE.test(name)) throw new Error('SQUAREL_LAUNCHER_FAKE must look like fixtures/<name>')
  const dir = join(testDir, ...name.split('/'))
  const fx = JSON.parse(await readFile(join(dir, 'fixture.json'), 'utf8')) as FixtureFile
  const squarelDir = `${ROOT}\\squarel`
  const sub = substituter(env)

  async function fileMap(map: FileMap = {}, copy: Record<string, string> = {}) {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(map))
      out[sub(k)] =
        typeof v === 'string' ? sub(v) : JSON.stringify(v, (_k, x) => (typeof x === 'string' ? sub(x) : x))
    for (const [k, src] of Object.entries(copy)) {
      const full = resolve(dir, src)
      if (!COPY_ROOTS(testDir).some((root) => within(root, full)))
        throw new Error(`fixture copy must come from launcher/test/fixtures or integrations/: ${src}`)
      out[sub(k)] = await readFile(full, /\.png$/i.test(full) ? 'latin1' : 'utf8')
    }
    return out
  }
  const files = await fileMap(fx.files, fx.copy)
  if (fx.env)
    files[`${squarelDir}\\.env`] = Object.entries(fx.env)
      .map(([k, v]) => `${k}=${sub(v)}`)
      .join('\n')
      .concat('\n')

  const run: NonNullable<Fixtures['run']> = {}
  for (const [k, v] of Object.entries(fx.run ?? {})) {
    const { files: f, copy, ...rest } = v
    run[sub(k)] = { ...rest, ...(f || copy ? { files: await fileMap(f, copy) } : {}) }
  }

  const deps = createDeps('fake', {
    files,
    run,
    now: new Date(fx.now),
    alivePids: fx.alivePids,
    running: fx.running,
    fetch: fx.fetch,
    platform: 'win32',
    env: { APPDATA: env.APPDATA, LOCALAPPDATA: env.LOCALAPPDATA },
  })
  const smoke = fx.smoke
  return {
    deps,
    squarelDir,
    state: fx.squarel === false ? { ...fx.state } : { ...fx.state, squarelDir },
    bridge: fx.bridge,
    homeDir: `${ROOT}\\home`,
    ...(smoke ? { smoke: async () => ({ ok: true, ...smoke }) } : {}),
  }
}
