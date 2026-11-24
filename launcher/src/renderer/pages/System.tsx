import { useCallback, useEffect, useState } from 'react'
import type { CheckResult } from '../../shared/model'
import { api, type LogLine, type LogsResult, type UpdatesInfo } from '../api'

import { errorText, useData, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Icon } from '../components/Icon'
import { RowCheck } from '../components/RowCheck'
import { RowComponent } from '../components/RowComponent'
import { StatusPill } from '../components/StatusPill'
import { SubTabs } from '../components/SubTabs'
import { formatLogLine, squarelPlanText } from '../format'
import { type SystemTab, useNav } from '../nav'

const TABS = [
  { id: 'components', label: 'Thành phần' },
  { id: 'health', label: 'Health check' },
  { id: 'logs', label: 'Nhật ký' },
] as const

function Components() {
  const { components } = useData()
  const { run, track, notify } = useTasks()
  const [checking, setChecking] = useState(false)
  const [info, setInfo] = useState<UpdatesInfo | null>(null)
  const core = components.filter((c) => c.kind === 'core')
  const updatable = core.filter((c) => c.actions.some((a) => a.kind === 'update'))
  const check = async () => {
    setChecking(true)
    try {
      setInfo(await api.checkUpdates())
    } catch (e) {
      notify({ label: 'Kiểm tra cập nhật', kind: 'error', text: errorText(e) })
    } finally {
      setChecking(false)
    }
  }
  const plan = info?.squarel
  const finishing = plan?.kind === 'tag' && plan.from === plan.to
  const applyAll = () => {
    // A Squarel tag plan (also "finishing" a half-done update, from === to) goes through
    // updates:apply, which installs a downloaded launcher update first and then moves Squarel.
    if (plan?.kind === 'tag') {
      void track(finishing ? 'Hoàn tất cập nhật' : 'Cập nhật', () => api.applyUpdates())
      return
    }
    const first = updatable.flatMap((c) => c.actions.filter((a) => a.kind === 'update'))[0]
    if (first) void run(first)
  }
  return (
    <>
      <div className="page-head-row">
        <p className="page-sub">
          Lõi của Squarel và công cụ nền. Công cụ vẽ nằm ở trang riêng của từng tích hợp.
        </p>
        <div className="page-actions">
          <Button type="secondary" icon="refresh" disabled={checking} onClick={check}>
            {checking ? 'Đang kiểm tra…' : 'Kiểm tra'}
          </Button>
          {(updatable.length > 0 || finishing) && (
            <Button type="primary" onClick={applyAll}>
              {finishing ? 'Hoàn tất cập nhật' : `Cập nhật (${updatable.length})`}
            </Button>
          )}
        </div>
      </div>
      {plan && (
        <p className="plan-line" data-testid="squarel-plan">
          {squarelPlanText(plan)}
        </p>
      )}
      <section className="card table-card comp-table" aria-label="Thành phần">
        <div className="row-comp row-head caption">
          <span />
          <span>Thành phần</span>
          <span>Đang dùng</span>
          <span>Mới nhất</span>
          <span>Trạng thái</span>
          <span />
        </div>
        {core.map((c, i) => (
          <div key={c.id} data-testid="component-row" data-id={c.id}>
            <RowComponent
              component={c}
              primary={i === core.findIndex((x) => x.actions.some((a) => a.kind === 'update'))}
              onAction={(ref) => void run(ref)}
            />
          </div>
        ))}
      </section>
    </>
  )
}

const GROUPS: Record<string, string> = {
  claude: 'Claude',
  bridge: 'Bridge & công cụ',
  ai: 'Ảnh AI',
  machine: 'Máy',
}

function hhmm(iso: string): string {
  const d = new Date(iso)
  return Number.isFinite(d.getTime())
    ? `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    : ''
}

function Health() {
  const { checks, setChecks, components } = useData()
  const { run, notify } = useTasks()
  const [busy, setBusy] = useState(false)
  const rerun = useCallback(async () => {
    setBusy(true)
    try {
      const results = await api.runChecks()
      setChecks({ at: new Date().toISOString(), results })
    } catch (e) {
      notify({ label: 'Health check', kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }, [setChecks, notify])
  // First visit without any result yet: run once.
  useEffect(() => {
    if (!checks) void rerun()
  }, [checks, rerun])

  const results = checks?.results ?? []
  const groups: { id: string; label: string; items: CheckResult[] }[] = []
  for (const r of results) {
    let g = groups.find((x) => x.id === r.group)
    if (!g) {
      const intId = r.group.startsWith('integration:') ? r.group.slice(12) : undefined
      const label = intId
        ? (components.find((c) => c.id === intId)?.name ?? intId)
        : (GROUPS[r.group] ?? r.group)
      g = { id: r.group, label, items: [] }
      groups.push(g)
    }
    g.items.push(r)
  }
  const count = (k: CheckResult['result']) => results.filter((r) => r.result === k).length
  return (
    <>
      <div className="page-head-row">
        <p className="page-sub">
          {checks ? `Chạy lúc ${hhmm(checks.at)} · ` : ''}tự chạy lại mỗi 10 phút khi launcher đang mở
        </p>
        <div className="page-actions">
          {count('pass') > 0 && <StatusPill level="ok" label={`${count('pass')} đạt`} />}
          {count('warn') > 0 && <StatusPill level="warn" label={`${count('warn')} cảnh báo`} />}
          {count('fail') > 0 && <StatusPill level="error" label={`${count('fail')} lỗi`} />}
          <Button type="primary" icon="refresh" disabled={busy} onClick={rerun}>
            {busy ? 'Đang chạy…' : 'Chạy lại tất cả'}
          </Button>
        </div>
      </div>
      <section className="card table-card">
        {groups.length === 0 && <p className="empty">{busy ? 'Đang kiểm tra…' : 'Chưa có kết quả.'}</p>}
        {groups.map((g) => (
          <section key={g.id} className="check-group" aria-label={g.label} data-testid="check-group">
            <h3 className="check-group-head caption">{g.label}</h3>
            {g.items.map((r) => (
              <RowCheck key={r.id} check={r} onFix={(ref) => void run(ref)} />
            ))}
          </section>
        ))}
      </section>
    </>
  )
}

const LEVELS = [
  { id: 'info', label: 'Info' },
  { id: 'warn', label: 'Cảnh báo' },
  { id: 'error', label: 'Lỗi' },
] as const
type LevelFilter = (typeof LEVELS)[number]['id']

const SOURCE_LABEL: Record<string, string> = {
  launcher: 'Launcher',
  bridge: 'Bridge',
  mcp: 'MCP',
  cli: 'CLI',
}

function time(ts: string): string {
  const d = new Date(ts)
  if (!ts || !Number.isFinite(d.getTime())) return '--:--:--'
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Log lines have no id; number them once (a result never reorders). */
function keyed(lines: LogLine[]): { l: LogLine; k: number }[] {
  let n = 0
  return lines.map((l) => ({ l, k: n++ }))
}

function Logs() {
  const { notify } = useTasks()
  const [source, setSource] = useState<string | undefined>()
  const [level, setLevel] = useState<LevelFilter>('info')
  const [data, setData] = useState<LogsResult | null>(null)
  const [sources, setSources] = useState<string[]>([])

  useEffect(() => {
    let alive = true
    api.readLogs({ ...(source ? { source } : {}), level }).then(
      (r) => {
        if (!alive) return
        setData(r)
        setSources((s) => [...new Set([...s, ...r.sources])].sort())
      },
      (e) => notify({ label: 'Nhật ký', kind: 'error', text: errorText(e) }),
    )
    return () => {
      alive = false
    }
  }, [source, level, notify])

  const copy = async () => {
    const text = (data?.lines ?? []).map(formatLogLine).join('\n')
    try {
      await api.writeClipboard({ text })
      notify({
        label: 'Sao chép cho Claude',
        kind: 'done',
        text: `Đã chép ${data?.lines.length ?? 0} dòng (khoá đã che)`,
      })
    } catch (e) {
      notify({ label: 'Sao chép cho Claude', kind: 'error', text: errorText(e) })
    }
  }
  const dir = data?.dir
  return (
    <>
      <div className="page-head-row">
        <p className="page-sub mono-small">
          {dir ? `${dir} · khoá API luôn được che` : 'khoá API luôn được che'}
        </p>
        <div className="page-actions">
          {dir && (
            <Button
              type="ghost"
              icon="folder"
              onClick={() =>
                api
                  .reveal({ path: dir })
                  .catch((e) => notify({ label: 'Mở thư mục log', kind: 'error', text: errorText(e) }))
              }
            >
              Mở thư mục log
            </Button>
          )}
          <Button type="secondary" onClick={copy}>
            Sao chép cho Claude
          </Button>
        </div>
      </div>
      <div className="log-filters">
        <fieldset className="chip-row">
          <legend className="sr-only">Nguồn</legend>
          {[undefined, ...sources].map((s) => (
            <button
              key={s ?? 'all'}
              type="button"
              className={`chip${source === s ? ' is-active' : ''}`}
              aria-pressed={source === s}
              onClick={() => setSource(s)}
            >
              {s ? (SOURCE_LABEL[s] ?? s) : 'Tất cả'}
            </button>
          ))}
        </fieldset>
        <SubTabs<LevelFilter> tabs={LEVELS} active={level} onSelect={setLevel} label="Mức" />
      </div>
      <section className="card log-view" aria-label="Nhật ký" data-testid="log-view">
        {(data?.lines ?? []).length === 0 ? (
          <p className="empty">Không có dòng nào.</p>
        ) : (
          <ol className="log-lines mono-small">
            {keyed(data?.lines ?? []).map(({ l, k }) => (
              <li key={k} className={`log-line is-${l.level}`} data-testid="log-line">
                <span className="log-time">{time(l.ts)}</span>
                <span className="log-level">{l.level.toUpperCase()}</span>
                <span className="log-source">{l.source}</span>
                <span className="log-text">{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  )
}

export function System({ tab }: { tab: SystemTab }) {
  const { go } = useNav()
  const { components } = useData()
  const badge = components.some((c) => c.kind === 'core' && c.actions.some((a) => a.kind === 'update'))
  return (
    <div className="page">
      <div className="page-head">
        <div className="int-title">
          <Icon name="heart" size={28} className="is-brand" />
          <h1 className="page-title">Hệ thống</h1>
        </div>
        <SubTabs
          tabs={TABS}
          active={tab}
          badges={badge ? ['components'] : []}
          onSelect={(t) => go({ system: t })}
          label="Mục hệ thống"
        />
      </div>
      {tab === 'components' ? <Components /> : tab === 'health' ? <Health /> : <Logs />}
    </div>
  )
}
