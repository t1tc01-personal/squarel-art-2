import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { type ActionCtx, resolveAction } from '../src/main/actions'
import { createDeps, type DetachedSpec, type Fixtures } from '../src/main/deps'
import { parseEnv } from '../src/main/env-store'
import { CORE } from '../src/main/registry/core'
import type { Registry } from '../src/main/registry/registry'
import {
  CLAUDE_INSTALL_COMMAND,
  checkCloneTarget,
  cloneArgv,
  hasWinget,
  installPlan,
  nextSetupStep,
  OFFICIAL_DOWNLOADS,
  SQUAREL_REPO,
  setupFacts,
  terminalArgv,
  wingetTerminalArgv,
} from '../src/main/setup'
import type { LauncherState } from '../src/main/state'
import type { ActionRef, ComponentView, TaskEvent } from '../src/shared/model'

const state = (over: Partial<LauncherState> = {}): LauncherState => ({
  schema: 1,
  setupStep: 1,
  selected: [],
  installChoice: {},
  closeToTray: true,
  autostart: false,
  ...over,
})

function view(id: string, over: Partial<ComponentView> = {}): ComponentView {
  return {
    id,
    name: id,
    description: '',
    kind: 'core',
    icon: 'box',
    iconKind: 'name',
    required: true,
    installed: true,
    level: 'ok',
    levelLabel: 'Đã cài',
    actions: [],
    ...over,
  }
}

const missing = (id: string) => view(id, { installed: false, level: 'error', levelLabel: 'Chưa cài' })

describe('nextSetupStep', () => {
  it('nextSetupStep resumes at the saved step', () => {
    const facts = { squarelOk: true, requiredMissing: [] }
    for (const step of [1, 2, 3, 4] as const)
      expect(nextSetupStep(state({ setupStep: step, mode: 'clone', squarelDir: 'D:\\sq' }), facts)).toBe(step)
    expect(nextSetupStep(state({ setupStep: 'done', squarelDir: 'D:\\sq' }), facts)).toBe('done')
    // Step 2 is where the fresh-mode clone happens, so a missing Squarel there is normal.
    expect(
      nextSetupStep(state({ setupStep: 2, mode: 'fresh' }), { squarelOk: false, requiredMissing: ['git'] }),
    ).toBe(2)
  })

  it('missing required component sends a done setup back to step 2', () => {
    const s = state({ setupStep: 'done', squarelDir: 'D:\\sq', mode: 'clone' })
    expect(nextSetupStep(s, { squarelOk: true, requiredMissing: ['node'] })).toBe(2)
    // Steps 3 and 4 need every required component too.
    expect(nextSetupStep({ ...s, setupStep: 4 }, { squarelOk: true, requiredMissing: ['claude-code'] })).toBe(
      2,
    )
    // Squarel itself gone: choose the folder again.
    expect(nextSetupStep(s, { squarelOk: false, requiredMissing: [] })).toBe(1)
    // No install mode chosen yet: start at the welcome step.
    expect(nextSetupStep(state({ setupStep: 3 }), { squarelOk: false, requiredMissing: [] })).toBe(1)
  })

  it('setupFacts lists missing or too-old required tools and missing node_modules', () => {
    const views = [
      view('launcher'),
      view('squarel'),
      view('git'),
      view('node', { level: 'error', levelLabel: 'Cần Node ≥ 22.18' }),
      missing('pnpm'),
      view('claude-code'),
      view('vs-build-tools', { required: false, installed: false, level: 'idle' }),
    ]
    expect(setupFacts(views, true)).toEqual({ squarelOk: true, requiredMissing: ['node', 'pnpm'] })
    expect(setupFacts(views, false).requiredMissing).toContain('squarel-deps')
    expect(setupFacts([missing('squarel')], false)).toEqual({ squarelOk: false, requiredMissing: [] })
  })
})

describe('installPlan', () => {
  const allMissing = [
    view('squarel'),
    missing('git'),
    missing('node'),
    missing('pnpm'),
    missing('claude-code'),
  ]

  it('no winget → install plan uses terminal actions with official links, never a silent download', () => {
    const plan = installPlan(allMissing, false)
    expect(plan.length).toBeGreaterThan(0)
    for (const a of plan) {
      expect(a.kind).toBe('terminal')
      expect(a.needsConsent?.command ?? '').not.toMatch(/winget|--accept|Invoke-WebRequest|curl|bitsadmin/i)
    }
    // App Installer first (Store page), then one official download page per winget tool.
    expect(plan[0]).toMatchObject({ componentId: 'winget', id: 'download' })
    for (const id of ['git', 'node', 'pnpm'])
      expect(plan).toContainEqual(
        expect.objectContaining({ componentId: id, kind: 'terminal', id: 'download' }),
      )
    for (const a of plan.filter((x) => x.id === 'download'))
      expect(OFFICIAL_DOWNLOADS[a.componentId]).toMatch(/^https:\/\//)
    // Claude Code: the official installer in a visible PowerShell window, shown before it runs.
    expect(plan).toContainEqual(
      expect.objectContaining({
        componentId: 'claude-code',
        kind: 'terminal',
        id: 'terminal',
        needsConsent: { command: CLAUDE_INSTALL_COMMAND },
      }),
    )
  })

  it('with winget every missing tool is a visible-terminal winget install with its command and size', () => {
    const plan = installPlan(allMissing, true)
    expect(plan.map((a) => `${a.componentId}/${a.kind}/${a.id}`)).toEqual([
      'git/terminal/winget',
      'node/terminal/winget',
      'pnpm/terminal/winget',
      'claude-code/terminal/terminal',
    ])
    expect(plan[0]?.needsConsent).toEqual({ command: 'winget install --id Git.Git -e', sizeHint: '~60 MB' })
    for (const a of plan) expect(a.needsConsent?.command).not.toMatch(/--accept/)
  })

  it('installed tools are left out; an old Node is reinstalled', () => {
    const plan = installPlan(
      [view('git'), view('node', { level: 'error' }), view('pnpm'), view('claude-code')],
      true,
    )
    expect(plan.map((a) => a.componentId)).toEqual(['node'])
  })
})

describe('terminal commands', () => {
  const d = createDeps('fake', { env: { SystemRoot: 'C:\\Windows' } })
  const CMD = 'C:\\Windows\\System32\\cmd.exe'

  it('winget runs in its own visible window without accepting any agreement', () => {
    const git = CORE.find((c) => c.id === 'git')?.install
    if (!git) throw new Error('git install spec missing')
    const argv = wingetTerminalArgv(d, git)
    expect(argv).toEqual([
      CMD,
      '/d',
      '/c',
      'start',
      'Squarel Art Launcher',
      CMD,
      '/d',
      '/k',
      'winget',
      'install',
      '--id',
      'Git.Git',
      '-e',
    ])
    for (const c of CORE) {
      if (!c.install?.winget) continue
      const all = wingetTerminalArgv(d, c.install).join(' ')
      expect(all).not.toMatch(
        /--accept-package-agreements|--accept-source-agreements|--silent|--disable-interactivity/,
      )
    }
  })

  it('VS Build Tools opens its own installer UI (no --passive / --quiet override)', () => {
    const vs = CORE.find((c) => c.id === 'vs-build-tools')?.install
    if (!vs) throw new Error('vs-build-tools install spec missing')
    const argv = wingetTerminalArgv(d, vs)
    const i = argv.indexOf('--override')
    expect(i).toBeGreaterThan(0)
    expect(argv[i + 1]).toMatch(/--add Microsoft\.VisualStudio\.Workload\.VCTools/)
    expect(argv[i + 1]).not.toMatch(/--passive|--quiet/)
  })

  it('rejects package ids and arguments that could reach a shell', () => {
    expect(() => wingetTerminalArgv(d, { winget: 'Git.Git & calc' })).toThrow()
    expect(() => wingetTerminalArgv(d, { winget: 'Git.Git', override: '--add x" & calc' })).toThrow()
    expect(() => terminalArgv(d, ['cmd.exe', '/k', 'a|b'])).toThrow()
  })

  it('cmd.exe always comes from System32, never from ComSpec', () => {
    const evil = createDeps('fake', { env: { SystemRoot: 'C:\\Windows', ComSpec: 'D:\\evil\\cmd.exe' } })
    const git = CORE.find((c) => c.id === 'git')?.install
    if (!git) throw new Error('git install spec missing')
    expect(wingetTerminalArgv(evil, git)[0]).toBe(CMD)
  })
})

describe('clone', () => {
  it('clones the launcher tag shallowly into the target with argv items only', () => {
    expect(cloneArgv('0.2.0', 'D:\\Local App\\SquarelArt\\app')).toEqual([
      'git',
      'clone',
      '--branch',
      'v0.2.0',
      '--depth',
      '1',
      SQUAREL_REPO,
      'D:\\Local App\\SquarelArt\\app',
    ])
    expect(SQUAREL_REPO).toBe('https://github.com/t1tc01-personal/squarel-art-2.git')
    expect(cloneArgv('1.0.0-rc.1', 'D:\\a')[3]).toBe('v1.0.0-rc.1')
  })

  it('refuses versions that are not a release tag', () => {
    for (const bad of ['0.2.0+abc', '0.2', 'main', '--upload-pack=calc', '0.2.0 --x', ''])
      expect(() => cloneArgv(bad, 'D:\\a'), bad).toThrow(/tag/)
  })

  it('target must be absent or empty', async () => {
    const d = createDeps('fake', { files: { 'D:\\full\\README.md': 'x' } })
    expect(await checkCloneTarget('D:\\absent', d)).toBeUndefined()
    expect(await checkCloneTarget('D:\\full', d)).toMatch(/không trống/)
    expect(await checkCloneTarget('relative\\dir', d)).toMatch(/tuyệt đối/)
  })
})

describe('hasWinget', () => {
  it('is true only when winget --version exits 0', async () => {
    expect(
      await hasWinget(createDeps('fake', { run: { 'winget --version': { code: 0, lines: ['v1.9'] } } })),
    ).toBe(true)
    expect(await hasWinget(createDeps('fake', {}))).toBe(false)
    const d = createDeps('fake', {})
    d.run = async () => {
      throw new Error('ENOENT')
    }
    expect(await hasWinget(d)).toBe(false)
  })
})

describe('setup actions', () => {
  const INSTALL = 'D:\\local\\SquarelArt\\app'
  function ctx(fx: Fixtures = {}, over: Partial<ActionCtx> = {}) {
    const launched: DetachedSpec[] = []
    const external: string[] = []
    const patches: Partial<LauncherState>[] = []
    const d = createDeps('fake', { launched, env: { SystemRoot: 'C:\\Windows' }, ...fx })
    const reg: Registry = { core: CORE, integrations: [], comingSoon: [], problems: [] }
    const c: ActionCtx = {
      d,
      state: state({ squarelDir: over.state?.squarelDir }),
      reg,
      launcherVersion: '0.2.0',
      isDev: false,
      toolsDir: (id) => `D:\\local\\SquarelArt\\tools\\${id}`,
      defaultInstall: INSTALL,
      homeDir: 'D:\\home',
      env: parseEnv(''),
      projects: async () => [],
      bridgeTool: async () => '',
      openFolder: async () => {},
      openExternal: async (u) => void external.push(u),
      setState: async (p) => void patches.push(p),
      ...over,
    }
    return { c, launched, external, patches }
  }
  async function run(ref: Omit<ActionRef, 'label'>, c: ActionCtx): Promise<TaskEvent[]> {
    const r = resolveAction({ label: 'x', ...ref }, c)
    if ('error' in r) throw new Error(r.error)
    const events: TaskEvent[] = []
    await r.body('t1', (e) => void events.push(e))
    return events
  }

  it('winget install opens a visible terminal and never runs winget in the background', async () => {
    const { c, launched } = ctx()
    const calls: string[] = []
    const run0 = c.d.run
    c.d.run = async (spec) => {
      calls.push(spec.argv.join(' '))
      return run0(spec)
    }
    for (const kind of ['install', 'terminal'] as const) {
      const ev = await run({ componentId: 'node', kind, id: 'winget' }, c)
      expect(ev.at(-1)?.kind).toBe('done')
    }
    expect(calls.filter((x) => x.includes('winget'))).toEqual([])
    expect(launched).toHaveLength(2)
    expect(launched[0]?.argv.slice(0, 5)).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
      '/d',
      '/c',
      'start',
      'Squarel Art Launcher',
    ])
    expect(launched[0]?.argv).toContain('OpenJS.NodeJS.LTS')
  })

  it('Claude Code installs in a visible PowerShell window', async () => {
    const { c, launched } = ctx()
    await run({ componentId: 'claude-code', kind: 'terminal', id: 'terminal' }, c)
    const argv = launched[0]?.argv ?? []
    expect(argv.slice(0, 4)).toEqual(['C:\\Windows\\System32\\cmd.exe', '/d', '/c', 'start'])
    expect(argv).toContain('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(argv.at(-1)).toBe(CLAUDE_INSTALL_COMMAND)
  })

  it('download actions open only the fixed official https page', async () => {
    const { c, external, launched } = ctx()
    await run({ componentId: 'git', kind: 'terminal', id: 'download' }, c)
    await run({ componentId: 'winget', kind: 'terminal', id: 'download' }, c)
    expect(external).toEqual([OFFICIAL_DOWNLOADS.git, OFFICIAL_DOWNLOADS.winget])
    expect(launched).toEqual([])
    expect(
      resolveAction({ componentId: 'evil', kind: 'terminal', id: 'download', label: 'x' }, c),
    ).toHaveProperty('error')
  })

  it('clone runs git with the release tag into the default folder, then stores it as the Squarel folder', async () => {
    const key = `git clone --branch v0.2.0 --depth 1 ${SQUAREL_REPO} ${INSTALL}`
    const { c, patches } = ctx({
      run: { [key]: { code: 0, files: { [join(INSTALL, 'package.json')]: '{"name":"squarel-art"}' } } },
    })
    const ev = await run({ componentId: 'squarel', kind: 'install', id: 'clone' }, c)
    expect(ev.at(-1)).toMatchObject({ kind: 'done' })
    expect(patches).toEqual([{ squarelDir: INSTALL, mode: 'fresh' }])
  })

  it('clone refuses a non-empty target and a non-release launcher version', async () => {
    const full = ctx({ files: { [join(INSTALL, 'x.txt')]: 'x' } })
    const ev = await run({ componentId: 'squarel', kind: 'install', id: 'clone' }, full.c)
    expect(ev.at(-1)).toMatchObject({ kind: 'error' })
    expect(full.patches).toEqual([])
    const dev = ctx({}, { launcherVersion: '0.2.0+dev' })
    const ev2 = await run({ componentId: 'squarel', kind: 'install', id: 'clone' }, dev.c)
    expect(ev2.at(-1)).toMatchObject({ kind: 'error' })
  })
})
