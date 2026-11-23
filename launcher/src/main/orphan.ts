/**
 * Orphaned own bridge (ruling B11): the launcher remembers the pid of the bridge it spawned
 * (`bridge-owner.json` next to state.json) and forgets it when that child exits. If the launcher
 * died without stopping it, the next start finds the record and kills the old bridge, but only
 * when it can prove the process is that bridge: a node process running `src/bridge/index.ts`
 * whose start time matches the record (a reused pid never matches). Anything else is left alone.
 * After a kill the supervisor's normal cycle spawns a fresh own bridge.
 */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BridgeChild, Deps } from './deps'

export interface OwnerRecord {
  pid: number
  port: number
  /** When the launcher spawned it (ISO). */
  startedAt: string
}

export interface ProcInfo {
  /** Full path (or name) of the process image. */
  image: string
  commandLine: string
  createdAt?: Date
}

export interface OrphanDeps {
  read(): Promise<string | undefined>
  write(text: string): Promise<void>
  remove(): Promise<void>
  isPidAlive(pid: number): boolean
  /** Image, command line and start time of a running process; undefined when unknown. */
  procInfo(pid: number): Promise<ProcInfo | undefined>
  /** Kills that one process and waits (bounded) for it to end. */
  kill(pid: number): Promise<void>
  log?(message: string): void
}

export type OrphanOutcome = 'none' | 'gone' | 'not-ours' | 'killed'

/** Spawn → process creation time skew we accept. */
const START_SKEW_MS = 30_000

export function isOurBridge(rec: OwnerRecord, info: ProcInfo): boolean {
  const image = (info.image.split(/[\\/]/).pop() ?? '').toLowerCase()
  if (image !== 'node.exe' && image !== 'node') return false
  if (!/(^|[\s"'])src[\\/]bridge[\\/]index\.ts(["'\s]|$)/.test(info.commandLine)) return false
  const started = Date.parse(rec.startedAt)
  if (!info.createdAt || !Number.isFinite(started) || !Number.isFinite(info.createdAt.getTime())) return false
  return Math.abs(info.createdAt.getTime() - started) <= START_SKEW_MS
}

function parseRecord(text: string): OwnerRecord | undefined {
  try {
    const r = JSON.parse(text) as Partial<OwnerRecord>
    if (
      Number.isInteger(r.pid) &&
      (r.pid as number) > 0 &&
      Number.isInteger(r.port) &&
      typeof r.startedAt === 'string' &&
      Number.isFinite(Date.parse(r.startedAt))
    )
      return { pid: r.pid as number, port: r.port as number, startedAt: r.startedAt }
  } catch {}
  return undefined
}

export async function recoverOrphanBridge(deps: OrphanDeps): Promise<OrphanOutcome> {
  const text = await deps.read().catch(() => undefined)
  if (text === undefined) return 'none'
  const rec = parseRecord(text)
  if (!rec) {
    await deps.remove().catch(() => {})
    return 'none'
  }
  let outcome: OrphanOutcome = 'gone'
  if (deps.isPidAlive(rec.pid)) {
    const info = await deps.procInfo(rec.pid).catch(() => undefined)
    if (info && isOurBridge(rec, info)) {
      deps.log?.(`orphaned bridge (pid ${rec.pid}) from an earlier run: stopping it`)
      await deps.kill(rec.pid)
      outcome = 'killed'
    } else {
      outcome = 'not-ours'
    }
  }
  await deps.remove().catch(() => {})
  return outcome
}

/** Remembers a freshly spawned own bridge; the record goes away when that child exits. */
export async function recordOwnBridge(
  deps: Pick<OrphanDeps, 'read' | 'write' | 'remove'>,
  child: Pick<BridgeChild, 'pid' | 'exited'>,
  port: number,
  now: Date,
): Promise<void> {
  const pid = child.pid
  if (!pid) return
  void child.exited.then(async () => {
    const cur = parseRecord((await deps.read().catch(() => undefined)) ?? '')
    if (cur?.pid === pid) await deps.remove().catch(() => {})
  })
  const rec: OwnerRecord = { pid, port, startedAt: now.toISOString() }
  await deps.write(`${JSON.stringify(rec)}\n`).catch(() => {})
}

/** Parses the JSON line of `windowsProcInfo`'s PowerShell query. */
export function parseProcInfo(text: string): ProcInfo | undefined {
  try {
    const r = JSON.parse(text) as { image?: unknown; cmd?: unknown; created?: unknown }
    if (typeof r.image !== 'string' || typeof r.cmd !== 'string') return undefined
    const created = typeof r.created === 'string' ? new Date(r.created) : undefined
    return {
      image: r.image,
      commandLine: r.cmd,
      ...(created && Number.isFinite(created.getTime()) ? { createdAt: created } : {}),
    }
  } catch {
    return undefined
  }
}

/** Image, command line and start time of `pid` (Win32_Process via the system PowerShell). */
export async function windowsProcInfo(
  pid: number,
  d: Pick<Deps, 'run' | 'env'>,
): Promise<ProcInfo | undefined> {
  if (!Number.isInteger(pid) || pid <= 0) return undefined
  const ps = join(
    d.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )
  const script = [
    `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'`,
    "if ($p) { [pscustomobject]@{ image = $p.ExecutablePath; cmd = $p.CommandLine; created = $p.CreationDate.ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress }",
  ].join('; ')
  const lines: string[] = []
  const { code } = await d.run({
    argv: [ps, '-NoProfile', '-NonInteractive', '-Command', script],
    cwd: tmpdir(),
    onLine: (l) => lines.push(l),
    signal: AbortSignal.timeout(15_000),
  })
  if (code !== 0) return undefined
  const line = lines.map((l) => l.trim()).find((l) => l.startsWith('{'))
  return line ? parseProcInfo(line) : undefined
}
