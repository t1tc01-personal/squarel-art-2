/**
 * Bridge supervisor: whoever opens the bridge port first keeps it. The launcher attaches to a running Squarel
 * bridge, spawns its own when the port is free, takes the port over when the holder leaves, and only ever
 * stops a bridge it spawned itself.
 *
 *            start()
 *               │
 *               ▼
 *   ┌──────► PROBE ──status──────────────► ATTACHED ──poll status / pollMs
 *   │          │  │                            │
 *   │   refused│  └─timeout/handshake error─► FOREIGN ──foreignRetryMs──► PROBE
 *   │          ▼                               │ socket closed
 *   │        SPAWN ◄──────────────────────────┘ (take over at once)
 *   │          │
 *   │          ▼
 *   │         OWN ── connect to own child (retry 250 ms; after 3 s every pollMs + message;
 *   │          │       after 60 s unreachable: kill it → DOWN ──foreignRetryMs──► PROBE), poll status / pollMs
 *   │          │
 *   │   child exits: "already in use" → PROBE at once
 *   │                other exit        → DOWN ──pollMs──► PROBE
 *   │                3rd failure in a row → DOWN ──foreignRetryMs──► PROBE
 *   └──────────────────────────────────────────┘
 *   stop() from any state → DOWN (kills the child only if it is ours)
 *
 * Every async step captures `epoch`; any transition or stop() bumps it so late results are no-ops. At most one
 * probe/connect attempt and one timer exist at a time.
 */
import type { BridgeChild, Deps } from '../deps'
import { type BridgeConnection, bridgeUrl, connectBridge } from './client'
import type { BridgeClientInfo, BridgeMode, BridgeState } from './types'

export interface BridgeSupervisorOptions {
  port: number
  token?: string
  squarelDir: string
  pollMs?: number
  foreignRetryMs?: number
}

export interface BridgeSupervisor {
  start(): Promise<void>
  stop(): Promise<void>
  state(): BridgeState
  onChange(cb: (s: BridgeState) => void): () => void
  sendTool(name: string, input: unknown): Promise<string>
  /** Synchronous last-resort for process exit / crash paths: kills our own child (never an attached bridge) and stops. */
  killOwnChild(): void
}

const PROBE_MS = 1500
const TOOL_MS = 5000
const OWN_CONNECT_RETRY_MS = 250
/** Own child alive but unreachable: fast retries this long, then retry every pollMs with a message… */
const OWN_GRACE_MS = 3000
/** …and after this long kill it and go down (then the normal probe cycle resumes after foreignRetryMs). */
const OWN_GIVE_UP_MS = 60_000
const KILL_WAIT_MS = 3000
/** Spawned children dying in a row before backing off to foreignRetryMs. */
const MAX_SPAWN_FAILURES = 3
/** Unanswered polls in a row before the socket is considered dead. */
const MAX_POLL_MISSES = 3
const SELF = 'launcher'

function sameClients(a: BridgeClientInfo[], b: BridgeClientInfo[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => {
    const y = b[i]
    return (
      !!y &&
      x.name === y.name &&
      x.slug === y.slug &&
      x.lastSeen === y.lastSeen &&
      x.version === y.version &&
      x.app === y.app &&
      x.ext === y.ext
    )
  })
}

export function createBridgeSupervisor(opts: BridgeSupervisorOptions, d: Deps): BridgeSupervisor {
  const { port, squarelDir } = opts
  const pollMs = opts.pollMs ?? 5000
  const foreignRetryMs = opts.foreignRetryMs ?? 30_000
  const url = bridgeUrl(port, opts.token)

  let st: BridgeState = { mode: 'down', port, clients: [], since: d.now().toISOString() }
  const listeners = new Set<(s: BridgeState) => void>()
  let running = false
  let epoch = 0
  let timer: unknown
  let hasTimer = false
  /** The live socket (attached or own). */
  let conn: BridgeConnection | undefined
  /** Cancels the in-flight probe / connect attempt. */
  let abortAttempt: (() => void) | undefined
  /** Only ever a child we spawned. */
  let child: BridgeChild | undefined
  let spawnFailures = 0
  let pollMisses = 0
  /** Start (ms) of the current run of failed connects to our own child. */
  let ownFailSince: number | undefined
  let startPromise: Promise<void> | undefined
  let firstSettled: (() => void) | undefined

  function set(mode: BridgeMode, clients: BridgeClientInfo[], message?: string) {
    const visible = clients.filter((c) => c.name !== SELF)
    if (mode === st.mode && message === st.message && sameClients(visible, st.clients)) return
    st = {
      mode,
      port,
      clients: visible,
      since: mode === st.mode ? st.since : d.now().toISOString(),
      ...(message ? { message } : {}),
    }
    for (const cb of listeners) {
      try {
        cb(st)
      } catch {}
    }
  }

  function settledOnce() {
    firstSettled?.()
    firstSettled = undefined
  }

  function clearTimer() {
    if (hasTimer) d.clearTimer(timer)
    hasTimer = false
  }

  function schedule(ms: number, fn: () => void) {
    clearTimer()
    const e = epoch
    hasTimer = true
    timer = d.setTimer(() => {
      hasTimer = false
      if (e === epoch && running) fn()
    }, ms)
  }

  /** Bump the epoch and drop everything in flight except the own child. */
  function transition(): number {
    epoch++
    clearTimer()
    abortAttempt?.()
    abortAttempt = undefined
    const c = conn
    conn = undefined
    c?.close()
    return epoch
  }

  // Step 1: is a Squarel bridge on the port?
  function probe() {
    if (child) return // our own child holds (or is taking) the port; its exit handler decides what's next
    const e = transition()
    const attempt = connectBridge(d, url, PROBE_MS)
    abortAttempt = attempt.abort
    void attempt.result.then((r) => {
      if (e !== epoch || !running) {
        if (r.kind === 'ok') r.conn.close()
        return
      }
      abortAttempt = undefined
      if (r.kind === 'ok') {
        spawnFailures = 0
        use(r.conn, r.status.clients, 'attached', e)
      } else if (r.kind === 'refused') {
        spawn()
      } else {
        const message = /\b401\b/.test(r.reason)
          ? `Bridge trên cổng ${port} từ chối token`
          : `Cổng ${port} đang bị chương trình khác dùng`
        set('foreign', [], message)
        schedule(foreignRetryMs, probe)
      }
      settledOnce()
    })
  }

  // Step 3: hold the port ourselves.
  function spawn() {
    const e = transition()
    const c = d.spawnBridge({ squarelDir, env: { BRIDGE_PORT: String(port) } })
    child = c
    ownFailSince = undefined
    set('own', [])
    void c.exited.then(({ code, stderr }) => {
      if (child !== c) return // stop() already dealt with it
      child = undefined
      if (!running) return
      transition()
      spawnFailures++
      if (spawnFailures >= MAX_SPAWN_FAILURES) {
        set('down', [], `Không khởi động được bridge (mã ${code ?? '?'}), thử lại sau`)
        schedule(foreignRetryMs, () => {
          spawnFailures = 0
          probe()
        })
      } else if (/already in use|EADDRINUSE/i.test(stderr)) {
        probe() // someone else got the port first: attach to them (or see what it is)
      } else {
        set('down', [], `Bridge đã dừng (mã ${code ?? '?'})`)
        schedule(pollMs, probe)
      }
    })
    connectOwn(e)
  }

  function connectOwn(e: number) {
    if (e !== epoch || !running || !child) return
    const attempt = connectBridge(d, url, PROBE_MS)
    abortAttempt = attempt.abort
    void attempt.result.then((r) => {
      if (e !== epoch || !running) {
        if (r.kind === 'ok') r.conn.close()
        return
      }
      abortAttempt = undefined
      if (r.kind === 'ok') {
        spawnFailures = 0
        use(r.conn, r.status.clients, 'own', e)
        return
      }
      const now = d.now().getTime()
      ownFailSince ??= now
      const failingFor = now - ownFailSince
      if (failingFor < OWN_GRACE_MS) {
        schedule(OWN_CONNECT_RETRY_MS, () => connectOwn(e)) // child still starting
      } else if (failingFor < OWN_GIVE_UP_MS) {
        const message =
          r.kind === 'foreign' && /\b401\b/.test(r.reason)
            ? `Bridge trên cổng ${port} từ chối token`
            : 'Bridge không phản hồi'
        set('own', [], message)
        schedule(pollMs, () => connectOwn(e))
      } else {
        // alive but unusable for a minute: stop it and fall back to the normal cycle
        const c = child
        child = undefined
        c?.kill()
        transition()
        ownFailSince = undefined
        set('down', [], 'Bridge không phản hồi, đã dừng; thử lại sau')
        schedule(foreignRetryMs, probe)
      }
    })
  }

  function use(c: BridgeConnection, clients: BridgeClientInfo[], mode: 'attached' | 'own', e: number) {
    conn = c
    pollMisses = 0
    ownFailSince = undefined
    set(mode, clients)
    c.onClose(() => {
      if (conn !== c) return // we closed it ourselves during a transition
      conn = undefined
      if (e !== epoch || !running) return
      if (mode === 'attached')
        spawn() // step 5: the holder left, take over now
      else {
        set('own', [])
        schedule(OWN_CONNECT_RETRY_MS, () => connectOwn(e))
      }
    })
    schedule(pollMs, () => poll(c, mode, e))
  }

  function poll(c: BridgeConnection, mode: 'attached' | 'own', e: number) {
    const stale = () => e !== epoch || !running || conn !== c
    c.status(Math.min(pollMs, PROBE_MS * 2)).then(
      (s) => {
        if (stale()) return
        pollMisses = 0
        set(mode, s.clients)
        schedule(pollMs, () => poll(c, mode, e))
      },
      () => {
        if (stale()) return
        if (++pollMisses >= MAX_POLL_MISSES) c.close()
        else schedule(pollMs, () => poll(c, mode, e))
      },
    )
  }

  return {
    start() {
      if (running && startPromise) return startPromise
      running = true
      startPromise = new Promise<void>((r) => {
        firstSettled = r
      })
      const p = startPromise
      probe()
      return p
    },

    async stop() {
      const wasRunning = running
      running = false
      transition()
      settledOnce()
      startPromise = undefined
      const c = child
      child = undefined
      if (c) {
        c.kill()
        await new Promise<void>((resolve) => {
          const t = d.setTimer(resolve, KILL_WAIT_MS)
          void c.exited.then(() => {
            d.clearTimer(t)
            resolve()
          })
        })
      }
      if (wasRunning || st.mode !== 'down') set('down', [])
    },

    state: () => st,

    onChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    killOwnChild() {
      running = false
      transition()
      settledOnce()
      startPromise = undefined
      const c = child
      child = undefined
      c?.kill()
      set('down', [])
    },

    sendTool(name, input) {
      if (!conn) return Promise.reject(new Error('Bridge chưa kết nối'))
      return conn.tool(name, input, TOOL_MS)
    },
  }
}
