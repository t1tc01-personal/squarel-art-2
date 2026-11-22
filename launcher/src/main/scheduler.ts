/**
 * Periodic jobs while the launcher is open: health checks (every 10 min) and update checks
 * (every 6 h). Both also run once at start. Each job runs at most once at a time: a tick that
 * comes due while the job is still running is skipped, and runNow() joins the running one.
 */

export type JobName = 'checks' | 'updates'

export interface SchedulerClock {
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
}

export interface Scheduler {
  start(): void
  stop(): void
  /** Runs the job now, or returns the run already in progress. */
  runNow(job: JobName): Promise<void>
}

export function createScheduler(
  intervals: { checksMs: number; updatesMs: number },
  jobs: Record<JobName, () => Promise<unknown>>,
  clock: SchedulerClock,
  opts: { runOnStart?: boolean; onError?: (job: JobName, e: unknown) => void } = {},
): Scheduler {
  const every: Record<JobName, number> = { checks: intervals.checksMs, updates: intervals.updatesMs }
  for (const ms of Object.values(every))
    if (!Number.isFinite(ms) || ms <= 0) throw new Error(`invalid scheduler interval: ${ms}`)
  const inFlight = new Map<JobName, Promise<void>>()
  const timers = new Map<JobName, unknown>()
  let started = false

  function runNow(job: JobName): Promise<void> {
    const running = inFlight.get(job)
    if (running) return running
    const p = (async () => {
      try {
        await jobs[job]()
      } catch (e) {
        opts.onError?.(job, e)
      } finally {
        inFlight.delete(job)
      }
    })()
    inFlight.set(job, p)
    return p
  }

  function arm(job: JobName): void {
    timers.set(
      job,
      clock.setTimer(() => {
        if (!started) return
        arm(job) // fixed rate: the next tick is due one interval after this one, whatever this run takes
        if (!inFlight.has(job)) void runNow(job)
      }, every[job]),
    )
  }

  return {
    start() {
      if (started) return
      started = true
      for (const job of ['checks', 'updates'] as const) {
        if (opts.runOnStart !== false) void runNow(job)
        arm(job)
      }
    },
    stop() {
      started = false
      for (const h of timers.values()) clock.clearTimer(h)
      timers.clear()
    },
    runNow,
  }
}
