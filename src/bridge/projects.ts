/**
 * Project directory of the single bridge process: resolves a project id to the folder that holds its
 * art (`<home>/squarel_art/`), for every project on the machine.
 * Sources: live MCP presence files (`DATA_DIR/run/mcp-*.json`), then the launcher's index
 * (`DATA_DIR/workspaces/*.json`). Learned homes are kept for the directory's lifetime and re-checked
 * against `<home>/.squarel/project.json` on every `get`.
 */
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Logger } from '../log.ts'
import { exists, readJson } from '../store/fsutil.ts'
import { Store } from '../store/store.ts'
import {
  artsDirOf,
  readWorkspace,
  resolveHome,
  samePath,
  type Workspace,
  type WorkspaceIndexEntry,
} from '../store/workspace.ts'
import { gitCommonDir } from '../store/worktree.ts'
import { ToolError } from '../tools/types.ts'

export interface KnownProject {
  id: string
  name: string
  home: string
  ws: Workspace
  store: Store
}

function alive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function jsonFiles(dir: string, prefix: string): Promise<string[]> {
  if (!(await exists(dir))) return []
  const names = await readdir(dir).catch(() => [] as string[])
  return names.filter((n) => n.startsWith(prefix) && n.endsWith('.json')).map((n) => join(dir, n))
}

export class ProjectDirectory {
  private readonly dataDir: string
  private readonly log: Logger
  /** id → home of every project learned so far. */
  private known = new Map<string, string>()
  /** id → homes, for ids declared by copied folders. */
  private duplicates = new Map<string, string[]>()
  private readonly stores = new Map<string, Store>()

  constructor(o: { dataDir: string; log: Logger }) {
    this.dataDir = o.dataDir
    this.log = o.log
  }

  homes(): string[] {
    return [...new Set(this.known.values())]
  }

  async get(id: string): Promise<KnownProject> {
    const home = this.known.get(id)
    if (home) {
      const ws = await this.read(home)
      if (ws?.id === id) return this.build(ws)
      this.known.delete(id)
    }
    await this.scan()
    const dup = this.duplicates.get(id)
    if (dup)
      throw new ToolError(
        'DUPLICATE_PROJECT',
        `Project id "${id}" is declared by more than one folder: ${dup.join(' and ')}. Change the id in one of their .squarel/project.json files.`,
      )
    const found = this.known.get(id)
    const ws = found ? await this.read(found) : undefined
    if (!ws || ws.id !== id) throw new ToolError('NOT_FOUND', `Unknown project "${id}".`)
    return this.build(ws)
  }

  async list(): Promise<KnownProject[]> {
    await this.scan()
    const out: KnownProject[] = []
    for (const home of this.known.values()) {
      const ws = await this.read(home)
      if (ws) out.push(this.build(ws))
    }
    return out
  }

  /** Re-scan every source; true when the set of homes changed. */
  async refresh(): Promise<boolean> {
    const before = this.homes()
    await this.scan()
    const after = this.homes()
    return before.length !== after.length || after.some((h) => !before.some((b) => samePath(b, h)))
  }

  /** The workspace at `home` with `home` kept as given, or undefined when it no longer declares one. */
  private async read(home: string): Promise<Workspace | undefined> {
    try {
      const ws = await readWorkspace(home, this.log)
      ws.home = home
      return ws
    } catch {
      return undefined
    }
  }

  private build(ws: Workspace): KnownProject {
    let store = this.stores.get(ws.home)
    if (!store) {
      store = new Store(artsDirOf(ws), { log: this.log, project: ws })
      this.stores.set(ws.home, store)
    }
    return { id: ws.id, name: ws.name, home: ws.home, ws, store }
  }

  private async candidates(): Promise<string[]> {
    const folders: string[] = []
    for (const f of await jsonFiles(join(this.dataDir, 'run'), 'mcp-')) {
      try {
        const p = await readJson<{ pid?: unknown; workspace?: { folder?: unknown } }>(f)
        const folder = p?.workspace?.folder
        if (alive(p?.pid) && typeof folder === 'string') folders.push(folder)
      } catch {}
    }
    for (const f of await jsonFiles(join(this.dataDir, 'workspaces'), '')) {
      try {
        const e = await readJson<WorkspaceIndexEntry>(f)
        if (typeof e?.folder === 'string') folders.push(e.folder)
      } catch {}
    }
    folders.push(...this.known.values())
    return folders
  }

  private async scan(): Promise<void> {
    const byId = new Map<string, Workspace[]>()
    for (const folder of await this.candidates()) {
      let ws: Workspace
      try {
        ws = await readWorkspace(folder, this.log)
        ws.home = await resolveHome(ws)
      } catch {
        continue
      }
      const list = byId.get(ws.id) ?? []
      if (!list.some((o) => samePath(o.home, ws.home))) list.push(ws)
      byId.set(ws.id, list)
    }
    const known = new Map<string, string>()
    const duplicates = new Map<string, string[]>()
    for (const [id, list] of byId) {
      if (await sameRepository(list.map((w) => w.home))) known.set(id, list[0].home)
      else {
        const homes = list.map((w) => w.home)
        duplicates.set(id, homes)
        if (!this.duplicates.has(id))
          this.log.warn('project id is declared by several folders; skipped', { id, homes })
      }
    }
    this.known = known
    this.duplicates = duplicates
  }
}

/** True when every home is in one git repository (linked worktrees of a project are not copies). */
async function sameRepository(homes: string[]): Promise<boolean> {
  if (homes.length < 2) return true
  const dirs = await Promise.all(homes.map((h) => gitCommonDir(h)))
  const first = dirs[0]
  return first !== undefined && dirs.every((d) => d !== undefined && samePath(d, first))
}
