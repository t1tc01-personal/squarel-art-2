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
import { createQuitController } from './lifecycle'
import { pruneLauncherLogs } from './logs'
import {
  clearOwnRecord,
  type OrphanDeps,
  recordOwnBridge,
  recoverOrphanBridge,
  windowsProcInfo,
} from './orphan'
import { appPaths } from './paths'
import { createScheduler } from './scheduler'
import { type LauncherState, loadState, saveState } from './state'
import { createTray, type LauncherTray } from './tray'
import type { TrayAction } from './tray-menu'
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
 * One launcher per profile. Electron scopes the lock to userData, so a test run (userData in its
 * temp APPDATA, set just above) never collides with a launcher the developer has open.
 */
const PRIMARY = app.requestSingleInstanceLock()
if (!PRIMARY) app.quit()

/** Started at Windows login (`--hidden`): stay in the tray, no window until asked. */
const START_HIDDEN = process.argv.includes('--hidden')

/**
 * Fake mode (e2e of the UI): main runs on createDeps('fake') from test/<fixture>. Honoured only in
 * test mode (isolated profile, unpackaged build) and only for a `fixtures/<name>` value.
 */
const FAKE_NAME = process.env.SQUAREL_LAUNCHER_FAKE ?? ''
const FAKE_MODE = TEST_MODE && FAKE_FIXTURE.test(FAKE_NAME)

/**
 * Test mode only (e2e of the tray / quit path): run the real bridge supervisor on this port
 * instead of none. Never with a fake world; ignored in a packaged build like all of test mode.
 */
const TEST_BRIDGE_PORT = (() => {
  const v = process.env.SQUAREL_LAUNCHER_TEST_BRIDGE_PORT ?? ''
  const n = Number(v)
  return TEST_MODE && !FAKE_MODE && /^\d{1,5}$/.test(v) && n >= 1024 && n <= 65535 ? n : undefined
})()
/** Whether this run supervises a bridge at all. */
const BRIDGE_ENABLED = !TEST_MODE || TEST_BRIDGE_PORT !== undefined

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
  /** Quit confirmations that would have been asked (answered "stop and quit"). */
  quitPrompts: string[][]
  bridgeMode(): string
  trayItems(): Promise<string[]>
  /** Clicks a tray entry on the next tick (so the call returns before e.g. Thoát ends the app). */
  trayClick(label: string): boolean
}
const testSink: TestSink | undefined = TEST_MODE
  ? {
      launched: [],
      bridgeTools: [],
      opened: [],
      folders: [],
      external: [],
      clipboard: [],
      quitPrompts: [],
      bridgeMode: () => 'down',
      trayItems: async () => [],
      trayClick: () => false,
    }
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
let tray: LauncherTray | undefined
/** closeToTray of the current state (kept in sync by startServices). */
let closeToTray = true

/** Brings the launcher window up (tray, second instance), creating it when it was closed. */
function showWindow(): void {
  const win = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWindow(true)
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
}

function createWindow(show: boolean): BrowserWindow {
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
  win.once('ready-to-show', () => {
    if (show) win.show()
  })
  // Alt+F4 / taskbar close behave like the title bar's close button.
  win.on('close', (event) => {
    if (quit.quitting) return
    event.preventDefault()
    if (closeToTray) win.hide()
    else app.quit()
  })
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

/** Stops the scheduler and presence polling (quit path). The bridge is separate. */
export function stopBackgroundWork(): void {
  stopBackground?.()
  stopBackground = undefined
}

/** What the quit path needs from the running services (set by startServices). */
let services:
  | {
      handlers: IpcHandlers
      bridge(): BridgeState
      /** No bridge may (re)start from now on (quit decided). */
      beginQuit(): void
      stopBridge(): Promise<void>
      killOwnChild(): void
      onTrayAction(action: TrayAction): void
    }
  | undefined

/** Autostart at Windows login (opt-in, packaged builds only). */
function applyAutostart(on: boolean): void {
  if (!app.isPackaged) return
  try {
    app.setLoginItemSettings({ openAtLogin: on, args: ['--hidden'] })
  } catch (e) {
    console.warn('[launcher] autostart failed:', (e as Error)?.name ?? e)
  }
}

/** Quit sequencing (lifecycle.ts): tasks → background work → graceful bridge stop → quit. */
const quit = createQuitController({
  runningTasks: () => services?.handlers.runningTasks() ?? [],
  async confirmStopTasks(labels) {
    if (testSink) {
      testSink.quitPrompts.push(labels)
      return true
    }
    showWindow()
    const opts = {
      type: 'warning' as const,
      buttons: ['Dừng và thoát', 'Huỷ'],
      defaultId: 1,
      cancelId: 1,
      title: 'Squarel Art Launcher',
      message: 'Đang có thao tác chạy',
      detail: `${labels.join('\n')}\n\nThoát bây giờ sẽ dừng các thao tác này.`,
    }
    const r = mainWindow ? await dialog.showMessageBox(mainWindow, opts) : await dialog.showMessageBox(opts)
    return r.response === 0
  },
  beginQuit: () => services?.beginQuit(),
  abortTasks: async () => services?.handlers.abortTasks(),
  stopBackgroundWork,
  stopBridge: async () => services?.stopBridge(),
  killOwnChild: () => services?.killOwnChild(),
  quit: () => app.quit(),
  log: (m) => console.warn(`[launcher] ${m}`),
})

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
  if (!fake) void pruneLauncherLogs(logsDir, d)

  let state: LauncherState = await loadState(paths.stateFile)
  if (fake) state = { ...state, ...fake.state }
  closeToTray = state.closeToTray
  applyAutostart(state.autostart)
  const readPort = async (): Promise<number> => {
    if (TEST_BRIDGE_PORT !== undefined) return TEST_BRIDGE_PORT
    if (!state.squarelDir) return DEFAULT_BRIDGE_PORT
    try {
      const doc = parseEnv(String(await d.fs.readFile(join(state.squarelDir, '.env'), 'utf8')))
      const n = Number(readVar(doc, 'BRIDGE_PORT'))
      return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : DEFAULT_BRIDGE_PORT
    } catch {
      return DEFAULT_BRIDGE_PORT
    }
  }

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

  // Orphan recovery (B11): the pid of the bridge we spawn is kept next to state.json until it exits.
  const ownerFile = join(dirname(paths.stateFile), 'bridge-owner.json')
  const owner: OrphanDeps = {
    read: async () => {
      try {
        return String(await d.fs.readFile(ownerFile, 'utf8'))
      } catch {
        return undefined
      }
    },
    write: async (text) => {
      await d.fs.mkdir(dirname(ownerFile), { recursive: true })
      // tmp + rename: a crash mid-write never leaves a half record.
      const tmp = `${ownerFile}.${process.pid}.tmp`
      await d.fs.writeFile(tmp, text)
      try {
        await d.fs.rename(tmp, ownerFile)
      } catch (e) {
        await d.fs.rm(tmp, { force: true }).catch(() => {})
        throw e
      }
    },
    remove: () => d.fs.rm(ownerFile, { force: true }),
    isPidAlive: (pid) => d.isPidAlive(pid),
    procInfo: (pid) => windowsProcInfo(pid, d),
    kill: async (pid) => {
      try {
        process.kill(pid)
      } catch {}
      for (let i = 0; i < 30 && d.isPidAlive(pid); i++) await new Promise((r) => setTimeout(r, 100))
    },
    log,
  }
  /** Pid of the most recent own bridge (its record is cleared on a normal quit). */
  let lastOwnPid: number | undefined
  /** The supervisor's deps: every own bridge it spawns is recorded. */
  const supDeps: Deps = {
    ...d,
    spawnBridge: (o) => {
      const child = d.spawnBridge(o)
      lastOwnPid = child.pid
      void recordOwnBridge(owner, child, Number(o.env?.BRIDGE_PORT) || supPort, d.now())
      return child
    },
  }

  /** Paused while a Squarel update/install moves the code; stopped for good on quit. */
  let bridgePauses = 0
  let bridgeStopped = false
  let bridgeChain: Promise<void> = Promise.resolve()
  const chainBridge = (step: () => Promise<void>) => {
    bridgeChain = bridgeChain
      .then(step)
      .catch((e) => log(`bridge restart failed: ${(e as Error)?.name ?? 'Error'}`))
    return bridgeChain
  }
  const stopSupervisor = async () => {
    unsubscribeBridge?.()
    unsubscribeBridge = undefined
    await sup?.stop()
    sup = undefined
  }
  const restartBridge = () => {
    if (!BRIDGE_ENABLED || fake) return
    void chainBridge(async () => {
      await stopSupervisor()
      if (bridgeStopped || bridgePauses > 0) return
      supPort = await readPort()
      if (!state.squarelDir) return
      sup = createBridgeSupervisor({ port: supPort, squarelDir: state.squarelDir }, supDeps)
      unsubscribeBridge = sup.onChange(() => void pushPresence())
      await sup.start()
    })
  }
  if (BRIDGE_ENABLED && !fake)
    void chainBridge(async () => {
      const outcome = await recoverOrphanBridge(owner)
      if (outcome !== 'none') log(`bridge record from an earlier run: ${outcome}`)
    })

  // electron-updater downloads in the background; the install action appears once it is done.
  const realUpdater =
    app.isPackaged && !TEST_MODE
      ? createLauncherUpdater(createElectronUpdaterAdapter(), (v) => {
          log(`launcher update ${v} downloaded`)
          send('components:changed', null)
        })
      : undefined
  const updater = realUpdater ?? {
    check: async () =>
      ({ ok: false, reason: 'not-found', message: 'Bản chạy từ mã nguồn không tự cập nhật' }) as const,
    ready: () => undefined,
  }

  handlers = createIpcHandlers({
    d,
    launcherVersion: app.getVersion(),
    isDev: !app.isPackaged,
    homeDir: fake?.homeDir ?? homedir(),
    logsDir,
    isAppUrl,
    state: {
      load: async () => state,
      save: async (s) => {
        const dirChanged = s.squarelDir !== state.squarelDir
        const autostartChanged = s.autostart !== state.autostart
        await saveState(paths.stateFile, s)
        state = s
        closeToTray = s.closeToTray
        if (autostartChanged) applyAutostart(s.autostart)
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
      close: (toTray) => (toTray ? mainWindow?.hide() : app.quit()),
    },
    launcherUpdater: updater,
    ...(realUpdater
      ? {
          // Same graceful stop as Thoát (tasks, bridge), then electron-updater installs and restarts.
          installLauncherUpdate: () =>
            setTimeout(
              () =>
                void quit.shutdown(() => {
                  if (!realUpdater.install()) app.quit()
                }),
              0,
            ),
        }
      : {}),
    pauseBridge: async () => {
      if (!BRIDGE_ENABLED || fake) return { wasOwn: false, resume: () => {} }
      bridgePauses++
      let wasOwn = false
      await chainBridge(async () => {
        wasOwn = sup?.state().mode === 'own'
        await stopSupervisor()
      })
      let resumed = false
      return {
        wasOwn,
        resume: () => {
          if (resumed) return
          resumed = true
          bridgePauses--
          restartBridge()
        },
      }
    },
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
    openExternal: async (url) => {
      if (!url.startsWith('https://')) throw new Error('Chỉ mở trang https')
      if (testSink) testSink.external.push(url)
      else await shell.openExternal(url)
    },
    ...(fake?.smoke ? { smoke: fake.smoke } : {}),
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

  const h = handlers
  services = {
    handlers: h,
    bridge,
    beginQuit() {
      bridgeStopped = true
    },
    async stopBridge() {
      bridgeStopped = true
      await chainBridge(stopSupervisor)
      // The exit handler's async cleanup may not run before the process ends: clear it here.
      if (lastOwnPid) await clearOwnRecord(owner, lastOwnPid)
    },
    killOwnChild: () => sup?.killOwnChild(),
    onTrayAction(action) {
      if (action.kind === 'show') return showWindow()
      if (action.kind === 'quit') return app.quit()
      h.runAction(action.ref).catch((e) => {
        const text = String((e as Error)?.message ?? e).slice(0, 200)
        log(`tray action failed: ${(e as Error)?.name ?? 'Error'}`)
        tray?.notify('Squarel Art Launcher', text)
      })
    },
  }
  if (testSink) testSink.bridgeMode = () => bridge().mode
  return handlers
}

/** The tray model: selected integrations (default launch action) and the bridge mode. */
function startTray(): void {
  const s = services
  if (!s) return
  try {
    tray = createTray({
      model: async () => ({
        integrations: await s.handlers.trayIntegrations().catch(() => []),
        bridge: s.bridge(),
      }),
      onAction: (a) => s.onTrayAction(a),
      log: (m) => console.warn(`[launcher] ${m}`),
    })
  } catch (e) {
    console.error('[launcher] tray failed:', (e as Error)?.message ?? e)
    return
  }
  if (testSink) {
    const t = tray
    testSink.trayItems = async () =>
      (await t.items()).map((i) => (i.type === 'separator' ? '' : i.label)).filter(Boolean)
    testSink.trayClick = (label) => {
      setTimeout(() => void t.click(label), 0)
      return true
    }
  }
}

if (PRIMARY) {
  /** A second instance that arrives before the window exists is answered once it does. */
  let windowCreated = false
  let showWhenCreated = false
  app.on('second-instance', () => {
    if (windowCreated) showWindow()
    else showWhenCreated = true
  })
  app.on('before-quit', (event) => quit.beforeQuit(event))
  app.on('will-quit', () => tray?.destroy())
  process.on('exit', () => quit.exit())
  // The tray keeps the app alive without a window; quitting goes through before-quit only.
  app.on('window-all-closed', () => {})

  app.whenReady().then(async () => {
    // Handlers first, so the page never calls a channel that is not registered yet.
    try {
      await startServices()
    } catch (e) {
      console.error('[launcher] services failed to start:', (e as Error)?.message ?? e)
    }
    startTray()
    // Without a tray icon there would be no way back to a hidden window.
    createWindow(!START_HIDDEN || !tray)
    windowCreated = true
    if (showWhenCreated) showWindow()
    app.on('activate', () => showWindow())
  })
}
