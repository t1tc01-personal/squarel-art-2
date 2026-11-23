import { appendFile, mkdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import type { EventName, EventPayload } from '../shared/ipc'
import { type BridgeSupervisor, createBridgeSupervisor } from './bridge/supervisor'
import type { BridgeState } from './bridge/types'
import { createDeps, type Deps } from './deps'
import { parseEnv, readVar } from './env-store'
import { FAKE_FIXTURE, type FakeWorld, loadFakeWorld } from './fake-mode'
import { createIpcHandlers, type IpcHandlers } from './ipc-handlers'
import { appPaths } from './paths'
import { createScheduler } from './scheduler'
import { type LauncherState, loadState, saveState } from './state'
import { createElectronUpdaterAdapter } from './updates/electron-updater'
import { createLauncherUpdater } from './updates/launcher'

const BG_APP = '#0D0E12'

const RENDERER_FILE = join(import.meta.dirname, '../renderer/index.html')

const CHECKS_MS = 600_000
const UPDATES_MS = 21_600_000
const PRESENCE_POLL_MS = 5_000
const DEFAULT_BRIDGE_PORT = 4321

/** The electron-vite dev server URL; never honoured in a packaged build. */
function devRendererUrl(): string | undefined {
  return app.isPackaged ? undefined : process.env.ELECTRON_RENDERER_URL || undefined
}

/**
 * Test mode (e2e): no bridge supervisor, no scheduler (so no network checks), and Electron's own
 * profile goes under the (temporary) APPDATA the test passes. Ignored in a packaged build.
 */
const TEST_MODE = !app.isPackaged && process.env.SQUAREL_LAUNCHER_TEST === '1'
if (TEST_MODE && process.env.APPDATA) app.setPath('userData', join(process.env.APPDATA, 'electron-user-data'))

/**
 * Fake mode (e2e of the UI): main runs on createDeps('fake') from test/<fixture>. Honoured only in
 * test mode (isolated profile, unpackaged build) and only for a `fixtures/<name>` value.
 */
const FAKE_NAME = process.env.SQUAREL_LAUNCHER_FAKE ?? ''
const FAKE_MODE = TEST_MODE && FAKE_FIXTURE.test(FAKE_NAME)

/** True only for the app's own page: the dev server URL or the packaged index.html. */
export function isAppUrl(url: string): boolean {
  const dev = devRendererUrl()
  try {
    if (dev) return new URL(url).origin === new URL(dev).origin
    const target = new URL(url)
    return target.protocol === 'file:' && target.pathname === pathToFileURL(RENDERER_FILE).pathname
  } catch {
    return false
  }
}

const REPO_URL = 'https://github.com/t1tc01-personal/squarel-art-2'

/**
 * Test mode only: side effects that would leave the app (open a file / URL, start a tool, write
 * the clipboard, call the bridge) are recorded here instead, so e2e tests can assert on them via
 * `app.evaluate(() => globalThis.__squarelTest)`.
 */
interface TestSink {
  launched: unknown[]
  bridgeTools: { name: string; input: unknown }[]
  opened: string[]
  folders: string[]
  external: string[]
  clipboard: string[]
}
const testSink: TestSink | undefined = TEST_MODE
  ? { launched: [], bridgeTools: [], opened: [], folders: [], external: [], clipboard: [] }
  : undefined
if (testSink) (globalThis as { __squarelTest?: TestSink }).__squarelTest = testSink

/** LICENSE.md shipped with the launcher: resources in a packaged build, repo root from source. */
function licensePath(): string {
  // TODO(T16): electron-builder `extraResources: [{ from: '../LICENSE.md', to: 'LICENSE.md' }]` (no builder config yet).
  return app.isPackaged
    ? join(process.resourcesPath, 'LICENSE.md')
    : join(app.getAppPath(), '..', 'LICENSE.md')
}

let mainWindow: BrowserWindow | undefined

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    useContentSize: true,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: BG_APP,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  // No network content: never open new windows, never navigate away from the app page.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) {
      if (testSink) testSink.external.push(url)
      else void shell.openExternal(url)
    }
    return { action: 'deny' }
  })
  const block = (event: { preventDefault: () => void }, url: string) => {
    if (!isAppUrl(url)) event.preventDefault()
  }
  win.webContents.on('will-navigate', block)
  win.webContents.on('will-redirect', block)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })
  const dev = devRendererUrl()
  if (dev) {
    void win.loadURL(dev)
  } else {
    void win.loadFile(RENDERER_FILE)
  }
  mainWindow = win
  return win
}

function send<E extends EventName>(event: E, payload: EventPayload<E>): void {
  const win = mainWindow
  if (win && !win.isDestroyed()) win.webContents.send(event, payload)
}

let stopBackground: (() => void) | undefined

/** Stops the scheduler and presence polling (for the quit path, T15). The bridge is separate. */
export function stopBackgroundWork(): void {
  stopBackground?.()
  stopBackground = undefined
}

/** Services behind the IPC channels: state, bridge supervisor, scheduler, presence polling. */
async function startServices(): Promise<IpcHandlers> {
  const fake: FakeWorld | undefined = FAKE_MODE
    ? await loadFakeWorld(join(app.getAppPath(), 'test'), FAKE_NAME, process.env)
    : undefined
  const d: Deps = fake?.deps ?? createDeps('real')
  const paths = appPaths(d.env)
  const logsDir = join(dirname(paths.stateFile), 'logs')
  /** Same JSON-lines format as Squarel's logger (src/log.ts); messages never carry .env values. */
  const writeLog = (level: 'info' | 'warn', msg: string) => {
    if (fake) return // the fake world has no real disk
    const ts = new Date().toISOString()
    const line = `${JSON.stringify({ ts, level, name: 'launcher', msg })}\n`
    void mkdir(logsDir, { recursive: true })
      .then(() => appendFile(join(logsDir, `launcher-${ts.slice(0, 10)}.log`), line))
      .catch(() => {})
  }
  const log = (m: string) => {
    console.warn(`[launcher] ${m}`)
    writeLog('warn', m)
  }
  if (fake && testSink)
    d.spawnDetached = async (spec) => {
      testSink.launched.push(spec)
      return { pid: 1 }
    }
  writeLog(
    'info',
    `Squarel Art Launcher ${app.getVersion()} khởi động · Electron ${process.versions.electron}`,
  )

  let state: LauncherState = await loadState(paths.stateFile)
  if (fake) state = { ...state, ...fake.state }
  const readPort = async (): Promise<number> => {
    if (!state.squarelDir) return DEFAULT_BRIDGE_PORT
    try {
      const doc = parseEnv(String(await d.fs.readFile(join(state.squarelDir, '.env'), 'utf8')))
      const n = Number(readVar(doc, 'BRIDGE_PORT'))
      return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_BRIDGE_PORT
    } catch {
      return DEFAULT_BRIDGE_PORT
    }
  }

  // TODO(T15): quit wiring (before-quit → await sup.stop(); exit → sup.killOwnChild()) and orphan recovery.
  let sup: BridgeSupervisor | undefined
  let supPort = DEFAULT_BRIDGE_PORT
  let unsubscribeBridge: (() => void) | undefined
  const bridge = (): BridgeState =>
    fake?.bridge ??
    sup?.state() ?? { mode: 'down', port: supPort, clients: [], since: new Date(0).toISOString() }

  let lastPresence = ''
  let handlers: IpcHandlers | undefined
  /** Single flight: a request during a run marks it dirty and triggers exactly one rerun. */
  let presenceRunning = false
  let presenceDirty = false
  const pushPresence = async (): Promise<void> => {
    if (!handlers) return
    if (presenceRunning) {
      presenceDirty = true
      return
    }
    presenceRunning = true
    try {
      do {
        presenceDirty = false
        try {
          const groups = await handlers.presence()
          const json = JSON.stringify(groups)
          if (json !== lastPresence) {
            lastPresence = json
            send('presence:changed', groups)
          }
        } catch (e) {
          log(`presence failed: ${(e as Error)?.name ?? 'Error'}`)
        }
      } while (presenceDirty)
    } finally {
      presenceRunning = false
    }
  }

  let bridgeChain: Promise<void> = Promise.resolve()
  const restartBridge = () => {
    if (TEST_MODE) return
    bridgeChain = bridgeChain.then(async () => {
      unsubscribeBridge?.()
      await sup?.stop()
      sup = undefined
      supPort = await readPort()
      if (!state.squarelDir) return
      sup = createBridgeSupervisor({ port: supPort, squarelDir: state.squarelDir }, d)
      unsubscribeBridge = sup.onChange(() => void pushPresence())
      await sup.start()
    })
    bridgeChain = bridgeChain.catch((e) => log(`bridge restart failed: ${(e as Error)?.name ?? 'Error'}`))
  }

  const updater =
    app.isPackaged && !TEST_MODE
      ? createLauncherUpdater(createElectronUpdaterAdapter())
      : {
          check: async () =>
            ({ ok: false, reason: 'not-found', message: 'Bản chạy từ mã nguồn không tự cập nhật' }) as const,
        }

  handlers = createIpcHandlers({
    d,
    launcherVersion: app.getVersion(),
    isDev: !app.isPackaged,
    homeDir: homedir(),
    logsDir,
    isAppUrl,
    state: {
      load: async () => state,
      save: async (s) => {
        const dirChanged = s.squarelDir !== state.squarelDir
        await saveState(paths.stateFile, s)
        state = s
        if (dirChanged) restartBridge()
      },
    },
    bridge,
    dialogs: {
      async pickFolder() {
        const opts = { properties: ['openDirectory' as const] }
        const r = mainWindow
          ? await dialog.showOpenDialog(mainWindow, opts)
          : await dialog.showOpenDialog(opts)
        return r.canceled ? null : (r.filePaths[0] ?? null)
      },
      async pickFile(filters) {
        const opts = { properties: ['openFile' as const], filters }
        const r = mainWindow
          ? await dialog.showOpenDialog(mainWindow, opts)
          : await dialog.showOpenDialog(opts)
        return r.canceled ? null : (r.filePaths[0] ?? null)
      },
    },
    showItemInFolder: (p) => shell.showItemInFolder(p),
    window: {
      minimize: () => mainWindow?.minimize(),
      // TODO(T15): hide instead of minimize once the tray icon exists to bring the window back.
      close: (toTray) => (toTray ? mainWindow?.minimize() : app.quit()),
    },
    launcherUpdater: updater,
    emit: send,
    onEnvChanged: (key) => {
      if (key === 'BRIDGE_PORT') restartBridge()
    },
    log,
    licensePath: licensePath(),
    repoUrl: REPO_URL,
    openPath: async (p) => {
      if (!(await stat(p).catch(() => undefined))?.isFile()) return 'not found'
      if (testSink) {
        testSink.opened.push(p)
        return ''
      }
      return shell.openPath(p)
    },
    clipboard: {
      writeText: (t) => (testSink ? void testSink.clipboard.push(t) : clipboard.writeText(t)),
    },
    bridgeTool: async (name, input) => {
      if (testSink && fake) {
        testSink.bridgeTools.push({ name, input })
        return ''
      }
      if (!sup) throw new Error('Bridge chưa chạy')
      return sup.sendTool(name, input)
    },
    openFolder: async (p) => {
      if (testSink && fake) {
        testSink.folders.push(p)
        return
      }
      const s = await stat(p).catch(() => undefined)
      if (!s?.isDirectory()) throw new Error('Không phải thư mục')
      const err = await shell.openPath(p)
      if (err) throw new Error(err)
    },
  })

  for (const channel of handlers.channels) {
    ipcMain.handle(channel, (event, payload) =>
      (handlers as IpcHandlers).handle(
        channel,
        {
          url: event.senderFrame?.url,
          fromAppWindow: !!mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents,
        },
        payload,
      ),
    )
  }

  restartBridge()
  const scheduler = createScheduler(
    { checksMs: CHECKS_MS, updatesMs: UPDATES_MS },
    {
      checks: () => (handlers as IpcHandlers).runChecks(),
      updates: () => (handlers as IpcHandlers).checkUpdates(),
    },
    { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h as NodeJS.Timeout) },
    { onError: (job, e) => log(`${job} failed: ${(e as Error)?.name ?? 'Error'}`) },
  )
  if (!TEST_MODE) scheduler.start()
  const presenceTimer = setInterval(() => void pushPresence(), PRESENCE_POLL_MS)
  presenceTimer.unref()
  stopBackground = () => {
    scheduler.stop()
    clearInterval(presenceTimer)
  }
  return handlers
}

app.whenReady().then(async () => {
  // Handlers first, so the page never calls a channel that is not registered yet.
  try {
    await startServices()
  } catch (e) {
    console.error('[launcher] services failed to start:', (e as Error)?.message ?? e)
  }
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // TODO(T15): closeToTray / supervisor.stop() before quitting.
  app.quit()
})
