import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  progressLine,
  progressView,
  type TaskTrack,
  trackEvent,
} from '../src/renderer/progress'
import type { TaskEvent, TaskStep } from '../src/shared/model'

const PLAN = ['Build tools', 'Aseprite source', 'Skia', 'Configure', 'Build', 'Check and configure']
const progress = (percent: number, step: Omit<TaskStep, 'total' | 'plan'>): TaskEvent => ({
  taskId: 't',
  kind: 'progress',
  text: step.label,
  percent,
  step: { total: 6, plan: PLAN, ...step },
})
const line = (text: string): TaskEvent => ({ taskId: 't', kind: 'line', text })

/** Feeds [event, at-seconds] pairs. */
function fold(events: [TaskEvent, number][]): TaskTrack {
  let t: TaskTrack | undefined
  for (const [e, s] of events) t = trackEvent(t, e, s * 1000)
  if (!t) throw new Error('no events')
  return t
}

describe('formatDuration', () => {
  it('prints m:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00')
    expect(formatDuration(65_000)).toBe('1:05')
    expect(formatDuration(3_723_000)).toBe('1:02:03')
    expect(formatDuration(-5)).toBe('0:00')
  })
})

describe('progressView', () => {
  const running = fold([
    [line('$ git clone'), 0],
    [progress(0, { step: 1, label: 'Build tools' }), 0],
    [progress(2, { step: 2, label: 'Aseprite source' }), 4],
    [progress(17, { step: 3, label: 'Skia' }), 134],
    [progress(25, { step: 4, label: 'Configure' }), 199],
    [progress(30, { step: 5, label: 'Build' }), 230],
    [progress(48, { step: 5, label: 'Build', detail: '400/1430' }), 830],
    [line('[400/1430] Building CXX object timeline.cpp.obj'), 830],
  ])

  it('lists every step with its state, duration or counter', () => {
    const v = progressView(running, 830_000)
    expect(v).toMatchObject({
      state: 'running',
      percent: 48,
      step: 5,
      total: 6,
      stepName: 'Biên dịch',
      detail: '400 / 1430 file',
      elapsed: '13:50',
      lastLine: '[400/1430] Building CXX object timeline.cpp.obj',
    })
    expect(v.steps.map((s) => [s.name, s.state, s.meta])).toEqual([
      ['Công cụ build', 'done', '0:04'],
      ['Tải mã nguồn Aseprite', 'done', '2:10'],
      ['Tải Skia', 'done', '1:05'],
      ['Cấu hình (CMake)', 'done', '0:31'],
      ['Biên dịch', 'active', '400/1430'],
      ['Kiểm tra và ghi .env', 'pending', undefined],
    ])
  })

  it('estimates the time left from the file counter of the current step', () => {
    // 400 files in 600 s → 1030 files left ≈ 26 min
    expect(progressView(running, 830_000).eta).toBe('còn khoảng 26 phút')
  })

  it('never lowers the percent and keeps the step counter out of other steps', () => {
    const t = fold([
      [progress(60, { step: 5, label: 'Build', detail: '10/20' }), 0],
      [progress(40, { step: 6, label: 'Check and configure' }), 1],
    ])
    expect(t.percent).toBe(60)
    expect(t.detail).toBeUndefined()
  })

  it('marks the failing step and stops the clock at the end', () => {
    const t = trackEvent(
      running,
      { taskId: 't', kind: 'error', text: 'Cài Aseprite thất bại (mã thoát 1).' },
      900_000,
    )
    const v = progressView(t, 5_000_000)
    expect(v.state).toBe('error')
    expect(v.elapsed).toBe('15:00')
    expect(v.errorText).toBe('Cài Aseprite thất bại (mã thoát 1).')
    expect(v.steps[4]).toMatchObject({ state: 'error', meta: 'lỗi' })
    expect(v.eta).toBeUndefined()
    // events after the end change nothing
    expect(trackEvent(t, line('late'), 999_000)).toEqual(t)
  })

  it('shows every step done and 100% once finished', () => {
    const t = trackEvent(running, { taskId: 't', kind: 'done', code: 0 }, 1000_000)
    const v = progressView(t, 2_000_000)
    expect(v.percent).toBe(100)
    expect(v.steps.every((s) => s.state === 'done')).toBe(true)
  })

  it('works with older scripts that send no plan: unknown steps are numbered', () => {
    const t = fold([
      [
        {
          taskId: 't',
          kind: 'progress',
          text: 'Build',
          percent: 67,
          step: { step: 5, total: 6, label: 'Build' },
        },
        0,
      ],
    ])
    const v = progressView(t, 0)
    expect(v.steps.map((s) => s.name)).toEqual([
      'Bước 1',
      'Bước 2',
      'Bước 3',
      'Bước 4',
      'Biên dịch',
      'Bước 6',
    ])
  })

  it('has no steps for a task without progress events', () => {
    const v = progressView(fold([[line('Packages: +312'), 0]]), 3000)
    expect(v).toMatchObject({
      state: 'running',
      percent: 0,
      steps: [],
      lastLine: 'Packages: +312',
      elapsed: '0:03',
    })
  })
})

describe('progressLine', () => {
  it('summarises the step for a toast', () => {
    const t = fold([[progress(48, { step: 5, label: 'Build', detail: '400/1430' }), 0]])
    expect(progressLine(t)).toBe('Bước 5/6 · Biên dịch · 400/1430')
    expect(progressLine(fold([[line('x'), 0]]))).toBeUndefined()
  })
})
