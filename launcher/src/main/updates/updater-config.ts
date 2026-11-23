/**
 * Settings of the real launcher updater, kept apart from electron-updater so they can be unit
 * tested without Electron. Updates download in the background, but only the user's click on
 * "Khởi động lại để cập nhật" (quitAndInstall) installs one: never on a plain quit.
 */
export interface UpdaterTarget {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  logger: unknown
  setFeedURL(options: { provider: 'github'; owner: string; repo: string }): void
}

export function configureUpdater(u: UpdaterTarget): void {
  u.autoDownload = true
  u.autoInstallOnAppQuit = false
  u.logger = null
  // No token: the repo is public.
  u.setFeedURL({ provider: 'github', owner: 't1tc01-personal', repo: 'squarel-art-2' })
}
