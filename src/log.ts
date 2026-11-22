import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

export type Level = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(msg: string, extra?: Record<string, unknown>): void
  info(msg: string, extra?: Record<string, unknown>): void
  warn(msg: string, extra?: Record<string, unknown>): void
  error(msg: string, extra?: Record<string, unknown>): void
}

const SECRET_KEYS = /token|key|secret|authorization|password/i

function redact(v: unknown): unknown {
  if (!v || typeof v !== 'object') return v
  if (Array.isArray(v)) return v.map(redact)
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [
      k,
      SECRET_KEYS.test(k) ? '[redacted]' : redact(x),
    ]),
  )
}

/**
 * JSON-lines logger. Writes to stderr and to DATA_DIR/logs/<name>-YYYY-MM-DD.log.
 * Never writes to stdout: stdout carries the MCP protocol.
 */
export function createLogger(
  name: string,
  dataDir?: string,
  o: { stderr?: boolean; minLevel?: Level } = {},
): Logger {
  const order: Level[] = ['debug', 'info', 'warn', 'error']
  const min = order.indexOf(o.minLevel ?? (process.env.SQUAREL_DEBUG ? 'debug' : 'info'))
  let logDir: string | undefined
  if (dataDir) {
    try {
      logDir = join(dataDir, 'logs')
      mkdirSync(logDir, { recursive: true })
    } catch {
      logDir = undefined
    }
  }
  const write = (level: Level, msg: string, extra?: Record<string, unknown>) => {
    if (order.indexOf(level) < min) return
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      name,
      msg,
      ...(redact(extra) as object),
    })
    if (o.stderr ?? true) process.stderr.write(`${line}\n`)
    if (logDir) {
      try {
        appendFileSync(join(logDir, `${name}-${new Date().toISOString().slice(0, 10)}.log`), `${line}\n`)
      } catch {
        /* logging must never crash the tool */
      }
    }
  }
  return {
    debug: (m, e) => write('debug', m, e),
    info: (m, e) => write('info', m, e),
    warn: (m, e) => write('warn', m, e),
    error: (m, e) => write('error', m, e),
  }
}

export const silentLogger: Logger = { debug() {}, info() {}, warn() {}, error() {} }
