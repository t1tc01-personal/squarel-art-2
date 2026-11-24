/**
 * Dự án (workspaces, spec 2026-11-24): a folder with `.squarel/project.json` (the source of truth),
 * a managed block in `AGENTS.md` and an `@AGENTS.md` line in `CLAUDE.md`, plus an index entry
 * `DATA_DIR/workspaces/<id>.json` so the launcher can list it. Arts (Squarel "projects") join a
 * workspace through the `workspace` field of `DATA_DIR/projects/<slug>/project.json`.
 *
 * Pure: every file access goes through Deps. Errors meant for the user are WorkspaceError (fixed
 * Vietnamese messages); the IPC layer turns them into IpcError.
 */
import { win32 } from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  type ArtView,
  WORKSPACE_ID,
  WORKSPACE_PALETTES,
  WORKSPACE_PURPOSES,
  type WorkspaceCreate,
  type WorkspaceDefaults,
  type WorkspaceDetail,
  type WorkspaceFolderInfo,
  type WorkspacePatch,
  type WorkspaceSummary,
} from '../shared/ipc'
import type { Deps, DetachedSpec } from './deps'
import { type LiveSession, liveSessions, sessionSubtitle } from './presence'
import { SAFE_PATH_ITEM, terminalArgvWith } from './setup'
import { system32 } from './system-root'
import { worktreeMain } from './worktree'

const { basename, dirname, isAbsolute, join, relative, resolve, sep } = win32

/** Where a project folder keeps its art (folder contract with Squarel, duplicated: no src import). */
export const ART_DIR = 'squarel_art'
/** Exact content of `squarel_art/.gitignore`: heavy and machine-local files stay out of git. */
export const ART_GITIGNORE = `*/.lock
*.tmp
*/.work-*.json
*/proposals/
*/exports/
*/work.aseprite
*/thumb.png
`

/** A problem the user can fix; the message is shown as is. */
export class WorkspaceError extends Error {}

export interface WorkspaceCtx {
  d: Deps
  /** Squarel's DATA_DIR (from its .env). */
  dataDir: string
  /**
   * Defense in depth (like squarelDir / DATA_DIR): true when the user chose this path with the
   * pick dialog in this session. A new workspace folder may also be a new folder right inside one.
   */
  chosen(path: string): boolean
}

/** The workspace config in `.squarel/project.json`, normalized (unknown fields live in `raw`). */
export interface WorkspaceConfig {
  id: string
  name: string
  description: string
  brief: string
  defaults: WorkspaceDefaults
  repos: string[]
  exportDir: string | null
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION_ID = /^v\d{6}$/
const UNC = /^[\\/]{2}/
const DRIVE_ABS = /^[A-Za-z]:[\\/]/
/** Characters Windows never allows in a path (besides the drive colon). */
const badPath = (s: string) => /["*?<>|]/.test(s) || [...s].some((c) => c.charCodeAt(0) < 0x20)
const MAX_JSON = 256 * 1024
const MAX_ART_JSON = 64 * 1024
const MAX_THUMB = 64 * 1024
const MAX_VERSION_GZ = 4 * 1024 * 1024
const MAX_MD = 1024 * 1024
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export const BLOCK_BEGIN =
  '<!-- squarel:begin (managed by Squarel Art Launcher; edits inside this block are replaced) -->'
export const BLOCK_END = '<!-- squarel:end -->'
const BEGIN_PREFIX = '<!-- squarel:begin'
const CLAUDE_IMPORT = '@AGENTS.md'

// ---- pure helpers -----------------------------------------------------------------------------

/** Same as Squarel's src/store/store.ts slugify (Vietnamese marks dropped, đ → d). */
export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '')
  return s || 'du-an'
}

/** User text must not end the managed block early. */
const inert = (s: string) => s.split('<!-- squarel:').join('<!-- squarel :')

function defaultsLine(x: WorkspaceDefaults): string {
  const parts: string[] = []
  if (x.purpose) parts.push(x.purpose)
  if (x.width && x.height) parts.push(`${x.width}×${x.height}`)
  else if (x.width) parts.push(`width ${x.width}`)
  else if (x.height) parts.push(`height ${x.height}`)
  if (x.palette) parts.push(`palette ${x.palette}`)
  return parts.length ? parts.join(', ') : 'none (ask the user)'
}

/** The managed AGENTS.md block (spec §3.1); LF line endings, no trailing newline. */
export function renderAgentsBlock(cfg: WorkspaceConfig): string {
  const lines = [BLOCK_BEGIN, `# ${inert(cfg.name.trim())}`, '']
  const description = cfg.description.trim()
  if (description) lines.push(inert(description), '')
  const brief = cfg.brief.trim()
  if (brief) lines.push('## Art brief', '', inert(brief), '')
  lines.push(
    '## Squarel',
    '- Pixel art for this project is made with the `squarel` MCP tools; new art joins this project automatically.',
    `- Defaults for new art: ${defaultsLine(cfg.defaults)}.`,
    `- Art catalog: \`.squarel/arts.md\`.${cfg.exportDir ? ` Exports are also copied to \`${cfg.exportDir}\`.` : ''}`,
  )
  if (cfg.repos.length)
    lines.push(
      `- Repos: ${cfg.repos.map((r) => `\`${r}\` (${DRIVE_ABS.test(r) ? 'outside' : 'inside'})`).join(', ')}.`,
    )
  lines.push(BLOCK_END)
  return lines.join('\n').replace(/\r/g, '')
}

/** Splits a leading BOM off and tells which line ending the text uses. */
function textParts(s: string): { bom: string; body: string; eol: string } {
  const bom = s.startsWith('﻿') ? '﻿' : ''
  const body = s.slice(bom.length)
  return { bom, body, eol: body.includes('\r\n') ? '\r\n' : '\n' }
}

/**
 * AGENTS.md with the managed block: a new file is just the block; a file without the block gets
 * it on top (the rest untouched); an existing block is replaced and nothing else changes. A begin
 * line without its end line is refused (guessing where the block ends could eat the user's text).
 */
export function mergeAgentsBlock(existing: string | undefined, block: string): string {
  if (existing === undefined || existing === '') return `${block}\n`
  const { bom, body, eol } = textParts(existing)
  const b = block.replace(/\r?\n/g, eol)
  const start = body.indexOf(BEGIN_PREFIX)
  const end = start === -1 ? -1 : body.indexOf(BLOCK_END, start)
  if (start !== -1 && end === -1)
    throw new WorkspaceError(
      `AGENTS.md có dòng mở khối Squarel nhưng thiếu dòng ${BLOCK_END}; hãy sửa tay rồi thử lại`,
    )
  if (start !== -1) return bom + body.slice(0, start) + b + body.slice(end + BLOCK_END.length)
  return `${bom}${b}${eol}${eol}${body}`
}

/** CLAUDE.md that imports AGENTS.md: created, or the line added on top; unchanged when present. */
export function ensureClaudeImport(existing: string | undefined): string {
  if (existing === undefined || existing === '') return `${CLAUDE_IMPORT}\n`
  const { bom, body, eol } = textParts(existing)
  if (body.split(/\r?\n/).some((l) => l.trim() === CLAUDE_IMPORT)) return existing
  return `${bom}${CLAUDE_IMPORT}${eol}${body}`
}

// ---- path checks ------------------------------------------------------------------------------

const within = (root: string, p: string) => {
  const rel = relative(root, p)
  return rel === '' || (rel !== '..' && !rel.startsWith('..\\') && !isAbsolute(rel))
}
const samePath = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase()

/** An absolute folder on this machine (no network path, no drive root), normalized. */
export function checkFolder(p: string): string {
  const v = p.trim()
  if (UNC.test(v) || !DRIVE_ABS.test(v) || badPath(v) || v.slice(2).includes(':'))
    throw new WorkspaceError('Thư mục dự án phải là đường dẫn tuyệt đối trên máy (không phải đường dẫn mạng)')
  const full = resolve(v)
  if (dirname(full) === full) throw new WorkspaceError('Không dùng gốc ổ đĩa làm thư mục dự án')
  return full
}

/**
 * `exportDir`: a sub-folder strictly inside the folder, stored relative with `/`. Same rule as
 * Squarel's exportDirProblem (empty, the folder itself, absolute paths and escapes such as `..` or
 * `../x` are refused; a folder named `..assets` is fine), plus no drive colon or characters Windows
 * rejects.
 */
export function checkExportDir(folder: string, exportDir: string): string {
  const v = exportDir.trim().replace(/[\\/]+$/, '')
  const bad = new WorkspaceError('Thư mục nhận file xuất phải là đường dẫn tương đối nằm trong thư mục dự án')
  if (!v || UNC.test(v) || isAbsolute(v) || v.includes(':') || badPath(v)) throw bad
  const base = resolve(folder)
  const rel = relative(base, resolve(base, v))
  if (rel === '')
    throw new WorkspaceError('Thư mục nhận file xuất phải là một thư mục con, không phải chính thư mục dự án')
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw bad
  return rel.replace(/\\/g, '/')
}

async function isDirectory(d: Deps, p: string): Promise<boolean> {
  try {
    return (await d.fs.stat(p)).isDirectory()
  } catch {
    return false
  }
}

/**
 * Repos: relative ones must stay inside the folder (stored with `/`); absolute ones must be
 * existing folders on this machine, chosen with the dialog (or already in the config). An absolute
 * path inside the folder is stored relative.
 */
export async function checkRepos(
  ctx: WorkspaceCtx,
  folder: string,
  repos: string[],
  known: string[] = [],
): Promise<string[]> {
  if (repos.length > 20) throw new WorkspaceError('Tối đa 20 repo')
  const out: string[] = []
  for (const raw of repos) {
    const v = raw.trim().replace(/[\\/]+$/, '') || raw.trim()
    if (!v || UNC.test(v) || badPath(v))
      throw new WorkspaceError(`Repo không hợp lệ (không dùng đường dẫn mạng): ${v.slice(0, 200)}`)
    let entry: string
    if (DRIVE_ABS.test(v)) {
      if (v.slice(2).includes(':')) throw new WorkspaceError(`Repo không hợp lệ: ${v.slice(0, 200)}`)
      const full = resolve(v)
      if (within(folder, full)) {
        const rel = relative(folder, full)
        if (rel === '') throw new WorkspaceError('Repo không được là chính thư mục dự án')
        entry = rel.replace(/\\/g, '/')
      } else {
        if (!ctx.chosen(full) && !known.some((k) => DRIVE_ABS.test(k) && samePath(k, full)))
          throw new WorkspaceError(`Hãy chọn repo ở ngoài thư mục dự án bằng hộp thoại: ${full}`)
        if (!(await isDirectory(ctx.d, full)))
          throw new WorkspaceError(`Repo không phải thư mục có sẵn: ${full}`)
        entry = full
      }
    } else {
      if (isAbsolute(v) || v.includes(':'))
        throw new WorkspaceError(
          `Repo phải là đường dẫn tuyệt đối có ổ đĩa hoặc tương đối: ${v.slice(0, 200)}`,
        )
      const full = resolve(folder, v)
      const rel = relative(folder, full)
      if (rel === '' || !within(folder, full))
        throw new WorkspaceError(`Repo tương đối phải nằm trong thư mục dự án: ${v.slice(0, 200)}`)
      entry = rel.replace(/\\/g, '/')
    }
    if (!out.some((o) => o.toLowerCase() === entry.toLowerCase())) out.push(entry)
  }
  return out
}

// ---- files ------------------------------------------------------------------------------------

const errCode = (e: unknown) => (e as NodeJS.ErrnoException)?.code

/** Text of a file, undefined when it does not exist; refuses files above `max` bytes. */
async function readText(d: Deps, file: string, max: number): Promise<string | undefined> {
  try {
    const st = await d.fs.stat(file)
    if (!st.isFile()) throw new WorkspaceError(`Không phải file: ${file}`)
    if (st.size > max) throw new WorkspaceError(`File quá lớn: ${file}`)
  } catch (e) {
    if (errCode(e) === 'ENOENT') return undefined
    throw e
  }
  return String(await d.fs.readFile(file, 'utf8'))
}

const isLink = async (d: Deps, p: string) =>
  d.fs.lstat(p).then(
    (s) => s.isSymbolicLink(),
    () => false,
  )

/**
 * Where writing `file` really goes. A symlink is written through to its target (the link stays a
 * link); the target must be an existing regular file. `inPlace`: a file with several hard links is
 * rewritten in place, since tmp + rename would split it from its other names.
 */
async function writeTarget(d: Deps, file: string): Promise<{ path: string; inPlace: boolean }> {
  let st: Awaited<ReturnType<Deps['fs']['lstat']>>
  try {
    st = await d.fs.lstat(file)
  } catch (e) {
    if (errCode(e) === 'ENOENT') return { path: file, inPlace: false }
    throw e
  }
  let path = file
  if (st.isSymbolicLink()) {
    try {
      path = await d.fs.realpath(file)
      st = await d.fs.lstat(path)
    } catch {
      throw new WorkspaceError(
        `${file} là liên kết tới một file không còn tồn tại; hãy sửa liên kết rồi thử lại`,
      )
    }
  }
  if (!st.isFile()) throw new WorkspaceError(`Không phải file: ${file}`)
  return { path, inPlace: Number(st.nlink) > 1 }
}

/** tmp + rename: a crash mid-write never leaves half a file. Links are written through (writeTarget). */
async function writeAtomic(d: Deps, file: string, text: string): Promise<void> {
  const { path, inPlace } = await writeTarget(d, file)
  if (inPlace) return void (await d.fs.writeFile(path, text, 'utf8'))
  const tmp = `${path}.${process.pid}.${d.now().getTime()}.tmp`
  await d.fs.writeFile(tmp, text, 'utf8')
  try {
    await d.fs.rename(tmp, path)
  } catch (e) {
    await d.fs.rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/** True when `a` and `b` are the same file on disk (one links to the other, or hard links). */
async function sameFile(d: Deps, a: string, b: string): Promise<boolean> {
  try {
    const [ra, rb] = await Promise.all([d.fs.realpath(a), d.fs.realpath(b)])
    if (samePath(ra, rb)) return true
    const [sa, sb] = await Promise.all([d.fs.stat(a), d.fs.stat(b)])
    return !!sa.ino && sa.ino === sb.ino && sa.dev === sb.dev
  } catch {
    return false
  }
}

const parseJson = (s: string): unknown => JSON.parse(s.replace(/^﻿/, ''))
const isRecord = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x)

const paletteKey = (s: string) => s.toLowerCase().replace(/[-_\s]/g, '')

/** Same as Squarel's normalizePaletteName: case-insensitive, ignoring "-", "_" and spaces. */
export function normalizePalette(name: unknown): WorkspaceDefaults['palette'] | undefined {
  if (typeof name !== 'string') return undefined
  const k = paletteKey(name)
  return WORKSPACE_PALETTES.find((p) => paletteKey(p) === k)
}

const DEFAULT_KEYS = ['purpose', 'width', 'height', 'palette']

function normalizeDefaults(x: unknown): WorkspaceDefaults {
  if (!isRecord(x)) return {}
  const out: WorkspaceDefaults = {}
  const side = (n: unknown) => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 256
  if ((WORKSPACE_PURPOSES as readonly unknown[]).includes(x.purpose))
    out.purpose = x.purpose as WorkspaceDefaults['purpose']
  if (side(x.width)) out.width = x.width as number
  if (side(x.height)) out.height = x.height as number
  const palette = normalizePalette(x.palette)
  if (palette) out.palette = palette
  return out
}

/**
 * Tolerant reading of project.json (people edit it too), agreeing with Squarel's
 * parseWorkspaceConfig: only a valid id and a non-empty name are required; any other bad field is
 * dropped on its own. null = not a workspace (status 'broken').
 */
export function normalizeConfig(raw: unknown): WorkspaceConfig | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !WORKSPACE_ID.test(raw.id)) return null
  if (typeof raw.name !== 'string' || !raw.name.trim()) return null
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  return {
    id: raw.id,
    name: raw.name.trim().slice(0, 80),
    description: text(raw.description, 2000),
    brief: text(raw.brief, 8000),
    defaults: normalizeDefaults(raw.defaults),
    repos: Array.isArray(raw.repos)
      ? raw.repos
          .filter((r): r is string => typeof r === 'string' && r.length > 0 && r.length <= 1000)
          .slice(0, 20)
      : [],
    exportDir: typeof raw.exportDir === 'string' && raw.exportDir.trim() ? raw.exportDir.slice(0, 500) : null,
  }
}

const projectFile = (folder: string) => join(folder, '.squarel', 'project.json')

type ConfigRead =
  | { status: 'ok'; cfg: WorkspaceConfig; raw: Record<string, unknown> }
  | { status: 'missing' }
  | { status: 'broken' }

async function readConfig(d: Deps, folder: string): Promise<ConfigRead> {
  if (!(await isDirectory(d, folder))) return { status: 'missing' }
  let text: string | undefined
  try {
    text = await readText(d, projectFile(folder), MAX_JSON)
  } catch {
    return { status: 'broken' }
  }
  if (text === undefined) return { status: 'missing' }
  try {
    const raw = parseJson(text)
    const cfg = normalizeConfig(raw)
    return cfg && isRecord(raw) ? { status: 'ok', cfg, raw } : { status: 'broken' }
  } catch {
    return { status: 'broken' }
  }
}

/** project.json: the known fields over what was there (unknown fields kept, forward compatible). */
function configJson(raw: Record<string, unknown>, cfg: WorkspaceConfig): string {
  const { exportDir, ...known } = cfg
  // Unknown keys inside `defaults` are kept as well (Squarel keeps them too).
  const extra = isRecord(raw.defaults)
    ? Object.fromEntries(Object.entries(raw.defaults).filter(([k]) => !DEFAULT_KEYS.includes(k)))
    : {}
  const out: Record<string, unknown> = {
    schema: 1,
    ...raw,
    ...known,
    defaults: { ...extra, ...cfg.defaults },
  }
  if (typeof raw.schema !== 'number') out.schema = 1
  if (exportDir) out.exportDir = exportDir
  else delete out.exportDir
  return `${JSON.stringify(out, null, 2)}\n`
}

type FileAction = 'create' | 'update' | 'keep'

/** What CLAUDE.md needs; a link, or the same file as AGENTS.md, is never touched. */
async function planClaude(
  d: Deps,
  folder: string,
): Promise<{ action: FileAction; text?: string; path: string }> {
  const path = join(folder, 'CLAUDE.md')
  const agents = join(folder, 'AGENTS.md')
  if ((await isLink(d, path)) || (await sameFile(d, path, agents))) return { action: 'keep', path }
  const was = await readText(d, path, MAX_MD)
  const now = ensureClaudeImport(was)
  if (now === was) return { action: 'keep', path }
  return { action: was === undefined ? 'create' : 'update', text: now, path }
}

interface FolderWrite {
  path: string
  text: string
}

/** What `squarel_art/` and its `.gitignore` need in this folder (an existing .gitignore is never touched). */
async function artFiles(
  d: Deps,
  folder: string,
): Promise<{ art: 'create' | 'keep'; artIgnore: 'create' | 'keep' }> {
  const exists = (p: string) =>
    d.fs.lstat(p).then(
      () => true,
      () => false,
    )
  return {
    art: (await exists(join(folder, ART_DIR))) ? 'keep' : 'create',
    artIgnore: (await exists(join(folder, ART_DIR, '.gitignore'))) ? 'keep' : 'create',
  }
}

/**
 * Every file the folder needs, computed before anything is written: the AGENTS.md block,
 * (`claude`) the CLAUDE.md import, and project.json last, so a failed write never leaves a folder
 * that looks like a finished workspace without its AGENTS.md.
 */
async function planFolderFiles(
  d: Deps,
  folder: string,
  raw: Record<string, unknown>,
  cfg: WorkspaceConfig,
  claude: boolean,
  art = false,
): Promise<FolderWrite[]> {
  const out: FolderWrite[] = []
  const agents = join(folder, 'AGENTS.md')
  const before = await readText(d, agents, MAX_MD)
  const after = mergeAgentsBlock(before, renderAgentsBlock(cfg))
  if (after !== before) out.push({ path: agents, text: after })
  if (claude) {
    const c = await planClaude(d, folder)
    if (c.text !== undefined) out.push({ path: c.path, text: c.text })
  }
  if (art && (await artFiles(d, folder)).artIgnore === 'create')
    out.push({ path: join(folder, ART_DIR, '.gitignore'), text: ART_GITIGNORE })
  out.push({ path: projectFile(folder), text: configJson(raw, cfg) })
  // Fail before writing anything when a target is a dangling link or not a file.
  for (const w of out) await writeTarget(d, w.path)
  return out
}

async function writeFolderFiles(d: Deps, folder: string, writes: FolderWrite[]): Promise<void> {
  await d.fs.mkdir(join(folder, '.squarel'), { recursive: true })
  for (const w of writes) {
    await d.fs.mkdir(dirname(w.path), { recursive: true })
    await writeAtomic(d, w.path, w.text)
  }
}

// ---- index (DATA_DIR/workspaces) ---------------------------------------------------------------

interface IndexEntry {
  id: string
  name: string
  folder: string
  createdAt: string | null
}

const indexDir = (ctx: WorkspaceCtx) => join(ctx.dataDir, 'workspaces')
const indexFile = (ctx: WorkspaceCtx, id: string) => join(indexDir(ctx), `${id}.json`)

async function readIndex(ctx: WorkspaceCtx): Promise<IndexEntry[]> {
  let names: string[]
  try {
    names = (await ctx.d.fs.readdir(indexDir(ctx))).map(String)
  } catch {
    return []
  }
  const out: IndexEntry[] = []
  for (const n of names.sort()) {
    const id = n.replace(/\.json$/, '')
    if (!n.endsWith('.json') || !WORKSPACE_ID.test(id)) continue
    try {
      const raw = parseJson((await readText(ctx.d, indexFile(ctx, id), MAX_JSON)) ?? '')
      if (!isRecord(raw) || (raw.id !== undefined && raw.id !== id)) continue
      if (typeof raw.folder !== 'string' || !DRIVE_ABS.test(raw.folder) || UNC.test(raw.folder)) continue
      out.push({
        id,
        name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : id,
        folder: resolve(raw.folder),
        createdAt: typeof raw.createdAt === 'string' ? raw.createdAt.slice(0, 40) : null,
      })
    } catch {
      /* broken index entry: skip */
    }
  }
  return out
}

async function writeIndex(ctx: WorkspaceCtx, e: IndexEntry): Promise<void> {
  await ctx.d.fs.mkdir(indexDir(ctx), { recursive: true })
  const body = { schema: 1, id: e.id, name: e.name, folder: e.folder, createdAt: e.createdAt }
  await writeAtomic(ctx.d, indexFile(ctx, e.id), `${JSON.stringify(body, null, 2)}\n`)
}

async function entry(ctx: WorkspaceCtx, id: string): Promise<IndexEntry> {
  const e = (await readIndex(ctx)).find((x) => x.id === id)
  if (!e) throw new WorkspaceError('Không có dự án này (có thể đã bị gỡ)')
  return e
}

// ---- arts (<folder>/squarel_art) --------------------------------------------------------------

interface ArtMeta {
  slug: string
  name: string
  purpose?: string
  head: string
  updatedAt: string
}

const artsDirOf = (folder: string) => join(folder, ART_DIR)
/** Art of Squarel before the move into project folders (Art cũ). */
const legacyArtsDir = (ctx: WorkspaceCtx) => join(ctx.dataDir, 'projects')

async function readArtsIn(ctx: WorkspaceCtx, dir: string): Promise<ArtMeta[]> {
  let names: string[]
  try {
    names = (await ctx.d.fs.readdir(dir)).map(String).filter((n) => SLUG.test(n))
  } catch {
    return []
  }
  const out: ArtMeta[] = []
  for (const slug of names) {
    try {
      const raw = parseJson((await readText(ctx.d, join(dir, slug, 'project.json'), MAX_ART_JSON)) ?? '')
      if (!isRecord(raw) || typeof raw.updatedAt !== 'string' || typeof raw.head !== 'string') continue
      out.push({
        slug,
        name: typeof raw.name === 'string' ? raw.name.slice(0, 300) : slug,
        ...(typeof raw.purpose === 'string' ? { purpose: raw.purpose.slice(0, 20) } : {}),
        head: VERSION_ID.test(raw.head) ? raw.head : '',
        updatedAt: raw.updatedAt.slice(0, 40),
      })
    } catch {
      /* broken art: skip */
    }
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.slug.localeCompare(b.slug))
}

/** The arts of a project folder: `<folder>/squarel_art/<id>/project.json`. */
export function readArts(ctx: WorkspaceCtx, folder: string): Promise<ArtMeta[]> {
  return readArtsIn(ctx, artsDirOf(folder))
}

const asBuffer = (raw: unknown) => (Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'latin1'))

/** thumb.png of an art as a data URL: a PNG of at most 64 KB that really lies inside `artsDir`. */
async function thumbIn(ctx: WorkspaceCtx, artsDir: string, slug: string): Promise<string | undefined> {
  if (!SLUG.test(slug)) return undefined
  try {
    const real = await ctx.d.fs.realpath(join(artsDir, slug, 'thumb.png'))
    const root = join(await ctx.d.fs.realpath(dirname(artsDir)), basename(artsDir))
    if (!within(root, real) || samePath(root, real)) return undefined
    const st = await ctx.d.fs.stat(real)
    if (!st.isFile() || st.size > MAX_THUMB) return undefined
    const buf = asBuffer(await ctx.d.fs.readFile(real))
    if (buf.length > MAX_THUMB || !buf.subarray(0, PNG_SIG.length).equals(PNG_SIG)) return undefined
    return `data:image/png;base64,${buf.toString('base64')}`
  } catch {
    return undefined
  }
}

/** thumb.png of an art of a project folder: only a real path inside `<folder>/squarel_art`. */
export function readThumb(ctx: WorkspaceCtx, folder: string, slug: string): Promise<string | undefined> {
  return thumbIn(ctx, artsDirOf(folder), slug)
}

/** Size and frame count of the head version (optional: unknown when the file is odd or large). */
async function docSize(
  ctx: WorkspaceCtx,
  artsDir: string,
  a: ArtMeta,
): Promise<Pick<ArtView, 'width' | 'height' | 'frames'>> {
  if (!a.head) return {}
  try {
    const file = join(artsDir, a.slug, 'versions', `${a.head}.json.gz`)
    if ((await ctx.d.fs.stat(file)).size > MAX_VERSION_GZ) return {}
    const json = JSON.parse(
      gunzipSync(asBuffer(await ctx.d.fs.readFile(file)), { maxOutputLength: 64 * 1024 * 1024 }).toString(
        'utf8',
      ),
    )
    const { width, height, frames } = json?.doc ?? {}
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) > 0
    return {
      ...(ok(width) && ok(height) ? { width, height } : {}),
      ...(Array.isArray(frames) && frames.length > 0 ? { frames: frames.length } : {}),
    }
  } catch {
    return {}
  }
}

async function artView(ctx: WorkspaceCtx, artsDir: string, a: ArtMeta, withSize: boolean): Promise<ArtView> {
  const thumb = await thumbIn(ctx, artsDir, a.slug)
  return {
    slug: a.slug,
    name: a.name,
    ...(a.purpose ? { purpose: a.purpose } : {}),
    head: a.head,
    updatedAt: a.updatedAt,
    ...(withSize ? await docSize(ctx, artsDir, a) : {}),
    ...(thumb ? { thumb } : {}),
  }
}

// ---- views ------------------------------------------------------------------------------------

function sessionCounts(live: LiveSession[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const s of live) if (s.workspace) counts.set(s.workspace.id, (counts.get(s.workspace.id) ?? 0) + 1)
  return counts
}

/** The other folder a live session declares for this id (its art home differs from the index folder). */
function duplicateFolder(live: LiveSession[], e: IndexEntry): string | undefined {
  for (const s of live) {
    const f = s.workspace?.folder
    if (s.workspace?.id === e.id && f && DRIVE_ABS.test(f) && !samePath(f, e.folder)) return resolve(f)
  }
  return undefined
}

const lastName = (p: string) =>
  p
    .split(/[\\/]+/)
    .filter(Boolean)
    .at(-1) ?? p

/** A session row's title: its cwd relative to the workspace folder, else a folder name. */
export function sessionTitle(folder: string, cwd: string): string {
  if (!DRIVE_ABS.test(cwd)) return lastName(cwd)
  const full = resolve(cwd)
  if (!within(folder, full)) return lastName(full)
  return relative(folder, full).replace(/\\/g, '/') || lastName(folder)
}

function base(e: IndexEntry, c: ConfigRead, arts: ArtMeta[], sessions: number, duplicate?: string) {
  const cfg = c.status === 'ok' ? c.cfg : undefined
  return {
    id: e.id,
    name: cfg?.name ?? e.name,
    folder: e.folder,
    status: c.status,
    ...(cfg?.defaults.purpose ? { purpose: cfg.defaults.purpose } : {}),
    description: cfg?.description ?? '',
    artCount: arts.length,
    updatedAt: arts[0]?.updatedAt ?? e.createdAt,
    sessions,
    ...(duplicate ? { duplicate } : {}),
  }
}

export async function listWorkspaces(ctx: WorkspaceCtx): Promise<WorkspaceSummary[]> {
  const [index, live] = await Promise.all([readIndex(ctx), liveSessions(ctx.dataDir, ctx.d)])
  const counts = sessionCounts(live)
  const out: WorkspaceSummary[] = []
  for (const e of index) {
    const mine = await readArts(ctx, e.folder)
    const recent = await Promise.all(mine.slice(0, 3).map((a) => artView(ctx, artsDirOf(e.folder), a, false)))
    out.push({
      ...base(e, await readConfig(ctx.d, e.folder), mine, counts.get(e.id) ?? 0, duplicateFolder(live, e)),
      recent,
    })
  }
  return out.sort(
    (a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name),
  )
}

async function detail(ctx: WorkspaceCtx, e: IndexEntry): Promise<WorkspaceDetail> {
  const c = await readConfig(ctx.d, e.folder)
  const mine = await readArts(ctx, e.folder)
  const cfg = c.status === 'ok' ? c.cfg : undefined
  const repos = []
  for (const r of cfg?.repos ?? []) {
    const outside = DRIVE_ABS.test(r) && !within(e.folder, resolve(r))
    repos.push({ path: r, outside, exists: await isDirectory(ctx.d, resolve(e.folder, r)) })
  }
  const arts = []
  for (const a of mine) arts.push(await artView(ctx, artsDirOf(e.folder), a, true))
  const all = await liveSessions(ctx.dataDir, ctx.d)
  const live = all.filter((s) => s.workspace?.id === e.id)
  const sessionList = live.slice(0, 200).map((s) => ({
    title: sessionTitle(e.folder, s.cwd).slice(0, 300),
    busy: !!s.busyWith,
    subtitle: sessionSubtitle(s).slice(0, 300),
  }))
  return {
    ...base(e, c, mine, live.length, duplicateFolder(all, e)),
    sessionList,
    brief: cfg?.brief ?? '',
    defaults: cfg?.defaults ?? {},
    repos,
    exportDir: cfg?.exportDir ?? null,
    createdAt: e.createdAt,
    arts,
  }
}

export async function getWorkspace(ctx: WorkspaceCtx, id: string): Promise<WorkspaceDetail> {
  return detail(ctx, await entry(ctx, id))
}

/** Every art still in DATA_DIR/projects ("Art cũ"), newest first; the old `workspace` field is ignored. */
export async function legacyArts(ctx: WorkspaceCtx): Promise<ArtView[]> {
  const arts = (await readArtsIn(ctx, legacyArtsDir(ctx))).slice(0, 2000)
  const out: ArtView[] = []
  for (const a of arts) out.push(await artView(ctx, legacyArtsDir(ctx), a, false))
  return out
}

// ---- create / update / remove -----------------------------------------------------------------

/** The folder of a new workspace: chosen with the dialog, or a new folder right inside a chosen one. */
async function checkChosenFolder(ctx: WorkspaceCtx, folder: string, index: IndexEntry[]): Promise<string> {
  const full = checkFolder(folder)
  const known = index.some((e) => samePath(e.folder, full))
  if (!known && !ctx.chosen(full) && !ctx.chosen(dirname(full)))
    throw new WorkspaceError('Hãy chọn thư mục dự án bằng nút Chọn…')
  // Art lives in the folder's squarel_art/ and is committed with the project: a linked worktree
  // would hold a second, diverging copy, so only the main checkout is accepted.
  const main = await worktreeMain(ctx.d, full)
  if (main)
    throw new WorkspaceError(`Thư mục này là một git worktree. Hãy chọn thư mục dự án ở bản chính: ${main}`)
  return full
}

export async function inspectFolder(ctx: WorkspaceCtx, folder: string): Promise<WorkspaceFolderInfo> {
  const index = await readIndex(ctx)
  const full = await checkChosenFolder(ctx, folder, index)
  const folderExists = await isDirectory(ctx.d, full)
  const c = await readConfig(ctx.d, full)
  if (c.status === 'broken')
    throw new WorkspaceError(
      'File .squarel/project.json trong thư mục này bị hỏng; sửa hoặc xoá nó rồi thử lại',
    )
  if (c.status === 'ok')
    return {
      folderExists,
      existing: { id: c.cfg.id, name: c.cfg.name },
      files: { project: 'keep', agents: 'keep', claude: 'keep', art: 'keep', artIgnore: 'keep' },
    }
  if (!folderExists)
    return {
      folderExists,
      existing: null,
      files: { project: 'create', agents: 'create', claude: 'create', art: 'create', artIgnore: 'create' },
    }
  const agents = await readText(ctx.d, join(full, 'AGENTS.md'), MAX_MD)
  // Refuses an AGENTS.md whose Squarel block has no end line now, not only when creating.
  if (agents !== undefined) mergeAgentsBlock(agents, BLOCK_END)
  return {
    folderExists,
    existing: null,
    files: {
      project: 'create',
      agents: agents === undefined ? 'create' : 'update',
      claude: (await planClaude(ctx.d, full)).action,
      ...(await artFiles(ctx.d, full)),
    },
  }
}

/** Ids that must not be handed out: the index, the config id of every known folder, leftover index files. */
async function usedIds(ctx: WorkspaceCtx, index: IndexEntry[]): Promise<(id: string) => Promise<boolean>> {
  const used = new Set(index.map((e) => e.id))
  // A known folder whose project.json was edited to another id holds that id too.
  for (const e of index) {
    const c = await readConfig(ctx.d, e.folder)
    if (c.status === 'ok') used.add(c.cfg.id)
  }
  return async (id) =>
    used.has(id) ||
    (await ctx.d.fs.lstat(indexFile(ctx, id)).then(
      () => true,
      () => false,
    ))
}

/** A fresh id: not in the index (nor a leftover index file) and not held by a known folder. */
async function uniqueId(ctx: WorkspaceCtx, name: string, index: IndexEntry[]): Promise<string> {
  const baseId = slugify(name)
  const taken = await usedIds(ctx, index)
  let id = baseId
  for (let i = 2; await taken(id); i++) id = `${baseId.slice(0, 64 - String(i).length - 1)}-${i}`
  return id
}

/**
 * New workspace in `input.folder` (created when missing). A folder that already has
 * `.squarel/project.json` is registered as it is: nothing in it is written.
 */
export async function createWorkspace(ctx: WorkspaceCtx, input: WorkspaceCreate): Promise<WorkspaceDetail> {
  const { d } = ctx
  const index = await readIndex(ctx)
  const folder = await checkChosenFolder(ctx, input.folder, index)
  const registered = index.find((e) => samePath(e.folder, folder))
  if (registered) return detail(ctx, registered)
  if (
    await d.fs.stat(folder).then(
      (s) => !s.isDirectory(),
      () => false,
    )
  )
    throw new WorkspaceError('Đường dẫn dự án đang là một file, không phải thư mục')

  const now = d.now().toISOString()
  const c = await readConfig(d, folder)
  if (c.status === 'broken')
    throw new WorkspaceError(
      'File .squarel/project.json trong thư mục này bị hỏng; sửa hoặc xoá nó rồi thử lại',
    )
  if (c.status === 'ok') {
    const other = index.find((e) => e.id === c.cfg.id)
    if (other) throw new WorkspaceError(`Mã dự án "${c.cfg.id}" đang được dùng cho thư mục ${other.folder}`)
    const e = { id: c.cfg.id, name: c.cfg.name, folder, createdAt: now }
    await writeIndex(ctx, e)
    return detail(ctx, e)
  }

  // Everything is checked and every file computed before the first write; the index comes last.
  const cfg: WorkspaceConfig = {
    id: await uniqueId(ctx, input.name, index),
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    brief: (input.brief ?? '').trim(),
    defaults: input.defaults ?? {},
    repos: await checkRepos(ctx, folder, input.repos ?? []),
    exportDir: input.exportDir ? checkExportDir(folder, input.exportDir) : null,
  }
  const writes = await planFolderFiles(d, folder, {}, cfg, true, true)
  await d.fs.mkdir(folder, { recursive: true })
  await writeFolderFiles(d, folder, writes)
  const e = { id: cfg.id, name: cfg.name, folder, createdAt: now }
  await writeIndex(ctx, e)
  return detail(ctx, e)
}

/** Changes project.json (unknown fields kept) and rewrites the AGENTS.md block. */
export async function updateWorkspace(
  ctx: WorkspaceCtx,
  id: string,
  patch: WorkspacePatch,
): Promise<WorkspaceDetail> {
  const e = await entry(ctx, id)
  const c = await readConfig(ctx.d, e.folder)
  if (c.status === 'missing')
    throw new WorkspaceError('Thư mục dự án hoặc file .squarel/project.json không còn nữa')
  if (c.status === 'broken')
    throw new WorkspaceError('File .squarel/project.json bị hỏng; sửa nó rồi thử lại')
  if (c.cfg.id !== id) throw new WorkspaceError('Thư mục này giờ chứa một dự án khác; gỡ rồi thêm lại')
  const newId = patch.id ?? id
  if (newId !== id) {
    if (!WORKSPACE_ID.test(newId))
      throw new WorkspaceError('Mã dự án chỉ gồm chữ thường a-z, số và dấu gạch ngang')
    if (await (await usedIds(ctx, await readIndex(ctx)))(newId))
      throw new WorkspaceError(`Mã dự án "${newId}" đã được dùng; hãy chọn mã khác`)
  }
  const cfg: WorkspaceConfig = {
    ...c.cfg,
    id: newId,
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.description !== undefined ? { description: patch.description.trim() } : {}),
    ...(patch.brief !== undefined ? { brief: patch.brief.trim() } : {}),
    ...(patch.defaults !== undefined ? { defaults: patch.defaults } : {}),
    ...(patch.repos !== undefined
      ? { repos: await checkRepos(ctx, e.folder, patch.repos, c.cfg.repos) }
      : {}),
    ...(patch.exportDir !== undefined
      ? { exportDir: patch.exportDir === null ? null : checkExportDir(e.folder, patch.exportDir) }
      : {}),
  }
  const writes = await planFolderFiles(ctx.d, e.folder, c.raw, cfg, false)
  const next = { ...e, id: newId, name: cfg.name }
  if (newId !== id) {
    // The folder and the index must agree at every step, or the project is stuck ("another project
    // in this folder"): new index first, then project.json (undo the index if that fails), and the
    // old index last (a leftover old entry is harmless: the folder already says the new id).
    await writeIndex(ctx, next)
    try {
      await writeFolderFiles(ctx.d, e.folder, writes)
    } catch (err) {
      await ctx.d.fs.rm(indexFile(ctx, newId), { force: true }).catch(() => {})
      throw err
    }
    await ctx.d.fs.rm(indexFile(ctx, id), { force: true })
  } else {
    await writeFolderFiles(ctx.d, e.folder, writes)
    if (cfg.name !== e.name) await writeIndex(ctx, next)
  }
  return detail(ctx, next)
}

/** Forgets the workspace: only its index file goes; the folder, its files and the arts stay. */
export async function removeWorkspace(ctx: WorkspaceCtx, id: string): Promise<void> {
  await entry(ctx, id)
  await ctx.d.fs.rm(indexFile(ctx, id), { force: true })
}

/** Folder of a workspace that still exists (Mở thư mục). */
export async function workspaceFolder(ctx: WorkspaceCtx, id: string): Promise<string> {
  const e = await entry(ctx, id)
  if (!(await isDirectory(ctx.d, e.folder))) throw new WorkspaceError('Thư mục dự án không còn tồn tại')
  return e.folder
}

// ---- Mở Claude --------------------------------------------------------------------------------

/**
 * `cmd /d /c start "<title>" <cmd.exe> /d /k call <claude.exe> --add-dir <repo>…`: a visible window
 * that stays open (also when Claude Code fails to start). Every item is a plain token (letters of
 * any script allowed, none of cmd's special characters), and claude.exe must be an absolute .exe path.
 *
 * Why `call`: libuv quotes items with spaces, so with claude.exe under `C:\Users\Nguyen Van A\` the
 * text after `/k` would start with a quote. When that text holds more than two quotes (a repo with
 * a space), cmd strips its first and last quote and the line breaks. `call` makes the text start
 * with a letter, so cmd keeps every quote; it runs the exe exactly like a bare command would.
 * (Quoting the whole /k text again is impossible through libuv, which escapes inner quotes as \",
 * and `start claude.exe` without cmd would close the window as soon as claude.exe exits.)
 */
export function claudeWorkspaceArgv(
  d: Deps,
  claudeExe: string,
  folder: string,
  outsideRepos: string[],
): string[] {
  if (!DRIVE_ABS.test(claudeExe) || !/\.exe$/i.test(claudeExe))
    throw new WorkspaceError('Đường dẫn Claude Code phải là file claude.exe tuyệt đối')
  // The folder is only the cwd (cmd never parses it); the command line items are checked.
  checkFolder(folder)
  for (const p of [claudeExe, ...outsideRepos])
    if (!SAFE_PATH_ITEM.test(p))
      throw new WorkspaceError(
        `Đường dẫn có ký tự cửa sổ lệnh không nhận (& | < > ^ % ! " ' ( ) ;…): ${p.slice(0, 300)}`,
      )
  const inner = [
    system32(d.env, 'cmd.exe'),
    '/d',
    '/k',
    'call',
    claudeExe,
    ...outsideRepos.flatMap((r) => ['--add-dir', r]),
  ]
  return terminalArgvWith(d, inner, (a) => SAFE_PATH_ITEM.test(a))
}

/** The detached spawn: cwd = folder; CLAUDE.md of --add-dir repos is loaded only when there are some. */
export function claudeWorkspaceSpec(
  d: Deps,
  claudeExe: string,
  folder: string,
  outsideRepos: string[],
): DetachedSpec {
  return {
    argv: claudeWorkspaceArgv(d, claudeExe, folder, outsideRepos),
    cwd: folder,
    ...(outsideRepos.length ? { env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' } } : {}),
  }
}

/** Claude Code in the workspace folder, in its own terminal window. */
export async function openClaude(ctx: WorkspaceCtx, id: string): Promise<void> {
  const folder = await workspaceFolder(ctx, id)
  const c = await readConfig(ctx.d, folder)
  if (c.status !== 'ok' || c.cfg.id !== id)
    throw new WorkspaceError('File .squarel/project.json của dự án không còn hoặc bị hỏng')
  const exe = ctx.d.which('claude')
  if (!exe)
    throw new WorkspaceError(
      'Không tìm thấy Claude Code (claude.exe). Hãy cài Claude Code (PowerShell: irm https://claude.ai/install.ps1 | iex), mở lại launcher rồi thử lại.',
    )
  if (!/\.exe$/i.test(exe) || !isAbsolute(exe))
    throw new WorkspaceError(
      'Claude Code trên máy không phải claude.exe (bản cài qua npm). Hãy cài bản chính thức của Claude Code rồi thử lại.',
    )
  const outside: string[] = []
  for (const r of c.cfg.repos) {
    if (!DRIVE_ABS.test(r) || UNC.test(r)) continue
    const full = resolve(r)
    if (within(folder, full) || !(await isDirectory(ctx.d, full))) continue
    if (!outside.some((o) => samePath(o, full))) outside.push(full)
  }
  await ctx.d.spawnDetached(claudeWorkspaceSpec(ctx.d, exe, folder, outside))
}
