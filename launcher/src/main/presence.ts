/** Model of the Connections panel: Claude Code sessions, bridge tools and services. */
import { join } from 'node:path'
import type { PresenceGroup, PresenceItem } from '../shared/model'
import type { BridgeState } from './bridge/types'
import type { Deps } from './deps'
import { type EnvDoc, readVar } from './env-store'
import type { Registry } from './registry/registry'

const STALE_MS = 30_000
const BUSY_MS = 15_000
const FUTURE_SKEW_MS = 5_000
const MAX_USAGE_BYTES = 2 * 1024 * 1024
const NEURON_BUDGET = 10_000
const RUN_FILE = /^mcp-\d+\.json$/
const VI_NUMBER = new Intl.NumberFormat('vi-VN')

function baseName(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/** `workspace: {id, name, folder}` that Squarel writes when the session belongs to a workspace. */
function sessionWorkspace(w: unknown): { id: string; name: string; folder?: string } | undefined {
  if (!w || typeof w !== 'object') return undefined
  const { id, name, folder } = w as { id?: unknown; name?: unknown; folder?: unknown }
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return undefined
  if (typeof name !== 'string' || !name.trim()) return undefined
  return {
    id,
    name: name.trim().slice(0, 80),
    ...(typeof folder === 'string' && folder.length > 0 ? { folder: folder.slice(0, 1000) } : {}),
  }
}

function ms(s: unknown): number {
  return typeof s === 'string' ? Date.parse(s) : Number.NaN
}

/** A live Claude Code session of Squarel's MCP server (DATA_DIR/run/mcp-<pid>.json). */
export interface LiveSession {
  pid: number
  cwd: string
  /** The workspace Squarel found for the session, if any; `folder` is its art home (the project folder). */
  workspace?: { id: string; name: string; folder?: string }
  /** Tool called in the last 15 s. */
  busyWith?: string
}

/** Fresh session files whose pid is alive, sorted by pid. */
export async function liveSessions(dataDir: string, d: Deps): Promise<LiveSession[]> {
  const dir = join(dataDir, 'run')
  let names: string[]
  try {
    names = (await d.fs.readdir(dir)) as string[]
  } catch {
    return []
  }
  const now = d.now().getTime()
  const out: LiveSession[] = []
  for (const name of names.filter((n) => RUN_FILE.test(n)).sort()) {
    let j: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(String(await d.fs.readFile(join(dir, name), 'utf8')))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      j = parsed as Record<string, unknown>
    } catch {
      continue
    }
    const pid = j.pid
    if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0 || typeof j.cwd !== 'string') continue
    if (name !== `mcp-${pid}.json`) continue
    const updated = ms(j.updatedAt)
    if (!Number.isFinite(updated) || now - updated > STALE_MS || updated - now > FUTURE_SKEW_MS) continue
    if (!d.isPidAlive(pid)) continue
    const lastAt = ms(j.lastToolAt)
    const busy =
      typeof j.lastTool === 'string' &&
      Number.isFinite(lastAt) &&
      now - lastAt <= BUSY_MS &&
      lastAt - now <= FUTURE_SKEW_MS
    const workspace = sessionWorkspace(j.workspace)
    out.push({
      pid,
      cwd: j.cwd,
      ...(workspace ? { workspace } : {}),
      ...(busy ? { busyWith: j.lastTool as string } : {}),
    })
  }
  return out.sort((a, b) => a.pid - b.pid)
}

/** "Đang gọi <tool>" while a tool ran in the last 15 s, else "Rảnh". */
export function sessionSubtitle(s: LiveSession): string {
  return s.busyWith ? `Đang gọi ${s.busyWith}` : 'Rảnh'
}

async function sessions(dataDir: string, d: Deps): Promise<PresenceItem[]> {
  return (await liveSessions(dataDir, d)).map((s) => ({
    id: `claude-${s.pid}`,
    title: `Phiên · ${s.workspace?.name ?? baseName(s.cwd)}`,
    subtitle: sessionSubtitle(s),
    status: s.busyWith ? 'busy' : 'online',
    icon: 'bolt',
  }))
}

/** Sum of today's (UTC) Cloudflare neurons from the last 2 MB of usage.jsonl. */
async function neuronsUsedToday(dataDir: string, d: Deps): Promise<number> {
  const file = join(dataDir, 'usage.jsonl')
  let text: string
  try {
    const size = Number((await d.fs.stat(file)).size)
    const len = Math.min(size, MAX_USAGE_BYTES)
    const fh = await d.fs.open(file, 'r')
    try {
      const buf = Buffer.alloc(len)
      let got = 0
      while (got < len) {
        const { bytesRead } = await fh.read(buf, got, len - got, size - len + got)
        if (bytesRead === 0) break
        got += bytesRead
      }
      text = buf.subarray(0, got).toString('utf8')
    } finally {
      await fh.close()
    }
    if (size > len) text = text.slice(text.indexOf('\n') + 1) // drop the partial first line
  } catch {
    return 0
  }
  const today = d.now().toISOString().slice(0, 10)
  let used = 0
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const e = JSON.parse(line) as { provider?: unknown; unitKind?: unknown; units?: unknown; ts?: unknown }
      if (e.provider !== 'cloudflare' || e.unitKind !== 'neuron') continue
      if (typeof e.units !== 'number' || !Number.isFinite(e.units)) continue
      const t = ms(e.ts)
      if (!Number.isFinite(t) || new Date(t).toISOString().slice(0, 10) !== today) continue
      used += e.units
    } catch {
      /* tolerate malformed lines */
    }
  }
  return used
}

function bridgeItem(b: BridgeState): PresenceItem {
  const base = { id: 'svc-bridge', title: 'Bridge', icon: 'link' }
  if (b.mode === 'own' || b.mode === 'attached')
    return { ...base, subtitle: `ws://127.0.0.1:${b.port}`, status: 'online' }
  if (b.mode === 'foreign')
    return { ...base, subtitle: `Cổng ${b.port} do chương trình khác giữ`, status: 'away' }
  return { ...base, subtitle: 'Chưa chạy', status: 'offline' }
}

export async function buildPresence(
  input: { dataDir: string; bridge: BridgeState; reg: Registry; env: EnvDoc },
  d: Deps,
): Promise<PresenceGroup[]> {
  const { dataDir, bridge, reg, env } = input
  const claude = await sessions(dataDir, d)

  const tools: PresenceItem[] = []
  const used = new Set<string>()
  /** Two editor windows may show the same project: later ids get a `~2`, `~3`… suffix. */
  const unique = (base: string) => {
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}~${n}`
    used.add(id)
    return id
  }
  for (const i of reg.integrations) {
    const want = i.manifest.bridge?.client
    if (!want) continue
    for (const c of bridge.clients.filter((x) => x.name === want)) {
      tools.push({
        id: unique(`tool-${i.manifest.id}-${c.slug ?? c.name}`),
        title: i.manifest.name,
        subtitle: [c.slug, c.app].filter(Boolean).join(' · ') || 'Đã kết nối',
        status: 'online',
        icon: 'box',
        iconKind: 'name',
        componentId: i.manifest.id,
      })
    }
  }

  const services: PresenceItem[] = [bridgeItem(bridge)]
  if (readVar(env, 'CLOUDFLARE_API_TOKEN')?.trim()) {
    const left = Math.max(0, NEURON_BUDGET - (await neuronsUsedToday(dataDir, d)))
    services.push({
      id: 'svc-cloudflare',
      title: 'Cloudflare AI',
      subtitle: `Còn ${VI_NUMBER.format(left)} neuron hôm nay`,
      status: 'online',
      icon: 'cloud',
    })
  } else
    services.push({
      id: 'svc-cloudflare',
      title: 'Cloudflare AI',
      subtitle: 'Chưa có token',
      status: 'offline',
      icon: 'cloud',
    })
  const rd = !!readVar(env, 'RETRO_DIFFUSION_API_KEY')?.trim()
  services.push({
    id: 'svc-retrodiffusion',
    title: 'Retro Diffusion',
    subtitle: rd ? 'Đã có key' : 'Chưa có key · tuỳ chọn',
    status: rd ? 'online' : 'offline',
    icon: 'sparkle',
  })

  return [
    { id: 'claude', label: 'Claude Code', items: claude },
    { id: 'tools', label: 'Công cụ', items: tools },
    { id: 'services', label: 'Dịch vụ', items: services },
  ]
}
