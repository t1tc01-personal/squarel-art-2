import type { ReactNode } from 'react'
import type { ComponentView } from '../../shared/model'
import { Icon, Logo, ModelIcon } from '../components/Icon'
import { type Page, railKey, useNav } from '../nav'

function RailItem({
  label,
  active,
  onClick,
  children,
  railId,
}: {
  label: string
  active?: boolean
  onClick(): void
  children: ReactNode
  railId: string
}) {
  return (
    <li className="rail-slot">
      <button
        type="button"
        className={`rail-item${active ? ' is-active' : ''}`}
        aria-label={label}
        title={label}
        aria-current={active ? 'page' : undefined}
        data-rail={railId}
        onClick={onClick}
      >
        {children}
      </button>
    </li>
  )
}

/**
 * Left icon rail: logo, home, library, ─, the selected integrations (manifest icon), ➕,
 * (space), system, settings.
 */
export function AppRail({ components, selected }: { components: ComponentView[]; selected: string[] }) {
  const { page, go } = useNav()
  const current = railKey(page)
  const integrations = components.filter((c) => c.kind === 'integration' && selected.includes(c.id))
  const item = (key: string, label: string, target: Page, icon: ReactNode) => (
    <RailItem key={key} label={label} railId={key} active={current === key} onClick={() => go(target)}>
      {icon}
    </RailItem>
  )
  return (
    <nav className="rail" aria-label="Điều hướng chính">
      <div className="rail-logo">
        <Logo cell={3} />
      </div>
      <ul className="rail-list">
        {item('home', 'Trang chủ', 'home', <Icon name="home" size={20} />)}
        {item('library', 'Thư viện tích hợp', 'library', <Icon name="grid" size={20} />)}
        <li className="rail-divider" aria-hidden="true" />
        {integrations.map((c) =>
          item(
            `int:${c.id}`,
            c.name,
            { integration: c.id, tab: 'overview' },
            <ModelIcon icon={c.icon} iconKind={c.iconKind} size={20} />,
          ),
        )}
        <RailItem label="Thêm tích hợp" railId="add" onClick={() => go('library')}>
          <Icon name="plus" size={20} />
        </RailItem>
      </ul>
      <ul className="rail-list rail-bottom">
        {item('system', 'Hệ thống', { system: 'components' }, <Icon name="heart" size={20} />)}
        {item('settings', 'Cài đặt', 'settings', <Icon name="gear" size={20} />)}
      </ul>
    </nav>
  )
}
