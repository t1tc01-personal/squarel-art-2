import { useState } from 'react'
import type { ActionRef, ComponentView, Level } from '../../shared/model'
import { useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { StatusPill } from '../components/StatusPill'
import { StepFrame, type StepProps } from './Wizard'

const MIN_NODE = '22.18'

interface Row {
  key: string
  title: string
  sub: string
  level: Level
  label: string
  action?: ActionRef
  /** Running task of this row (progress bar). */
  taskId?: string
  note?: string
}

/** Step 2: base tools, Squarel itself and its libraries. Each install waits for a click. */
export function Step2({ info, state, reload, go, log }: StepProps) {
  const { run } = useTasks()
  const [tasks, setTasks] = useState<Record<string, string>>({})
  const tool = (id: string) => info.tools.find((t) => t.id === id)
  const plan = (id: string) => info.plan.find((a) => a.componentId === id)

  const start = async (key: string, ref: ActionRef) => {
    const taskId = await run(ref)
    if (!taskId) return
    setTasks((t) => ({ ...t, [key]: taskId }))
    const end = await log.wait(taskId)
    await reload(ref.kind === 'terminal')
    void end
  }

  const status = (key: string, ok: boolean, okLabel: string): Pick<Row, 'level' | 'label'> => {
    const id = tasks[key]
    const fin = log.final(id)
    if (id && !fin) return { level: 'running', label: 'Đang cài' }
    if (ok) return { level: 'ok', label: fin?.kind === 'done' ? 'Xong' : okLabel }
    if (fin?.kind === 'error') return { level: 'error', label: 'Lỗi' }
    if (fin?.kind === 'done' && tasks[key]) return { level: 'warn', label: 'Chờ kiểm tra lại' }
    return { level: 'idle', label: 'Đang chờ' }
  }

  const toolRow = (id: string, title: string, need?: string): Row => {
    const t: ComponentView | undefined = tool(id)
    const ok = !!t?.installed && t.level !== 'error'
    const sub = t?.installed
      ? `${t.version ?? 'đã cài'}${need ? ` · cần ≥ ${need}` : ''}`
      : (t?.description ?? '')
    return { key: id, title, sub, ...status(id, ok, 'Có sẵn'), action: plan(id), taskId: tasks[id] }
  }

  const squarel = tool('squarel')
  const squarelOk = !!squarel?.installed
  const fresh = state?.mode !== 'clone'
  const rows: Row[] = []
  const store = plan('winget')
  if (store)
    rows.push({
      key: 'winget',
      title: 'App Installer (winget)',
      sub: 'Máy chưa có winget. Cài App Installer từ Microsoft Store rồi bấm Kiểm tra lại, hoặc tự cài từng công cụ.',
      level: 'warn',
      label: 'Chưa có',
      action: store,
    })
  rows.push(toolRow('git', 'Git'), toolRow('node', 'Node.js', MIN_NODE), toolRow('pnpm', 'pnpm'))
  rows.push({
    key: 'squarel',
    title: 'Squarel Art',
    sub: squarelOk
      ? `${fresh ? 'Đã tải' : 'Dùng'} v${squarel?.version ?? '?'} ở ${state?.squarelDir ?? ''}`
      : `Clone v${info.launcherVersion} về ${info.defaultInstall ?? ''}`,
    ...status('squarel', squarelOk, 'Có sẵn'),
    taskId: tasks.squarel,
    ...(!squarelOk && fresh && info.cloneCommand
      ? {
          action: {
            componentId: 'squarel',
            kind: 'install',
            id: 'clone',
            label: 'Tải về',
            needsConsent: { command: info.cloneCommand, sizeHint: '~40 MB' },
          },
        }
      : {}),
  })
  rows.push({
    key: 'deps',
    title: 'Thư viện (pnpm install)',
    sub: 'sharp, MCP SDK, ws… cài vào thư mục Squarel',
    ...status('deps', info.depsInstalled, 'Đã cài'),
    taskId: tasks.deps,
    ...(squarelOk && !info.depsInstalled
      ? {
          action: {
            componentId: 'squarel',
            kind: 'install',
            id: 'deps',
            label: 'Cài',
            needsConsent: { command: 'pnpm install', sizeHint: '~300 MB' },
          },
        }
      : {}),
  })
  rows.push({
    ...toolRow('claude-code', 'Claude Code'),
    note: 'Cài xong, mở terminal và chạy claude một lần để đăng nhập. Launcher không đăng nhập thay bạn.',
  })

  const requiredOk = info.tools
    .filter((t) => t.required && t.id !== 'launcher')
    .every((t) => t.installed && t.level !== 'error')
  const canGo = requiredOk && info.depsInstalled
  const pending = rows.filter((r) => r.level !== 'ok').length
  const lines = Object.values(tasks)
    .flatMap((id) => log.events(id))
    .filter((e) => (e.kind === 'line' || e.kind === 'done' || e.kind === 'error') && e.text)
    .map((e) => e.text as string)
    .slice(-8)

  return (
    <StepFrame
      step={2}
      title="Cài công cụ cần thiết"
      intro={
        info.winget
          ? 'Launcher cài những gì còn thiếu bằng winget, trong một cửa sổ riêng. Nếu Windows hỏi quyền admin hay winget hỏi điều khoản, bạn tự trả lời trong cửa sổ đó.'
          : 'Máy này chưa có winget: cài App Installer, hoặc mở trang tải chính thức của từng công cụ, cài xong thì bấm Kiểm tra lại. Launcher không tự tải file cài.'
      }
      footer={
        <>
          <Button type="ghost" onClick={() => void go(1)}>
            Quay lại
          </Button>
          <span className="wiz-footer-spacer" />
          <span className="wiz-footer-hint">{pending ? `Còn ${pending} mục cần làm` : 'Đủ công cụ'}</span>
          <Button type="secondary" icon="refresh" onClick={() => void reload(true)}>
            Kiểm tra lại
          </Button>
          <Button type="primary" disabled={!canGo} onClick={() => void go(3)}>
            Tiếp tục
          </Button>
        </>
      }
    >
      <div className="wiz-list">
        {rows.map((r) => (
          <InstallRow
            key={r.key}
            row={r}
            percent={log.percent(r.taskId)}
            onRun={(a) => void start(r.key, a)}
          />
        ))}
      </div>
      {lines.length > 0 && (
        <pre className="wiz-log mono-small" data-testid="install-log">
          {lines.join('\n')}
        </pre>
      )}
    </StepFrame>
  )
}

const TILE: Record<Level, IconName> = {
  ok: 'check',
  warn: 'alert',
  error: 'cross',
  running: 'refresh',
  idle: 'box',
}

function InstallRow({ row, percent, onRun }: { row: Row; percent?: number; onRun(a: ActionRef): void }) {
  const running = row.level === 'running'
  return (
    <div className={`wiz-row is-${row.level}`} data-testid="install-row">
      <span className="wiz-row-tile">
        <Icon name={TILE[row.level]} size={16} />
      </span>
      <span className="wiz-row-text">
        <span className="row-title">{row.title}</span>
        <span className="row-sub">{row.sub}</span>
        {row.note && <span className="row-sub wiz-row-note">{row.note}</span>}
      </span>
      {running && percent !== undefined && (
        <span className="wiz-progress" role="progressbar" aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
      <StatusPill level={row.level} label={row.label} />
      {row.action && !running && row.level !== 'ok' && (
        <Button
          type={row.action.id === 'download' ? 'secondary' : 'primary'}
          onClick={() => onRun(row.action as ActionRef)}
        >
          {row.action.label}
        </Button>
      )}
    </div>
  )
}
