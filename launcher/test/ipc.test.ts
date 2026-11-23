import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeps, type DetachedSpec, type Fixtures } from '../src/main/deps'
import { createIpcHandlers, type IpcContext, type SenderInfo } from '../src/main/ipc-handlers'
import { redactText } from '../src/main/redact'
import type { LauncherState } from '../src/main/state'

const ROOT = resolve(tmpdir(), 'squarel-ipc-test')
const SQ = join(ROOT, 'squarel')
const DATA = join(ROOT, 'data')
const LOCAL = join(ROOT, 'local')
const APPDATA = join(ROOT, 'roaming')
const LOGS = join(APPDATA, 'SquarelArt Launcher', 'logs')
const ELSEWHERE = join(ROOT, 'elsewhere')
const LICENSE = join(ROOT, 'LICENSE.md')
const APP_URL = 'file:///app/renderer/index.html'
const APP: SenderInfo = { url: APP_URL, fromAppWindow: true }

const CF_TOKEN = 'cf-secret-token-0123456789'
const RD_KEY = 'rd-secret-key-abcdefgh'

function setup(fx: Fixtures = {}) {
  const files: Record<string, string> = {
    [join(SQ, 'package.json')]: '{"name":"squarel-art"}',
    [join(SQ, '.env')]:
      `CLOUDFLARE_API_TOKEN=${CF_TOKEN}\r\nRETRO_DIFFUSION_API_KEY="${RD_KEY}"\r\nDATA_DIR=${DATA}\r\nBRIDGE_PORT=4321\r\n`,
    [join(SQ, 'src', 'mcp', 'index.ts')]: '',
    [join(DATA, 'projects', 'cat', 'project.json')]: JSON.stringify({
      slug: 'cat',
      name: 'Cat',
      purpose: 'sprite',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-03T00:00:00Z',
      head: 'v000002',
    }),
    [join(LOCAL, 'SquarelArt', 'tools', 'aseprite', 'build.log')]: 'x',
    [join(LOGS, 'launcher.log')]: 'x',
    [join(ELSEWHERE, 'secret.txt')]: 'x',
    ...fx.files,
  }
  const launched: DetachedSpec[] = []
  const d = createDeps('fake', { launched, ...fx, files, env: { APPDATA, LOCALAPPDATA: LOCAL, ...fx.env } })
  const opened: string[] = []
  const clipboard: string[] = []
  const bridgeTools: { name: string; input: unknown }[] = []
  const folders: string[] = []
  let state: LauncherState = {
    schema: 1,
    squarelDir: SQ,
    setupStep: 'done',
    selected: [],
    installChoice: {},
    closeToTray: true,
    autostart: false,
  }
  const revealed: string[] = []
  const picked: { folder: string | null; file: string | null } = { folder: null, file: null }
  const events: { event: string; payload: unknown }[] = []
  const logs: string[] = []
  const windowCalls: string[] = []
  const ctx: IpcContext = {
    d,
    launcherVersion: '0.2.0',
    isDev: false,
    homeDir: join(ROOT, 'home'),
    logsDir: LOGS,
    isAppUrl: (u) => u === APP_URL,
    state: {
      load: async () => state,
      save: async (s) => {
        state = s
      },
    },
    bridge: () => ({ mode: 'down', port: 4321, clients: [], since: '2026-01-01T00:00:00Z' }),
    dialogs: { pickFolder: async () => picked.folder, pickFile: async () => picked.file },
    showItemInFolder: (p) => void revealed.push(p),
    window: {
      minimize: () => void windowCalls.push('minimize'),
      close: (toTray) => void windowCalls.push(toTray ? 'hide' : 'quit'),
    },
    launcherUpdater: { check: async () => ({ ok: true, version: '0.2.0' }) },
    emit: (event, payload) => void events.push({ event, payload }),
    log: (m) => void logs.push(m),
    licensePath: LICENSE,
    repoUrl: 'https://github.com/example/repo',
    openPath: async (p) => {
      opened.push(p)
      return ''
    },
    clipboard: { writeText: (t) => void clipboard.push(t) },
    bridgeTool: async (name, input) => {
      bridgeTools.push({ name, input })
      return 'ok'
    },
    openFolder: async (p) => void folders.push(p),
    openExternal: async () => {},
  }
  return {
    h: createIpcHandlers(ctx),
    d,
    revealed,
    events,
    logs,
    picked,
    windowCalls,
    opened,
    clipboard,
    bridgeTools,
    folders,
    launched,
    getState: () => state,
  }
}

describe('ipc handlers', () => {
  it('rejects unknown channels and invalid payloads', async () => {
    const { h } = setup()
    await expect(h.handle('fs:read', APP, { path: 'C:\\x' })).rejects.toThrow(/kênh/i)
    await expect(h.handle('toString', APP, undefined)).rejects.toThrow(/kênh/i)
    await expect(h.handle('__proto__', APP, undefined)).rejects.toThrow(/kênh/i)
    // Channels without input take nothing.
    await expect(h.handle('state:get', APP, { x: 1 })).rejects.toThrow(/không hợp lệ/i)
    // Wrong types and unknown / read-only fields.
    await expect(h.handle('state:set', APP, { closeToTray: 'yes' })).rejects.toThrow(/không hợp lệ/i)
    await expect(h.handle('state:set', APP, { schema: 2 })).rejects.toThrow(/không hợp lệ/i)
    await expect(h.handle('state:set', APP, { selected: ['../../evil'] })).rejects.toThrow(/không hợp lệ/i)
    await expect(h.handle('state:set', APP, { squarelDir: 'relative\\dir' })).rejects.toThrow()
    await expect(h.handle('state:set', APP, { squarelDir: ELSEWHERE })).rejects.toThrow(/hộp thoại/)
    await expect(
      h.handle('action:run', APP, { componentId: 'squarel', kind: 'nuke', id: 'x', label: 'x' }),
    ).rejects.toThrow(/không hợp lệ/i)
    await expect(
      h.handle('action:run', APP, { componentId: 'squarel', kind: 'fix', id: 'rm-rf', label: 'x' }),
    ).rejects.toThrow(/không được hỗ trợ/i)
    await expect(
      h.handle('dialog:pickFile', APP, { filters: [{ name: 'x', extensions: ['../'] }] }),
    ).rejects.toThrow(/không hợp lệ/i)
    // Only the app's own window may call.
    await expect(
      h.handle('state:get', { url: 'https://evil.example/', fromAppWindow: true }, undefined),
    ).rejects.toThrow(/từ chối/i)
    await expect(h.handle('state:get', { url: APP_URL, fromAppWindow: false }, undefined)).rejects.toThrow(
      /từ chối/i,
    )
    await expect(h.handle('state:get', { fromAppWindow: true }, undefined)).rejects.toThrow(/từ chối/i)

    // Valid calls still work, and output only carries declared fields.
    const st = (await h.handle('state:set', APP, {
      closeToTray: false,
      selected: ['aseprite'],
    })) as LauncherState
    expect(st.closeToTray).toBe(false)
    expect(st.selected).toEqual(['aseprite'])
    expect(h.channels).toContain('projects:recent')
  })

  it('env:set refuses keys outside the allow-list', async () => {
    const { h, d } = setup()
    for (const key of ['PATH', 'NODE_OPTIONS', 'SQUAREL_NO_BRIDGE', 'bridge_port', 'BRIDGE_PORT\n']) {
      await expect(h.handle('env:set', APP, { key, value: '1' })).rejects.toThrow(/không hợp lệ/i)
    }
    for (const value of ['4321\nNODE_OPTIONS=--inspect', '4321\r', '43\u000021']) {
      await expect(h.handle('env:set', APP, { key: 'BRIDGE_PORT', value })).rejects.toThrow(/không hợp lệ/i)
    }
    await expect(h.handle('env:set', APP, { key: 'BRIDGE_PORT', value: '99999' })).rejects.toThrow()
    await expect(h.handle('env:set', APP, { key: 'IMAGE_PROVIDER', value: 'evil' })).rejects.toThrow()
    await expect(h.handle('env:set', APP, { key: 'DATA_DIR', value: '\\\\server\\share' })).rejects.toThrow()

    await h.handle('env:set', APP, { key: 'IMAGE_PROVIDER', value: 'mock' })
    await h.handle('env:set', APP, { key: 'BRIDGE_PORT', value: '4400' })
    const text = String(await d.fs.readFile(join(SQ, '.env'), 'utf8'))
    expect(text).toContain('IMAGE_PROVIDER=mock\r\n')
    expect(text).toContain('BRIDGE_PORT=4400\r\n')
    expect(text).not.toContain('BRIDGE_PORT=4321')
    expect(text).toContain(`CLOUDFLARE_API_TOKEN=${CF_TOKEN}\r\n`)
  })

  it('env:get never returns raw secrets', async () => {
    const { h, logs } = setup()
    const view = (await h.handle('env:get', APP, undefined)) as Record<
      string,
      { set: boolean; value: string }
    >
    const json = JSON.stringify(view)
    expect(json).not.toContain(CF_TOKEN)
    expect(json).not.toContain(RD_KEY)
    expect(json).not.toContain('0123456789')
    expect(view.CLOUDFLARE_API_TOKEN).toMatchObject({ set: true, value: '••••6789', secret: true })
    expect(view.RETRO_DIFFUSION_API_KEY).toMatchObject({ set: true, value: '••••efgh' })
    expect(view.CLOUDFLARE_ACCOUNT_ID).toMatchObject({ set: false, value: '' })
    expect(view.BRIDGE_PORT).toMatchObject({ set: true, value: '4321', secret: false })

    // Writing a secret answers with the masked view; a rejected secret is never echoed back or logged.
    const after = (await h.handle('env:set', APP, {
      key: 'CLOUDFLARE_API_TOKEN',
      value: 'new-token-value-WXYZ',
    })) as Record<string, { value: string }>
    expect(JSON.stringify(after)).not.toContain('new-token-value')
    expect(after.CLOUDFLARE_API_TOKEN?.value).toBe('••••WXYZ')
    const bad = h.handle('env:set', APP, { key: 'CLOUDFLARE_API_TOKEN', value: 'leaky-secret\nX=1' })
    await expect(bad).rejects.toThrow()
    const err = await bad.catch((e: Error) => e.message)
    expect(err).not.toContain('leaky-secret')
    expect(logs.join('\n')).not.toContain('leaky-secret')
    expect(logs.join('\n')).not.toContain('new-token-value')
  })

  it('shell:reveal refuses paths outside known roots', async () => {
    const { h, revealed } = setup({
      realpaths: { [join(DATA, 'projects', 'link')]: join(ELSEWHERE, 'secret.txt') },
      files: { [join(DATA, 'projects', 'link')]: 'x', [join(DATA, '..foo', 'x.txt')]: 'x' },
    })
    const refused = [
      join(ELSEWHERE, 'secret.txt'),
      join(DATA, '..', 'elsewhere', 'secret.txt'),
      join(DATA, 'projects', 'link'), // resolves outside through a link
      join(DATA, 'missing.txt'),
      'projects\\cat',
      '\\\\server\\share\\x.txt',
      '//server/share/x.txt',
      `\\\\?\\${join(DATA, 'projects', 'cat', 'project.json')}`,
      `${join(DATA, 'projects', 'cat', 'project.json')}\u0000.txt`,
    ]
    for (const path of refused) {
      await expect(h.handle('shell:reveal', APP, { path })).rejects.toThrow()
    }
    expect(revealed).toEqual([])

    const ok = [
      join(DATA, 'projects', 'cat', 'project.json'),
      join(SQ, 'package.json'),
      join(LOCAL, 'SquarelArt', 'tools', 'aseprite', 'build.log'),
      join(LOGS, 'launcher.log'),
      join(DATA, '..foo', 'x.txt'), // a folder whose name starts with ".." is still inside
    ]
    for (const path of ok) await h.handle('shell:reveal', APP, { path })
    expect(revealed).toEqual(ok)
  })

  it('path settings are accepted only from a pick dialog or the stored value', async () => {
    const SQ2 = join(ROOT, 'squarel-2')
    const EXE = join(ROOT, 'tools', 'Aseprite.exe')
    const { h, picked, getState } = setup({
      files: { [join(SQ2, 'package.json')]: '{"name":"squarel-art"}' },
    })
    // The stored folder may be set again; another valid Squarel folder needs the dialog.
    await h.handle('state:set', APP, { squarelDir: SQ })
    await expect(h.handle('state:set', APP, { squarelDir: SQ2 })).rejects.toThrow(/hộp thoại/)
    picked.folder = ELSEWHERE
    await h.handle('dialog:pickFolder', APP, undefined)
    // Picked, but still has to be a Squarel folder.
    await expect(h.handle('state:set', APP, { squarelDir: ELSEWHERE })).rejects.toThrow(/squarel-art/)
    picked.folder = SQ2
    expect(await h.handle('dialog:pickFolder', APP, undefined)).toBe(SQ2)
    await h.handle('state:set', APP, { squarelDir: SQ2 })
    expect(getState().squarelDir).toBe(SQ2)
    // Going back to the previous folder also needs the dialog (only the stored one is implied).
    await expect(h.handle('state:set', APP, { squarelDir: SQ })).rejects.toThrow(/hộp thoại/)
    picked.folder = SQ
    await h.handle('dialog:pickFolder', APP, undefined)
    await h.handle('state:set', APP, { squarelDir: SQ })

    await expect(h.handle('env:set', APP, { key: 'ASEPRITE_PATH', value: EXE })).rejects.toThrow(/hộp thoại/)
    picked.file = EXE
    await h.handle('dialog:pickFile', APP, { filters: [{ name: 'Aseprite', extensions: ['exe'] }] })
    const view = (await h.handle('env:set', APP, { key: 'ASEPRITE_PATH', value: EXE })) as Record<
      string,
      { value: string }
    >
    expect(view.ASEPRITE_PATH?.value).toBe(EXE)
    // Current DATA_DIR may be written back; clearing is always allowed; a new one needs the dialog.
    await h.handle('env:set', APP, { key: 'DATA_DIR', value: DATA })
    await expect(h.handle('env:set', APP, { key: 'DATA_DIR', value: ELSEWHERE })).rejects.toThrow(/hộp thoại/)
    await h.handle('env:set', APP, { key: 'DATA_DIR', value: '' })
  })

  it('LOCAL_SD_URL must not carry credentials', async () => {
    const { h } = setup()
    await expect(
      h.handle('env:set', APP, { key: 'LOCAL_SD_URL', value: 'http://user:pass@127.0.0.1:7861' }),
    ).rejects.toThrow(/mật khẩu/)
    await expect(
      h.handle('env:set', APP, { key: 'LOCAL_SD_URL', value: 'http://u@127.0.0.1:7861' }),
    ).rejects.toThrow()
    await h.handle('env:set', APP, { key: 'LOCAL_SD_URL', value: 'http://127.0.0.1:7861' })
  })

  it('only one action at a time may work in the Squarel folder', async () => {
    const { h, d, events } = setup()
    let release: (() => void) | undefined
    const run = d.run
    d.run = async (spec) => {
      if (!release && spec.argv.join(' ').startsWith('claude mcp add'))
        await new Promise<void>((r) => (release = r))
      return run(spec)
    }
    const ref = { componentId: 'squarel', kind: 'fix', id: 'register-mcp', label: 'x' }
    await h.handle('action:run', APP, ref)
    await expect(h.handle('action:run', APP, ref)).rejects.toThrow(/đang chạy/)
    await expect(
      h.handle('action:run', APP, { componentId: 'squarel', kind: 'update', id: 'update', label: 'x' }),
    ).rejects.toThrow(/thư mục Squarel/)
    await expect(h.handle('updates:apply', APP, undefined)).rejects.toThrow(/thư mục Squarel/)
    // Actions outside the Squarel folder are not blocked.
    await h.handle('action:run', APP, {
      componentId: 'settings',
      kind: 'fix',
      id: 'open-settings',
      label: 'x',
    })
    while (!release) await new Promise((r) => setTimeout(r, 1))
    release()
    await h.idle()
    const ends = events.filter((e) =>
      ['done', 'error'].includes((e.payload as { kind?: string })?.kind ?? ''),
    )
    expect(ends).toHaveLength(2) // open-settings + the first register-mcp
    // Released: a new Squarel-folder action may start.
    expect(typeof (await h.handle('action:run', APP, ref))).toBe('string')
    await h.idle()
  })

  it('action:run starts a known action and streams task events', async () => {
    const { h, events } = setup({
      run: {
        [`claude mcp add squarel --scope user -- node ${join(SQ, 'src', 'mcp', 'index.ts')}`]: {
          code: 0,
          lines: ['Added squarel'],
        },
      },
    })
    const taskId = await h.handle('action:run', APP, {
      componentId: 'squarel',
      kind: 'fix',
      id: 'register-mcp',
      label: 'Đăng ký lại',
    })
    expect(typeof taskId).toBe('string')
    await h.idle()
    const mine = events
      .filter((e) => e.event === 'task:event')
      .map((e) => e.payload as { taskId: string; kind: string })
    expect(mine.every((e) => e.taskId === taskId)).toBe(true)
    expect(mine.at(-1)?.kind).toBe('done')
  })

  it('projects:recent lists the newest projects of DATA_DIR', async () => {
    const { h } = setup({
      files: {
        [join(DATA, 'projects', 'dog', 'project.json')]: JSON.stringify({
          slug: 'dog',
          name: 'Dog',
          updatedAt: '2026-01-05T00:00:00Z',
          head: 'v000001',
        }),
        [join(DATA, 'projects', 'BAD', 'project.json')]: '{}',
      },
    })
    const list = (await h.handle('projects:recent', APP, undefined)) as { slug: string; version: string }[]
    expect(list.map((p) => p.slug)).toEqual(['dog', 'cat'])
    expect(list[1]?.version).toBe('v000002')
  })

  it('window:close hides to the tray only when closeToTray is on', async () => {
    const { h, windowCalls } = setup()
    await h.handle('window:minimize', APP, undefined)
    await h.handle('window:close', APP, undefined)
    await h.handle('state:set', APP, { closeToTray: false })
    await h.handle('window:close', APP, undefined)
    expect(windowCalls).toEqual(['minimize', 'hide', 'quit'])
    await expect(
      h.handle('window:close', { url: APP_URL, fromAppWindow: false }, undefined),
    ).rejects.toThrow()
  })
})

const ASEPRITE_MANIFEST = readFileSync(
  join(__dirname, '..', '..', 'integrations', 'aseprite', 'integration.json'),
  'utf8',
)
const EXE = join(ROOT, 'tools', 'aseprite', 'Aseprite.exe')

function withAseprite(fx: Fixtures = {}) {
  return setup({
    ...fx,
    files: {
      [join(SQ, 'integrations', 'aseprite', 'integration.json')]: ASEPRITE_MANIFEST,
      [join(SQ, '.env')]: `CLOUDFLARE_API_TOKEN=${CF_TOKEN}\r\nDATA_DIR=${DATA}\r\nASEPRITE_PATH=${EXE}\r\n`,
      [EXE]: '',
      ...fx.files,
    },
    run: { [`${EXE} -b --version`]: { code: 0, lines: ['Aseprite 1.3.18.6-x64'] }, ...fx.run },
  })
}

describe('launch actions (from the manifest only)', () => {
  const ref = (id: string, extra: object = {}) => ({
    componentId: 'aseprite',
    kind: 'launch',
    id,
    label: 'ignored',
    ...extra,
  })

  it('refuses launch actions of an unselected integration', async () => {
    const { h, launched } = withAseprite()
    await expect(h.handle('action:run', APP, ref('open'))).rejects.toThrow(/Chưa chọn/)
    expect(launched).toEqual([])
  })

  it('runs the default action and "open without sync" with SQUAREL_NO_SYNC only there', async () => {
    const { h, launched, events } = withAseprite()
    await h.handle('state:set', APP, { selected: ['aseprite'] })
    await h.handle('action:run', APP, ref('open'))
    await h.idle()
    await h.handle('action:run', APP, ref('open-plain'))
    await h.idle()
    expect(launched).toEqual([
      { argv: [EXE], cwd: SQ },
      { argv: [EXE], cwd: SQ, env: { SQUAREL_NO_SYNC: '1' } },
    ])
    const done = events.filter(
      (e) => e.event === 'task:event' && (e.payload as { kind?: string }).kind === 'done',
    )
    expect(done).toHaveLength(2)
  })

  it('bridge tools get the recent project from DATA_DIR, or a picked existing one', async () => {
    const { h, bridgeTools, events } = withAseprite()
    await h.handle('state:set', APP, { selected: ['aseprite'] })
    await h.handle('action:run', APP, ref('open-recent'))
    await h.idle()
    expect(bridgeTools).toEqual([{ name: 'open_in_editor', input: { project: 'cat' } }])

    await h.handle('action:run', APP, ref('open-project', { project: 'nope' }))
    await h.idle()
    expect(bridgeTools).toHaveLength(1)
    const ends = events
      .filter((e) => e.event === 'task:event')
      .map((e) => e.payload as { kind?: string })
      .filter((p) => p.kind === 'done' || p.kind === 'error')
    expect(ends.at(-1)?.kind).toBe('error')
    await h.handle('action:run', APP, ref('open-project', { project: 'cat' }))
    await h.idle()
    expect(bridgeTools.at(-1)).toEqual({ name: 'open_in_editor', input: { project: 'cat' } })
    // A path is never a valid project.
    await expect(h.handle('action:run', APP, ref('open-project', { project: '..\\x' }))).rejects.toThrow(
      /không hợp lệ/,
    )
  })

  it('reveal opens the detected exe folder; labels substitute {recentProject}', async () => {
    const { h, folders } = withAseprite()
    await h.handle('state:set', APP, { selected: ['aseprite'] })
    await h.handle('action:run', APP, ref('folder'))
    await h.idle()
    expect(folders).toEqual([join(ROOT, 'tools', 'aseprite')])
    const comps = (await h.handle('components:list', APP, undefined)) as {
      id: string
      actions: { kind: string; label: string }[]
    }[]
    const labels = comps.find((c) => c.id === 'aseprite')?.actions.filter((a) => a.kind === 'launch')
    expect(labels?.map((a) => a.label)).toEqual([
      'Mở Aseprite',
      'Mở project…',
      'Mở cat',
      'Mở không đồng bộ',
      'Mở thư mục cài đặt',
    ])
  })

  it('hides {recentProject} actions while there is no project', async () => {
    const { h, d } = withAseprite()
    await d.fs.rm(join(DATA, 'projects', 'cat', 'project.json'))
    await h.handle('state:set', APP, { selected: ['aseprite'] })
    const comps = (await h.handle('components:list', APP, undefined)) as {
      id: string
      actions: { kind: string; id: string }[]
    }[]
    const ids = comps.find((c) => c.id === 'aseprite')?.actions.filter((a) => a.kind === 'launch')
    expect(ids?.map((a) => a.id)).toEqual(['open', 'open-project', 'open-plain', 'folder'])
  })
})

describe('logs, clipboard, about, license', () => {
  const LOGDIR = join(DATA, 'logs')
  const line = (o: object) => `${JSON.stringify(o)}\n`

  function withLogs() {
    return setup({
      realpaths: { [join(LOGDIR, 'evil.log')]: join(ELSEWHERE, 'secret.txt') },
      files: {
        [join(LOGDIR, 'bridge-2026-01-01.log')]:
          line({
            ts: '2026-01-01T10:00:01Z',
            level: 'info',
            name: 'bridge',
            msg: 'editor hello',
            client: 'aseprite',
          }) +
          line({
            ts: '2026-01-01T10:00:03Z',
            level: 'warn',
            name: 'bridge',
            msg: `token ${CF_TOKEN} leaked`,
          }),
        [join(LOGDIR, 'mcp-2026-01-01.log')]:
          line({ ts: '2026-01-01T10:00:02Z', level: 'error', name: 'mcp', msg: 'auth: Bearer abc.def-123' }) +
          line({
            ts: '2026-01-01T10:00:04Z',
            level: 'info',
            name: 'mcp',
            msg: 'fetch https://u:p4ss@example.com/x?token=zzz',
          }),
        [join(LOGDIR, 'evil.log')]: `{"ts":"2026-01-01T09:00:00Z","msg":"outside"}`,
        [join(LOGDIR, 'notes.txt')]: `raw ${CF_TOKEN}`,
      },
    })
  }

  it('logs:read merges, sorts, filters and redacts before leaving main', async () => {
    const { h } = withLogs()
    const all = (await h.handle('logs:read', APP, {})) as {
      dir: string
      sources: string[]
      lines: { ts: string; level: string; source: string; text: string }[]
    }
    expect(all.dir).toBe(LOGDIR)
    expect(all.sources).toEqual(expect.arrayContaining(['bridge', 'mcp', 'launcher']))
    expect(JSON.stringify(all)).not.toContain('outside')
    const data = all.lines.filter((l) => l.source !== 'launcher')
    expect(data.map((l) => l.ts)).toEqual([
      '2026-01-01T10:00:01Z',
      '2026-01-01T10:00:02Z',
      '2026-01-01T10:00:03Z',
      '2026-01-01T10:00:04Z',
    ])
    const json = JSON.stringify(all)
    expect(json).not.toContain(CF_TOKEN)
    expect(json).not.toContain('abc.def-123')
    expect(json).not.toContain('p4ss')
    expect(json).not.toContain('zzz')
    expect(json).toContain('••••6789')
    expect(data[0]?.text).toBe('editor hello · client=aseprite')

    const bridge = (await h.handle('logs:read', APP, { source: 'bridge' })) as { lines: { source: string }[] }
    expect(bridge.lines.map((l) => l.source)).toEqual(['bridge', 'bridge'])
    const errors = (await h.handle('logs:read', APP, { level: 'error' })) as { lines: { level: string }[] }
    expect(errors.lines.map((l) => l.level)).toEqual(['error'])
    const warn = (await h.handle('logs:read', APP, { level: 'warn' })) as { lines: { level: string }[] }
    expect(warn.lines.map((l) => l.level)).toEqual(['error', 'warn'])

    // No path input is accepted.
    await expect(h.handle('logs:read', APP, { dir: ELSEWHERE })).rejects.toThrow(/không hợp lệ/)
    await expect(h.handle('logs:read', APP, { source: '../x' })).rejects.toThrow(/không hợp lệ/)
  })

  it('clipboard:write redacts again in main', async () => {
    const { h, clipboard } = setup()
    await h.handle('clipboard:write', APP, { text: `a ${CF_TOKEN} b Bearer qqq.www` })
    expect(clipboard).toEqual(['a ••••6789 b Bearer ••••'])
    await expect(h.handle('clipboard:write', APP, { text: 1 })).rejects.toThrow(/không hợp lệ/)
  })

  it('license:open opens only the fixed bundled path; app:about reports versions', async () => {
    const { h, opened } = setup()
    await h.handle('license:open', APP, undefined)
    await expect(h.handle('license:open', APP, { path: ELSEWHERE })).rejects.toThrow(/không hợp lệ/)
    expect(opened).toEqual([LICENSE])
    expect(await h.handle('app:about', APP, undefined)).toEqual({
      launcherVersion: '0.2.0',
      squarelVersion: null,
      repoUrl: 'https://github.com/example/repo',
    })
  })
})

describe('setup:info', () => {
  const tools = (extra: Fixtures['run'] = {}): Fixtures => ({
    run: {
      'node --version': { code: 0, lines: ['v24.19.0'] },
      'git --version': { code: 0, lines: ['git version 2.55.0'] },
      'pnpm -v': { code: 0, lines: ['10.20.0'] },
      ...extra,
    },
    files: { [join(SQ, 'node_modules', '.modules.yaml')]: 'x' },
  })

  it('a missing Claude Code does not reopen a finished setup', async () => {
    const { h } = setup(tools())
    expect(await h.handle('setup:info', APP, { refresh: false })).toMatchObject({ step: 'done' })
  })

  it('Node missing reopens step 2 once per start; "Bỏ qua, vào launcher" then sticks', async () => {
    const { h, getState } = setup()
    expect(await h.handle('setup:info', APP, { refresh: false })).toMatchObject({ step: 2 })
    expect(getState().setupStep).toBe(2)
    await h.handle('state:set', APP, { setupStep: 'done' })
    expect(getState().setupCompleted).toBeUndefined() // a skip is not a finished setup
    expect(await h.handle('setup:info', APP, { refresh: false })).toMatchObject({ step: 'done' })
  })

  it('a returning user back at step 2 is done as soon as step 2 is satisfied', async () => {
    const { h } = setup(tools())
    await h.handle('state:set', APP, { setupStep: 4 })
    await h.handle('state:set', APP, { setupStep: 'done' })
    await h.handle('state:set', APP, { setupStep: 2, mode: 'clone' })
    expect(await h.handle('setup:info', APP, { refresh: false })).toMatchObject({ step: 'done' })
    // Someone who never finished goes on to step 3 instead.
    const fresh = setup(tools())
    await fresh.h.handle('state:set', APP, { setupStep: 2, mode: 'clone' })
    expect(fresh.getState().setupCompleted).toBeUndefined()
    expect(await fresh.h.handle('setup:info', APP, { refresh: false })).toMatchObject({ step: 2 })
  })
})

describe('redactText', () => {
  it('masks .env secrets, URL credentials, Bearer tokens and token query params', () => {
    expect(redactText('x secret-value-1234 y', ['secret-value-1234'])).toBe('x ••••1234 y')
    expect(redactText('git https://user:pw@host/repo', [])).toBe('git https://***@host/repo')
    expect(redactText('Authorization: Bearer eyJ.abc_d', [])).toBe('Authorization: Bearer ••••')
    expect(redactText('ws://127.0.0.1:4321/bridge?token=abc&x=1', [])).toBe(
      'ws://127.0.0.1:4321/bridge?token=••••&x=1',
    )
    expect(redactText('short abc', ['abc'])).toBe('short abc') // < 4 characters are never matched
  })
})
