/**
 * Real launcher updater adapter (electron-updater, GitHub releases of the public repo).
 * Imported only by the Electron entry point; unit tests use a fake adapter.
 * No token: the repo is public. Settings live in updater-config.ts (installs only on the user's click).
 */
import { autoUpdater } from 'electron-updater'
import type { UpdaterAdapter } from './launcher'
import { configureUpdater, type UpdaterTarget } from './updater-config'

export function createElectronUpdaterAdapter(): UpdaterAdapter {
  configureUpdater(autoUpdater as unknown as UpdaterTarget)
  // An EventEmitter 'error' without a listener would throw; failures surface through checkForUpdates().
  autoUpdater.on('error', () => {})
  return {
    async checkForUpdates() {
      const r = await autoUpdater.checkForUpdates()
      return r ? { version: r.updateInfo.version } : null
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall()
    },
    onDownloaded(cb) {
      autoUpdater.on('update-downloaded', (info) => cb(info.version))
    },
  }
}
