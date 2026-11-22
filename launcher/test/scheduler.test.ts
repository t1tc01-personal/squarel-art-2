import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createScheduler } from '../src/main/scheduler'

const clock = {
  setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimer: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
}

const MIN = 60_000

describe('scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('scheduler runs checks every 10 min and updates every 6 h without overlap', async () => {
    let checks = 0
    let updates = 0
    let release: (() => void) | undefined
    let hang = false
    const sched = createScheduler(
      { checksMs: 600_000, updatesMs: 21_600_000 },
      {
        checks: async () => {
          checks++
          if (hang) await new Promise<void>((r) => (release = r))
        },
        updates: async () => {
          updates++
        },
      },
      clock,
    )
    sched.start()
    await vi.advanceTimersByTimeAsync(0)
    // Both run once when the launcher opens.
    expect([checks, updates]).toEqual([1, 1])

    await vi.advanceTimersByTimeAsync(10 * MIN - 1)
    expect(checks).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(checks).toBe(2)

    // A run that is still going when the next ticks come due: those ticks are skipped.
    hang = true
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(checks).toBe(3)
    await vi.advanceTimersByTimeAsync(30 * MIN)
    expect(checks).toBe(3)
    // A manual run while busy joins the running one instead of starting a second.
    const manual = sched.runNow('checks')
    expect(checks).toBe(3)
    hang = false
    release?.()
    await manual
    await vi.advanceTimersByTimeAsync(10 * MIN)
    expect(checks).toBe(4)

    // 60 min elapsed so far; updates come due at 6 h.
    expect(updates).toBe(1)
    await vi.advanceTimersByTimeAsync(300 * MIN - 1)
    expect(updates).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(updates).toBe(2)
    expect(checks).toBe(4 + 30)

    sched.stop()
    await vi.advanceTimersByTimeAsync(24 * 60 * MIN)
    expect([checks, updates]).toEqual([34, 2])
  })

  it('a failing job does not stop the schedule', async () => {
    let n = 0
    const errors: unknown[] = []
    const sched = createScheduler(
      { checksMs: 1000, updatesMs: 1_000_000 },
      {
        checks: async () => {
          n++
          throw new Error('boom')
        },
        updates: async () => {},
      },
      clock,
      { onError: (_job, e) => errors.push(e) },
    )
    sched.start()
    await vi.advanceTimersByTimeAsync(3000)
    expect(n).toBe(4)
    expect(errors).toHaveLength(4)
    sched.stop()
  })

  it('a job that throws synchronously does not stop the schedule', async () => {
    let n = 0
    const errors: unknown[] = []
    const sched = createScheduler(
      { checksMs: 1000, updatesMs: 1_000_000 },
      {
        checks: () => {
          n++
          throw new Error('sync boom')
        },
        updates: async () => {},
      },
      clock,
      { onError: (_job, e) => errors.push(e) },
    )
    sched.start()
    await vi.advanceTimersByTimeAsync(2000)
    await expect(sched.runNow('checks')).resolves.toBeUndefined()
    expect(n).toBe(4)
    expect(errors).toHaveLength(4)
    sched.stop()
  })
})
