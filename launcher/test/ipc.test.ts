import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createDeps, type Fixtures } from '../src/main/deps'
import { createIpcHandlers, type IpcContext, type SenderInfo } from '../src/main/ipc-handlers'
import type { LauncherState } from '../src/main/state'

const ROOT = resolve(tmpdir(), 'squarel-ipc-test')
const SQ = join(ROOT, 'squarel')
const DATA = join(ROOT, 'data')
const LOCAL = join(ROOT, 'local')
const APPDATA = join(ROOT, 'roaming')
const LOGS = join(APPDATA, 'SquarelArt Launcher', 'logs')
const ELSEWHERE = join(ROOT, 'elsewhere')
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
  const d = createDeps('fake', { ...fx, files, env: { APPDATA, LOCALAPPDATA: LOCAL, ...fx.env } })
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
    launcherUpdater: { check: async () => ({ ok: true, version: '0.2.0' }) },
    emit: (event, payload) => void events.push({ event, payload }),
    log: (m) => void logs.push(m),
  }
  return { h: createIpcHandlers(ctx), d, revealed, events, logs, picked, getState: () => state }
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
})
