/**
 * `logs:read`: the tail of the Squarel logs (DATA_DIR/logs/*.log, JSON lines from src/log.ts) and
 * the launcher's own logs. Only `*.log` files directly inside the given folders are read, and only
 * when their real path is still inside the folder's real path. Every line is redacted here, before
 * it leaves main.
 */
import { isAbsolute, join, relative, sep } from 'node:path'
import type { LogLevel, LogLine, LogsQuery, LogsResult } from '../shared/ipc'
import type { Deps } from './deps'

export const MAX_LINES = 500
/** Bytes read from the end of each file. */
const TAIL_BYTES = 512 * 1024
const MAX_FILES = 40
const MAX_TEXT = 4000
const FILE = /^[\w.-]{1,120}\.log$/i
const SOURCE = /^[a-z][a-z0-9-]{0,31}$/
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function within(root: string, p: string): boolean {
  const rel = relative(root, p)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function tail(d: Deps, file: string): Promise<string> {
  const { size } = await d.fs.stat(file)
  const len = Math.min(size, TAIL_BYTES)
  const fh = await d.fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, size - len)
    let text = buf.subarray(0, bytesRead).toString('utf8')
    if (size > len) text = text.slice(text.indexOf('\n') + 1) // drop the cut first line
    return text
  } finally {
    await fh.close()
  }
}

function toSource(s: string): string {
  const v = s
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .slice(0, 32)
  return SOURCE.test(v) ? v : 'khac'
}

/** `bridge-2026-01-01.log` → `bridge`. */
function sourceOfFile(name: string): string {
  return toSource(name.replace(/\.log$/i, '').replace(/-\d{4}-\d{2}-\d{2}$/, ''))
}

function levelOf(v: unknown): LogLevel {
  const s = String(v ?? '').toLowerCase()
  if (s === 'warning') return 'warn'
  return s === 'debug' || s === 'warn' || s === 'error' ? s : 'info'
}

function scalar(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

export function parseLogLine(raw: string, fileSource: string): Omit<LogLine, 'text'> & { text: string } {
  const line = raw.trim()
  if (line.startsWith('{')) {
    try {
      const o = JSON.parse(line) as Record<string, unknown>
      if (o && typeof o === 'object' && !Array.isArray(o)) {
        const { ts, level, name, msg, ...extra } = o
        const rest = Object.entries(extra).map(([k, v]) => `${k}=${scalar(v)}`)
        return {
          ts: typeof ts === 'string' ? ts.slice(0, 40) : '',
          level: levelOf(level),
          source: typeof name === 'string' ? toSource(name) : fileSource,
          text: [scalar(msg ?? ''), ...rest].filter(Boolean).join(' · '),
        }
      }
    } catch {
      /* not JSON: plain text below */
    }
  }
  const lv = /\b(ERROR|WARN(?:ING)?|DEBUG)\b/.exec(line)?.[1]
  return { ts: '', level: levelOf(lv), source: fileSource, text: line }
}

export async function readLogs(
  dirs: readonly string[],
  query: LogsQuery,
  redact: (s: string) => string,
  d: Deps,
): Promise<Omit<LogsResult, 'dir'>> {
  type Entry = LogLine & { order: number }
  const all: Entry[] = []
  let order = 0
  for (const dir of dirs) {
    let realDir: string
    let names: string[]
    try {
      realDir = await d.fs.realpath(dir)
      names = (await d.fs.readdir(dir)).map(String).filter((n) => FILE.test(n))
    } catch {
      continue
    }
    names.sort()
    for (const name of names.slice(-MAX_FILES)) {
      const file = join(dir, name)
      let text: string
      try {
        const real = await d.fs.realpath(file)
        if (!within(realDir, real)) continue
        text = await tail(d, real)
      } catch {
        continue
      }
      const src = sourceOfFile(name)
      let lastTs = ''
      for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim()) continue
        const p = parseLogLine(raw, src)
        const ts = p.ts || lastTs
        lastTs = ts
        const t = redact(p.text)
        all.push({ ...p, ts, text: t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t, order: order++ })
      }
    }
  }
  all.sort((a, b) => (a.ts === b.ts ? a.order - b.order : a.ts < b.ts ? -1 : 1))
  const sources = [...new Set(all.map((l) => l.source))].sort().slice(0, 50)
  const min = RANK[query.level ?? 'info']
  const lines = all
    .filter(
      (l) =>
        (!query.source || l.source === query.source) &&
        (!query.level || query.level === 'info' || RANK[l.level] >= min),
    )
    .slice(-MAX_LINES)
    .map(({ order: _o, ...l }) => l)
  return { sources, lines }
}
