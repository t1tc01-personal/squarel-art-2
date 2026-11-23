import type { PresenceItem } from '../../shared/model'
import { ModelIcon } from './Icon'

const STATUS_LABEL: Record<PresenceItem['status'], string> = {
  online: 'đang kết nối',
  busy: 'đang làm',
  away: 'cần chú ý',
  offline: 'chưa kết nối',
}

/** One row of the Connections panel: 34px avatar with a status square, title and subtitle. */
export function PresenceRow({
  item,
  icon,
}: {
  item: PresenceItem
  /** Overrides the item's own icon (e.g. the integration's PNG for a bridge tool). */
  icon?: { icon: string; iconKind: 'name' | 'data' }
}) {
  const ic = icon ?? { icon: item.icon, iconKind: item.iconKind ?? 'name' }
  return (
    <li className={`presence-row is-${item.status}`} data-testid="presence-row">
      <span className="presence-avatar">
        <ModelIcon icon={ic.icon} iconKind={ic.iconKind} size={16} />
        <span className="presence-dot" role="img" aria-label={STATUS_LABEL[item.status]} />
      </span>
      <span className="presence-text">
        <span className="presence-title">{item.title}</span>
        <span className="presence-sub">{item.subtitle}</span>
      </span>
    </li>
  )
}
