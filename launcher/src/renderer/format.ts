/** Pure text helpers of the pages (no window access, so unit tests can import them). */
import type { LogLine, UpdatesInfo } from '../shared/ipc'

/** "2 giờ trước", "hôm qua", … relative to now. */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ''
  const min = Math.max(0, Math.round((now - t) / 60_000))
  if (min < 1) return 'vừa xong'
  if (min < 60) return `${min} phút trước`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} giờ trước`
  const days = Math.round(h / 24)
  return days === 1 ? 'hôm qua' : `${days} ngày trước`
}

/** Text for the Squarel update plan; a tag plan already at its target finishes an interrupted update. */
export function squarelPlanText(p: UpdatesInfo['squarel']): string {
  switch (p.kind) {
    case 'tag':
      return p.from === p.to ? 'Hoàn tất cập nhật' : `Squarel ${p.from ?? '?'} → ${p.to}`
    case 'branch':
      return `Squarel đang ở nhánh ${p.branch}: không tự cập nhật`
    case 'blocked':
    case 'error':
      return p.message
    default:
      return 'Squarel đã đúng phiên bản'
  }
}

/** One line as copied for Claude: time, level, source, text (already redacted by main). */
export function formatLogLine(l: LogLine): string {
  return `${l.ts || '-'} ${l.level.toUpperCase()} ${l.source} ${l.text}`
}
