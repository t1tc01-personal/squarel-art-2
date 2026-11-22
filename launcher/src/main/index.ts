import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { app, BrowserWindow, shell } from 'electron'

const BG_APP = '#0D0E12'

const RENDERER_FILE = join(import.meta.dirname, '../renderer/index.html')

/** True only for the app's own page: the dev server URL or the packaged index.html. */
export function isAppUrl(url: string): boolean {
  const dev = process.env.ELECTRON_RENDERER_URL
  try {
    if (dev) return new URL(url).origin === new URL(dev).origin
    const target = new URL(url)
    return target.protocol === 'file:' && target.pathname === pathToFileURL(RENDERER_FILE).pathname
  } catch {
    return false
  }
}

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
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  const block = (event: { preventDefault: () => void }, url: string) => {
    if (!isAppUrl(url)) event.preventDefault()
  }
  win.webContents.on('will-navigate', block)
  win.webContents.on('will-redirect', block)
  win.once('ready-to-show', () => win.show())
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(RENDERER_FILE)
  }
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
