import WebSocket from 'ws'
import { BRIDGE_PROTOCOL, type ServerMessage } from './protocol.ts'

/**
 * Ask a bridge owned by another process to open an art (`<project id>/<art id>`) in its connected editor.
 * Always settles within `timeoutMs` and always terminates the socket.
 */
export function openViaBridge(opts: {
  port: number
  token?: string
  ref: string
  timeoutMs?: number
}): Promise<string> {
  const { port, token, ref, timeoutMs = 3000 } = opts
  const prefix = `bridge on port ${port} did not answer`
  return new Promise<string>((resolve, reject) => {
    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge${query}`)
    let done = false
    const finish = (err: Error | null, text = '') => {
      if (done) return
      done = true
      clearTimeout(timer)
      ws.removeAllListeners()
      ws.on('error', () => {})
      ws.terminate()
      if (err) reject(err)
      else resolve(text)
    }
    const timer = setTimeout(() => finish(new Error(`${prefix} within ${timeoutMs} ms`)), timeoutMs)
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'hello', client: 'squarel-mcp', protocol: BRIDGE_PROTOCOL }))
      ws.send(JSON.stringify({ type: 'tool', id: 'open', name: 'open_in_editor', ref, input: {} }))
    })
    ws.on('message', (raw) => {
      let m: ServerMessage
      try {
        m = JSON.parse(String(raw)) as ServerMessage
      } catch {
        return
      }
      if (m.type !== 'tool_result' || m.id !== 'open') return
      if (m.ok) finish(null, m.text)
      else finish(new Error(`${prefix}: ${m.text}`))
    })
    ws.on('unexpected-response', (_req, res) => finish(new Error(`${prefix} (HTTP ${res.statusCode})`)))
    ws.on('error', (e) => {
      const refused = (e as NodeJS.ErrnoException).code === 'ECONNREFUSED'
      const hint = refused
        ? ' (start the Squarel launcher or `pnpm bridge`, or restart this Claude Code session)'
        : ''
      finish(new Error(`${prefix}: ${e.message}${hint}`))
    })
    ws.on('close', () => finish(new Error(`${prefix} (connection closed)`)))
  })
}
