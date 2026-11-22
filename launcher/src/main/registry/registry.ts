/** The component registry: core list + integration manifests, and the views the UI renders. */
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { substitute } from '@squarel/integration-schema'
import type { ActionRef, ComponentView, Level } from '../../shared/model'
import type { Deps } from '../deps'
import { type EnvDoc, getVar } from '../env-store'
import type { LauncherState } from '../state'
import { compareVersions, type Latest, latestGitTag, satisfiesMin } from '../versions'
import { CORE, type CoreComponent, type Ctx, type Detected, MIN_NODE } from './core'
import {
  type CatalogEntry,
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
function expandEnv(s: string, env: NodeJS.ProcessEnv): string | undefined {
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

export async function detectIntegration(i: LoadedIntegration, envDoc: EnvDoc, d: Deps): Promise<Detected> {
  const { detect } = i.manifest
  const candidates: string[] = []
  if (detect.env) {
    const v = getVar(envDoc, detect.env)?.trim() || envGet(d.env, detect.env)?.trim()
    if (v) candidates.push(v)
  }
  for (const c of detect.candidates ?? []) {
    const e = expandEnv(c, d.env)
    if (e) candidates.push(e)
  }
  let path: string | undefined
  for (const c of candidates) {
    if (await fileExists(d, c)) {
      path = c
      break
    }
  }
  if (!path) return { installed: false }
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
  const actions: ActionRef[] = []
  if (!det.installed && c.install?.winget) {
    actions.push({
      componentId: c.id,
      kind: 'install',
      id: 'winget',
      label: 'Cài',
      needsConsent: {
        command: `winget install --id ${c.install.winget} -e`,
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
    required: c.required,
    installed: det.installed,
    ...(det.version ? { version: det.version } : {}),
    ...latestFields(latest),
    ...levelFor({ required: c.required, installed: det.installed, version: det.version, latest, nodeOk }),
    actions,
  }
}

async function viewIntegration(
  i: LoadedIntegration,
  state: LauncherState,
  envDoc: EnvDoc,
  d: Deps,
): Promise<ComponentView> {
  const m = i.manifest
  const base = {
    id: m.id,
    name: m.name,
    description: m.description,
    kind: 'integration' as const,
    icon: join(i.dir, m.icon),
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
  const det = await detectIntegration(i, envDoc, d)
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
    for (const a of m.launch)
      actions.push({ componentId: m.id, kind: 'launch', id: a.id, label: sub(a.label) })
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
  ctx: Partial<Pick<Ctx, 'launcherVersion' | 'isDev'>> = {},
): Promise<ComponentView[]> {
  const full: Ctx = {
    squarelDir: state.squarelDir,
    launcherVersion: ctx.launcherVersion ?? '0.0.0',
    isDev: ctx.isDev ?? false,
    env: envDoc,
  }
  const core = Promise.all(reg.core.map((c) => viewCore(c, full, d)))
  const ints = Promise.all(reg.integrations.map((i) => viewIntegration(i, state, envDoc, d)))
  return [...(await core), ...(await ints)]
}
