/** Actions around the quit / bridge lifecycle (Task 15): bridge pause, abort signal, tags, self-update. */
import { join } from 'node:path'
import type { IntegrationManifestT } from '@squarel/integration-schema'
import { describe, expect, it } from 'vitest'
import { type ActionCtx, resolveAction } from '../src/main/actions'
import { createDeps, type Fixtures } from '../src/main/deps'
import { parseEnv } from '../src/main/env-store'
import type { LoadedIntegration } from '../src/main/registry/registry'
import type { ActionRef, TaskEvent } from '../src/shared/model'

const SQ = join('D:', 'sq')
const REPO = 'https://github.com/aseprite/aseprite.git'

const GIT_REPO: NonNullable<Fixtures['run']> = {
  'git rev-parse --show-prefix': { code: 0, lines: [''] },
  'git rev-parse --git-path squarel-update-pending': { code: 0, lines: ['.git/squarel-update-pending'] },
  'git for-each-ref --contains HEAD --format=%(refname)': { code: 0, lines: ['refs/heads/main'] },
  'git status --porcelain --untracked-files=no': { code: 0, lines: [] },
  'git rev-parse --abbrev-ref HEAD': { code: 0, lines: ['HEAD'] },
  'git describe --tags --exact-match HEAD': { code: 0, lines: ['v0.1.0'] },
  'git fetch --tags --force': { code: 0 },
  'git checkout --detach refs/tags/v0.2.0': { code: 0 },
  'pnpm install': { code: 0 },
}

const manifest: IntegrationManifestT = {
  schema: 1,
  id: 'aseprite',
  name: 'Aseprite',
  description: 'x',
  icon: 'icon.png',
  accent: '#FF77A8',
  platforms: ['win32'],
  detect: { candidates: ['C:\\A\\Aseprite.exe'] },
  install: [],
  latest: { type: 'git-tags', repo: REPO, stable: true },
  update: { run: ['pnpm', 'aseprite:build', '--', '--ref', '{version}'] },
  launch: [{ id: 'open', label: 'Mở', default: true, run: ['{exe}'] }],
  checks: [],
} as IntegrationManifestT
const aseprite: LoadedIntegration = { manifest, dir: join(SQ, 'integrations', 'aseprite'), source: 'squarel' }

function harness(fx: Fixtures, over: Partial<ActionCtx> = {}) {
  const d = createDeps('fake', fx)
  const log: string[] = []
  const signals: (AbortSignal | undefined)[] = []
  const run = d.run
  d.run = async (spec) => {
    log.push(`run ${spec.argv.join(' ')}`)
    signals.push(spec.signal)
    return run(spec)
  }
  const ctx: ActionCtx = {
    d,
    state: {
      schema: 1,
      squarelDir: SQ,
      setupStep: 'done',
      selected: ['aseprite'],
      installChoice: {},
      closeToTray: true,
      autostart: false,
    },
    reg: { core: [], integrations: [aseprite], comingSoon: [], problems: [] },
    launcherVersion: '0.2.0',
    isDev: false,
    toolsDir: (id) => join('D:', 'tools', id),
    env: parseEnv(''),
    artRefs: async () => [],
    bridgeTool: async () => '',
    openFolder: async () => {},
    homeDir: join('D:', 'home'),
    openExternal: async () => {},
    setState: async () => {},
    ...over,
  }
  const exec = async (ref: Omit<ActionRef, 'label'>, signal?: AbortSignal) => {
    const r = resolveAction({ label: 'x', ...ref } as ActionRef, ctx)
    if ('error' in r) return { error: r.error, events: [] as TaskEvent[] }
    const events: TaskEvent[] = []
    await r.body('t', (e) => void events.push(e), signal)
    return { events }
  }
  return { d, ctx, log, signals, exec }
}

describe('actions and the bridge lifecycle', () => {
  it('Squarel update pauses the bridge around the checkout and warns about live MCP sessions', async () => {
    const h = harness({ run: GIT_REPO })
    h.ctx.pauseBridge = async () => {
      h.log.push('pause')
      return { wasOwn: true, resume: () => void h.log.push('resume') }
    }
    h.ctx.mcpSessions = async () => 2
    const { events } = await h.exec({ componentId: 'squarel', kind: 'update', id: 'update' })
    const firstGitWrite = h.log.indexOf('run git fetch --tags --force')
    expect(h.log.indexOf('pause')).toBeGreaterThan(-1)
    expect(h.log.indexOf('pause')).toBeLessThan(firstGitWrite)
    expect(h.log.at(-1)).toBe('resume')
    expect(events.some((e) => /2 phiên Claude Code/.test(e.text ?? ''))).toBe(true)
    expect(events.some((e) => /tạm dừng bridge/.test(e.text ?? ''))).toBe(true)
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
  })

  it('the bridge resumes even when the update fails; a no-op plan never pauses it', async () => {
    const h = harness({ run: { ...GIT_REPO, 'pnpm install': { code: 1 } } })
    h.ctx.pauseBridge = async () => {
      h.log.push('pause')
      return { wasOwn: false, resume: () => void h.log.push('resume') }
    }
    const { events } = await h.exec({ componentId: 'squarel', kind: 'update', id: 'update' })
    expect(events.at(-1)).toMatchObject({ kind: 'error' })
    expect(h.log.at(-1)).toBe('resume')

    const none = harness({
      run: { ...GIT_REPO, 'git describe --tags --exact-match HEAD': { code: 0, lines: ['v0.2.0'] } },
    })
    none.ctx.pauseBridge = async () => {
      none.log.push('pause')
      return { wasOwn: true, resume: () => {} }
    }
    expect(
      (await none.exec({ componentId: 'squarel', kind: 'update', id: 'update' })).events.at(-1),
    ).toMatchObject({ kind: 'done' })
    expect(none.log).not.toContain('pause')
  })

  it('a planSquarelUpdate failure ends the task with an error instead of throwing', async () => {
    const h = harness({ run: GIT_REPO })
    h.ctx.d.run = async () => {
      throw new Error('spawn git ENOENT')
    }
    const { events } = await h.exec({ componentId: 'squarel', kind: 'update', id: 'update' })
    expect(events.at(-1)?.kind).toBe('error')
  })

  it('tool update passes the tag form (v<version>) and the task signal', async () => {
    const h = harness({
      run: {
        [`git ls-remote --tags --refs ${REPO}`]: {
          code: 0,
          lines: ['2222222222222222222222222222222222222222\trefs/tags/v1.3.19'],
        },
        'pnpm aseprite:build -- --ref v1.3.19': { code: 0 },
      },
    })
    const abort = new AbortController()
    const { events } = await h.exec({ componentId: 'aseprite', kind: 'update', id: 'update' }, abort.signal)
    expect(h.log).toContain('run pnpm aseprite:build -- --ref v1.3.19')
    expect(h.signals.at(-1)).toBe(abort.signal)
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
  })

  it('launcher install is offered only after the download finished', async () => {
    const h = harness({})
    expect((await h.exec({ componentId: 'launcher', kind: 'update', id: 'install' })).error).toMatch(
      /chưa tải xong/,
    )
    let installs = 0
    h.ctx.launcherUpdateReady = '0.3.0'
    h.ctx.installLauncherUpdate = () => void installs++
    const { events } = await h.exec({ componentId: 'launcher', kind: 'update', id: 'install' })
    expect(installs).toBe(1)
    expect(events.at(-1)).toMatchObject({ kind: 'done' })
    expect(resolveAction({ componentId: 'launcher', kind: 'update', id: 'other', label: '' }, h.ctx)).toEqual(
      {
        error: 'Thao tác không được hỗ trợ',
      },
    )
  })
})
