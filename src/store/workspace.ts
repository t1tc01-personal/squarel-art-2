/**
 * Workspaces ("Dự án" in the launcher): a folder that groups several arts for one purpose.
 * The folder's `.squarel/project.json` is the source of truth (written by the launcher; Squarel only reads it).
 * DATA_DIR/workspaces/<id>.json is an index (id → folder) owned by the launcher; Squarel only repairs
 * an existing entry whose folder was moved (see ensureWorkspaceIndex).
 * `<home>/.squarel/arts.md` is a generated catalog of the workspace's arts.
 */
import { readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Logger } from '../log.ts'
import { PALETTES } from '../shared/palettes.ts'
import { MAX_SIDE, PURPOSES } from '../shared/types.ts'
import { exists, readJson, writeAtomic } from './fsutil.ts'
import type { ProjectInfo, Store } from './store.ts'
import { mainCheckoutOf } from './worktree.ts'

export const WORKSPACE_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
export const WORKSPACE_DIR = '.squarel'
export const WORKSPACE_FILE = 'project.json'
export const CATALOG_FILE = 'arts.md'
const MAX_WALK = 32
/** Folder inside a workspace's home that holds its arts. */
export const ART_DIR = 'squarel_art'
export const ART_GITIGNORE = `*/.lock
*.tmp
*/.work-*.json
*/proposals/
*/exports/
*/work.aseprite
*/thumb.png
`

export type WorkspaceDefaults = {
  purpose?: (typeof PURPOSES)[number]
  width?: number
  height?: number
  /** A key of PALETTES. */
  palette?: string
  [k: string]: unknown
}

/** `.squarel/project.json` (shared contract with the launcher; unknown fields are kept). */
export type WorkspaceConfig = {
  schema: number
  id: string
  name: string
  description?: string
  brief?: string
  defaults?: WorkspaceDefaults
  repos?: string[]
  exportDir?: string
  [k: string]: unknown
}

const MAX_NAME = 80
const MAX_DESCRIPTION = 2000
const MAX_BRIEF = 8000
const MAX_REPOS = 20

const paletteKey = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '')

/** Match a palette name loosely: case-insensitive, ignoring "-", "_" and spaces ("PICO-8" → pico8). */
export function normalizePaletteName(name: string): string | undefined {
  const k = paletteKey(name)
  return Object.keys(PALETTES).find((p) => paletteKey(p) === k)
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

const isBlank = (v: unknown) => v === undefined || v === null || v === ''

/**
 * Lenient parse of `.squarel/project.json` (it may be hand-edited). Only a valid `id` and a non-empty
 * `name` are required (the name is clipped to 80 characters); every other bad field is dropped or
 * clipped on its own and reported in `warnings`. Unknown fields are kept. Throws when the file cannot
 * describe a workspace at all.
 */
export function parseWorkspaceConfig(raw: unknown): { config: WorkspaceConfig; warnings: string[] } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('file: expected a JSON object')
  const src = raw as Record<string, unknown>
  if (typeof src.id !== 'string' || !WORKSPACE_ID_RE.test(src.id))
    throw new Error(`id: expected lowercase letters, digits and "-" (got ${JSON.stringify(src.id)})`)
  const name = typeof src.name === 'string' ? src.name.trim() : ''
  if (!name) throw new Error('name: expected a non-empty string')
  const warnings: string[] = []
  const config: WorkspaceConfig = { ...src, schema: 1, id: src.id, name }
  for (const k of ['description', 'brief', 'defaults', 'repos', 'exportDir']) delete config[k]

  if (name.length > MAX_NAME) {
    config.name = name.slice(0, MAX_NAME)
    warnings.push(`name: longer than ${MAX_NAME} characters, truncated`)
  }
  if (isInt(src.schema, 1, Number.MAX_SAFE_INTEGER)) config.schema = src.schema
  else if (src.schema !== undefined) warnings.push('schema: not a positive integer, using 1')

  const text = (key: 'description' | 'brief', max: number) => {
    const v = src[key]
    if (isBlank(v)) return
    if (typeof v !== 'string') {
      warnings.push(`${key}: not a string, ignored`)
    } else if (v.length > max) {
      warnings.push(`${key}: longer than ${max} characters, truncated`)
      config[key] = v.slice(0, max)
    } else config[key] = v
  }
  text('description', MAX_DESCRIPTION)
  text('brief', MAX_BRIEF)

  const d = src.defaults
  if (!isBlank(d)) {
    if (typeof d !== 'object' || Array.isArray(d)) warnings.push('defaults: not an object, ignored')
    else {
      const sd = d as Record<string, unknown>
      const out: WorkspaceDefaults = { ...sd }
      for (const k of ['purpose', 'width', 'height', 'palette']) delete out[k]
      if (!isBlank(sd.purpose)) {
        if ((PURPOSES as readonly unknown[]).includes(sd.purpose))
          out.purpose = sd.purpose as WorkspaceDefaults['purpose']
        else warnings.push(`defaults.purpose: unknown purpose ${JSON.stringify(sd.purpose)}, ignored`)
      }
      for (const k of ['width', 'height'] as const) {
        const v = sd[k]
        if (isBlank(v)) continue
        if (isInt(v, 1, MAX_SIDE)) out[k] = v
        else warnings.push(`defaults.${k}: expected an integer 1..${MAX_SIDE}, ignored`)
      }
      if (!isBlank(sd.palette)) {
        const p = typeof sd.palette === 'string' ? normalizePaletteName(sd.palette) : undefined
        if (p) out.palette = p
        else warnings.push(`defaults.palette: unknown palette ${JSON.stringify(sd.palette)}, ignored`)
      }
      config.defaults = out
    }
  }

  const r = src.repos
  if (!isBlank(r)) {
    if (!Array.isArray(r)) warnings.push('repos: not a list, ignored')
    else {
      const ok = r.filter((x): x is string => typeof x === 'string' && x.length > 0)
      if (ok.length < r.length) warnings.push('repos: entries that are not non-empty strings were ignored')
      if (ok.length > MAX_REPOS) warnings.push(`repos: more than ${MAX_REPOS}, extra entries ignored`)
      config.repos = ok.slice(0, MAX_REPOS)
    }
  }

  const e = src.exportDir
  if (typeof e === 'string' && e !== '') config.exportDir = e
  else if (!isBlank(e)) warnings.push('exportDir: not a string, ignored')

  return { config, warnings }
}

export interface Workspace {
  id: string
  name: string
  /** Absolute path of the workspace folder (the one holding `.squarel/`). */
  folder: string
  /**
   * Folder whose `squarel_art/` holds the arts: `folder`, or the same folder in the main checkout
   * when `folder` is in a linked git worktree of the same project.
   */
  home: string
  config: WorkspaceConfig
}

export function artsDirOf(ws: Workspace): string {
  return join(ws.home, ART_DIR)
}

/** DATA_DIR/workspaces/<id>.json */
export interface WorkspaceIndexEntry {
  schema: 1
  id: string
  name: string
  folder: string
  createdAt: string
  [k: string]: unknown
}

export function workspaceConfigPath(folder: string): string {
  return join(folder, WORKSPACE_DIR, WORKSPACE_FILE)
}

export function catalogPath(folder: string): string {
  return join(folder, WORKSPACE_DIR, CATALOG_FILE)
}

export function workspaceIndexPath(dataDir: string, id: string): string {
  if (!WORKSPACE_ID_RE.test(id)) throw new Error(`invalid workspace id "${id}"`)
  return join(dataDir, 'workspaces', `${id}.json`)
}

/**
 * Read `<folder>/.squarel/project.json` leniently (see parseWorkspaceConfig); dropped fields are
 * logged. Throws with a readable message when it is unreadable or lacks a valid id or name.
 */
export async function readWorkspace(folder: string, log?: Logger): Promise<Workspace> {
  const abs = resolve(folder)
  const file = workspaceConfigPath(abs)
  let raw: unknown
  try {
    raw = await readJson<unknown>(file)
  } catch (e) {
    throw new Error(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
  let parsed: ReturnType<typeof parseWorkspaceConfig>
  try {
    parsed = parseWorkspaceConfig(raw)
  } catch (e) {
    throw new Error(`invalid ${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (parsed.warnings.length)
    log?.warn('workspace file has invalid fields; they are ignored', { file, issues: parsed.warnings })
  const { config } = parsed
  return { id: config.id, name: config.name, folder: abs, home: abs, config }
}

/**
 * Walk up from `start` (at most 32 levels, stopping at the filesystem root) to the first folder with
 * `.squarel/project.json`. A broken file is logged and treated as "no workspace".
 * Detection never needs the DATA_DIR index; see ensureWorkspaceIndex for when an entry is repaired.
 */
export async function detectWorkspace(o: {
  start: string
  dataDir?: string
  log?: Logger
}): Promise<Workspace | undefined> {
  let dir = resolve(o.start)
  for (let i = 0; i < MAX_WALK; i++) {
    if (await exists(workspaceConfigPath(dir))) {
      let ws: Workspace
      try {
        ws = await readWorkspace(dir, o.log)
      } catch (e) {
        o.log?.warn('ignoring broken workspace file', { error: String(e) })
        return undefined
      }
      if (o.dataDir)
        await ensureWorkspaceIndex(o.dataDir, ws).catch((e) =>
          o.log?.warn('workspace index update failed', { id: ws.id, error: String(e) }),
        )
      ws.home = await resolveHome(ws)
      return ws
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Where the arts live: the main checkout's folder when `ws.folder` is in a linked git worktree and
 * that folder holds the same project id; otherwise `ws.folder`.
 */
export async function resolveHome(ws: Workspace): Promise<string> {
  const main = await mainCheckoutOf(ws.folder)
  if (main && (await folderWorkspaceId(main)) === ws.id) return main
  return ws.folder
}

export async function readWorkspaceIndex(
  dataDir: string,
  id: string,
): Promise<WorkspaceIndexEntry | undefined> {
  const file = workspaceIndexPath(dataDir, id)
  if (!(await exists(file))) return undefined
  try {
    const e = await readJson<WorkspaceIndexEntry>(file)
    return e && typeof e.folder === 'string' ? e : undefined
  } catch {
    return undefined
  }
}

const samePath = (a: string, b: string) =>
  process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b)

/** Id in `<folder>/.squarel/project.json`, or undefined when it is missing or unreadable. */
async function folderWorkspaceId(folder: string): Promise<string | undefined> {
  try {
    const raw = await readJson<unknown>(workspaceConfigPath(folder))
    const id = raw && typeof raw === 'object' ? (raw as { id?: unknown }).id : undefined
    return typeof id === 'string' ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Repair the DATA_DIR index entry after its workspace folder was moved. Returns true when written.
 * - No entry: nothing is written. The launcher owns registration, and removing a workspace there
 *   deletes its entry, so it must stay removed.
 * - The entry's folder still holds a `.squarel/project.json` with this id: the entry is live and is
 *   never moved (a copied folder or an old removed one must not take it over).
 * - Otherwise (that folder is gone or now holds something else): the entry is pointed at `ws.folder`.
 */
export async function ensureWorkspaceIndex(dataDir: string, ws: Workspace): Promise<boolean> {
  const cur = await readWorkspaceIndex(dataDir, ws.id)
  if (!cur || samePath(cur.folder, ws.folder)) return false
  if ((await folderWorkspaceId(cur.folder)) === ws.id) return false
  const entry: WorkspaceIndexEntry = { ...cur, schema: 1, id: ws.id, folder: ws.folder }
  await writeAtomic(workspaceIndexPath(dataDir, ws.id), `${JSON.stringify(entry, null, 2)}\n`)
  return true
}

/** Find a workspace by id through the DATA_DIR index; undefined if unknown, moved or broken. */
export async function loadWorkspaceById(dataDir: string, id: string): Promise<Workspace | undefined> {
  if (!WORKSPACE_ID_RE.test(id)) return undefined
  const entry = await readWorkspaceIndex(dataDir, id)
  if (!entry) return undefined
  try {
    const ws = await readWorkspace(entry.folder)
    return ws.id === id ? ws : undefined
  } catch {
    return undefined
  }
}

/**
 * Why `exportDir` is not a usable export folder for the workspace `folder`, or undefined when it is.
 * Same rule as the launcher: a relative path to a sub-folder strictly inside the workspace folder.
 * Empty, "." (the folder itself), absolute paths and escapes ("..", "../x") are rejected; a folder
 * literally named "..assets" is allowed.
 */
export function exportDirProblem(folder: string, exportDir: string): string | undefined {
  if (exportDir.trim() === '') return 'it is empty'
  if (isAbsolute(exportDir)) return 'it is an absolute path; use a path relative to the project folder'
  const base = resolve(folder)
  const rel = relative(base, resolve(base, exportDir))
  if (rel === '') return 'it is the project folder itself; name a sub-folder'
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    return 'it points outside the project folder'
  return undefined
}

/**
 * Resolve `exportDir` inside the workspace folder. Returns undefined when not set;
 * throws (with the reason from exportDirProblem) when it is not a sub-folder of the workspace folder.
 */
export function resolveExportDir(ws: Workspace): string | undefined {
  const rel = ws.config.exportDir
  if (rel === undefined) return undefined
  const problem = exportDirProblem(ws.folder, rel)
  if (problem) throw new Error(`exportDir "${rel}" is not usable: ${problem}`)
  return resolve(ws.folder, rel)
}

export function describeDefaults(d: WorkspaceDefaults | undefined): string {
  const parts: string[] = []
  if (d?.purpose) parts.push(d.purpose)
  if (d?.width && d?.height) parts.push(`${d.width}×${d.height}`)
  else if (d?.width) parts.push(`width ${d.width}`)
  else if (d?.height) parts.push(`height ${d.height}`)
  parts.push(d?.palette ? `palette ${d.palette}` : 'free palette')
  return parts.join(', ')
}

/** Arts in a project's store, newest first. */
export async function workspaceArts(store: Store): Promise<ProjectInfo[]> {
  return store.listProjects()
}

// ---- catalog (.squarel/arts.md) ----

const headCache = new Map<string, { head: string; width: number; height: number; frames: number }>()

async function artShape(store: Store, p: ProjectInfo) {
  const key = `${store.root}|${p.slug}`
  const hit = headCache.get(key)
  if (hit && hit.head === p.head) return hit
  const { doc } = await store.readHead(p.slug)
  const v = { head: p.head, width: doc.width, height: doc.height, frames: doc.frames.length }
  headCache.set(key, v)
  return v
}

async function latestExports(store: Store, slug: string, n = 5): Promise<string[]> {
  const dir = store.projectPath(slug, 'exports')
  if (!(await exists(dir))) return []
  const files: { path: string; mtime: number }[] = []
  for (const e of await readdir(dir, { withFileTypes: true }))
    if (e.isFile() && !e.name.endsWith('.tmp')) {
      const path = join(dir, e.name)
      files.push({ path, mtime: (await stat(path)).mtimeMs })
    }
  return files
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n)
    .map((f) => f.path)
}

export async function renderCatalog(store: Store, ws: Workspace): Promise<string> {
  const arts = await workspaceArts(store)
  const out = [
    "<!-- Generated by Squarel. Do not edit: this file is rewritten after every change to this project's art. -->",
    `# Art catalog: ${ws.name}`,
    '',
    `${arts.length} art${arts.length === 1 ? '' : 's'} in this project, newest first. Defaults for new art: ${describeDefaults(ws.config.defaults)}.`,
    'Open one with the Squarel tool `art_open` and its id.',
    '',
  ]
  for (const p of arts) {
    let shape = ''
    try {
      const s = await artShape(store, p)
      shape = `${s.width}×${s.height}, ${s.frames} frame${s.frames === 1 ? '' : 's'}`
    } catch {
      shape = 'unreadable'
    }
    out.push(
      `## ${p.name}`,
      '',
      `- Slug: \`${p.slug}\``,
      `- Size: ${shape}`,
      `- Purpose: ${p.purpose}`,
      `- Head version: ${p.head}, updated ${p.updatedAt}`,
    )
    const exp = await latestExports(store, p.slug).catch(() => [])
    if (exp.length) out.push(`- Latest exports:${exp.map((f) => `\n  - \`${f}\``).join('')}`)
    out.push('')
  }
  return `${out.join('\n').trimEnd()}\n`
}

const catalogChains = new Map<string, Promise<void>>()

/** Regenerate `<home>/.squarel/arts.md`. Never throws: failures are logged. */
export function writeCatalog(store: Store, ws: Workspace, log?: Logger): Promise<void> {
  const key = ws.home.toLowerCase()
  const run = async () => {
    try {
      await writeAtomic(catalogPath(ws.home), await renderCatalog(store, ws))
    } catch (e) {
      log?.warn('art catalog update failed', { workspace: ws.id, error: String(e) })
    }
  }
  // Serialize per folder inside this process so an older render never lands last.
  const next = (catalogChains.get(key) ?? Promise.resolve()).then(run)
  catalogChains.set(key, next)
  next.then(() => {
    if (catalogChains.get(key) === next) catalogChains.delete(key)
  })
  return next
}
