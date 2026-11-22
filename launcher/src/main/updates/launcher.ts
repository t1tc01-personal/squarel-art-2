/**
 * Launcher self-update, independent of electron: the real adapter (electron-updater.ts) is only
 * imported by index.ts, tests pass a fake adapter.
 */
import type { Latest } from '../versions'

export interface UpdaterAdapter {
  /** Resolves with the newest published version, or null when there is no update feed (dev build). */
  checkForUpdates(): Promise<{ version?: string } | null>
  quitAndInstall(): void
}

const OFFLINE =
  /ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION_(REFUSED|RESET|TIMED_OUT|CLOSED)|ERR_ADDRESS_UNREACHABLE|ERR_TIMED_OUT|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENETUNREACH/

/** First line only, capped: updater errors can carry response headers or bodies. */
function shortMessage(e: unknown): string {
  const text = String((e as Error)?.message ?? e)
  const first = (text.split(/\r?\n/)[0] ?? '').trim()
  return first.length > 200 ? `${first.slice(0, 200)}…` : first
}

export function createLauncherUpdater(adapter: UpdaterAdapter): {
  check(): Promise<Latest>
  install(): void
} {
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
      if (!/^\d+(\.\d+)+(-[0-9A-Za-z.-]+)?$/.test(version))
        return { ok: false, reason: 'error', message: 'Phiên bản cập nhật không hợp lệ' }
      return { ok: true, version }
    },
    install() {
      adapter.quitAndInstall()
    },
  }
}
