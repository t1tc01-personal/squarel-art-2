/**
 * Quit sequencing (ruling B11), pure so it can be unit-tested without Electron:
 *
 *   app 'before-quit' ─► preventDefault ─► running tasks? ask ─► (cancel: keep running)
 *                                              │ yes / none
 *                                              ▼
 *                          abort tasks (tree-kill) → stop background work → await bridge stop
 *                                              │
 *                                              ▼
 *                                  finish(): app.quit() again (now passes) or quitAndInstall
 *
 *   process 'exit' ─► killOwnChild() (synchronous last resort; never touches an attached bridge)
 *
 * Re-entry: while a shutdown runs, further quit requests are held back and join it.
 */

export interface QuitDeps {
  /** Labels of the tasks still running (e.g. "Aseprite đang build…"). */
  runningTasks(): string[]
  /** Asks the user whether to stop those tasks and quit. */
  confirmStopTasks(labels: string[]): Promise<boolean>
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

export function createQuitController(deps: QuitDeps): QuitController {
  let done = false
  let pending: Promise<boolean> | undefined

  async function run(finish: () => void): Promise<boolean> {
    const labels = deps.runningTasks()
    if (labels.length) {
      let ok = false
      try {
        ok = await deps.confirmStopTasks(labels)
      } catch (e) {
        deps.log?.(`quit confirm failed: ${name(e)}`)
      }
      if (!ok) return false
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
    try {
      await deps.stopBridge()
    } catch (e) {
      deps.log?.(`bridge stop failed: ${name(e)}`)
    }
    done = true
    finish()
    return true
  }

  function shutdown(finish: () => void = deps.quit): Promise<boolean> {
    if (done) {
      finish()
      return Promise.resolve(true)
    }
    pending ??= run(finish).finally(() => {
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
