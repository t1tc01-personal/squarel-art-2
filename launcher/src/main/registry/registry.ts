/** The component registry: core list + integration manifests, and the views the UI renders. */
import { tmpdir } from 'node:os'
import { dirname, join, win32 } from 'node:path'
import { substitute } from '@squarel/integration-schema'
import type { ActionRef, ComponentView, Level } from '../../shared/model'
import type { Deps } from '../deps'
import { type EnvDoc, readVar } from '../env-store'
import type { LauncherState } from '../state'
import { compareVersions, type Latest, latestGitTag, satisfiesMin } from '../versions'
import { CORE, type CoreComponent, type Ctx, type Detected, type InstallSpec, MIN_NODE } from './core'
import {
  type CatalogEntry,
  ICON_FILE,
  isInsideDir,
  type LoadedIntegration,
  loadCatalog,
  loadIntegrationsFrom,
  type Problem,
} from './integrations'

export type { CoreComponent, Ctx, Detected, InstallSpec } from './core'
export type { CatalogEntry, LoadedIntegration, Problem } from './integrations'

export interface Registry {
  core: CoreComponent[]
  integrations: LoadedIntegration[]
  comingSoon: CatalogEntry[]
  problems: Problem[]
}

export async function loadRegistry(
  opts: { squarelDir?: string; userIntegrationsDir: string; platform: NodeJS.Platform },
  d: Deps,
): Promise<Registry> {
  const problems: Problem[] = []
  const byId = new Map<string, LoadedIntegration>()
  if (opts.squarelDir) {
    const root = join(opts.squarelDir, 'integrations')
    for (const i of await loadIntegrationsFrom(root, 'squarel', opts.platform, d, problems))
      byId.set(i.manifest.id, i)
  }
  for (const i of await loadIntegrationsFrom(opts.userIntegrationsDir, 'user', opts.platform, d, problems)) {
    if (byId.has(i.manifest.id))
      problems.push({
        path: join(i.dir, 'integration.json'),
        error: `Tích hợp "${i.manifest.id}" của người dùng ghi đè bản có sẵn của Squarel`,
      })
    byId.set(i.manifest.id, i)
  }
  const comingSoon = opts.squarelDir
    ? await loadCatalog(join(opts.squarelDir, 'integrations', 'catalog.json'), d, problems)
    : []
  return { core: CORE, integrations: [...byId.values()], comingSoon, problems }
}

function envGet(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key]
  const upper = key.toUpperCase()
  for (const k of Object.keys(env)) if (k.toUpperCase() === upper) return env[k]
  return undefined
}

/** Expands `%VAR%` (case-insensitive); undefined when any variable is unknown. */
export function expandEnv(s: string, env: NodeJS.ProcessEnv): string | undefined {
  let missing = false
  const out = s.replace(/%([^%]+)%/g, (_, name: string) => {
    const v = envGet(env, name)
    if (v === undefined) missing = true
    return v ?? ''
  })
  return missing ? undefined : out
}

async function fileExists(d: Deps, p: string): Promise<boolean> {
  try {
    await d.fs.stat(p)
    return true
  } catch {
    return false
  }
}

const DENY_EXE = new Set([
  'cmd',
  'powershell',
  'pwsh',
  'wscript',
  'cscript',
  'mshta',
  'rundll32',
  'regsvr32',
  'node',
  'python',
  'python3',
  'bash',
  'sh',
  'conhost',
  'explorer',
])
const SECRET_VARS = new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'RETRO_DIFFUSION_API_KEY'])

/** Why a detected path may not be executed, or undefined when acceptable. */
function rejectPath(p: string): string | undefined {
  const BS = String.fromCharCode(92)
  if ((p[0] === '/' || p[0] === BS) && (p[1] === '/' || p[1] === BS))
    return 'không cho phép đường dẫn mạng (UNC)'
  if (!win32.isAbsolute(p)) return 'đường dẫn không tuyệt đối'
  const base = win32.basename(p).toLowerCase()
  if (base.includes('~')) return 'tên file rút gọn (8.3) không được phép'
  if (!base.endsWith('.exe')) return 'chỉ chấp nhận file .exe'
  if (DENY_EXE.has(base.slice(0, -4))) return `không cho phép chạy ${base}`
  return undefined
}

export async function detectIntegration(i: LoadedIntegration, envDoc: EnvDoc, d: Deps): Promise<Detected> {
  const { detect } = i.manifest
  const candidates: string[] = []
  const notes: string[] = []
  if (detect.env) {
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(detect.env) || SECRET_VARS.has(detect.env.toUpperCase()))
      notes.push(`Biến môi trường "${detect.env}" không được phép dùng để dò`)
    else {
      const v = readVar(envDoc, detect.env)?.trim() || envGet(d.env, detect.env)?.trim()
      if (v) candidates.push(v)
    }
  }
  for (const c of detect.candidates ?? []) {
    const e = expandEnv(c, d.env)
    if (e) candidates.push(e)
  }
  let path: string | undefined
  for (const c of candidates) {
    const why = rejectPath(c)
    if (why) {
      notes.push(`Bỏ qua ${c}: ${why}`)
      continue
    }
    if (!(await fileExists(d, c))) continue
    let real: string
    try {
      real = await d.fs.realpath(c)
    } catch {
      continue
    }
    const whyReal = rejectPath(real)
    if (whyReal) {
      notes.push(`Bỏ qua ${c}: đường dẫn thật ${whyReal}`)
      continue
    }
    path = real
    break
  }
  if (!path) return notes.length ? { installed: false, note: notes.join('; ') } : { installed: false }
  if (!detect.version) return { installed: true, path }

  const lines: string[] = []
  let code: number
  try {
    ;({ code } = await d.run({
      argv: [path, ...detect.version.args],
      cwd: tmpdir(),
      onLine: (l) => lines.push(l),
      signal: AbortSignal.timeout(10_000),
    }))
  } catch (e) {
    return {
      installed: true,
      path,
      note: `Không chạy được để đọc phiên bản: ${String((e as Error)?.message ?? e)}`,
    }
  }
  if (code !== 0) return { installed: true, path, note: `Đọc phiên bản thất bại (mã thoát ${code})` }
  let re: RegExp
  try {
    re = new RegExp(detect.version.pattern)
  } catch {
    return { installed: true, path, note: 'Mẫu đọc phiên bản không hợp lệ' }
  }
  for (const l of lines) {
    const m = re.exec(l)
    if (m?.[1]) return { installed: true, path, version: m[1] }
  }
  return { installed: true, path, note: 'Không đọc được phiên bản' }
}

const MAX_ICON = 64 * 1024
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** A PNG of at most 64 KB whose real path lies inside `dir`, as a data URL, or why not. */
async function readPngIcon(
  dir: string,
  rel: string,
  d: Deps,
): Promise<{ ok: true; url: string } | { ok: false; note: string }> {
  const no = (note: string) => ({ ok: false as const, note })
  if (!isInsideDir(dir, rel)) return no('Tên file icon không hợp lệ')
  try {
    const realIcon = await d.fs.realpath(join(dir, rel))
    const realDir = await d.fs.realpath(dir)
    if (!isInsideDir(realDir, realIcon)) return no('Icon nằm ngoài thư mục cho phép')
    if ((await d.fs.stat(realIcon)).size > MAX_ICON) return no('Icon quá lớn (tối đa 64 KB)')
    const raw = await d.fs.readFile(realIcon)
    const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(String(raw), 'latin1')
    if (buf.length > MAX_ICON) return no('Icon quá lớn (tối đa 64 KB)')
    if (buf.length < PNG_SIG.length || !buf.subarray(0, PNG_SIG.length).equals(PNG_SIG))
      return no('Icon không phải file PNG')
    return { ok: true, url: `data:image/png;base64,${buf.toString('base64')}` }
  } catch {
    return no('Không đọc được file icon')
  }
}

/** Reads the integration icon as a data URL; any problem falls back to the 'box' icon with a note. */
async function loadIcon(
  i: LoadedIntegration,
  d: Deps,
): Promise<{ icon: string; iconKind: 'name' | 'data'; note?: string }> {
  const name = i.manifest.icon
  const r = ICON_FILE.test(name)
    ? await readPngIcon(i.dir, name, d)
    : { ok: false as const, note: 'Tên file icon không hợp lệ' }
  return r.ok
    ? { icon: r.url, iconKind: 'data' }
    : { icon: 'box', iconKind: 'name', note: r.note.replace('thư mục cho phép', 'thư mục tích hợp') }
}

/** Display form of the winget install the terminal runs (see setup.ts wingetTerminalArgv). */
export function wingetCommand(spec: InstallSpec): string {
  const base = `winget install --id ${spec.winget} -e`
  return spec.override ? `${base} --override "${spec.override}"` : base
}

function shell(argv: string[]): string {
  return argv.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(' ')
}

function levelFor(args: {
  required: boolean
  installed: boolean
  version?: string
  latest?: Latest
  nodeOk?: boolean
}): { level: Level; levelLabel: string } {
  const { required, installed, version, latest } = args
  if (!installed) return { level: required ? 'error' : 'idle', levelLabel: 'Chưa cài' }
  if (args.nodeOk === false) return { level: 'error', levelLabel: `Cần Node ≥ ${MIN_NODE}` }
  if (!latest) return { level: 'ok', levelLabel: 'Đã cài' }
  if (!latest.ok) return { level: 'idle', levelLabel: 'Không kiểm tra được' }
  if (version && compareVersions(latest.version, version) > 0)
    return { level: 'warn', levelLabel: 'Có bản mới' }
  return { level: 'ok', levelLabel: 'Mới nhất' }
}

function latestFields(latest?: Latest): Pick<ComponentView, 'latest' | 'latestError'> {
  if (!latest) return {}
  return latest.ok ? { latest: latest.version } : { latestError: latest.message }
}

async function viewCore(c: CoreComponent, ctx: Ctx, d: Deps): Promise<ComponentView> {
  const det = await c
    .detect(d, ctx)
    .catch((e): Detected => ({ installed: false, note: String((e as Error)?.message ?? e) }))
  const latest =
    det.installed && c.latest ? await c.latest(d, ctx).catch((): undefined => undefined) : undefined
  const nodeOk =
    c.id === 'node' && det.installed && det.version ? satisfiesMin(det.version, MIN_NODE) : undefined
  const lv = levelFor({
    required: c.required,
    installed: det.installed,
    version: det.version,
    latest,
    nodeOk,
  })
  const actions: ActionRef[] = []
  // Squarel only ever moves to the launcher's own tag (updates:apply / squarel:update), so a newer
  // tag than the launcher is reached by updating the launcher first: no button that would do nothing.
  const squarelUpdatable =
    c.id === 'squarel' && !ctx.isDev && !!det.version && compareVersions(ctx.launcherVersion, det.version) > 0
  if (squarelUpdatable)
    actions.push({ componentId: 'squarel', kind: 'update', id: 'update', label: 'Cập nhật' })
  const squarelWaits = c.id === 'squarel' && lv.level === 'warn' && !squarelUpdatable
  const launcherFound =
    c.id === 'launcher' &&
    !ctx.launcherUpdateReady &&
    !!ctx.launcherLatest &&
    compareVersions(ctx.launcherLatest, ctx.launcherVersion) > 0
  // The launcher's own update is offered only once electron-updater downloaded it.
  if (c.id === 'launcher' && ctx.launcherUpdateReady)
    actions.push({
      componentId: 'launcher',
      kind: 'update',
      id: 'install',
      label: 'Khởi động lại để cập nhật',
    })
  if (!det.installed && c.install?.winget) {
    actions.push({
      componentId: c.id,
      kind: 'install',
      id: 'winget',
      label: 'Cài',
      needsConsent: {
        command: wingetCommand(c.install),
        ...(c.install.sizeHint ? { sizeHint: c.install.sizeHint } : {}),
      },
    })
  } else if (!det.installed && c.install?.terminal) {
    actions.push({
      componentId: c.id,
      kind: 'terminal',
      id: 'terminal',
      label: 'Mở PowerShell để cài',
      needsConsent: { command: c.install.terminal.command },
    })
  }
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    kind: 'core',
    icon: c.icon,
    iconKind: 'name',
    required: c.required,
    installed: det.installed,
    ...(det.version ? { version: det.version } : {}),
    ...latestFields(latest),
    ...lv,
    ...(squarelWaits ? { levelLabel: 'Cập nhật launcher trước' } : {}),
    ...(launcherFound
      ? { latest: ctx.launcherLatest, level: 'warn' as const, levelLabel: 'Đang tải bản mới' }
      : {}),
    ...(c.id === 'launcher' && ctx.launcherUpdateReady
      ? { latest: ctx.launcherUpdateReady, level: 'warn' as const, levelLabel: 'Đã tải bản mới' }
      : {}),
    actions,
  }
}

async function viewIntegration(
  i: LoadedIntegration,
  state: LauncherState,
  envDoc: EnvDoc,
  d: Deps,
  recentArt?: string,
): Promise<ComponentView> {
  const m = i.manifest
  const { note: iconNote, ...iconPart } = await loadIcon(i, d)
  const base = {
    id: m.id,
    name: m.name,
    description: m.description,
    kind: 'integration' as const,
    ...iconPart,
    ...(iconNote ? { note: iconNote } : {}),
    accent: m.accent,
    required: false,
  }
  if (i.incompatible)
    return {
      ...base,
      installed: false,
      level: 'error',
      levelLabel: i.incompatible,
      incompatible: i.incompatible,
      actions: [],
    }
  if (!state.selected.includes(m.id))
    return { ...base, installed: false, level: 'idle', levelLabel: 'Chưa chọn', actions: [] }
  const det = await detectIntegration(i, envDoc, d)
  // The tool's own logo, read from its install folder (Squarel does not ship it).
  if (det.path && m.installedIcon) {
    const own = await readPngIcon(dirname(det.path), m.installedIcon, d)
    if (own.ok) Object.assign(base, { icon: own.url, iconKind: 'data' as const })
  }
  let latest: Latest | undefined
  if (det.installed && m.latest) {
    latest = await latestGitTag(m.latest.repo, d).catch(
      (e): Latest => ({ ok: false, reason: 'error', message: String((e as Error)?.message ?? e) }),
    )
  }
  const lv = levelFor({ required: false, installed: det.installed, version: det.version, latest })
  const vars = {
    toolsDir: join(d.env.LOCALAPPDATA ?? tmpdir(), 'SquarelArt', 'tools', m.id),
    ...(det.path ? { exe: det.path, exeDir: dirname(det.path) } : {}),
    ...(latest?.ok ? { version: latest.version } : {}),
    ...(recentArt ? { recentProject: recentArt } : {}),
  }
  const subOrUndefined = (s: string) => {
    try {
      return substitute(s, vars)
    } catch {
      return undefined
    }
  }
  const sub = (s: string) => {
    try {
      return substitute(s, vars)
    } catch {
      return s
    }
  }
  const actions: ActionRef[] = []
  if (!det.installed) {
    const choice = state.installChoice[m.id]
    const opts = [...m.install].sort((a, b) => Number(b.id === choice) - Number(a.id === choice))
    for (const o of opts)
      actions.push({
        componentId: m.id,
        kind: 'install',
        id: o.id,
        label: sub(o.label),
        ...(o.run ? { needsConsent: { command: shell(o.run.map(sub)) } } : {}),
      })
  } else {
    // The default action comes first: it is the big Open button, the rest form the ▾ menu.
    for (const a of [...m.launch].sort((x, y) => Number(!!y.default) - Number(!!x.default))) {
      // Hidden while it cannot run: a variable without value ({recentProject} with no art yet),
      // or a bridge tool that needs the recent project when there is none.
      const label = subOrUndefined(a.label)
      if (label === undefined) continue
      if (a.bridgeTool && !a.pickProject && !recentArt) continue
      actions.push({
        componentId: m.id,
        kind: 'launch',
        id: a.id,
        label,
        ...(a.pickProject ? { pickProject: true } : {}),
      })
    }
    if (lv.level === 'warn' && m.update)
      actions.push({
        componentId: m.id,
        kind: 'update',
        id: 'update',
        label: 'Cập nhật',
        needsConsent: { command: shell(m.update.run.map(sub)) },
      })
  }
  return {
    ...base,
    installed: det.installed,
    ...(det.version ? { version: det.version } : {}),
    ...latestFields(latest),
    ...lv,
    actions,
  }
}

export async function viewComponents(
  reg: Registry,
  state: LauncherState,
  envDoc: EnvDoc,
  d: Deps,
  ctx: Pick<Ctx, 'launcherVersion' | 'isDev' | 'launcherUpdateReady' | 'launcherLatest'> & {
    recentArt?: string
  },
): Promise<ComponentView[]> {
  const full: Ctx = {
    squarelDir: state.squarelDir,
    launcherVersion: ctx.launcherVersion,
    isDev: ctx.isDev,
    env: envDoc,
    ...(ctx.launcherUpdateReady ? { launcherUpdateReady: ctx.launcherUpdateReady } : {}),
    ...(ctx.launcherLatest ? { launcherLatest: ctx.launcherLatest } : {}),
  }
  const core = Promise.all(reg.core.map((c) => viewCore(c, full, d)))
  const ints = Promise.all(reg.integrations.map((i) => viewIntegration(i, state, envDoc, d, ctx.recentArt)))
  return [...(await core), ...(await ints)]
}
