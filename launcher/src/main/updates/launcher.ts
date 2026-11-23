/**
 * Launcher self-update, independent of electron: the real adapter (electron-updater.ts) is only
 * imported by index.ts, tests pass a fake adapter.
 */
import type { Latest } from '../versions'

export interface UpdaterAdapter {
  /** Resolves with the newest published version, or null when there is no update feed (dev build). */
  checkForUpdates(): Promise<{ version?: string } | null>
  quitAndInstall(): void
  /** electron-updater 'update-downloaded': only then may the update be installed. */
  onDownloaded?(cb: (version: string) => void): void
}

const OFFLINE =
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED)|ERR_ADDRESS_UNREACHABLE|ERR_TIMED_OUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH/

/** First line only, capped: updater errors can carry response headers or bodies. */
function shortMessage(e: unknown): string {
  const text = String((e as Error)?.message ?? e)
  const first = (text.split(/\r?\n/)[0] ?? '').trim()
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}

const VERSION = /^\d+(\.\d+)+(-[0-9A-Za-z.-]+)?$/

/** `onReady` runs once per downloaded version (e.g. to refresh the component list). */
export function createLauncherUpdater(
  adapter: UpdaterAdapter,
  onReady?: (version: string) => void,
): {
  check(): Promise<Latest>
  /** The downloaded version, once electron-updater finished downloading it. */
  ready(): string | undefined
  /** quitAndInstall, only when an update was downloaded; false otherwise. */
  install(): boolean
} {
  let downloaded: string | undefined
  adapter.onDownloaded?.((v) => {
    const version = String(v ?? '')
      .trim()
      .replace(/^v/i, '')
    if (!VERSION.test(version) || version === downloaded) return
    downloaded = version
    onReady?.(version)
  })
  return {
    async check(): Promise<Latest> {
      let res: { version?: string } | null
      try {
        res = await adapter.checkForUpdates()
      } catch (e) {
        const full = String((e as Error)?.message ?? e)
        const message = shortMessage(e)
        if (OFFLINE.test(full)) return { ok: false, reason: 'offline', message }
        if (/\b429\b|rate limit/i.test(full)) return { ok: false, reason: 'rate-limited', message }
        return { ok: false, reason: 'error', message }
      }
      const version = res?.version?.trim().replace(/^v/i, '')
      if (!version) return { ok: false, reason: 'not-found', message: 'Không có thông tin bản cập nhật' }
      if (!VERSION.test(version))
        return { ok: false, reason: 'error', message: 'Phiên bản cập nhật không hợp lệ' }
      return { ok: true, version }
    },
    ready: () => downloaded,
    install() {
      if (!downloaded) return false
      adapter.quitAndInstall()
      return true
    },
  }
}
