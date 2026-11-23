/**
 * Fake world for e2e runs (SQUAREL_LAUNCHER_FAKE=fixtures/<name>): main runs on createDeps('fake')
 * built from `test/<fixture>/fixture.json`, plus a fixed bridge state and launcher state. Only
 * index.ts enables it, and only in an unpackaged build together with the isolated test profile.
 *
 * Fixture paths use `{root}`, a virtual drive folder that exists only in the in-memory fs, so the
 * fixture never names a real path on anyone's machine.
 */
import { readFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { BridgeState } from './bridge/types'
import { createDeps, type Deps, type Fixtures } from './deps'
import type { LauncherState } from './state'

/** Accepted values of SQUAREL_LAUNCHER_FAKE. */
export const FAKE_FIXTURE = /^fixtures\/[a-z0-9-]{1,40}$/

const ROOT = 'Z:\\squarel-fixture'

interface FixtureFile {
  now: string
  state?: Partial<
    Pick<LauncherState, 'setupStep' | 'selected' | 'installChoice' | 'closeToTray' | 'autostart'>
  >
  /** `.env` of the fake Squarel folder (`{root}\squarel\.env`). */
  env?: Record<string, string>
  /** In-memory files; objects are stored as JSON. */
  files?: Record<string, string | object>
  /** In-memory files copied from the repo, source relative to the fixture folder (.png as binary). */
  copy?: Record<string, string>
  run?: Fixtures['run']
  alivePids?: number[]
  running?: string[]
  bridge: BridgeState
}

export interface FakeWorld {
  deps: Deps
  squarelDir: string
  state: Partial<LauncherState>
  bridge: BridgeState
}

const sub = (s: string) => s.split('{root}').join(ROOT)

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

  const files: Record<string, string> = {}
  for (const [k, v] of Object.entries(fx.files ?? {}))
    files[sub(k)] =
      typeof v === 'string' ? sub(v) : JSON.stringify(v, (_k, x) => (typeof x === 'string' ? sub(x) : x))
  for (const [k, src] of Object.entries(fx.copy ?? {})) {
    const full = resolve(dir, src)
    const repo = resolve(testDir, '..', '..')
    const rel = relative(repo, full)
    if (rel.startsWith(`..${sep}`) || rel === '..') throw new Error(`fixture copy outside the repo: ${src}`)
    files[sub(k)] = await readFile(full, /\.png$/i.test(full) ? 'latin1' : 'utf8')
  }
  if (fx.env)
    files[`${squarelDir}\\.env`] = Object.entries(fx.env)
      .map(([k, v]) => `${k}=${sub(v)}`)
      .join('\n')
      .concat('\n')

  const run: NonNullable<Fixtures['run']> = {}
  for (const [k, v] of Object.entries(fx.run ?? {})) run[sub(k)] = v

  const deps = createDeps('fake', {
    files,
    run,
    now: new Date(fx.now),
    alivePids: fx.alivePids,
    running: fx.running,
    platform: 'win32',
    env: { APPDATA: env.APPDATA, LOCALAPPDATA: env.LOCALAPPDATA },
  })
  return { deps, squarelDir, state: { ...fx.state, squarelDir }, bridge: fx.bridge }
}
