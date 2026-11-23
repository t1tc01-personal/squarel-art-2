import { type ChildProcess, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { type ElectronApplication, expect, test } from '@playwright/test'
import { isolatedEnv, launchIsolated } from './launch'

const LAUNCHER_DIR = process.cwd()
const SQUAREL_DIR = resolve(LAUNCHER_DIR, '..')
const ELECTRON_EXE = join(
  dirname(createRequire(join(LAUNCHER_DIR, 'package.json')).resolve('electron/package.json')),
  'dist',
  'electron.exe',
)

/** A launcher that already finished setup and uses this repo as its Squarel folder. */
const REAL_STATE = {
  squarelDir: SQUAREL_DIR,
  setupStep: 'done',
  setupCompleted: true,
  selected: [],
  closeToTray: true,
}

interface TestHooks {
  bridgeMode(): string
  trayItems(): Promise<string[]>
  trayClick(label: string): boolean
  launched: { argv: string[] }[]
}
async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer()
    s.once('error', fail)
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port
      s.close(() => ok(port))
    })
  })
}

/** True while something accepts TCP connections on 127.0.0.1:port. */
function listening(port: number): Promise<boolean> {
  return new Promise((ok) => {
    const sock = connect({ host: '127.0.0.1', port })
    sock.setTimeout(1000)
    sock.once('connect', () => {
      sock.destroy()
      ok(true)
    })
    sock.once('error', () => ok(false))
    sock.once('timeout', () => {
      sock.destroy()
      ok(false)
    })
  })
}

const bridgeMode = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __squarelTest: TestHooks }).__squarelTest.bridgeMode())
const trayItems = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __squarelTest: TestHooks }).__squarelTest.trayItems())
/** Clicks a tray menu item; the click runs after this call returns (Thoát ends the app). */
const trayClick = (app: ElectronApplication, label: string) =>
  app.evaluate(
    (_e, l) => (globalThis as unknown as { __squarelTest: TestHooks }).__squarelTest.trayClick(l),
    label,
  )
const windowState = (app: ElectronApplication) =>
  app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    return w ? { visible: w.isVisible(), minimized: w.isMinimized() } : null
  })

/** Launches the launcher with a real bridge supervisor on `port` (bridge data in a temp folder). */
async function launchWithBridge(port: number, data: string) {
  return launchIsolated({
    state: REAL_STATE,
    env: { SQUAREL_LAUNCHER_TEST_BRIDGE_PORT: String(port), DATA_DIR: data },
  })
}

/** `node src/bridge/index.ts` of this repo, started by the test (i.e. not by the launcher). */
function startForeignBridge(port: number, data: string): ChildProcess {
  return spawn(process.execPath, ['src/bridge/index.ts'], {
    cwd: SQUAREL_DIR,
    env: { ...process.env, BRIDGE_PORT: String(port), DATA_DIR: data },
    stdio: 'ignore',
    windowsHide: true,
  })
}

function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) return
  spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore', windowsHide: true })
}

test.describe('tray', () => {
  let data: string
  test.beforeEach(() => {
    data = mkdtempSync(join(tmpdir(), 'squarel-launcher-e2e-data-'))
  })
  test.afterEach(() => {
    rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  })

  test('closing hides the window and the bridge keeps running', async () => {
    test.setTimeout(120_000)
    const port = await freePort()
    const { app, close } = await launchWithBridge(port, data)
    try {
      const page = await app.firstWindow()
      await expect.poll(() => bridgeMode(app), { timeout: 45_000 }).toBe('own')
      // 'own' starts at spawn; wait until the child actually listens.
      await expect.poll(() => listening(port), { timeout: 30_000 }).toBe(true)

      await page.getByRole('button', { name: 'Đóng' }).click()
      await expect.poll(async () => (await windowState(app))?.visible).toBe(false)
      await page.waitForTimeout(1500)
      expect(app.windows()).toHaveLength(1)
      expect(await bridgeMode(app)).toBe('own')
      expect(await listening(port)).toBe(true)

      const items = await trayItems(app)
      expect(items).toContain('Mở launcher')
      expect(items).toContain(`Bridge: launcher đang giữ (cổng ${port})`)
      expect(items.at(-1)).toBe('Thoát')

      // "Mở launcher" brings the hidden window back.
      await trayClick(app, 'Mở launcher')
      await expect.poll(async () => (await windowState(app))?.visible).toBe(true)
    } finally {
      await close()
    }
    // Quitting stopped the launcher's own bridge.
    await expect.poll(() => listening(port), { timeout: 10_000 }).toBe(false)
  })

  test('second instance focuses the first', async () => {
    test.setTimeout(90_000)
    const first = await launchIsolated({ fake: 'fixtures/basic' })
    try {
      const page = await first.app.firstWindow()
      await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible()
      await page.getByRole('button', { name: 'Đóng' }).click()
      await expect.poll(async () => (await windowState(first.app))?.visible).toBe(false)

      // The tray lists the selected integration with its default launch action.
      const items = await trayItems(first.app)
      expect(items).toEqual(['Mở launcher', 'Mở Aseprite…', 'Bridge: launcher đang giữ (cổng 4321)', 'Thoát'])
      await trayClick(first.app, 'Mở Aseprite…')
      await expect
        .poll(() =>
          first.app.evaluate(
            () => (globalThis as unknown as { __squarelTest: TestHooks }).__squarelTest.launched.length,
          ),
        )
        .toBe(1)

      // A second start on the same profile hands over to the first one and exits.
      const second = spawn(ELECTRON_EXE, ['.'], {
        cwd: LAUNCHER_DIR,
        env: isolatedEnv(first.root, { fake: 'fixtures/basic' }),
        stdio: 'ignore',
      })
      const code = await new Promise<number | null>((ok) => second.once('exit', ok))
      expect(code).toBe(0)
      await expect.poll(async () => await windowState(first.app)).toEqual({ visible: true, minimized: false })
      expect(first.app.windows()).toHaveLength(1)
    } finally {
      await first.close()
    }
  })

  test('Thoát stops an own bridge but leaves an attached one', async () => {
    test.setTimeout(180_000)
    // Own: the launcher started the bridge, Thoát stops it.
    const own = await freePort()
    const a = await launchWithBridge(own, data)
    try {
      await a.app.firstWindow()
      await expect.poll(() => bridgeMode(a.app), { timeout: 45_000 }).toBe('own')
      await expect.poll(() => listening(own), { timeout: 30_000 }).toBe(true)
      const closed = a.app.waitForEvent('close')
      await trayClick(a.app, 'Thoát')
      await closed
      await expect.poll(() => listening(own), { timeout: 10_000 }).toBe(false)
    } finally {
      await a.close().catch(() => {})
    }

    // Attached: someone else holds the port; Thoát leaves that bridge running.
    const port = await freePort()
    const foreign = startForeignBridge(port, data)
    try {
      await expect.poll(() => listening(port), { timeout: 30_000 }).toBe(true)
      const b = await launchWithBridge(port, data)
      try {
        await b.app.firstWindow()
        await expect.poll(() => bridgeMode(b.app), { timeout: 30_000 }).toBe('attached')
        const closed = b.app.waitForEvent('close')
        await trayClick(b.app, 'Thoát')
        await closed
      } finally {
        await b.close().catch(() => {})
      }
      await new Promise((r) => setTimeout(r, 1500))
      expect(foreign.exitCode).toBeNull()
      expect(await listening(port)).toBe(true)
    } finally {
      killTree(foreign)
    }
  })
})
