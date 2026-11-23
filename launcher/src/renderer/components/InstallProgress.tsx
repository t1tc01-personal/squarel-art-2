/**
 * Progress card of a long install (Figma "InstallProgress"): overall percent that never goes back,
 * the current step with its file counter and time left, every step with its duration, the last
 * output line, the full log on demand, and Huỷ (asks first) / Thử lại / Mở.
 * Full size in the setup wizard, compact (no step list) in a tool page's banner.
 */
import { useEffect, useState } from 'react'
import { useTasks } from '../app-context'
import { progressView, type StepView } from '../progress'
import { Button } from './Button'
import { Icon } from './Icon'
import { StatusPill } from './StatusPill'
import './install-progress.css'

const VERB_TITLE = { build: 'Build', cài: 'Cài', 'cập nhật': 'Cập nhật' } as const
export type InstallVerb = keyof typeof VERB_TITLE

export function InstallProgress({
  taskId,
  name,
  verb,
  compact = false,
  runningNote,
  retryNote,
  doneNote,
  onRetry,
  onDismiss,
  onOpen,
  openLabel,
}: {
  taskId: string
  /** Tool name, e.g. "Aseprite". */
  name: string
  verb: InstallVerb
  compact?: boolean
  /** Under the running card, e.g. how long a first build takes. */
  runningNote?: string
  /** Second line after a failure. */
  retryNote?: string
  /** Second line once done, e.g. what was written to .env. */
  doneNote?: string
  onRetry?(): void
  /** Shows Đóng after a failure (the card stays until then). */
  onDismiss?(): void
  onOpen?(): void
  openLabel?: string
}) {
  const { log, cancel } = useTasks()
  const [now, setNow] = useState(() => Date.now())
  const [showLog, setShowLog] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const track = log.track(taskId)
  const running = !track?.final

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])
  useEffect(() => {
    if (!running) setConfirming(false)
  }, [running])

  const v = progressView(track ?? { startedAt: now, stepAt: {} }, now)
  const cancelled = v.state === 'error' && v.errorText === 'Đã huỷ'
  const title =
    v.state === 'running'
      ? `Đang ${verb} ${name}`
      : v.state === 'done'
        ? `Đã ${verb} xong ${name}`
        : cancelled
          ? `Đã huỷ ${verb} ${name}`
          : `${VERB_TITLE[verb]} ${name} thất bại`

  const big = v.state === 'error' && v.step && v.total ? `${v.step}/${v.total}` : `${v.percent}%`
  const line1 =
    v.state === 'running'
      ? v.step && v.total
        ? `Bước ${v.step}/${v.total} · ${v.stepName ?? ''}`
        : 'Đang khởi động…'
      : v.state === 'done'
        ? `Xong sau ${v.elapsed}`
        : v.step && v.stepName && !cancelled
          ? `Dừng ở bước ${v.stepName} · ${v.errorText}`
          : (v.errorText ?? 'Thất bại')
  const line2 =
    v.state === 'running'
      ? [v.detail, v.eta].filter(Boolean).join(' · ') || undefined
      : v.state === 'done'
        ? doneNote
        : retryNote

  const lines = showLog
    ? log
        .events(taskId)
        .filter((e) => e.kind === 'line' && e.text)
        .map((e) => e.text)
        .join('\n')
    : ''

  return (
    <section
      className={`install-progress is-${v.state}${compact ? ' is-compact' : ''}`}
      aria-label={title}
      data-testid="install-progress"
    >
      <div className="ip-head">
        <Icon
          name={v.state === 'running' ? 'refresh' : v.state === 'done' ? 'check' : 'alert'}
          size={16}
          className="ip-icon"
        />
        <span className="ip-title">{title}</span>
        <span className="ip-elapsed mono-small" title="Thời gian đã chạy">
          {v.elapsed}
        </span>
        <StatusPill
          level={v.state === 'running' ? 'running' : v.state === 'done' ? 'ok' : cancelled ? 'idle' : 'error'}
          label={
            v.state === 'running' ? 'Đang chạy' : v.state === 'done' ? 'Xong' : cancelled ? 'Đã huỷ' : 'Lỗi'
          }
        />
      </div>

      <div className="ip-summary">
        <span className="ip-percent">{big}</span>
        <span className="ip-summary-text">
          <span className="ip-line1">{line1}</span>
          {line2 && <span className="ip-line2">{line2}</span>}
        </span>
      </div>

      <span
        className="ip-bar"
        role="progressbar"
        aria-label={`Tiến trình ${verb} ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v.percent}
      >
        <span style={{ width: `${v.percent}%` }} />
      </span>

      {!compact && v.steps.length > 0 && (
        <ol className="ip-steps" aria-label="Các bước">
          {v.steps.map((s) => (
            <StepRow key={s.n} step={s} />
          ))}
        </ol>
      )}

      {v.state !== 'done' && v.lastLine && !showLog && (
        <div className="ip-logline mono-small" title={v.lastLine}>
          {v.lastLine}
        </div>
      )}
      {showLog && (
        <pre className="ip-log mono-small" data-testid="install-log">
          {lines || 'Chưa có output.'}
        </pre>
      )}

      {!compact && v.state === 'running' && runningNote && <p className="ip-note">{runningNote}</p>}

      <div className="ip-actions">
        <Button type="ghost" onClick={() => setShowLog((s) => !s)} aria-expanded={showLog}>
          {showLog ? 'Ẩn log' : 'Xem log'}
        </Button>
        <span className="ip-spacer" />
        {v.state === 'running' &&
          (confirming ? (
            <>
              <span className="ip-confirm">Dừng và huỷ?</span>
              <Button type="ghost" onClick={() => setConfirming(false)}>
                Tiếp tục
              </Button>
              <Button
                type="danger"
                onClick={() => {
                  setConfirming(false)
                  void cancel(taskId)
                }}
              >
                Huỷ {verb}
              </Button>
            </>
          ) : (
            <Button type="secondary" onClick={() => setConfirming(true)}>
              Huỷ {verb}
            </Button>
          ))}
        {v.state === 'error' && onDismiss && (
          <Button type="ghost" onClick={onDismiss}>
            Đóng
          </Button>
        )}
        {v.state === 'error' && onRetry && (
          <Button type="primary" onClick={onRetry}>
            Thử lại
          </Button>
        )}
        {v.state === 'done' && onOpen && (
          <Button type="primary" onClick={onOpen}>
            {openLabel ?? `Mở ${name}`}
          </Button>
        )}
      </div>
    </section>
  )
}

function StepRow({ step: s }: { step: StepView }) {
  return (
    <li className={`ip-step is-${s.state}`} aria-current={s.state === 'active' ? 'step' : undefined}>
      <span className="ip-badge" aria-hidden="true">
        {s.state === 'done' ? (
          <Icon name="check" size={12} />
        ) : s.state === 'error' ? (
          <Icon name="cross" size={12} />
        ) : s.state === 'active' ? (
          <span className="ip-dot" />
        ) : (
          s.n
        )}
      </span>
      <span className="ip-step-name">{s.name}</span>
      <span className="ip-step-meta mono-small">{s.meta ?? (s.state === 'pending' ? '–' : '')}</span>
    </li>
  )
}
