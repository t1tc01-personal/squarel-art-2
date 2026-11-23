import { useState } from 'react'
import type { ComponentView, PresenceGroup, PresenceItem } from '../../shared/model'
import { Icon, type IconName, ModelIcon } from '../components/Icon'
import { PresenceRow } from '../components/PresenceRow'

const STORAGE_KEY = 'squarel.connections.collapsed'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1'
  } catch {
    return false
  }
}
function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
  } catch {
    /* storage unavailable: the choice lasts for this session only */
  }
}

type Filter = 'all' | 'active' | 'claude'
const FILTERS: { id: Filter; icon: IconName; label: string }[] = [
  { id: 'all', icon: 'link', label: 'Tất cả kết nối' },
  { id: 'active', icon: 'list', label: 'Đang hoạt động' },
  { id: 'claude', icon: 'bolt', label: 'Phiên Claude Code' },
]

const live = (i: PresenceItem) => i.status === 'online' || i.status === 'busy'

/** The integration icon (from components:list) for a bridge tool row `tool-<id>-…`. */
function toolIcon(item: PresenceItem, components: ComponentView[]) {
  const c = components.find((x) => x.kind === 'integration' && item.id.startsWith(`tool-${x.id}-`))
  return c ? { icon: c.icon, iconKind: c.iconKind } : undefined
}

function GroupIcon({ group, components }: { group: PresenceGroup; components: ComponentView[] }) {
  if (group.id === 'claude') return <Icon name="bolt" className="group-icon is-brand" />
  if (group.id === 'services') return <Icon name="cloud" className="group-icon is-brand" />
  const first = group.items[0]
  const ic = first && toolIcon(first, components)
  return ic ? (
    <ModelIcon icon={ic.icon} iconKind={ic.iconKind} className="group-icon" />
  ) : (
    <Icon name="box" className="group-icon is-brand" />
  )
}

function Summary({ groups }: { groups: PresenceGroup[] }) {
  const items = groups.flatMap((g) => g.items)
  const n = items.filter(live).length
  const bridge = items.find((i) => i.id === 'svc-bridge')
  const ok = !bridge || live(bridge)
  return (
    <div className={`panel-summary ${ok ? 'is-ok' : 'is-warn'}`}>
      <span className="panel-summary-dot" aria-hidden="true" />
      {ok ? 'Mọi thứ ổn' : 'Bridge chưa chạy'} · {n} kết nối
    </div>
  )
}

/** Right panel "Kết nối": Claude sessions, bridge tools and services. Collapsible (remembered). */
export function ConnectionsPanel({
  groups,
  components,
}: {
  groups: PresenceGroup[]
  components: ComponentView[]
}) {
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [filter, setFilter] = useState<Filter>('all')
  const toggle = (v: boolean) => {
    setCollapsed(v)
    writeCollapsed(v)
  }

  if (collapsed)
    return (
      <aside className="panel-collapsed" aria-label="Kết nối (thu gọn)">
        <button
          type="button"
          className="icon-btn"
          aria-label="Mở rộng panel Kết nối"
          title="Mở rộng panel Kết nối"
          onClick={() => toggle(false)}
        >
          <Icon name="collapse" className="flip-x" />
        </button>
      </aside>
    )

  const shown = groups
    .filter((g) => filter !== 'claude' || g.id === 'claude')
    .map((g) => ({ ...g, items: filter === 'active' ? g.items.filter(live) : g.items }))

  return (
    <aside className="panel" aria-label="Kết nối">
      <div className="panel-head">
        <div>
          <h2 className="panel-title">Kết nối</h2>
          <Summary groups={groups} />
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Thu gọn panel Kết nối"
          title="Thu gọn panel Kết nối"
          onClick={() => toggle(true)}
        >
          <Icon name="collapse" />
        </button>
      </div>
      <div className="panel-tabs" role="tablist" aria-label="Lọc kết nối">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="tab"
            aria-selected={filter === f.id}
            aria-label={f.label}
            title={f.label}
            className={`panel-tab${filter === f.id ? ' is-active' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            <Icon name={f.icon} />
          </button>
        ))}
      </div>
      <div className="panel-groups">
        {shown.map((g) => (
          <section key={g.id} className="panel-group" aria-label={g.label}>
            <h3 className="panel-group-head">
              <GroupIcon group={g} components={components} />
              <span>{g.label}</span>
              <span className="panel-group-count">{g.items.length}</span>
            </h3>
            {g.items.length > 0 ? (
              <ul className="panel-rows">
                {g.items.map((i) => (
                  <PresenceRow
                    key={i.id}
                    item={i}
                    icon={g.id === 'tools' ? toolIcon(i, components) : undefined}
                  />
                ))}
              </ul>
            ) : (
              <p className="panel-empty">{g.id === 'claude' ? 'Chưa có phiên nào' : 'Chưa có kết nối'}</p>
            )}
          </section>
        ))}
      </div>
      <div className="panel-tip">
        <div className="panel-tip-title">Mẹo</div>
        Bảo Claude "mở trong Aseprite" để vẽ tay tiếp. Nét vẽ tự quay về Claude.
      </div>
    </aside>
  )
}
