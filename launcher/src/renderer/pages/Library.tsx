import { useEffect, useState } from 'react'
import type { ComponentView } from '../../shared/model'
import { api, type CatalogEntryView } from '../api'
import { errorText, report, useData, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Icon, ModelIcon } from '../components/Icon'
import { StatusPill } from '../components/StatusPill'
import { SubTabs } from '../components/SubTabs'
import { useNav } from '../nav'

type Filter = 'all' | 'installed' | 'soon'
const TABS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'installed', label: 'Đã cài' },
  { id: 'soon', label: 'Sắp có' },
] as const

const DOCS_URL = 'https://github.com/t1tc01-personal/squarel-art-2/blob/main/docs/integrations.md'

function IntegrationCard({ c, selected }: { c: ComponentView; selected: boolean }) {
  const { go } = useNav()
  const { setState, refresh } = useData()
  const { notify } = useTasks()
  const add = async () => {
    try {
      const s = await api.getState()
      setState(await api.setState({ selected: [...new Set([...s.selected, c.id])] }))
      refresh()
    } catch (e) {
      notify({ label: `Thêm ${c.name}`, kind: 'error', text: errorText(e) })
    }
  }
  return (
    <li className="card lib-card" data-testid="library-card" aria-label={c.name}>
      <div className="lib-card-head">
        <span className="lib-icon">
          <ModelIcon icon={c.icon} iconKind={c.iconKind} size={32} />
        </span>
        {c.incompatible ? (
          <StatusPill level="error" label="Không tương thích" />
        ) : selected && c.installed ? (
          <StatusPill level="ok" label={c.version ? `Đã cài · ${c.version}` : 'Đã cài'} />
        ) : selected ? (
          <StatusPill level="warn" label="Chưa cài" />
        ) : (
          <StatusPill level="idle" label="Chưa chọn" />
        )}
      </div>
      <h3 className="lib-name">{c.name}</h3>
      <p className="lib-desc">{c.incompatible ?? c.description}</p>
      {selected ? (
        <Button type="primary" className="lib-btn" onClick={() => go({ integration: c.id, tab: 'overview' })}>
          Mở trang
        </Button>
      ) : (
        <Button type="secondary" className="lib-btn" disabled={!!c.incompatible} onClick={add}>
          Thêm vào launcher
        </Button>
      )}
    </li>
  )
}

function SoonCard({ e }: { e: CatalogEntryView }) {
  return (
    <li className="card lib-card" data-testid="library-card" aria-label={e.name}>
      <div className="lib-card-head">
        <span className="lib-icon lib-monogram" style={{ color: e.accent }}>
          {e.icon}
        </span>
        <StatusPill level="idle" label="Sắp có" />
      </div>
      <h3 className="lib-name">{e.name}</h3>
      <p className="lib-desc">{e.description}</p>
      <span className="lib-soon">Đang chuẩn bị</span>
    </li>
  )
}

export function Library() {
  const { components, state } = useData()
  const [filter, setFilter] = useState<Filter>('all')
  const [soon, setSoon] = useState<CatalogEntryView[]>([])
  useEffect(() => {
    api.catalog().then(setSoon, report('catalog:list'))
  }, [])
  const selected = state?.selected ?? []
  const integrations = components.filter((c) => c.kind === 'integration')
  const shownInts =
    filter === 'soon'
      ? []
      : filter === 'installed'
        ? integrations.filter((c) => selected.includes(c.id) && c.installed)
        : integrations
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Thư viện tích hợp</h1>
          <p className="page-sub">
            Mỗi công cụ là một tích hợp: launcher tự cài, cập nhật, kiểm tra và mở nó.
          </p>
        </div>
        <Button type="secondary" icon="plus" onClick={() => window.open(DOCS_URL)}>
          Viết tích hợp mới
        </Button>
      </div>
      <SubTabs<Filter> tabs={TABS} active={filter} onSelect={setFilter} label="Lọc tích hợp" />
      <ul className="lib-grid">
        {shownInts.map((c) => (
          <IntegrationCard key={c.id} c={c} selected={selected.includes(c.id)} />
        ))}
        {filter !== 'installed' && soon.map((e) => <SoonCard key={e.id} e={e} />)}
        {filter === 'all' && (
          <li className="card lib-card lib-own">
            <span className="lib-icon">
              <Icon name="plus" size={24} />
            </span>
            <h3 className="lib-name">Tích hợp của bạn</h3>
            <p className="lib-desc">
              Một file integration.json: tên, icon, cách phát hiện, cài, cập nhật, health, mở.
            </p>
            <Button type="secondary" className="lib-btn" onClick={() => window.open(DOCS_URL)}>
              Xem hướng dẫn
            </Button>
          </li>
        )}
      </ul>
      <p className="info-strip">
        <Icon name="link" />
        Tích hợp mới tự có icon trên thanh bên trái, trang riêng với nút Mở, và hiện trong panel Kết nối khi
        đang chạy.
      </p>
    </div>
  )
}
