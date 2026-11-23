/**
 * System tray icon (spec §5): left click opens the launcher; the right-click menu is rebuilt from
 * the current model each time it opens (integrations and bridge mode change while running).
 */
import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron'
import { logoPng, type TrayAction, type TrayItem, type TrayModel, trayItems } from './tray-menu'

export interface LauncherTray {
  /** The menu entries as they would show now (test hooks). */
  items(): Promise<TrayItem[]>
  /** Runs the entry with this label, as a click would. */
  click(label: string): Promise<boolean>
  /** Windows balloon (e.g. a tray action failed while the window is hidden). */
  notify(title: string, content: string): void
  destroy(): void
}

function icon(): Electron.NativeImage {
  const img = nativeImage.createFromBuffer(logoPng(16), { scaleFactor: 1 })
  img.addRepresentation({ scaleFactor: 2, buffer: logoPng(32) })
  return img
}

export function createTray(opts: {
  model(): Promise<TrayModel>
  onAction(action: TrayAction): void
  log?(message: string): void
}): LauncherTray {
  const tray = new Tray(icon())
  tray.setToolTip('Squarel Art Launcher')

  const items = async (): Promise<TrayItem[]> => trayItems(await opts.model())
  const toMenu = (list: TrayItem[]): Menu =>
    Menu.buildFromTemplate(
      list.map((i): MenuItemConstructorOptions => {
        if (i.type === 'separator') return { type: 'separator' }
        const action = i.action
        return {
          label: i.label,
          enabled: i.enabled ?? true,
          ...(action ? { click: () => opts.onAction(action) } : {}),
        }
      }),
    )

  tray.on('click', () => opts.onAction({ kind: 'show' }))
  tray.on('right-click', () => {
    items().then(
      (list) => {
        if (!tray.isDestroyed()) tray.popUpContextMenu(toMenu(list))
      },
      (e) => opts.log?.(`tray menu failed: ${(e as Error)?.name ?? 'Error'}`),
    )
  })

  return {
    items,
    async click(label) {
      const hit = (await items()).find((i) => i.type !== 'separator' && i.label === label)
      if (!hit || hit.type === 'separator' || !hit.action || hit.enabled === false) return false
      opts.onAction(hit.action)
      return true
    },
    notify(title, content) {
      if (!tray.isDestroyed()) tray.displayBalloon({ title, content, iconType: 'warning' })
    },
    destroy() {
      if (!tray.isDestroyed()) tray.destroy()
    },
  }
}
