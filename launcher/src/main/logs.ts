/**
 * `logs:read`: the tail of the Squarel logs (DATA_DIR/logs/*.log, JSON lines from src/log.ts) and
 * the launcher's own logs. Only `*.log` files directly inside the given folders are read, and only
 * when their real path is still inside the folder's real path. Every line is redacted here, before
 * it leaves main.
 */
import { isAbsolute, join, relative, sep } from 'node:path'
import type { LogLevel, LogLine, LogsQuery, LogsResult } from '../shared/ipc'
import type { Deps } from './deps'
import { redactKeys } from './redact'

export const MAX_LINES = 500
/** Bytes read from the end of each file, and in total per call. */
const TAIL_BYTES = 512 * 1024
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024
const MAX_FILES = 200
const DATE_IN_NAME = /(\d{4}-\d{2}-\d{2})\.log$/i
const MAX_TEXT = 4000
const FILE = /^[\w.-]{1,120}\.log$/i
const SOURCE = /^[a-z][a-z0-9-]{0,31}$/
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 }

function within(root: string, p: string): boolean {
  const rel = relative(root, p)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

async function tail(d: Deps, file: string, max: number): Promise<{ text: string; bytes: number }> {
  const { size } = await d.fs.stat(file)
  const len = Math.max(0, Math.min(size, max))
  const fh = await d.fs.open(file, 'r')
  try {
    const buf = Buffer.alloc(len)
    const { bytesRead } = await fh.read(buf, 0, len, size - len)
    let start = 0
    if (size > len) {
      // Cut mid-file: skip a partial UTF-8 sequence (continuation bytes), then the partial line.
      while (start < bytesRead && ((buf[start] as number) & 0xc0) === 0x80) start++
      const nl = buf.indexOf(0x0a, start)
      start = nl < 0 || nl >= bytesRead ? bytesRead : nl + 1
    }
    return { text: buf.subarray(start, bytesRead).toString('utf8'), bytes: bytesRead }
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
        // Values of secret-looking keys never reach the text (same rule as src/log.ts).
        const safe = redactKeys(extra) as Record<string, unknown>
        const rest = Object.entries(safe).map(([k, v]) => `${k}=${scalar(v)}`)
        return {
          ts: typeof ts === 'string' ? ts.slice(0, 40) : '',
          level: levelOf(level),
          source: typeof name === 'string' ? toSource(name) : fileSource,
          text: [scalar(redactKeys(msg ?? '')), ...rest].filter(Boolean).join(' · '),
        }
      }
    } catch {
      /* not JSON: plain text below */
    }
  }
  const lv = /\b(ERROR|WARN(?:ING)?|DEBUG)\b/.exec(line)?.[1]
  return { ts: '', level: levelOf(lv), source: fileSource, text: line }
}

interface LogFile {
  file: string
  name: string
  /** Sort key, newest = largest: the date in the name, else the mtime. */
  key: string
}

async function listFiles(dirs: readonly string[], d: Deps): Promise<LogFile[]> {
  const out: LogFile[] = []
  for (const dir of dirs) {
    let realDir: string
    let names: string[]
    try {
      realDir = await d.fs.realpath(dir)
      names = (await d.fs.readdir(dir)).map(String).filter((n) => FILE.test(n))
    } catch {
      continue
    }
    for (const name of names) {
      const file = join(dir, name)
      try {
        const real = await d.fs.realpath(file)
        if (!within(realDir, real)) continue
        let key = DATE_IN_NAME.exec(name)?.[1] ?? ''
        if (!key) {
          const st = (await d.fs.stat(real)) as { mtime?: Date }
          key = st.mtime instanceof Date ? st.mtime.toISOString().slice(0, 10) : ''
        }
        out.push({ file: real, name, key })
      } catch {}
    }
  }
  // Newest first; same day: by name, so the order is stable.
  return out.sort((a, b) => (a.key === b.key ? a.name.localeCompare(b.name) : a.key < b.key ? 1 : -1))
}

/**
 * Reads newest files first, at most MAX_TOTAL_BYTES per call, and stops once a whole day of files
 * gave MAX_LINES matching lines (older days could only add older lines).
 */
export async function readLogs(
  dirs: readonly string[],
  query: LogsQuery,
  redact: (s: string) => string,
  d: Deps,
): Promise<Omit<LogsResult, 'dir'>> {
  type Entry = LogLine & { order: number }
  const matched: Entry[] = []
  const sources = new Set<string>()
  const min = RANK[query.level ?? 'info']
  const matches = (l: LogLine) =>
    (!query.source || l.source === query.source) &&
    (!query.level || query.level === 'info' || RANK[l.level] >= min)
  let budget = MAX_TOTAL_BYTES
  let order = 0
  const files = (await listFiles(dirs, d)).slice(0, MAX_FILES)
  for (let i = 0; i < files.length && budget > 0; i++) {
    const f = files[i] as LogFile
    let text: string
    try {
      const r = await tail(d, f.file, Math.min(TAIL_BYTES, budget))
      budget -= r.bytes
      text = r.text
    } catch {
      continue
    }
    const src = sourceOfFile(f.name)
    let lastTs = ''
    for (const raw of text.split(/\r?\n/)) {
      if (!raw.trim()) continue
      const p = parseLogLine(raw, src)
      const ts = redact(p.ts || lastTs).slice(0, 40)
      lastTs = p.ts || lastTs
      sources.add(p.source)
      const t = redact(p.text)
      const line: LogLine = { ...p, ts, text: t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT - 1)}…` : t }
      if (matches(line)) matched.push({ ...line, order: order++ })
    }
    const next = files[i + 1]
    if (matched.length >= MAX_LINES && (!next || next.key !== f.key)) break
  }
  matched.sort((a, b) => (a.ts === b.ts ? a.order - b.order : a.ts < b.ts ? -1 : 1))
  return {
    sources: [...sources].sort().slice(0, 50),
    lines: matched.slice(-MAX_LINES).map(({ order: _o, ...l }) => l),
  }
}

export const LOG_KEEP_DAYS = 14

/** Deletes the launcher's own `launcher-YYYY-MM-DD.log` files older than LOG_KEEP_DAYS (at startup). */
export async function pruneLauncherLogs(dir: string, d: Pick<Deps, 'fs' | 'now'>): Promise<string[]> {
  const cutoff = new Date(d.now().getTime() - LOG_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10)
  const names = await d.fs.readdir(dir).catch(() => [] as string[])
  const removed: string[] = []
  for (const name of names.map(String)) {
    const day = /^launcher-(\d{4}-\d{2}-\d{2})\.log$/.exec(name)?.[1]
    if (!day || day >= cutoff) continue
    try {
      await d.fs.rm(join(dir, name), { force: true })
      removed.push(name)
    } catch {}
  }
  return removed
}
