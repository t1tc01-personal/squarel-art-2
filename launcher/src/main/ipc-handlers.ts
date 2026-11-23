/**
 * Pure IPC handlers (no Electron import): index.ts registers `handle` for every channel in
 * CHANNELS and supplies the Electron pieces (dialogs, shell, window events) through IpcContext.
 * Every call checks the sender, validates the input, runs, then validates the output; errors that
 * reach the renderer carry only fixed messages (never .env values).
 */

import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { substitute } from '@squarel/integration-schema'
import type { z } from 'zod'
import {
  CHANNELS,
  type Channel,
  type ChecksSnapshot,
  ENV_KEYS,
  type EnvKey,
  type EnvView,
  EVENTS,
  type EventName,
  type EventPayload,
  type FileFilter,
  IMAGE_PROVIDERS,
  type LauncherStateView,
  type RecentProject,
  SECRET_ENV_KEYS,
  type SetupInfo,
  type UpdatesInfo,
} from '../shared/ipc'
import type { CheckResult, PresenceGroup, TaskEvent } from '../shared/model'
import { type ActionCtx, type Resolved, resolveAction, squarelUpdate } from './actions'
import type { BridgeState } from './bridge/types'
import { type CheckCtx, runChecks } from './checks/runner'
import type { Deps } from './deps'
import { type EnvDoc, maskSecret, parseEnv, readVar, serializeEnv, setVar } from './env-store'
import { readLogs } from './logs'
import { appPaths } from './paths'
import { buildPresence } from './presence'
import { redactText } from './redact'
import { loadRegistry, type Registry, viewComponents } from './registry/registry'
import {
  ASEPRITE_EULA,
  cloneArgv,
  hasWinget,
  installPlan,
  nextSetupStep,
  refreshPath,
  setupFacts,
  step2Done,
} from './setup'
import type { LauncherState } from './state'
import { planSquarelUpdate } from './updates/squarel'
import { maskCredentials, showArgv } from './updates/tools'
import type { Latest } from './versions'

// Compile-time: shared/ipc.ts mirrors main/state.ts.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false
const _stateMirror: Same<LauncherState, LauncherStateView> = true
void _stateMirror

/** An error whose message is safe to show in the renderer. */
export class IpcError extends Error {}

export interface SenderInfo {
  /** URL of the frame that sent the message (`event.senderFrame.url`). */
  url?: string
  /** True when the message came from the launcher's own BrowserWindow. */
  fromAppWindow: boolean
}

export interface IpcContext {
  d: Deps
  launcherVersion: string
  isDev: boolean
  homeDir: string
  /** %APPDATA%\SquarelArt Launcher\logs */
  logsDir: string
  /** True only for the app's own renderer page. */
  isAppUrl(url: string): boolean
  state: { load(): Promise<LauncherState>; save(s: LauncherState): Promise<void> }
  bridge(): BridgeState
  dialogs: {
    pickFolder(): Promise<string | null>
    pickFile(filters: FileFilter[]): Promise<string | null>
  }
  /** shell.showItemInFolder; called only with a checked, real path. */
  showItemInFolder(path: string): void
  /** Title bar buttons. `close(true)` keeps the app running (tray; minimized until T15), `close(false)` quits. */
  window: { minimize(): void; close(toTray: boolean): void }
  launcherUpdater: { check(): Promise<Latest> }
  emit<E extends EventName>(event: E, payload: EventPayload<E>): void
  /** Called after a successful env:set (e.g. BRIDGE_PORT → restart the supervisor). */
  onEnvChanged?(key: EnvKey): void
  /** Diagnostics; messages never contain .env values. */
  log?(message: string): void
  /** Fixed path of the bundled LICENSE.md (dev: repo root; packaged: resources). */
  licensePath: string
  /** Public repository page (About section). */
  repoUrl: string
  /** shell.openPath; only ever called with licensePath. Resolves to an error text ('' = ok). */
  openPath(path: string): Promise<string>
  clipboard: { writeText(text: string): void }
  /** Tool call over the launcher's bridge connection; rejects when the bridge is not running. */
  bridgeTool(name: string, input: unknown): Promise<string>
  /** Opens a folder in the file manager; must refuse anything that is not a directory. */
  openFolder(path: string): Promise<void>
  /** shell.openExternal for https URLs from main's own fixed tables (official download pages). */
  openExternal(url: string): Promise<void>
  /** Test seam for the MCP smoke test of checks:run. */
  smoke?: CheckCtx['smoke']
}

export interface IpcHandlers {
  readonly channels: readonly Channel[]
  handle(channel: string, sender: SenderInfo, payload: unknown): Promise<unknown>
  /** Shared with the scheduler: one run at a time, result also pushed as `checks:changed`. */
  runChecks(): Promise<CheckResult[]>
  checkUpdates(): Promise<UpdatesInfo>
  presence(): Promise<PresenceGroup[]>
  /** Resolves once no task started by action:run / updates:apply is running. */
  idle(): Promise<void>
}

const UNC = /^[\\/]{2}/
const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
const VERSION_ID = /^v\d{6}$/
const MAX_TEXT = 20_000

const errMsg = (e: unknown) => String((e as Error)?.message ?? e)

export function createIpcHandlers(ctx: IpcContext): IpcHandlers {
  const { d } = ctx
  const isWin = d.platform === 'win32'
  const isDriveAbsolute = (p: string) => (isWin ? /^[A-Za-z]:[\\/]/.test(p) : p.startsWith('/'))

  // ---- state --------------------------------------------------------------------------------
  let cached: LauncherState | undefined
  let stateChain: Promise<unknown> = Promise.resolve()
  const getState = async () => {
    cached ??= await ctx.state.load()
    return cached
  }
  /** Serialized read-modify-write so concurrent setters never lose an update. */
  function updateState(
    fn: (s: LauncherState) => LauncherState | Promise<LauncherState>,
  ): Promise<LauncherState> {
    const next = stateChain.then(async () => {
      const s = await fn(await getState())
      await ctx.state.save(s)
      cached = s
      return s
    })
    stateChain = next.catch(() => {})
    return next
  }

  function paths() {
    try {
      return appPaths(d.env)
    } catch (e) {
      throw new IpcError(errMsg(e))
    }
  }

  // ---- push events --------------------------------------------------------------------------
  function push<E extends EventName>(event: E, payload: EventPayload<E>): void {
    const r = EVENTS[event].safeParse(payload)
    if (!r.success) {
      ctx.log?.(`ipc: dropped invalid ${event} event`)
      return
    }
    ctx.emit(event, r.data as EventPayload<E>)
  }

  // ---- .env ---------------------------------------------------------------------------------
  function envFile(s: LauncherState): string | undefined {
    return s.squarelDir ? join(s.squarelDir, '.env') : undefined
  }
  /** Secret values seen in the last .env read: scrubbed from anything logged. */
  let knownSecrets: string[] = []
  async function readEnv(s: LauncherState): Promise<EnvDoc> {
    const file = envFile(s)
    let doc = parseEnv('')
    if (file) {
      try {
        doc = parseEnv(String(await d.fs.readFile(file, 'utf8')))
      } catch {}
    }
    knownSecrets = secretValues(doc)
    return doc
  }
  function scrub(t: string, secrets: string[] = knownSecrets): string {
    let out = maskCredentials(t)
    for (const v of secrets) out = out.split(v).join(maskSecret(v))
    return out
  }
  function envView(doc: EnvDoc): EnvView {
    const view = {} as EnvView
    for (const key of ENV_KEYS) {
      const value = readVar(doc, key) ?? ''
      const secret = SECRET_ENV_KEYS.includes(key)
      view[key] = { set: value !== '', value: secret ? maskSecret(value) : value, secret }
    }
    return view
  }
  /** Fixed message per key; never includes the value. */
  function envValueError(key: EnvKey, v: string): string | undefined {
    if (v === '') return undefined
    const path = (exe: boolean) =>
      isDriveAbsolute(v) && !UNC.test(v) && !/["*?<>|]/.test(v) && (!exe || /\.exe$/i.test(v))
        ? undefined
        : `${key} phải là đường dẫn tuyệt đối trên máy${exe ? ' tới file .exe' : ''}`
    switch (key) {
      case 'BRIDGE_PORT': {
        const n = Number(v)
        return /^\d{1,5}$/.test(v) && n >= 1 && n <= 65535 ? undefined : 'BRIDGE_PORT phải là số cổng 1–65535'
      }
      case 'IMAGE_DAILY_BUDGET_USD':
        return /^\d{1,6}(\.\d{1,4})?$/.test(v) ? undefined : 'IMAGE_DAILY_BUDGET_USD phải là số không âm'
      case 'IMAGE_PROVIDER':
        return (IMAGE_PROVIDERS as readonly string[]).includes(v)
          ? undefined
          : `IMAGE_PROVIDER phải là ${IMAGE_PROVIDERS.join(', ')}`
      case 'LOCAL_SD_URL':
        try {
          const u = new URL(v)
          if (u.username || u.password) return 'LOCAL_SD_URL không được chứa tên đăng nhập hoặc mật khẩu'
          return u.protocol === 'http:' || u.protocol === 'https:'
            ? undefined
            : 'LOCAL_SD_URL phải là URL http(s)'
        } catch {
          return 'LOCAL_SD_URL phải là URL http(s)'
        }
      case 'DATA_DIR':
        return path(false)
      case 'ASEPRITE_PATH':
        return path(true)
      default:
        return /^\S{1,512}$/.test(v) ? undefined : `${key} không được chứa khoảng trắng`
    }
  }
  /** Single quotes (literal in Node's parser) only when the plain form would be misread. */
  function encodeEnvValue(v: string): string {
    if (!/[#'"`]|^\s|\s$/.test(v)) return v
    if (v.includes("'")) throw new IpcError('Giá trị không được chứa dấu nháy đơn')
    return `'${v}'`
  }
  async function writeEnv(file: string, doc: EnvDoc): Promise<void> {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    await d.fs.writeFile(tmp, serializeEnv(doc), 'utf8')
    try {
      await d.fs.rename(tmp, file)
    } catch (e) {
      await d.fs.rm(tmp, { force: true }).catch(() => {})
      throw e
    }
  }
  function secretValues(doc: EnvDoc): string[] {
    return SECRET_ENV_KEYS.map((k) => readVar(doc, k) ?? '').filter((v) => v.length >= 4)
  }

  function dataDir(s: LauncherState, doc: EnvDoc): string {
    const v = readVar(doc, 'DATA_DIR')
    return v ? resolve(s.squarelDir ?? ctx.homeDir, v) : join(ctx.homeDir, 'SquarelArt-data')
  }

  // ---- shared pieces ------------------------------------------------------------------------
  async function registry(s: LauncherState): Promise<Registry> {
    return loadRegistry(
      { squarelDir: s.squarelDir, userIntegrationsDir: paths().userIntegrations, platform: d.platform },
      d,
    )
  }

  async function checkCtx(s: LauncherState, env: EnvDoc): Promise<CheckCtx> {
    return {
      squarelDir: s.squarelDir,
      dataDir: dataDir(s, env),
      env,
      bridge: ctx.bridge(),
      selected: s.selected,
      ...(ctx.smoke ? { smoke: ctx.smoke } : {}),
    }
  }

  async function exists(p: string): Promise<boolean> {
    try {
      await d.fs.stat(p)
      return true
    } catch {
      return false
    }
  }

  let setupStartChecked = false

  /** Everything the setup wizard needs; detection only (no update checks over the network). */
  async function setupInfo(refresh: boolean): Promise<SetupInfo> {
    if (refresh) await refreshPath(d).catch(() => {})
    const s = await getState()
    const env = await readEnv(s)
    const reg = await registry(s)
    const coreOnly: Registry = {
      ...reg,
      core: reg.core.map(({ latest: _latest, ...c }) => c),
      integrations: [],
    }
    const tools = await viewComponents(coreOnly, s, env, d, {
      launcherVersion: ctx.launcherVersion,
      isDev: ctx.isDev,
    })
    const depsInstalled = s.squarelDir
      ? await exists(join(s.squarelDir, 'node_modules', '.modules.yaml'))
      : false
    const facts = setupFacts(tools, depsInstalled)
    // A finished setup is re-checked once per launcher start only, so "Bỏ qua, vào launcher" sticks
    // for this session (Health keeps reporting what is missing).
    let step = s.setupStep === 'done' && setupStartChecked ? 'done' : nextSetupStep(s, facts)
    setupStartChecked = true
    // A returning user (setup completed before) sent back to step 2 is done once step 2 is.
    if (step === 2 && s.setupCompleted && step2Done(facts)) step = 'done'
    if (step !== s.setupStep) await updateState((st) => ({ ...st, setupStep: step }))
    let defaultInstall: string | null = null
    try {
      defaultInstall = appPaths(d.env).defaultInstall
    } catch {}
    let cloneCommand: string | null = null
    try {
      if (defaultInstall) cloneCommand = showArgv(cloneArgv(ctx.launcherVersion, defaultInstall))
    } catch {}
    // Only the wizard needs to know (spawning winget costs a moment at every start otherwise).
    const winget = step === 'done' ? false : await hasWinget(d)
    const p = paths()
    const integrations = reg.integrations
      .filter((i) => !i.incompatible)
      .map((i) => {
        const m = i.manifest
        const vars = { toolsDir: p.toolsDir(m.id) }
        const sub = (x: string) => {
          try {
            return substitute(x, vars)
          } catch {
            return x
          }
        }
        return {
          id: m.id,
          name: m.name,
          extension: !!m.extension?.install,
          options: m.install.map((o) => ({
            id: o.id,
            label: sub(o.label),
            ...(o.note ? { note: o.note } : {}),
            ...(o.run ? { command: showArgv(o.run.map(sub)) } : {}),
            ...(o.pickFile ? { pickFile: o.pickFile } : {}),
            ...(o.setEnv ? { setEnv: o.setEnv } : {}),
          })),
        }
      })
    return {
      step,
      winget,
      launcherVersion: ctx.launcherVersion,
      defaultInstall,
      cloneCommand,
      depsInstalled,
      tools,
      plan: installPlan(tools, winget),
      integrations,
      asepriteEula: ASEPRITE_EULA,
    }
  }

  let lastChecks: ChecksSnapshot | null = null
  let checksInFlight: Promise<CheckResult[]> | undefined
  function runChecksOnce(): Promise<CheckResult[]> {
    checksInFlight ??= (async () => {
      try {
        const s = await getState()
        const env = await readEnv(s)
        const reg = await registry(s)
        const results = await runChecks(reg, await checkCtx(s, env), d)
        lastChecks = { at: d.now().toISOString(), results }
        push('checks:changed', lastChecks)
        return results
      } finally {
        checksInFlight = undefined
      }
    })()
    return checksInFlight
  }

  async function presence(): Promise<PresenceGroup[]> {
    const s = await getState()
    const env = await readEnv(s)
    return buildPresence({ dataDir: dataDir(s, env), bridge: ctx.bridge(), reg: await registry(s), env }, d)
  }

  async function checkUpdates(): Promise<UpdatesInfo> {
    const s = await getState()
    const launcher = ctx.launcherUpdater
      .check()
      .catch((e): Latest => ({ ok: false, reason: 'error', message: maskCredentials(errMsg(e)) }))
    const squarel: Promise<UpdatesInfo['squarel']> = s.squarelDir
      ? planSquarelUpdate(s.squarelDir, ctx.launcherVersion, d, { isDev: ctx.isDev }).catch(
          (e): UpdatesInfo['squarel'] => ({ kind: 'error', message: maskCredentials(errMsg(e)) }),
        )
      : Promise.resolve({ kind: 'error', message: 'Chưa chọn thư mục Squarel' })
    const checkedAt = d.now().toISOString()
    const info: UpdatesInfo = { checkedAt, launcher: await launcher, squarel: await squarel }
    await updateState((st) => ({ ...st, lastUpdateCheck: checkedAt })).catch(() => {})
    push('components:changed', null) // tool rows recompute their `latest`
    return info
  }

  // ---- tasks --------------------------------------------------------------------------------
  const running = new Map<string, Promise<void>>()
  /** One task at a time may run in / change the Squarel folder. */
  let squarelBusy = false
  /** What holds the Squarel folder now (message for refused actions). */
  let squarelBusyText = ''
  let seq = 0
  function startTask(resolved: Resolved, secrets: string[]): string {
    if ('error' in resolved) throw new IpcError(resolved.error)
    const { key, body } = resolved
    if (running.has(key)) throw new IpcError('Thao tác này đang chạy')
    if (resolved.squarelDir && squarelBusy)
      throw new IpcError(
        squarelBusyText
          ? `${squarelBusyText} Chờ xong rồi thử lại.`
          : 'Đang có thao tác khác trên thư mục Squarel, chờ thao tác đó xong rồi thử lại',
      )
    if (resolved.squarelDir) {
      squarelBusy = true
      squarelBusyText = resolved.busyText ?? ''
    }
    const taskId = `${key}#${++seq}`
    const redact = (t: string) => {
      const out = scrub(t, secrets)
      return out.length > MAX_TEXT ? `${out.slice(0, MAX_TEXT)}…` : out
    }
    let finished = false
    const emit = (e: TaskEvent) => {
      if (finished) return
      if (e.kind === 'done' || e.kind === 'error') finished = true
      push('task:event', { ...e, taskId, ...(e.text !== undefined ? { text: redact(e.text) } : {}) })
    }
    const p = (async () => {
      try {
        await body(taskId, emit)
        if (!finished) emit({ taskId, kind: 'done', code: 0 })
      } catch (e) {
        emit({ taskId, kind: 'error', text: errMsg(e) })
      } finally {
        if (resolved.squarelDir) {
          squarelBusy = false
          squarelBusyText = ''
        }
        running.delete(key)
        push('components:changed', null)
      }
    })()
    running.set(key, p)
    return taskId
  }
  async function actionCtx(): Promise<{ actx: ActionCtx; secrets: string[] }> {
    const s = await getState()
    const env = await readEnv(s)
    const p = paths()
    const recent = await newestProjectSlug(s, env)
    return {
      actx: {
        d,
        state: s,
        reg: await registry(s),
        launcherVersion: ctx.launcherVersion,
        isDev: ctx.isDev,
        toolsDir: p.toolsDir,
        env,
        ...(recent ? { recentProject: recent } : {}),
        projects: () => projectSlugs(s, env),
        bridgeTool: (name, input) => ctx.bridgeTool(name, input),
        openFolder: (path) => ctx.openFolder(path),
        defaultInstall: p.defaultInstall,
        homeDir: ctx.homeDir,
        openExternal: async (url) => {
          if (!url.startsWith('https://')) throw new Error('Chỉ mở trang https')
          await ctx.openExternal(url)
        },
        setState: async (patch) => {
          await updateState((st) => ({ ...st, ...patch }))
        },
      },
      secrets: secretValues(env),
    }
  }

  // ---- shell:reveal -------------------------------------------------------------------------
  function within(root: string, p: string): boolean {
    const rel = relative(root, p)
    return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
  }
  async function realOrResolved(p: string): Promise<string> {
    try {
      return await d.fs.realpath(p)
    } catch {
      return resolve(p)
    }
  }
  async function revealPath(p: string): Promise<void> {
    const refused = new IpcError('Đường dẫn nằm ngoài các thư mục của Squarel')
    if (/[\0\r\n]/.test(p) || UNC.test(p) || !isDriveAbsolute(p)) throw refused
    let real: string
    try {
      real = await d.fs.realpath(resolve(p))
    } catch {
      throw new IpcError('Không tìm thấy đường dẫn')
    }
    if (UNC.test(real) || !isDriveAbsolute(real)) throw refused
    const s = await getState()
    const env = await readEnv(s)
    const candidates = [s.squarelDir, dataDir(s, env), ctx.logsDir]
    try {
      candidates.push(dirname(appPaths(d.env).toolsDir('x')))
    } catch {}
    const roots: string[] = []
    for (const c of candidates) {
      if (!c || !isDriveAbsolute(c)) continue
      const r = await realOrResolved(c)
      // A drive root as "known folder" would allow everything on that drive.
      if (UNC.test(r) || dirname(r) === r) continue
      roots.push(r)
    }
    if (!roots.some((r) => within(r, real))) throw refused
    ctx.showItemInFolder(real)
  }

  // ---- projects:recent ----------------------------------------------------------------------
  /** Slug of the most recently updated project: project.json `updatedAt` only, no version files. */
  async function newestProjectSlug(s: LauncherState, env: EnvDoc): Promise<string | undefined> {
    const projects = join(dataDir(s, env), 'projects')
    let best: { slug: string; at: string } | undefined
    for (const slug of await projectSlugs(s, env)) {
      try {
        const file = join(projects, slug, 'project.json')
        if ((await d.fs.stat(file)).size > 64 * 1024) continue
        const raw = JSON.parse(String(await d.fs.readFile(file, 'utf8')).replace(/^﻿/, ''))
        if (typeof raw?.updatedAt !== 'string' || typeof raw?.head !== 'string') continue
        if (!best || raw.updatedAt > best.at) best = { slug, at: raw.updatedAt }
      } catch {}
    }
    return best?.slug
  }

  /** Project folders of DATA_DIR that have a project.json. */
  async function projectSlugs(s: LauncherState, env: EnvDoc): Promise<string[]> {
    const projects = join(dataDir(s, env), 'projects')
    let names: string[]
    try {
      names = (await d.fs.readdir(projects)).map(String).filter((n) => SLUG.test(n))
    } catch {
      return []
    }
    const out: string[] = []
    for (const n of names) {
      try {
        await d.fs.stat(join(projects, n, 'project.json'))
        out.push(n)
      } catch {}
    }
    return out
  }

  async function recentProjects(): Promise<RecentProject[]> {
    const s = await getState()
    const projects = join(dataDir(s, await readEnv(s)), 'projects')
    let names: string[]
    try {
      names = (await d.fs.readdir(projects)).map(String).filter((n) => SLUG.test(n))
    } catch {
      return []
    }
    const infos: RecentProject[] = []
    for (const slug of names) {
      try {
        const file = join(projects, slug, 'project.json')
        if ((await d.fs.stat(file)).size > 64 * 1024) continue
        const raw = JSON.parse(String(await d.fs.readFile(file, 'utf8')).replace(/^﻿/, ''))
        if (typeof raw?.updatedAt !== 'string' || typeof raw?.head !== 'string') continue
        infos.push({
          slug,
          name: typeof raw.name === 'string' ? raw.name.slice(0, 300) : slug,
          version: VERSION_ID.test(raw.head) ? raw.head : '',
          updatedAt: raw.updatedAt.slice(0, 40),
        })
      } catch {
        /* broken project: skip */
      }
    }
    infos.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const top = infos.slice(0, 3)
    for (const p of top) {
      if (!p.version) continue
      try {
        const file = join(projects, p.slug, 'versions', `${p.version}.json.gz`)
        if ((await d.fs.stat(file)).size > 16 * 1024 * 1024) continue
        const buf = Buffer.from((await d.fs.readFile(file)) as Uint8Array)
        const json = JSON.parse(gunzipSync(buf, { maxOutputLength: 256 * 1024 * 1024 }).toString('utf8'))
        const { width, height } = json?.doc ?? {}
        if (Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0) {
          p.width = width
          p.height = height
        }
      } catch {
        /* size is optional */
      }
    }
    return top
  }

  // ---- channel table ------------------------------------------------------------------------
  type Impl = { [C in Channel]: (input: z.infer<(typeof CHANNELS)[C]['input']>) => Promise<unknown> }
  const impl: Impl = {
    'state:get': () => getState(),
    'state:set': async (patch) => {
      if (patch.squarelDir !== undefined) patch.squarelDir = await checkSquarelDir(patch.squarelDir)
      const s = await updateState((st) => ({
        ...st,
        ...patch,
        // Only finishing step 4 completes setup; "Bỏ qua, vào launcher" from step 2 does not.
        ...(patch.setupStep === 'done' && st.setupStep === 4 ? { setupCompleted: true } : {}),
      }))
      push('components:changed', null)
      return s
    },
    'components:list': async () => {
      const s = await getState()
      const env = await readEnv(s)
      const recent = await newestProjectSlug(s, env)
      return viewComponents(await registry(s), s, env, d, {
        launcherVersion: ctx.launcherVersion,
        isDev: ctx.isDev,
        ...(recent ? { recentProject: recent } : {}),
      })
    },
    'checks:run': () => runChecksOnce(),
    'checks:last': async () => lastChecks,
    'presence:get': () => presence(),
    'env:get': async () => envView(await readEnv(await getState())),
    'env:set': async ({ key, value }) => {
      const problem = envValueError(key, value)
      if (problem) throw new IpcError(problem)
      const s = await getState()
      if ((key === 'DATA_DIR' || key === 'ASEPRITE_PATH') && value !== '') {
        if (!fromMain(value, readVar(await readEnv(s), key)))
          throw new IpcError(`Hãy chọn ${key === 'DATA_DIR' ? 'thư mục' : 'file'} bằng hộp thoại`)
      }
      const file = envFile(s)
      if (!file) throw new IpcError('Chưa chọn thư mục Squarel')
      const doc = setVar(await readEnv(s), key, encodeEnvValue(value))
      await writeEnv(file, doc)
      ctx.log?.(`env: ${key} updated`)
      ctx.onEnvChanged?.(key)
      push('components:changed', null)
      return envView(doc)
    },
    'action:run': async (ref) => {
      const { actx, secrets } = await actionCtx()
      return startTask(resolveAction(ref, actx), secrets)
    },
    'updates:check': () => checkUpdates(),
    'updates:apply': async () => {
      // TODO(T15): launcher self-update (quitAndInstall) and stopping the own bridge belong to the quit wiring.
      const { actx, secrets } = await actionCtx()
      return startTask(squarelUpdate(actx), secrets)
    },
    'dialog:pickFolder': async () => remember(await ctx.dialogs.pickFolder()),
    'dialog:pickFile': async ({ filters }) => remember(await ctx.dialogs.pickFile(filters)),
    'shell:reveal': async ({ path }) => {
      await revealPath(path)
      return undefined
    },
    'projects:recent': () => recentProjects(),
    'logs:read': async (query) => {
      const s = await getState()
      const env = await readEnv(s)
      const dataLogs = join(dataDir(s, env), 'logs')
      const secrets = secretValues(env)
      const r = await readLogs([dataLogs, ctx.logsDir], query, (t) => redactText(t, secrets), d)
      return { dir: dataLogs, ...r }
    },
    'clipboard:write': async ({ text }) => {
      // The renderer sends lines main already redacted; redact again in case it did not.
      const env = await readEnv(await getState())
      ctx.clipboard.writeText(redactText(text, secretValues(env)))
      return undefined
    },
    'license:open': async () => {
      const err = await ctx.openPath(ctx.licensePath)
      if (err) throw new IpcError('Không mở được LICENSE.md')
      return undefined
    },
    'app:about': async () => {
      const s = await getState()
      let squarelVersion: string | null = null
      if (s.squarelDir) {
        try {
          const pkg = JSON.parse(
            String(await d.fs.readFile(join(s.squarelDir, 'package.json'), 'utf8')).replace(/^﻿/, ''),
          )
          if (typeof pkg?.version === 'string') squarelVersion = pkg.version.slice(0, 100)
        } catch {}
      }
      return { launcherVersion: ctx.launcherVersion, squarelVersion, repoUrl: ctx.repoUrl }
    },
    'catalog:list': async () => (await registry(await getState())).comingSoon,
    'setup:info': ({ refresh }) => setupInfo(refresh),
    'checks:runOne': async ({ id }) => {
      const s = await getState()
      const env = await readEnv(s)
      const [r] = await runChecks(await registry(s), await checkCtx(s, env), d, [id])
      if (!r) throw new IpcError('Không có kiểm tra này')
      return r
    },
    'window:minimize': async () => {
      ctx.window.minimize()
      return undefined
    },
    'window:close': async () => {
      ctx.window.close((await getState()).closeToTray)
      return undefined
    },
  }

  // ---- paths chosen by the user ----------------------------------------------------------------
  /**
   * Defense in depth: paths that steer where commands run or what gets executed (squarelDir,
   * DATA_DIR, ASEPRITE_PATH) are only accepted when main itself produced them, i.e. the result of
   * the most recent pick dialog, or the value already stored.
   */
  let lastPicked: string | undefined
  function remember(p: string | null): string | null {
    lastPicked = p ?? lastPicked
    return p
  }
  const samePath = (a: string, b: string) =>
    isWin ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
  function fromMain(p: string, ...known: (string | undefined)[]): boolean {
    return [lastPicked, ...known].some((k) => !!k && samePath(k, p))
  }

  async function checkSquarelDir(dir: string): Promise<string> {
    if (UNC.test(dir) || !isDriveAbsolute(dir))
      throw new IpcError('Thư mục Squarel phải là đường dẫn tuyệt đối trên máy')
    let defaultInstall: string | undefined
    try {
      defaultInstall = appPaths(d.env).defaultInstall
    } catch {}
    if (!fromMain(dir, (await getState()).squarelDir, defaultInstall))
      throw new IpcError('Hãy chọn thư mục Squarel bằng hộp thoại chọn thư mục')
    const full = resolve(dir)
    try {
      const pkg = JSON.parse(String(await d.fs.readFile(join(full, 'package.json'), 'utf8')).replace(/^﻿/, ''))
      if (pkg?.name === 'squarel-art') return full
    } catch {}
    throw new IpcError('Thư mục này không phải Squarel (cần package.json tên "squarel-art")')
  }

  const channels = Object.keys(CHANNELS) as Channel[]

  return {
    channels,
    async handle(channel, sender, payload) {
      if (!Object.hasOwn(CHANNELS, channel))
        throw new IpcError(`Kênh IPC không tồn tại: ${channel.slice(0, 40)}`)
      if (!sender.fromAppWindow || !sender.url || !ctx.isAppUrl(sender.url))
        throw new IpcError('Từ chối yêu cầu IPC không đến từ cửa sổ launcher')
      const ch = channel as Channel
      const spec = CHANNELS[ch]
      const input = spec.input.safeParse(payload)
      if (!input.success) throw new IpcError(`Tham số không hợp lệ cho ${ch}`)
      let result: unknown
      try {
        result = await (impl[ch] as (i: unknown) => Promise<unknown>)(input.data)
      } catch (e) {
        if (e instanceof IpcError) throw e
        ctx.log?.(`ipc ${ch} failed: ${scrub(errMsg(e))}`)
        throw new IpcError(`Lỗi khi xử lý ${ch}`)
      }
      const output = spec.output.safeParse(result)
      if (!output.success) {
        ctx.log?.(`ipc ${ch}: invalid output dropped`)
        throw new IpcError(`Kết quả không hợp lệ từ ${ch}`)
      }
      return output.data
    },
    runChecks: runChecksOnce,
    checkUpdates,
    presence,
    async idle() {
      while (running.size) await Promise.all([...running.values()])
    },
  }
}
