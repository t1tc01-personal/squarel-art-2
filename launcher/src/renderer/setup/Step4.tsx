import { useState } from 'react'
import type { SetupCheckId } from '../../shared/ipc'
import type { ActionRef, CheckResult } from '../../shared/model'
import { api } from '../api'
import { errorText, useData, useTasks } from '../app-context'
import { Button } from '../components/Button'
import { Icon, type IconName } from '../components/Icon'
import { StepFrame, type StepProps } from './Wizard'

type Result = CheckResult['result'] | 'running' | 'idle'

interface ConnectRow {
  key: string
  title: string
  sub: string
  result: Result
  detail?: string
}

const TRY_PROMPT = '/pixel-new một hiệp sĩ 32×32 cho game, palette PICO-8'

const TILE: Record<Result, IconName> = {
  pass: 'check',
  warn: 'alert',
  fail: 'cross',
  running: 'refresh',
  idle: 'box',
}

/** Step 4: register the MCP server, copy the skills, smoke-test, then integration extensions. */
export function Step4({ info, state, go, log, builds }: StepProps) {
  const { run, notify } = useTasks()
  const { components } = useData()
  const [rows, setRows] = useState<Record<string, { result: Result; detail?: string }>>({})
  const [busy, setBusy] = useState(false)
  const [ext, setExt] = useState<Record<string, string>>({})

  const set = (key: string, result: Result, detail?: string) =>
    setRows((r) => ({ ...r, [key]: { result, ...(detail !== undefined ? { detail } : {}) } }))

  const check = async (key: string, id: SetupCheckId): Promise<boolean> => {
    set(key, 'running')
    try {
      const r = await api.runCheck({ id })
      set(key, r.result, r.detail)
      return r.result !== 'fail'
    } catch (e) {
      set(key, 'fail', errorText(e))
      return false
    }
  }

  const action = async (key: string, ref: ActionRef, ok: (text: string) => string): Promise<boolean> => {
    set(key, 'running')
    const taskId = await run(ref)
    if (!taskId) {
      set(key, 'fail', 'Không chạy được')
      return false
    }
    const end = await log.wait(taskId)
    set(key, end.kind === 'done' ? 'pass' : 'fail', end.kind === 'done' ? ok(end.text ?? '') : end.text)
    return end.kind === 'done'
  }

  const connect = async () => {
    setBusy(true)
    try {
      if (!(await check('claude', 'claude-installed'))) return
      await action(
        'register',
        { componentId: 'squarel', kind: 'fix', id: 'register-mcp', label: 'Đăng ký Squarel với Claude Code' },
        () => 'scope: user',
      )
      await action(
        'skills',
        { componentId: 'squarel', kind: 'fix', id: 'copy-skills', label: 'Chép skill cho Claude Code' },
        (text) => {
          const n = /Đã chép (\d+) skill/.exec(text)?.[1]
          return n ? `${n} / ${n}` : text
        },
      )
      await check('smoke', 'mcp-starts')
      await check('sees', 'claude-sees-squarel')
    } finally {
      setBusy(false)
    }
  }

  const row = (key: string, title: string, sub: string): ConnectRow => ({
    key,
    title,
    sub,
    result: rows[key]?.result ?? 'idle',
    ...(rows[key]?.detail ? { detail: rows[key].detail } : {}),
  })
  const list: ConnectRow[] = [
    row('claude', 'Claude Code đã cài', 'Lệnh claude có trong PATH.'),
    row('register', 'Đăng ký MCP server "squarel"', 'claude mcp add squarel --scope user'),
    row(
      'skills',
      'Chép skill vào ~/.claude/skills',
      '/pixel-new, /pixel-export, /pixel-from-photo, pixel-art',
    ),
    row('smoke', 'Chạy thử MCP server', 'Khởi động qua stdio và đọc danh sách tool.'),
    row('sees', 'Claude Code thấy squarel', 'claude mcp list báo Connected.'),
  ]
  const started = Object.keys(rows).length > 0
  const withExtension = info.integrations.filter((i) => i.extension && state?.selected.includes(i.id))
  const buildRows = Object.entries(builds).filter(([, id]) => id)

  return (
    <StepFrame
      step={4}
      title="Kết nối với Claude"
      intro="Đăng ký Squarel với Claude Code để dùng ở mọi thư mục, rồi chạy thử đúng như cách Claude Code khởi động nó."
      footer={
        <>
          <Button type="ghost" onClick={() => void go(3)}>
            Quay lại
          </Button>
          <span className="wiz-footer-spacer" />
          <span className="wiz-footer-hint">Launcher sẽ thu xuống khay hệ thống và giữ bridge chạy</span>
          <Button type="secondary" disabled={busy} onClick={() => void connect()}>
            {started ? 'Chạy lại' : 'Kết nối'}
          </Button>
          <Button type="primary" disabled={busy} onClick={() => void go('done')}>
            Hoàn tất
          </Button>
        </>
      }
    >
      <div className="wiz-list">
        {list.map((r) => (
          <div
            key={r.key}
            className={`wiz-row is-${r.result}`}
            data-testid="connect-row"
            data-result={r.result}
          >
            <span className="wiz-row-tile">
              <Icon name={TILE[r.result]} size={16} />
            </span>
            <span className="wiz-row-text">
              <span className="row-title">{r.title}</span>
              <span className="row-sub">{r.sub}</span>
            </span>
            <span className="wiz-row-detail mono-small">
              {r.result === 'running' ? 'đang chạy…' : (r.detail ?? (r.result === 'idle' ? 'chưa chạy' : ''))}
            </span>
          </div>
        ))}
        {buildRows.map(([id, taskId]) => {
          const name = info.integrations.find((i) => i.id === id)?.name ?? id
          const end = log.final(taskId)
          const pct = log.percent(taskId)
          const result: Result = !end ? 'running' : end.kind === 'done' ? 'pass' : 'fail'
          return (
            <div
              key={id}
              className={`wiz-row is-${result === 'running' ? 'warn' : result}`}
              data-testid="build-row"
            >
              <span className="wiz-row-tile">
                <Icon name={result === 'running' ? 'alert' : TILE[result]} size={16} />
              </span>
              <span className="wiz-row-text">
                <span className="row-title">
                  {!end
                    ? `${name} đang build`
                    : end.kind === 'done'
                      ? `${name} đã build xong`
                      : `Build ${name} thất bại`}
                </span>
                <span className="row-sub">
                  {!end
                    ? `Bạn dùng được Squarel ngay; nút Mở ${name} sẽ bật khi build xong.`
                    : (end.text ?? '')}
                </span>
              </span>
              {!end && <span className="wiz-row-detail mono-small is-warn">{pct ?? 0}%</span>}
            </div>
          )
        })}
      </div>

      {withExtension.length > 0 && (
        <section className="card wiz-card" aria-label="Extension của tích hợp">
          <h2 className="card-title">Extension của tích hợp</h2>
          {withExtension.map((i) => {
            const taskId = ext[i.id]
            const end = log.final(taskId)
            const installed = components.find((c) => c.id === i.id)?.installed
            return (
              <div key={i.id} className="wiz-row is-sub" data-testid="extension-row">
                <span className="wiz-row-text">
                  <span className="row-title">Extension Squarel cho {i.name}</span>
                  <span className="row-sub">
                    {end?.text ??
                      (installed
                        ? 'Cài vào công cụ để đồng bộ hai chiều.'
                        : `Cài được sau khi có ${i.name}.`)}
                  </span>
                </span>
                {(!taskId || end?.kind === 'error') && (
                  <Button
                    type="secondary"
                    onClick={async () => {
                      const id = await run({
                        componentId: i.id,
                        kind: 'extension',
                        id: 'install',
                        label: `Cài extension ${i.name}`,
                      })
                      if (id) setExt((x) => ({ ...x, [i.id]: id }))
                    }}
                  >
                    Cài
                  </Button>
                )}
              </div>
            )
          })}
        </section>
      )}

      <section className="card wiz-card">
        <h2 className="card-title">Thử ngay trong Claude Code</h2>
        <div className="wiz-try">
          <code className="mono-value wiz-try-text">{TRY_PROMPT}</code>
          <button
            type="button"
            className="field-action"
            onClick={() =>
              api
                .writeClipboard({ text: TRY_PROMPT })
                .then(() => notify({ label: 'Sao chép', kind: 'done', text: 'Đã chép câu lệnh' }))
                .catch((e) => notify({ label: 'Sao chép', kind: 'error', text: errorText(e) }))
            }
          >
            Sao chép
          </button>
        </div>
      </section>
    </StepFrame>
  )
}
