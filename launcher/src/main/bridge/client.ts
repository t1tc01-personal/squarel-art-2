/** One WebSocket connection to a Squarel bridge, speaking as client `launcher` (hello → status / tool). */
import type { Deps, WsLike } from '../deps'
import type { BridgeClientInfo } from './types'

export type ClientDeps = Pick<Deps, 'connectWs' | 'setTimer' | 'clearTimer'>

export interface BridgeStatus {
  version: string
  clients: BridgeClientInfo[]
}

export type ConnectResult =
  | { kind: 'ok'; conn: BridgeConnection; status: BridgeStatus }
  /** Nothing listens on the port (ECONNREFUSED). */
  | { kind: 'refused' }
  /** Something answered but it is not a (usable) Squarel bridge, or it did not answer in time. */
  | { kind: 'foreign'; reason: string }

export function bridgeUrl(port: number, token?: string): string {
  const q = token ? `?token=${encodeURIComponent(token)}` : ''
  return `ws://127.0.0.1:${port}/bridge${q}`
}

interface Waiter<T> {
  resolve: (v: T) => void
  reject: (e: Error) => void
  timer: unknown
}

/** A connection that already answered `status`. Closing (either side) rejects everything pending. */
export class BridgeConnection {
  private statusWaiters: Waiter<BridgeStatus>[] = []
  private toolWaiters = new Map<string, Waiter<string>>()
  private closeCbs: (() => void)[] = []
  private seq = 0
  closed = false

  constructor(
    private ws: WsLike,
    private d: ClientDeps,
  ) {}

  /** Ask for `status`; replies carry no id, so waiters are answered in order. */
  status(timeoutMs: number): Promise<BridgeStatus> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Bridge chưa kết nối'))
      const w: Waiter<BridgeStatus> = { resolve, reject, timer: undefined }
      w.timer = this.d.setTimer(() => {
        const i = this.statusWaiters.indexOf(w)
        if (i >= 0) this.statusWaiters.splice(i, 1)
        reject(new Error('Bridge không trả lời status'))
      }, timeoutMs)
      this.statusWaiters.push(w)
      this.sendRaw(
        { type: 'status' },
        () => {
          this.statusWaiters.splice(this.statusWaiters.indexOf(w), 1)
          this.d.clearTimer(w.timer)
        },
        reject,
      )
    })
  }

  /** Run a Squarel tool through the bridge; resolves with the result text, rejects when the tool failed. */
  tool(name: string, input: unknown, timeoutMs: number, ref?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Bridge chưa kết nối'))
      const id = `launcher-${++this.seq}`
      const w: Waiter<string> = { resolve, reject, timer: undefined }
      w.timer = this.d.setTimer(() => {
        this.toolWaiters.delete(id)
        reject(new Error(`Bridge không trả lời ${name} sau ${Math.round(timeoutMs / 1000)} giây`))
      }, timeoutMs)
      this.toolWaiters.set(id, w)
      this.sendRaw(
        { type: 'tool', id, name, input, ref },
        () => {
          this.toolWaiters.delete(id)
          this.d.clearTimer(w.timer)
        },
        reject,
      )
    })
  }

  onClose(cb: () => void): void {
    if (this.closed) cb()
    else this.closeCbs.push(cb)
  }

  /** Close from our side; runs the close callbacks synchronously (real sockets emit 'close' later, fakes never). */
  close(): void {
    if (this.closed) return
    try {
      this.ws.terminate()
    } catch {}
    this.handleClose()
  }

  /** @internal */
  handleMessage(m: {
    type?: string
    id?: string
    ok?: boolean
    text?: string
    clients?: unknown
    version?: unknown
  }) {
    if (m.type === 'status') {
      const w = this.statusWaiters.shift()
      if (!w) return
      this.d.clearTimer(w.timer)
      w.resolve(toStatus(m))
    } else if (m.type === 'tool_result' && typeof m.id === 'string') {
      const w = this.toolWaiters.get(m.id)
      if (!w) return
      this.toolWaiters.delete(m.id)
      this.d.clearTimer(w.timer)
      if (m.ok) w.resolve(String(m.text ?? ''))
      else w.reject(new Error(String(m.text ?? 'Tool lỗi')))
    }
  }

  /** @internal */
  handleClose() {
    if (this.closed) return
    this.closed = true
    const err = new Error('Bridge đã ngắt kết nối')
    for (const w of this.statusWaiters.splice(0)) {
      this.d.clearTimer(w.timer)
      w.reject(err)
    }
    for (const w of this.toolWaiters.values()) {
      this.d.clearTimer(w.timer)
      w.reject(err)
    }
    this.toolWaiters.clear()
    for (const cb of this.closeCbs.splice(0)) cb()
  }

  private sendRaw(m: unknown, undo: () => void, reject: (e: Error) => void) {
    try {
      this.ws.send(JSON.stringify(m))
    } catch (e) {
      undo()
      reject(new Error(`Không gửi được tới bridge: ${(e as Error).message}`))
    }
  }
}

function toStatus(m: { clients?: unknown; version?: unknown }): BridgeStatus {
  const clients = Array.isArray(m.clients) ? (m.clients as BridgeClientInfo[]) : []
  return { version: String(m.version ?? ''), clients }
}

/**
 * Open a connection, say hello as `launcher` and ask for `status`; settles exactly once within timeoutMs.
 * abort() settles a pending attempt as foreign and drops the socket (no-op once settled).
 */
export function connectBridge(
  d: ClientDeps,
  url: string,
  timeoutMs: number,
): { result: Promise<ConnectResult>; abort: () => void } {
  let settle!: (r: ConnectResult) => void
  const result = new Promise<ConnectResult>((r) => {
    settle = r
  })
  let settled = false
  let ws: WsLike | undefined
  let timer: unknown

  const finish = (r: ConnectResult) => {
    if (settled) return
    settled = true
    d.clearTimer(timer)
    if (r.kind !== 'ok') {
      try {
        ws?.terminate()
      } catch {}
    }
    settle(r)
  }

  try {
    ws = d.connectWs(url)
  } catch (e) {
    finish({ kind: 'foreign', reason: (e as Error).message })
    return { result, abort: () => {} }
  }
  const sock = ws
  const c = new BridgeConnection(sock, d)
  timer = d.setTimer(() => finish({ kind: 'foreign', reason: 'timeout' }), timeoutMs)

  sock.on('open', () => {
    if (settled) return
    try {
      sock.send(JSON.stringify({ type: 'hello', client: 'launcher', protocol: 2 }))
      sock.send(JSON.stringify({ type: 'status' }))
    } catch (e) {
      finish({ kind: 'foreign', reason: (e as Error).message })
    }
  })
  sock.on('message', (raw: unknown) => {
    let m: { type?: string; message?: string; server?: string }
    try {
      m = JSON.parse(String(raw))
    } catch {
      if (!settled) finish({ kind: 'foreign', reason: 'not a Squarel bridge (malformed message)' })
      return
    }
    if (!settled) {
      if (m.type === 'status') finish({ kind: 'ok', conn: c, status: toStatus(m as { clients?: unknown }) })
      else if (m.type === 'error')
        finish({ kind: 'foreign', reason: `old or incompatible bridge: ${m.message}` })
      // 'welcome' (reply to hello) is expected and ignored
      return
    }
    c.handleMessage(m)
  })
  sock.on('error', (e: NodeJS.ErrnoException | undefined) => {
    if (settled) return // 'close' follows
    if (e?.code === 'ECONNREFUSED') finish({ kind: 'refused' })
    else finish({ kind: 'foreign', reason: String(e?.message ?? e) })
  })
  sock.on('close', () => {
    if (!settled) finish({ kind: 'foreign', reason: 'closed before status' })
    else c.handleClose()
  })
  return {
    result,
    abort: () => finish({ kind: 'foreign', reason: 'aborted' }),
  }
}
