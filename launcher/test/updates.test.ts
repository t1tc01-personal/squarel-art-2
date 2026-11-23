import { join } from 'node:path'
import type { IntegrationManifestT } from '@squarel/integration-schema'
import { describe, expect, it } from 'vitest'
import { createDeps, type Deps, type Fixtures } from '../src/main/deps'
import type { LoadedIntegration, Registry } from '../src/main/registry/registry'
import { createLauncherUpdater } from '../src/main/updates/launcher'
import { applySquarelUpdate, planSquarelUpdate } from '../src/main/updates/squarel'
import { applyToolUpdate } from '../src/main/updates/tools'
import type { TaskEvent } from '../src/shared/model'

const SQ = join('D:', 'sq')
const TOOLS = join('D:', 'tools', 'aseprite')

const PREFIX = 'git rev-parse --show-prefix'
const GITPATH = 'git rev-parse --git-path squarel-update-pending'
const FOREACH = 'git for-each-ref --contains HEAD --format=%(refname)'
const MARKER = join(SQ, '.git', 'squarel-update-pending')
const STATUS = 'git status --porcelain --untracked-files=no'
const HEAD = 'git rev-parse --abbrev-ref HEAD'
const DESCRIBE = 'git describe --tags --exact-match HEAD'

function repo(extra: Fixtures['run'] = {}): Fixtures['run'] {
  return {
    [PREFIX]: { code: 0, lines: [''] },
    [GITPATH]: { code: 0, lines: ['.git/squarel-update-pending'] },
    [FOREACH]: { code: 0, lines: ['refs/heads/main'] },
    [STATUS]: { code: 0, lines: [] },
    [HEAD]: { code: 0, lines: ['HEAD'] },
    [DESCRIBE]: { code: 0, lines: ['v0.1.0'] },
    ...extra,
  }
}

/** Fake deps that also record every command (argv + cwd) in order. */
function recording(fx: Fixtures): { d: Deps; calls: { cmd: string; cwd: string }[] } {
  const d = createDeps('fake', fx)
  const calls: { cmd: string; cwd: string }[] = []
  const run = d.run
  d.run = async (spec) => {
    calls.push({ cmd: spec.argv.join(' '), cwd: spec.cwd })
    return run(spec)
  }
  return { d, calls }
}

function manifest(over: Partial<IntegrationManifestT> = {}): IntegrationManifestT {
  return {
    schema: 1,
    id: 'aseprite',
    name: 'Aseprite',
    description: 'x',
    icon: 'icon.png',
    accent: '#FF77A8',
    platforms: ['win32'],
    detect: { candidates: ['C:\\A\\Aseprite.exe'] },
    install: [],
    update: {
      run: ['pnpm', 'aseprite:build', '--', '--src', '{toolsDir}', '--ref', '{version}'],
      requiresClosed: 'aseprite.exe',
    },
    extension: {
      version: { source: 'integrations/aseprite/squarel/package.json', installed: 'x' },
      install: { run: ['pnpm', 'aseprite:pack', '--', '--install'], requiresClosed: 'aseprite.exe' },
    },
    launch: [{ id: 'open', label: 'Mở', default: true, run: ['{exe}'] }],
    checks: [],
    ...over,
  }
}

const aseprite: LoadedIntegration = {
  manifest: manifest(),
  dir: join(SQ, 'integrations', 'aseprite'),
  source: 'squarel',
}
const other: LoadedIntegration = {
  manifest: manifest({
    id: 'other',
    extension: {
      version: { source: 'a', installed: 'b' },
      install: { run: ['pnpm', 'other:pack'] },
    },
  }),
  dir: join(SQ, 'integrations', 'other'),
  source: 'squarel',
}
const reg: Registry = { core: [], integrations: [aseprite, other], comingSoon: [], problems: [] }

describe('planSquarelUpdate', () => {
  it("tag checkout targets the launcher's own version", async () => {
    // A newer tag exists upstream, but the target is the launcher's version, never newer.
    const { d } = recording({ run: repo() })
    expect(await planSquarelUpdate(SQ, '0.2.0', d)).toEqual({ kind: 'tag', from: '0.1.0', to: '0.2.0' })
  })

  it('already on the launcher tag → none', async () => {
    const { d } = recording({ run: repo({ [DESCRIBE]: { code: 0, lines: ['v0.2.0'] } }) })
    expect(await planSquarelUpdate(SQ, '0.2.0', d)).toEqual({ kind: 'none' })
  })

  it('detached HEAD without a tag plans a tag checkout without from', async () => {
    const { d } = recording({ run: repo({ [DESCRIBE]: { code: 128, lines: ['fatal: no tag'] } }) })
    expect(await planSquarelUpdate(SQ, '0.2.0', d)).toEqual({ kind: 'tag', to: '0.2.0' })
  })

  it('branch checkout plans a fast-forward pull', async () => {
    const { d } = recording({ run: repo({ [HEAD]: { code: 0, lines: ['main'] } }) })
    expect(await planSquarelUpdate(SQ, '0.2.0', d)).toEqual({ kind: 'branch', branch: 'main' })
  })

  it('dirty tree blocks with a readable message', async () => {
    const { d } = recording({ run: repo({ [STATUS]: { code: 0, lines: [' M src/version.ts'] } }) })
    const plan = await planSquarelUpdate(SQ, '0.2.0', d)
    expect(plan.kind).toBe('blocked')
    if (plan.kind !== 'blocked') throw new Error('unreachable')
    expect(plan.reason).toBe('dirty')
    expect(plan.message).toMatch(/chưa commit/)
  })

  it('a folder that is not the repo root is not-a-repo', async () => {
    const notRepo = recording({
      run: repo({ [PREFIX]: { code: 128, lines: ['fatal: not a git repository'] } }),
    })
    expect(await planSquarelUpdate(SQ, '0.2.0', notRepo.d)).toMatchObject({
      kind: 'blocked',
      reason: 'not-a-repo',
    })
    // Squarel installed inside some other repo must never move that repo.
    const nested = recording({ run: repo({ [PREFIX]: { code: 0, lines: ['sub/'] } }) })
    expect(await planSquarelUpdate(SQ, '0.2.0', nested.d)).toMatchObject({
      kind: 'blocked',
      reason: 'not-a-repo',
    })
  })

  it('detached HEAD on commits no ref contains is blocked', async () => {
    const { d, calls } = recording({
      run: repo({ [DESCRIBE]: { code: 128 }, [FOREACH]: { code: 0, lines: [] } }),
    })
    const plan = await planSquarelUpdate(SQ, '0.2.0', d)
    expect(plan).toMatchObject({ kind: 'blocked', reason: 'orphan-commits' })
    if (plan.kind !== 'blocked') throw new Error('unreachable')
    expect(plan.message).toMatch(/HEAD có commit chưa thuộc nhánh nào/)
    expect(calls.map((c) => c.cmd)).not.toContain(STATUS)
  })

  it('dev launcher never moves the repo', async () => {
    const { d, calls } = recording({ run: repo() })
    expect(await planSquarelUpdate(SQ, '0.2.0', d, { isDev: true })).toEqual({ kind: 'none' })
    expect(calls).toEqual([])
  })

  it('rejects a launcher version that is not a release tag', async () => {
    const { d } = recording({ run: repo() })
    await expect(planSquarelUpdate(SQ, '0.2.0 --force', d)).rejects.toThrow()
    await expect(planSquarelUpdate(SQ, '--upload-pack=x', d)).rejects.toThrow()
  })
})

describe('applySquarelUpdate', () => {
  it('apply runs fetch, checkout, install, extension reinstall in order and streams TaskEvents', async () => {
    const { d, calls } = recording({
      run: repo({
        'git fetch --tags --force': { code: 0, lines: ['From github.com:x'] },
        'git checkout --detach refs/tags/v0.2.0': { code: 0 },
        'pnpm install': { code: 0, lines: ['Done'] },
        'pnpm aseprite:pack -- --install': { code: 0, lines: ['installed'] },
        'pnpm other:pack': { code: 0 },
      }),
    })
    const events: TaskEvent[] = []
    await applySquarelUpdate(
      { kind: 'tag', from: '0.1.0', to: '0.2.0' },
      { squarelDir: SQ, reg, selected: ['aseprite'], onEvent: (e) => events.push(e) },
      d,
    )
    expect(calls.map((c) => c.cmd)).toEqual([
      STATUS,
      GITPATH,
      'git fetch --tags --force',
      'git checkout --detach refs/tags/v0.2.0',
      'pnpm install',
      'pnpm aseprite:pack -- --install',
    ])
    expect(calls.every((c) => c.cwd === SQ)).toBe(true)
    const texts = events.filter((e) => e.kind === 'line').map((e) => e.text)
    expect(texts).toContain('From github.com:x')
    expect(texts).toContain('installed')
    expect(events.some((e) => e.kind === 'progress')).toBe(true)
    expect(events.at(-1)).toMatchObject({ kind: 'done', code: 0 })
    expect(new Set(events.map((e) => e.taskId)).size).toBe(1)
  })

  it('branch plan runs pull --ff-only, then install', async () => {
    const { d, calls } = recording({
      run: repo({ 'git pull --ff-only': { code: 0 }, 'pnpm install': { code: 0 } }),
    })
    const events: TaskEvent[] = []
    await applySquarelUpdate(
      { kind: 'branch', branch: 'main' },
      { squarelDir: SQ, reg, selected: [], onEvent: (e) => events.push(e) },
      d,
    )
    expect(calls.map((c) => c.cmd)).toEqual([STATUS, GITPATH, 'git pull --ff-only', 'pnpm install'])
    expect(events.at(-1)).toMatchObject({ kind: 'done', code: 0 })
  })

  it('a failing step stops the update and emits an error', async () => {
    const { d, calls } = recording({
      run: repo({
        'git fetch --tags --force': { code: 0 },
        'git checkout --detach refs/tags/v0.2.0': { code: 1 },
      }),
    })
    const events: TaskEvent[] = []
    await applySquarelUpdate(
      { kind: 'tag', to: '0.2.0' },
      { squarelDir: SQ, reg, selected: ['aseprite'], onEvent: (e) => events.push(e) },
      d,
    )
    expect(calls.map((c) => c.cmd)).not.toContain('pnpm install')
    expect(events.at(-1)).toMatchObject({ kind: 'error', code: 1 })
  })

  it('re-checks for uncommitted changes before touching the repo', async () => {
    const { d, calls } = recording({ run: repo({ [STATUS]: { code: 0, lines: ['M x'] } }) })
    const events: TaskEvent[] = []
    await applySquarelUpdate(
      { kind: 'tag', to: '0.2.0' },
      { squarelDir: SQ, reg, selected: [], onEvent: (e) => events.push(e) },
      d,
    )
    expect(calls.map((c) => c.cmd)).toEqual([STATUS])
    expect(events.at(-1)?.kind).toBe('error')
  })

  it('skips an extension reinstall while its tool is running, and says so', async () => {
    const { d, calls } = recording({
      running: ['Aseprite.exe'],
      run: repo({
        'git fetch --tags --force': { code: 0 },
        'git checkout --detach refs/tags/v0.2.0': { code: 0 },
        'pnpm install': { code: 0 },
      }),
    })
    const events: TaskEvent[] = []
    await applySquarelUpdate(
      { kind: 'tag', to: '0.2.0' },
      { squarelDir: SQ, reg, selected: ['aseprite'], onEvent: (e) => events.push(e) },
      d,
    )
    expect(calls.map((c) => c.cmd)).not.toContain('pnpm aseprite:pack -- --install')
    expect(events.some((e) => e.kind === 'line' && /Đóng aseprite\.exe trước/.test(e.text ?? ''))).toBe(true)
    expect(events.at(-1)?.kind).toBe('done')
  })

  it('none and blocked plans run nothing', async () => {
    const { d, calls } = recording({ run: repo() })
    const events: TaskEvent[] = []
    const ctx = { squarelDir: SQ, reg, selected: [], onEvent: (e: TaskEvent) => events.push(e) }
    await applySquarelUpdate({ kind: 'none' }, ctx, d)
    await applySquarelUpdate({ kind: 'blocked', reason: 'dirty', message: 'bẩn' }, ctx, d)
    expect(calls).toEqual([])
    expect(events.map((e) => e.kind)).toEqual(['done', 'error'])
  })
})

describe('retry after a failed apply', () => {
  it('install failure after checkout is planned again and finishes on retry', async () => {
    const run = repo({
      'git fetch --tags --force': { code: 0 },
      'git checkout --detach refs/tags/v0.2.0': { code: 0 },
      'pnpm install': { code: 1, lines: ['ERR_PNPM_FETCH'] },
      'pnpm aseprite:pack -- --install': { code: 0 },
    }) as NonNullable<Fixtures['run']>
    const { d } = recording({ run })
    const events: TaskEvent[] = []
    const ctx = { squarelDir: SQ, reg, selected: ['aseprite'], onEvent: (e: TaskEvent) => events.push(e) }

    const first = await planSquarelUpdate(SQ, '0.2.0', d)
    await applySquarelUpdate(first, ctx, d)
    const err = events.at(-1)
    expect(err).toMatchObject({ kind: 'error', code: 1 })
    expect(err?.text).toMatch(/v0\.2\.0/)
    expect(err?.text).toMatch(/Cập nhật lần nữa/)
    await expect(d.fs.stat(MARKER)).resolves.toBeTruthy()

    // The checkout moved HEAD onto the target tag.
    run[DESCRIBE] = { code: 0, lines: ['v0.2.0'] }
    const again = await planSquarelUpdate(SQ, '0.2.0', d)
    expect(again).toEqual({ kind: 'tag', from: '0.2.0', to: '0.2.0' })

    run['pnpm install'] = { code: 0 }
    events.length = 0
    await applySquarelUpdate(again, ctx, d)
    expect(events.at(-1)).toMatchObject({ kind: 'done', code: 0 })
    await expect(d.fs.stat(MARKER)).rejects.toThrow()
    expect(await planSquarelUpdate(SQ, '0.2.0', d)).toEqual({ kind: 'none' })
  })

  it('a failed fetch does not claim the code moved, and masks credentials in streamed lines', async () => {
    const { d } = recording({
      run: repo({
        'git fetch --tags --force': {
          code: 128,
          lines: ["fatal: unable to access 'https://user:ghp_SECRET123@example.com/o/r.git/'"],
        },
      }),
    })
    const events: TaskEvent[] = []
    await applySquarelUpdate(
      { kind: 'tag', to: '0.2.0' },
      { squarelDir: SQ, reg, selected: [], onEvent: (e) => events.push(e) },
      d,
    )
    const all = events.map((e) => e.text ?? '').join(' | ')
    expect(all).not.toContain('ghp_SECRET123')
    expect(all).toContain('https://***@example.com')
    expect(events.at(-1)?.kind).toBe('error')
    expect(events.at(-1)?.text).not.toMatch(/Cập nhật lần nữa/)
  })
})

describe('applyToolUpdate', () => {
  const ctx = (events: TaskEvent[]) => ({
    squarelDir: SQ,
    toolsDir: TOOLS,
    selected: ['aseprite'],
    onEvent: (e: TaskEvent) => events.push(e),
  })

  it('tool update blocked while aseprite.exe runs', async () => {
    const { d, calls } = recording({ running: ['ASEPRITE.EXE'] })
    const events: TaskEvent[] = []
    expect(await applyToolUpdate(aseprite, 'v1.3.19', ctx(events), d)).toEqual({
      blocked: 'Đóng aseprite.exe trước',
    })
    expect(calls).toEqual([])
  })

  it('runs the manifest update command with substituted variables from the Squarel folder', async () => {
    const cmd = `pnpm aseprite:build -- --src ${TOOLS} --ref v1.3.19`
    const { d, calls } = recording({ run: { [cmd]: { code: 0, lines: ['built'] } } })
    const events: TaskEvent[] = []
    expect(await applyToolUpdate(aseprite, 'v1.3.19', ctx(events), d)).toEqual({})
    expect(calls).toEqual([{ cmd, cwd: SQ }])
    expect(events.some((e) => e.text === 'built')).toBe(true)
    expect(events.at(-1)).toMatchObject({ kind: 'done', code: 0 })
  })

  it('refuses unselected integrations, missing update commands and flag-like versions', async () => {
    const { d, calls } = recording({})
    const events: TaskEvent[] = []
    expect(
      (await applyToolUpdate(aseprite, '1.3.19', { ...ctx(events), selected: [] }, d)).blocked,
    ).toBeTruthy()
    const noUpdate = { ...aseprite, manifest: manifest({ update: undefined }) }
    expect((await applyToolUpdate(noUpdate, '1.3.19', ctx(events), d)).blocked).toBeTruthy()
    expect((await applyToolUpdate(aseprite, '--upload-pack=x', ctx(events), d)).blocked).toBeTruthy()
    expect(calls).toEqual([])
  })

  it('a failed update with requiresClosed hints to close the tool', async () => {
    const cmd = `pnpm aseprite:build -- --src ${TOOLS} --ref v1.3.19`
    const { d } = recording({ run: { [cmd]: { code: 2 } } })
    const events: TaskEvent[] = []
    await applyToolUpdate(aseprite, 'v1.3.19', ctx(events), d)
    expect(events.at(-1)).toMatchObject({ kind: 'error', code: 2 })
    expect(events.at(-1)?.text).toMatch(/Đóng aseprite\.exe trước/)
  })

  it('user integrations run from their own folder', async () => {
    const dir = join('D:', 'user', 'integrations', 'aseprite')
    const user: LoadedIntegration = { ...aseprite, dir, source: 'user' }
    const cmd = `pnpm aseprite:build -- --src ${TOOLS} --ref 1.3.19`
    const { d, calls } = recording({ run: { [cmd]: { code: 0 } } })
    await applyToolUpdate(user, '1.3.19', ctx([]), d)
    expect(calls).toEqual([{ cmd, cwd: dir }])
  })
})

describe('createLauncherUpdater', () => {
  it('offline check returns Latest{ok:false} and does not throw', async () => {
    const u = createLauncherUpdater({
      checkForUpdates: async () => {
        throw new Error('net::ERR_INTERNET_DISCONNECTED')
      },
      quitAndInstall() {},
    })
    expect(await u.check()).toMatchObject({ ok: false, reason: 'offline' })
  })

  it('reports the latest version and installs through the adapter only once it is downloaded', async () => {
    let installed = 0
    let downloaded: ((version: string) => void) | undefined
    const readyCalls: string[] = []
    const u = createLauncherUpdater(
      {
        checkForUpdates: async () => ({ version: 'v0.3.0' }),
        quitAndInstall: () => void installed++,
        onDownloaded: (cb) => {
          downloaded = cb
        },
      },
      (v) => void readyCalls.push(v),
    )
    expect(await u.check()).toEqual({ ok: true, version: '0.3.0' })
    expect(u.ready()).toBeUndefined()
    expect(u.install()).toBe(false)
    expect(installed).toBe(0)
    downloaded?.('v0.3.0')
    expect(u.ready()).toBe('0.3.0')
    expect(u.install()).toBe(true)
    expect(installed).toBe(1)
    // A malformed version from the feed never becomes installable.
    downloaded?.('--evil')
    downloaded?.('0.3.0')
    expect(u.ready()).toBe('0.3.0')
    expect(readyCalls).toEqual(['0.3.0'])
  })

  it('no update info (e.g. unpacked dev build) is not-found; error text is cut to one short line', async () => {
    expect(
      await createLauncherUpdater({ checkForUpdates: async () => null, quitAndInstall() {} }).check(),
    ).toMatchObject({ ok: false, reason: 'not-found' })
    const r = await createLauncherUpdater({
      checkForUpdates: async () => {
        throw new Error(`HttpError: 500\nHeaders: {"authorization":"token-should-not-leak"}`)
      },
      quitAndInstall() {},
    }).check()
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.message).not.toContain('token-should-not-leak')
  })
})
