/**
 * Presence file for the desktop launcher: DATA_DIR/run/mcp-<pid>.json.
 * Rewritten every intervalMs and after each tool call; removed on exit.
 * The launcher treats a file as stale after 30 seconds without an update.
 */
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeAtomic } from '../store/fsutil.ts'

export interface McpPresence {
  pid: number
  cwd: string
  version: string
  startedAt: string
  updatedAt: string
  lastTool?: string
  lastToolAt?: string
  bridge: 'own' | 'shared' | 'none'
  /** Workspace ("Dự án") detected at startup, if any. */
  workspace?: { id: string; name: string }
}

/**
 * 'own' = this process runs the bridge; 'shared' = another process owns the port (start() returned false);
 * 'none' = no bridge (disabled, or start() threw).
 */
export function bridgeMode(s: {
  disabled: boolean
  up: boolean
  startThrew: boolean
}): McpPresence['bridge'] {
  if (s.disabled || s.startThrew) return 'none'
  return s.up ? 'own' : 'shared'
}

export function presenceFile(dataDir: string, pid: number = process.pid): string {
  return join(dataDir, 'run', `mcp-${pid}.json`)
}

export function startPresence(opts: {
  dataDir: string
  version: string
  bridge: McpPresence['bridge']
  workspace?: { id: string; name: string }
  intervalMs?: number
  now?: () => Date
  pid?: number
}): { touch(tool: string): void; stop(): Promise<void> } {
  const now = opts.now ?? (() => new Date())
  const pid = opts.pid ?? process.pid
  const file = presenceFile(opts.dataDir, pid)
  const state: McpPresence = {
    pid,
    cwd: process.cwd(),
    version: opts.version,
    startedAt: now().toISOString(),
    updatedAt: now().toISOString(),
    bridge: opts.bridge,
    ...(opts.workspace ? { workspace: { id: opts.workspace.id, name: opts.workspace.name } } : {}),
  }
  let stopped = false
  let chain: Promise<void> = Promise.resolve()

  const write = () => {
    if (stopped) return
    state.updatedAt = now().toISOString()
    const body = `${JSON.stringify(state)}\n`
    // Serialize writes so a late write can never land after stop() removed the file.
    chain = chain.then(() => (stopped ? undefined : writeAtomic(file, body))).catch(() => {})
  }

  write()
  const timer = setInterval(write, opts.intervalMs ?? 10_000)
  timer.unref()

  return {
    touch(tool: string) {
      if (stopped) return
      state.lastTool = tool
      state.lastToolAt = now().toISOString()
      write()
    },
    async stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      await chain
      await rm(file, { force: true }).catch(() => {})
    },
  }
}
