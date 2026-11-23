/**
 * Real launcher updater adapter (electron-updater, GitHub releases of the public repo).
 * Imported only by the Electron entry point; unit tests use a fake adapter.
 * No token: the repo is public.
 */
import { autoUpdater } from 'electron-updater'
import type { UpdaterAdapter } from './launcher'

export function createElectronUpdaterAdapter(): UpdaterAdapter {
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = null
  autoUpdater.setFeedURL({ provider: 'github', owner: 't1tc01-personal', repo: 'squarel-art-2' })
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
