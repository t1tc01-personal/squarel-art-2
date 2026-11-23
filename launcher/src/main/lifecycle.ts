/**
 * Quit sequencing (ruling B11), pure so it can be unit-tested without Electron:
 *
 *   app 'before-quit' ─► preventDefault ─► running tasks? ask ─► (cancel: keep running)
 *                                              │ yes / none
 *                                              ▼
 *        beginQuit (no more bridge restarts) → abort tasks (tree-kill) → stop background work
 *                       → await bridge stop (deadline: then killOwnChild and go on)
 *                                              │
 *                                              ▼
 *                                  finish(): app.quit() again (now passes) or quitAndInstall
 *
 *   process 'exit' ─► killOwnChild() (synchronous last resort; never touches an attached bridge)
 *
 * Re-entry: while a shutdown runs, further quit requests are held back and join it; an install
 * (quitAndInstall) requested meanwhile replaces the plain quit as the finish step.
 */

export interface QuitDeps {
  /** Labels of the tasks still running (e.g. "Aseprite đang build…"). */
  runningTasks(): string[]
  /** Asks the user whether to stop those tasks and quit. */
  confirmStopTasks(labels: string[]): Promise<boolean>
  /** The quit is decided: from now on nothing may start a bridge again (e.g. a task's resume). */
  beginQuit(): void
  /** Aborts every running task (killing its process tree) and waits for them to end. */
  abortTasks(): Promise<void>
  /** Scheduler and presence polling (index.ts stopBackgroundWork). */
  stopBackgroundWork(): void
  /** Graceful bridge stop: only a bridge the launcher spawned is killed. */
  stopBridge(): Promise<void>
  killOwnChild(): void
  /** app.quit(). */
  quit(): void
  log?(message: string): void
}

export interface QuitController {
  /** Handler for app 'before-quit'. */
  beforeQuit(event: { preventDefault(): void }): void
  /** Handler for process 'exit'. */
  exit(): void
  /**
   * Runs the shutdown, then `finish` (default: quit). Resolves false when the user kept the app
   * open because of running tasks.
   */
  shutdown(finish?: () => void): Promise<boolean>
  /** True once the shutdown finished (the next quit passes through). */
  readonly quitting: boolean
}

const name = (e: unknown) => (e as Error)?.name ?? 'Error'

/** How long a graceful bridge stop may take before the own child is killed outright. */
export const STOP_DEADLINE_MS = 8000

export function createQuitController(deps: QuitDeps, opts: { stopDeadlineMs?: number } = {}): QuitController {
  const deadlineMs = opts.stopDeadlineMs ?? STOP_DEADLINE_MS
  let done = false
  let pending: Promise<boolean> | undefined
  /** A non-default finish (install) requested for the pending shutdown; it outranks a plain quit. */
  let finishOverride: (() => void) | undefined

  async function run(): Promise<boolean> {
    const labels = deps.runningTasks()
    if (labels.length) {
      let ok = false
      try {
        ok = await deps.confirmStopTasks(labels)
      } catch (e) {
        deps.log?.(`quit confirm failed: ${name(e)}`)
      }
      if (!ok) return false
    }
    try {
      deps.beginQuit()
    } catch (e) {
      deps.log?.(`begin quit failed: ${name(e)}`)
    }
    if (labels.length) {
      try {
        await deps.abortTasks()
      } catch (e) {
        deps.log?.(`aborting tasks failed: ${name(e)}`)
      }
    }
    try {
      deps.stopBackgroundWork()
    } catch (e) {
      deps.log?.(`stopping background work failed: ${name(e)}`)
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const stopped = await Promise.race([
      deps.stopBridge().then(
        () => true,
        (e) => {
          deps.log?.(`bridge stop failed: ${name(e)}`)
          return true
        },
      ),
      new Promise<false>((r) => {
        timer = setTimeout(() => r(false), deadlineMs)
      }),
    ])
    clearTimeout(timer)
    if (!stopped) {
      deps.log?.(`bridge stop took over ${deadlineMs} ms: killing the own bridge`)
      try {
        deps.killOwnChild()
      } catch {}
    }
    done = true
    const finish = finishOverride ?? deps.quit
    finishOverride = undefined
    finish()
    return true
  }

  function shutdown(finish?: () => void): Promise<boolean> {
    if (done) {
      ;(finish ?? deps.quit)()
      return Promise.resolve(true)
    }
    if (finish) finishOverride = finish
    pending ??= run().finally(() => {
      pending = undefined
    })
    return pending
  }

  return {
    beforeQuit(event) {
      if (done) return
      event.preventDefault()
      void shutdown()
    },
    exit() {
      try {
        deps.killOwnChild()
      } catch {}
    },
    shutdown,
    get quitting() {
      return done
    },
  }
}
