/**
 * What a long task (the Aseprite build) is doing, folded from its task events: overall percent,
 * which step, when each step started, the last output line. Pure, so it is unit-tested; the
 * InstallProgress card and the toasts render from `progressView`.
 */
import type { TaskEvent } from '../shared/model'

export interface TaskTrack {
  startedAt: number
  endedAt?: number
  percent?: number
  step?: number
  total?: number
  label?: string
  detail?: string
  plan?: string[]
  /** First time each step was seen (1-based step → ms). */
  stepAt: Record<number, number>
  lastLine?: string
  final?: TaskEvent
}

/** Folds one event (received at `at`) into the task's track. */
export function trackEvent(t: TaskTrack | undefined, e: TaskEvent, at: number): TaskTrack {
  const next: TaskTrack = t ? { ...t, stepAt: { ...t.stepAt } } : { startedAt: at, stepAt: {} }
  if (next.final) return next
  if (e.kind === 'line' && e.text?.trim()) next.lastLine = e.text.trim()
  if (e.kind === 'progress') {
    if (e.percent !== undefined) next.percent = Math.max(next.percent ?? 0, e.percent)
    if (e.step) {
      if (e.step.step !== next.step) next.detail = undefined
      next.step = e.step.step
      next.total = e.step.total
      next.label = e.step.label
      if (e.step.detail) next.detail = e.step.detail
      if (e.step.plan) next.plan = e.step.plan
      next.stepAt[e.step.step] ??= at
    } else if (e.text) next.label = e.text
  }
  if (e.kind === 'done' || e.kind === 'error') {
    next.final = e
    next.endedAt = at
  }
  return next
}

/** Vietnamese names of the steps `pnpm aseprite:build` prints; unknown labels show as printed. */
const STEP_NAMES: Record<string, string> = {
  'Build tools': 'Công cụ build',
  'Aseprite source': 'Tải mã nguồn Aseprite',
  Skia: 'Tải Skia',
  Configure: 'Cấu hình (CMake)',
  Build: 'Biên dịch',
  'Check and configure': 'Kiểm tra và ghi .env',
}
export const stepName = (label: string): string => STEP_NAMES[label] ?? label

/** "4:05" or "1:02:03". */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "812/1430" → {done, total}. */
function counter(detail: string | undefined): { done: number; total: number } | undefined {
  const m = detail && /^(\d+)\/(\d+)$/.exec(detail)
  return m && Number(m[2]) > 0 ? { done: Number(m[1]), total: Number(m[2]) } : undefined
}

export type StepState = 'done' | 'active' | 'pending' | 'error'
export interface StepView {
  n: number
  name: string
  state: StepState
  /** Duration of a finished step, the counter of the running one. */
  meta?: string
}
export interface ProgressView {
  state: 'running' | 'done' | 'error'
  percent: number
  step?: number
  total?: number
  /** Name of the current step. */
  stepName?: string
  /** "812 / 1430 file" when the step counts files. */
  detail?: string
  /** "còn khoảng 9 phút", from the file counter of the current step. */
  eta?: string
  elapsed: string
  lastLine?: string
  steps: StepView[]
  errorText?: string
}

export function progressView(t: TaskTrack, now: number): ProgressView {
  const end = t.final
  const state = !end ? 'running' : end.kind === 'done' ? 'done' : 'error'
  const until = t.endedAt ?? now
  const total = t.total ?? t.plan?.length
  const steps: StepView[] = []
  for (let n = 1; total && n <= total; n++) {
    const raw = t.plan?.[n - 1] ?? (n === t.step ? t.label : undefined)
    const name = raw ? stepName(raw) : `Bước ${n}`
    const startedAt = t.stepAt[n]
    const nextAt = t.stepAt[n + 1]
    let s: StepState
    if (state === 'done') s = 'done'
    else if (t.step === undefined || n > t.step) s = 'pending'
    else if (n < t.step) s = 'done'
    else s = state === 'error' ? 'error' : 'active'
    let meta: string | undefined
    if (s === 'done' && startedAt !== undefined) meta = formatDuration((nextAt ?? until) - startedAt)
    else if (s === 'active') meta = t.detail
    else if (s === 'error') meta = 'lỗi'
    steps.push({ n, name, state: s, ...(meta ? { meta } : {}) })
  }

  const c = counter(t.detail)
  let eta: string | undefined
  const stepStart = t.step !== undefined ? t.stepAt[t.step] : undefined
  if (state === 'running' && c && c.done > 0 && stepStart !== undefined && now - stepStart > 30_000) {
    const left = ((now - stepStart) / c.done) * (c.total - c.done)
    const min = Math.max(1, Math.round(left / 60_000))
    eta = `còn khoảng ${min} phút`
  }

  return {
    state,
    percent: state === 'done' ? 100 : Math.round(t.percent ?? 0),
    ...(t.step !== undefined ? { step: t.step } : {}),
    ...(total ? { total } : {}),
    ...(t.label ? { stepName: stepName(t.label) } : {}),
    ...(c ? { detail: `${c.done} / ${c.total} file` } : t.detail ? { detail: t.detail } : {}),
    ...(eta ? { eta } : {}),
    elapsed: formatDuration(until - t.startedAt),
    ...(t.lastLine ? { lastLine: t.lastLine } : {}),
    steps,
    ...(end?.kind === 'error' ? { errorText: end.text ?? 'Thất bại' } : {}),
  }
}

/** One-line summary for a toast: "Bước 5/6 · Biên dịch · 812/1430". */
export function progressLine(t: TaskTrack): string | undefined {
  if (t.step === undefined || !t.label) return undefined
  return [`Bước ${t.step}/${t.total ?? '?'}`, stepName(t.label), t.detail].filter(Boolean).join(' · ')
}
