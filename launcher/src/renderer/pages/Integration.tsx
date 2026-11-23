/**
 * The page of one integration, built only from its ComponentView (manifest name, icon, accent,
 * launch actions, install options), its health checks and its presence row: a new manifest gets
 * a working page without code changes.
 */
import { type CSSProperties, useEffect, useState } from 'react'
import type { ActionRef, CheckResult, ComponentView, Level } from '../../shared/model'
import { api, type RecentProject } from '../api'
import { errorText, report, useData, useTasks } from '../app-context'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Icon, type IconName, ModelIcon } from '../components/Icon'
import { InstallProgress, type InstallVerb } from '../components/InstallProgress'
import { LaunchButton } from '../components/LaunchButton'
import { RowCheck } from '../components/RowCheck'
import { StatusPill } from '../components/StatusPill'
import { SubTabs } from '../components/SubTabs'
import { type IntegrationTab, useNav } from '../nav'

const TABS = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'updates', label: 'Cập nhật' },
  { id: 'health', label: 'Health' },
  { id: 'settings', label: 'Cài đặt' },
] as const

function InfoCard({
  icon,
  caption,
  level,
  levelLabel,
  title,
  sub,
  action,
  testId,
}: {
  icon: IconName
  caption: string
  level?: Level
  levelLabel?: string
  title: string
  sub?: string
  action?: { label: string; onClick(): void }
  testId: string
}) {
  return (
    <section className="card info-card" data-testid={testId} aria-label={caption}>
      <div className="info-card-head">
        <Icon name={icon} className="info-card-icon" />
        <span className="caption">{caption}</span>
        {level && levelLabel && <StatusPill level={level} label={levelLabel} />}
      </div>
      <div className="info-card-title">{title}</div>
      {sub && <div className="row-sub">{sub}</div>}
      {action && (
        <Button type="ghost" className="info-card-action" onClick={action.onClick}>
          {action.label}
        </Button>
      )}
    </section>
  )
}

const CHECK_LEVEL: Record<CheckResult['result'], Level> = { pass: 'ok', warn: 'warn', fail: 'error' }

function ProjectPicker({ onPick, onClose }: { onPick(slug: string): void; onClose(): void }) {
  const [projects, setProjects] = useState<RecentProject[] | null>(null)
  useEffect(() => {
    api.recentProjects().then(setProjects, (e) => {
      report('projects:recent')(e)
      setProjects([])
    })
  }, [])
  return (
    <div className="modal-backdrop">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pick-title"
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2 id="pick-title" className="modal-title">
          Chọn project
        </h2>
        {projects === null ? (
          <p className="modal-text">Đang đọc…</p>
        ) : projects.length === 0 ? (
          <p className="modal-text">Chưa có project nào.</p>
        ) : (
          <ul className="pick-list">
            {projects.map((p) => (
              <li key={p.slug}>
                <button type="button" className="pick-item" onClick={() => onPick(p.slug)}>
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub mono-small">{p.slug}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="modal-actions">
          <Button type="ghost" onClick={onClose}>
            Huỷ
          </Button>
        </div>
      </div>
    </div>
  )
}

function Overview({ c, checks, checked }: { c: ComponentView; checks: CheckResult[]; checked: boolean }) {
  const { presence } = useData()
  const { run, active, log } = useTasks()
  const { go } = useNav()
  const [picking, setPicking] = useState<ActionRef | null>(null)
  const [hidden, setHidden] = useState<string | null>(null)
  const launches = c.actions.filter((a) => a.kind === 'launch')
  // An install/update started from this window: its progress replaces the launch button while it
  // runs, and stays (with Thử lại) after a failure until closed.
  const job = active[c.id]
  const jobEnd = log.final(job?.taskId)
  const showJob = !!job && job.taskId !== hidden && jobEnd?.kind !== 'done'
  const jobRunning = !!job && !jobEnd
  const verb: InstallVerb =
    job?.ref.kind === 'update'
      ? 'cập nhật'
      : /build/i.test(`${job?.ref.id} ${job?.ref.label}`)
        ? 'build'
        : 'cài'
  const [main, ...more] = launches
  const tool = presence
    .filter((g) => g.id === 'tools')
    .flatMap((g) => g.items)
    .find((i) => i.componentId === c.id)
  const connected = !!tool && tool.status !== 'offline'
  const start = (a: ActionRef) => (a.pickProject ? setPicking(a) : void run(a))

  const update = c.actions.find((a) => a.kind === 'update')
  const newer = c.level === 'warn' && !!c.latest
  const ext = checks.find((r) => r.builtin === 'extension-version')

  return (
    <>
      <Banner className="int-banner">
        {jobRunning ? (
          <span className="banner-pill">Đang {verb} · mở được khi xong</span>
        ) : connected ? (
          <span className="banner-pill is-ok">Đã kết nối · {tool.subtitle}</span>
        ) : (
          <span className="banner-pill is-idle">{c.installed ? 'Chưa kết nối bridge' : c.levelLabel}</span>
        )}
        <h2 className="banner-title">{c.name}</h2>
        {!showJob && <p className="banner-text">{c.description}</p>}
        <div className="banner-launch">
          {showJob && job ? (
            <InstallProgress
              compact
              taskId={job.taskId}
              name={c.name}
              verb={verb}
              onRetry={() => void run(job.ref)}
              onDismiss={() => setHidden(job.taskId)}
            />
          ) : c.installed && main ? (
            <LaunchButton
              label={main.label}
              onLaunch={() => start(main)}
              actions={more.map((a) => ({
                id: a.id,
                label: a.label,
                icon: a.pickProject ? 'folder' : 'play',
                onSelect: () => start(a),
              }))}
            />
          ) : (
            <Button type="primary" size="lg" onClick={() => go({ integration: c.id, tab: 'settings' })}>
              Cài {c.name}
            </Button>
          )}
        </div>
      </Banner>
      <div className="info-cards">
        <InfoCard
          testId="card-update"
          icon="refresh"
          caption="Cập nhật"
          level={jobRunning ? 'running' : c.level}
          levelLabel={jobRunning ? 'Đang chạy' : c.levelLabel}
          title={`${c.name} ${(newer ? c.latest : c.version) ?? ''}`.trim()}
          sub={
            jobRunning
              ? `Đang ${verb}, xem tiến trình phía trên`
              : newer
                ? `Đang dùng ${c.version ?? '–'}`
                : c.latestError
                  ? 'Không kiểm tra được bản mới'
                  : c.version
                    ? 'Đang dùng bản mới nhất'
                    : undefined
          }
          action={
            update && !jobRunning ? { label: update.label, onClick: () => void run(update) } : undefined
          }
        />
        <InfoCard
          testId="card-extension"
          icon="plug"
          caption="Extension"
          {...(ext
            ? { level: CHECK_LEVEL[ext.result], levelLabel: ext.result === 'pass' ? 'Mới nhất' : 'Cần cài' }
            : {})}
          title={ext ? ext.detail : checked ? 'Không có extension' : 'Chưa kiểm tra'}
          sub={ext ? ext.description : checked ? undefined : 'Kết quả có sau lần health check đầu tiên'}
          action={
            ext?.fix ? { label: ext.fix.label, onClick: () => ext.fix && void run(ext.fix) } : undefined
          }
        />
        {/* Ruling: counting today's editor/claude versions means reading every project's history;
            the card shows the live bridge connection instead (recorded in the task report). */}
        <InfoCard
          testId="card-activity"
          icon="sparkle"
          caption="Hôm nay"
          level={connected ? 'ok' : 'idle'}
          levelLabel={connected ? 'Đang kết nối' : 'Không kết nối'}
          title={connected ? 'Đang kết nối' : 'Không kết nối'}
          sub={connected ? tool.subtitle : 'Mở công cụ để đồng bộ với Claude'}
        />
      </div>
      {picking && (
        <ProjectPicker
          onClose={() => setPicking(null)}
          onPick={(slug) => {
            const ref = picking
            setPicking(null)
            void run({ ...ref, project: slug })
          }}
        />
      )}
    </>
  )
}

function Updates({ c }: { c: ComponentView }) {
  const { run } = useTasks()
  const update = c.actions.find((a) => a.kind === 'update')
  return (
    <section className="card table-card">
      <div className="kv">
        <span className="caption">Đang dùng</span>
        <span className="mono-value">{c.version ?? '–'}</span>
        <span className="caption">Mới nhất</span>
        <span className={`mono-value${c.level === 'warn' ? ' is-newer' : ''}`}>{c.latest ?? '–'}</span>
        <span className="caption">Trạng thái</span>
        <span>
          <StatusPill level={c.level} label={c.levelLabel} />
        </span>
      </div>
      {c.latestError && <p className="row-sub">{c.latestError}</p>}
      {update && (
        <div className="card-actions">
          <Button type="primary" onClick={() => void run(update)}>
            {update.label}
          </Button>
        </div>
      )}
    </section>
  )
}

function Health({ c, checks }: { c: ComponentView; checks: CheckResult[] }) {
  const { run, notify } = useTasks()
  const { setChecks } = useData()
  const [busy, setBusy] = useState(false)
  const rerun = async () => {
    setBusy(true)
    try {
      const results = await api.runChecks()
      setChecks({ at: new Date().toISOString(), results })
    } catch (e) {
      notify({ label: 'Health check', kind: 'error', text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="page-actions">
        <Button type="secondary" icon="refresh" disabled={busy} onClick={rerun}>
          {busy ? 'Đang kiểm tra…' : 'Kiểm tra lại'}
        </Button>
      </div>
      <section className="card table-card" aria-label={`Kiểm tra ${c.name}`}>
        {checks.length === 0 ? (
          <p className="empty">Chưa có kết quả. Bấm "Kiểm tra lại".</p>
        ) : (
          checks.map((r) => <RowCheck key={r.id} check={r} onFix={(ref) => void run(ref)} />)
        )}
      </section>
    </>
  )
}

function SettingsTab({ c }: { c: ComponentView }) {
  const { run } = useTasks()
  const { go } = useNav()
  const installs = c.actions.filter((a) => a.kind === 'install')
  return (
    <section className="card">
      <h2 className="card-title">Cách cài</h2>
      {c.installed ? (
        <p className="row-sub">
          Đã cài{c.version ? ` bản ${c.version}` : ''}. Đường dẫn file chạy và khoá nằm trong trang Cài đặt.
        </p>
      ) : installs.length === 0 ? (
        <p className="row-sub">Tích hợp này không khai báo cách cài tự động.</p>
      ) : (
        <ul className="install-list">
          {installs.map((a) => (
            <li key={a.id} className="install-row">
              <span className="row-title">{a.label}</span>
              {a.needsConsent && <code className="mono-small row-sub">{a.needsConsent.command}</code>}
              {/* Options without a command pick an existing file: that path is set in Settings. */}
              <Button type="secondary" onClick={() => (a.needsConsent ? void run(a) : go('settings'))}>
                Chọn
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="card-actions">
        <Button type="ghost" onClick={() => go('settings')}>
          Mở trang Cài đặt
        </Button>
      </div>
    </section>
  )
}

export function Integration({ id, tab }: { id: string; tab: IntegrationTab }) {
  const { components, checks } = useData()
  const { go } = useNav()
  const c = components.find((x) => x.kind === 'integration' && x.id === id)
  const mine = (checks?.results ?? []).filter((r) => r.group === `integration:${id}`)
  const style = c?.accent ? ({ '--accent-int': c.accent } as CSSProperties) : undefined
  return (
    <div className="page page-int" style={style} data-accent={c?.accent}>
      <div className="page-head">
        <div className="int-title">
          {c && <ModelIcon icon={c.icon} iconKind={c.iconKind} size={28} />}
          <h1 className="page-title">{c?.name ?? id}</h1>
        </div>
        <SubTabs
          tabs={TABS}
          active={tab}
          badges={c?.level === 'warn' ? ['updates'] : []}
          onSelect={(t) => go({ integration: id, tab: t })}
          label={`Mục của ${c?.name ?? id}`}
        />
      </div>
      {!c ? (
        <p className="empty">Đang tải…</p>
      ) : tab === 'overview' ? (
        <Overview c={c} checks={mine} checked={!!checks} />
      ) : tab === 'updates' ? (
        <Updates c={c} />
      ) : tab === 'health' ? (
        <Health c={c} checks={mine} />
      ) : (
        <SettingsTab c={c} />
      )}
    </div>
  )
}
