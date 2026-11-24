/**
 * `action:run` dispatch. Only ActionRefs listed here run; the command always comes from the
 * launcher's own code or from the loaded manifest of a selected integration, never from the
 * ActionRef itself (its `label` / `needsConsent` are display-only and ignored here).
 *
 * Supported: launcher/update/install (only after the update downloaded), settings/fix/open-settings, squarel/fix/register-mcp, squarel/fix/copy-skills,
 * squarel/update/update, squarel/install/clone, squarel/install/deps,
 * <core>/(install|terminal)/winget (visible terminal), claude-code/terminal/terminal (visible
 * PowerShell), <core|winget>/terminal/download (official page in the browser),
 * <integration>/extension/install, <integration>/update/update, <integration>/install/<option with run>,
 * <integration>/launch/<launch id>.
 */
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { substitute } from '@squarel/integration-schema'
import type { ActionRef, TaskEvent } from '../shared/model'
import { copySkills, registerMcp } from './claude'
import type { Deps } from './deps'
import type { EnvDoc } from './env-store'
import { CORE } from './registry/core'
import { detectIntegration, type LoadedIntegration, type Registry } from './registry/registry'
import { parseProgressLine } from './run'
import {
  checkCloneTarget,
  claudeTerminalArgv,
  cloneArgv,
  OFFICIAL_DOWNLOADS,
  wingetPath,
  wingetTerminalArgv,
} from './setup'
import type { LauncherState } from './state'
import { applySquarelUpdate, planSquarelUpdate } from './updates/squarel'
import {
  applyToolUpdate,
  closedBlocker,
  closeHint,
  manifestCwd,
  maskCredentials,
  runStep,
} from './updates/tools'
import { latestGitTag } from './versions'

export type Emit = (e: TaskEvent) => void
/** `signal` aborts the task (quit during a build): running commands are killed with their tree. */
export type ActionBody = (taskId: string, emit: Emit, signal?: AbortSignal) => Promise<void>

export interface ActionCtx {
  d: Deps
  state: LauncherState
  reg: Registry
  launcherVersion: string
  isDev: boolean
  toolsDir(id: string): string
  /** The parsed Squarel `.env` (detection of integration executables). */
  env: EnvDoc
  /** Slug of the most recently updated project (resolved in main), for `{recentProject}`. */
  recentProject?: string
  /** Slugs of all projects in DATA_DIR (checks a `pickProject` choice). */
  projects(): Promise<string[]>
  /** Sends a tool call over the bridge (launch actions with `bridgeTool`). */
  bridgeTool(name: string, input: unknown): Promise<string>
  /** Opens a folder in the file manager (launch actions with `reveal`); refuses files. */
  openFolder(path: string): Promise<void>
  /** Where "Cài mới" clones Squarel (%LOCALAPPDATA%\SquarelArt\app). */
  defaultInstall?: string
  /** The user's home folder (skills go to ~/.claude/skills). */
  homeDir: string
  /** Opens an https page in the browser (only the fixed OFFICIAL_DOWNLOADS pages). */
  openExternal(url: string): Promise<void>
  /** Persists launcher state set by main itself (e.g. the cloned Squarel folder). */
  setState(patch: Partial<LauncherState>): Promise<void>
  /**
   * Stops the launcher's bridge supervisor while Squarel's code or dependencies change (an own
   * bridge is stopped, an attached one only disconnected); `resume()` starts it again.
   */
  pauseBridge?(): Promise<{ wasOwn: boolean; resume(): void }>
  /** Live Claude Code sessions (MCP presence): they keep running the old Squarel code. */
  mcpSessions?(): Promise<number>
  /** Version electron-updater finished downloading, if any. */
  launcherUpdateReady?: string
  /** Graceful quit (tasks, bridge) followed by electron-updater's quitAndInstall. */
  installLauncherUpdate?(): void
}

/** Never wait for credentials: a clone must fail instead of hanging. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0' }
const CLONE_MS = 10 * 60_000

/**
 * `squarelDir: true` = the task runs in or changes the Squarel folder; at most one such task runs
 * at a time (a git checkout must never race a `pnpm install` or an extension build).
 */
export type Resolved =
  | {
      key: string
      body: ActionBody
      squarelDir?: boolean
      /** Shown to other actions while this one holds the Squarel folder (e.g. "Aseprite đang build…"). */
      busyText?: string
    }
  | { error: string }

const msg = (e: unknown) => maskCredentials(String((e as Error)?.message ?? e))

/** Runs `fn` with the launcher's bridge paused (B11/T10: never run a bridge from a moving checkout). */
async function withBridgePaused<T>(
  ctx: ActionCtx,
  taskId: string,
  emit: Emit,
  fn: () => Promise<T>,
): Promise<T> {
  const paused = ctx.pauseBridge ? await ctx.pauseBridge() : undefined
  if (paused?.wasOwn)
    emit({ taskId, kind: 'line', text: 'Đã tạm dừng bridge của launcher; sẽ chạy lại sau khi xong.' })
  try {
    return await fn()
  } finally {
    paused?.resume()
  }
}

/** Warns that running Claude Code sessions keep the old Squarel code (and may hold the bridge). */
async function warnSessions(ctx: ActionCtx, taskId: string, emit: Emit): Promise<void> {
  const n = (await ctx.mcpSessions?.().catch(() => 0)) ?? 0
  if (n > 0)
    emit({
      taskId,
      kind: 'line',
      text: `Có ${n} phiên Claude Code đang chạy Squarel (có thể đang giữ bridge). Các phiên này vẫn dùng mã cũ cho tới khi khởi động lại.`,
    })
}

/** Squarel update task (also used by `updates:apply`). */
export function squarelUpdate(ctx: ActionCtx): Resolved {
  const dir = ctx.state.squarelDir
  if (!dir) return { error: 'Chưa chọn thư mục Squarel' }
  return {
    key: 'squarel:update',
    squarelDir: true,
    busyText: 'Squarel đang cập nhật…',
    body: async (taskId, emit, signal) => {
      let plan: Awaited<ReturnType<typeof planSquarelUpdate>>
      try {
        plan = await planSquarelUpdate(dir, ctx.launcherVersion, ctx.d, { isDev: ctx.isDev })
      } catch (e) {
        return emit({ taskId, kind: 'error', text: msg(e) })
      }
      const apply = () =>
        applySquarelUpdate(
          plan,
          {
            squarelDir: dir,
            reg: ctx.reg,
            selected: ctx.state.selected,
            onEvent: emit,
            taskId,
            ...(signal ? { signal } : {}),
          },
          ctx.d,
        )
      // Only a plan that moves the checkout needs the bridge out of the way.
      if (plan.kind !== 'tag' && plan.kind !== 'branch') return apply()
      await warnSessions(ctx, taskId, emit)
      await withBridgePaused(ctx, taskId, emit, apply)
    },
  }
}

/** A selected, compatible integration with this id, or an error message. */
function selectedIntegration(ctx: ActionCtx, id: string): LoadedIntegration | string {
  const i = ctx.reg.integrations.find((x) => x.manifest.id === id)
  if (!i) return `Không có tích hợp "${id}"`
  if (i.incompatible) return i.incompatible
  if (!ctx.state.selected.includes(id)) return `Chưa chọn tích hợp ${i.manifest.name}`
  if (i.source === 'squarel' && !ctx.state.squarelDir) return 'Chưa chọn thư mục Squarel'
  return i
}

/**
 * Turns `@@progress {json}` output lines into progress events. The percent is for the whole task:
 * the script's weighted `overall` when it sends one, otherwise each step counts the same. It never
 * goes down, so a step that restarts its own counter does not move the bar back.
 */
export function withProgress(emit: Emit): Emit {
  let best = 0
  return (e) => {
    const p = e.kind === 'line' && e.text ? parseProgressLine(e.text) : undefined
    if (!p) return emit(e)
    const clamp = (n: number) => Math.min(100, Math.max(0, n))
    const total = Math.max(1, Math.round(p.total))
    const step = Math.min(total, Math.max(1, Math.round(p.step)))
    const raw = p.overall ?? ((step - 1 + clamp(p.percent ?? 0) / 100) / total) * 100
    best = Math.max(best, Math.round(clamp(raw)))
    emit({
      taskId: e.taskId,
      kind: 'progress',
      text: p.label,
      percent: best,
      step: {
        step,
        total,
        label: p.label,
        ...(p.detail ? { detail: p.detail } : {}),
        ...(p.plan ? { plan: p.plan } : {}),
      },
    })
  }
}

async function runManifestCommand(
  taskId: string,
  emit: Emit,
  ctx: ActionCtx,
  i: LoadedIntegration,
  run: string[],
  vars: Record<string, string>,
  what: string,
  requiresClosed?: string,
  signal?: AbortSignal,
): Promise<void> {
  const why = await closedBlocker(requiresClosed, ctx.d)
  if (why) return emit({ taskId, kind: 'error', text: `${why} rồi thử lại.` })
  let argv: string[]
  try {
    argv = run.map((a) => substitute(a, vars))
  } catch (e) {
    return emit({ taskId, kind: 'error', text: `Lệnh không hợp lệ: ${msg(e)}` })
  }
  const code = await runStep(
    taskId,
    argv,
    manifestCwd(i, ctx.state.squarelDir ?? ''),
    withProgress(emit),
    ctx.d,
    undefined,
    signal,
  )
  if (code === 0) emit({ taskId, kind: 'done', code: 0, text: `${what}: xong` })
  else
    emit({
      taskId,
      kind: 'error',
      code,
      text: `${what} thất bại (mã thoát ${code}).${closeHint(requiresClosed)}`,
    })
}

type LaunchSpec = LoadedIntegration['manifest']['launch'][number]

/**
 * One entry of the manifest's `launch` list. The command, folder and tool name come only from the
 * manifest; `{exe}` / `{exeDir}` from detection and `{recentProject}` from DATA_DIR, both in main.
 * The renderer contributes at most a project slug for `pickProject`, checked against DATA_DIR.
 */
async function runLaunch(
  taskId: string,
  emit: Emit,
  ctx: ActionCtx,
  i: LoadedIntegration,
  a: LaunchSpec,
  project: string | undefined,
): Promise<void> {
  const m = i.manifest
  const fail = (text: string) => emit({ taskId, kind: 'error', text })
  const det = await detectIntegration(i, ctx.env, ctx.d)
  if (!det.installed || !det.path) return fail(`Chưa cài ${m.name}`)
  const vars = {
    toolsDir: ctx.toolsDir(m.id),
    exe: det.path,
    exeDir: dirname(det.path),
    ...(det.version ? { version: det.version } : {}),
    ...(ctx.recentProject ? { recentProject: ctx.recentProject } : {}),
  }
  let label: string
  try {
    label = substitute(a.label, vars)
  } catch {
    label = a.label
  }
  try {
    if (a.run) {
      const argv = a.run.map((x) => substitute(x, vars))
      // `env` is used only as the manifest declares it (e.g. SQUAREL_NO_SYNC=1 for "open without sync").
      await ctx.d.spawnDetached({
        argv,
        cwd: manifestCwd(i, ctx.state.squarelDir ?? ''),
        ...(a.env ? { env: { ...a.env } } : {}),
      })
      return emit({ taskId, kind: 'done', code: 0, text: `Đã mở: ${label}` })
    }
    if (a.bridgeTool) {
      let slug = ctx.recentProject
      if (a.pickProject) {
        if (!project) return fail('Hãy chọn một project')
        if (!(await ctx.projects()).includes(project)) return fail(`Không có project "${project}"`)
        slug = project
      }
      if (!slug) return fail('Chưa có project nào')
      const text = await ctx.bridgeTool(a.bridgeTool, { art: slug })
      return emit({ taskId, kind: 'done', code: 0, text: text.trim() || `Đã mở ${slug}` })
    }
    if (a.reveal) {
      await ctx.openFolder(substitute(a.reveal, vars))
      return emit({ taskId, kind: 'done', code: 0, text: label })
    }
  } catch (e) {
    return fail(`${label} thất bại: ${msg(e)}`)
  }
  return fail('Mục mở không hợp lệ')
}

/** Starts a fixed command in its own visible window; the user follows it there. */
function terminalTask(key: string, argv: () => string[], what: string, ctx: ActionCtx): Resolved {
  return {
    key,
    body: async (taskId, emit) => {
      let a: string[]
      try {
        a = argv()
      } catch (e) {
        return emit({ taskId, kind: 'error', text: msg(e) })
      }
      await ctx.d.spawnDetached({ argv: a, cwd: tmpdir() })
      emit({
        taskId,
        kind: 'done',
        code: 0,
        text: `Đã mở cửa sổ cài ${what}. Làm theo hướng dẫn trong cửa sổ đó, xong thì bấm "Kiểm tra lại".`,
      })
    },
  }
}

/** Installs of the core tools (setup wizard / System page). */
function resolveCoreInstall(ref: ActionRef, ctx: ActionCtx): Resolved | undefined {
  const { componentId: cid, kind, id } = ref
  if (kind === 'terminal' && id === 'download') {
    const url = Object.hasOwn(OFFICIAL_DOWNLOADS, cid) ? OFFICIAL_DOWNLOADS[cid] : undefined
    if (!url) return undefined
    return {
      key: `${cid}:download`,
      body: async (taskId, emit) => {
        await ctx.openExternal(url)
        emit({ taskId, kind: 'done', code: 0, text: `Đã mở ${url}` })
      },
    }
  }
  const core = CORE.find((c) => c.id === cid)
  if (!core) return undefined
  if ((kind === 'install' || kind === 'terminal') && id === 'winget') {
    const spec = core.install
    if (!spec?.winget) return undefined
    return terminalTask(
      `${cid}:install`,
      () => {
        const exe = wingetPath(ctx.d)
        if (!exe)
          throw new Error('Không tìm thấy winget. Bấm "Kiểm tra lại", hoặc dùng trang tải chính thức.')
        return wingetTerminalArgv(ctx.d, spec, exe)
      },
      core.name,
      ctx,
    )
  }
  if (kind === 'terminal' && id === 'terminal' && cid === 'claude-code')
    return terminalTask(`${cid}:install`, () => claudeTerminalArgv(ctx.d), core.name, ctx)
  return undefined
}

/** "Cài mới": shallow clone of the launcher's own tag into the default folder (empty or absent). */
function cloneSquarel(ctx: ActionCtx): Resolved {
  const target = ctx.defaultInstall
  if (!target) return { error: 'Không xác định được thư mục cài' }
  return {
    key: 'squarel:clone',
    squarelDir: true,
    busyText: 'Đang tải Squarel…',
    body: async (taskId, emit, signal) => {
      let argv: string[]
      try {
        argv = cloneArgv(ctx.launcherVersion, target)
      } catch (e) {
        return emit({ taskId, kind: 'error', text: msg(e) })
      }
      const problem = await checkCloneTarget(target, ctx.d)
      if (problem) return emit({ taskId, kind: 'error', text: problem })
      const parent = dirname(target)
      await ctx.d.fs.mkdir(parent, { recursive: true })
      // The target was absent or empty, so anything in it now came from this clone.
      const cleanup = () => ctx.d.fs.rm(target, { recursive: true, force: true }).catch(() => {})
      let missingTag = false
      const watch: Emit = (e) => {
        if (e.kind === 'line' && /Remote branch .* not found/i.test(e.text ?? '')) missingTag = true
        emit(e)
      }
      const timeout = AbortSignal.timeout(CLONE_MS)
      const code = await runStep(
        taskId,
        argv,
        parent,
        watch,
        ctx.d,
        GIT_ENV,
        signal ? AbortSignal.any([timeout, signal]) : timeout,
      )
      if (code !== 0) {
        await cleanup()
        return emit({
          taskId,
          kind: 'error',
          code,
          text: missingTag
            ? `Chưa có bản Squarel v${ctx.launcherVersion} trên GitHub. Hãy clone repo bằng git rồi chọn "Dùng repo đã clone".`
            : code === -1
              ? 'Tải Squarel quá lâu hoặc bị dừng; đã xoá phần tải dở.'
              : `Tải Squarel thất bại (mã thoát ${code})`,
        })
      }
      try {
        const pkg = JSON.parse(String(await ctx.d.fs.readFile(join(target, 'package.json'), 'utf8')))
        if (pkg?.name !== 'squarel-art') throw new Error('not squarel')
      } catch {
        await cleanup()
        return emit({ taskId, kind: 'error', text: 'Bản tải về không phải Squarel (package.json); đã xoá.' })
      }
      await ctx.setState({ squarelDir: target, mode: 'fresh' })
      emit({ taskId, kind: 'done', code: 0, text: `Đã tải Squarel vào ${target}` })
    },
  }
}

export function resolveAction(ref: ActionRef, ctx: ActionCtx): Resolved {
  const { componentId: cid, kind, id } = ref
  const unsupported = { error: 'Thao tác không được hỗ trợ' }

  const coreInstall = resolveCoreInstall(ref, ctx)
  if (coreInstall) return coreInstall

  if (cid === 'launcher') {
    if (kind !== 'update' || id !== 'install') return unsupported
    const ready = ctx.launcherUpdateReady
    const install = ctx.installLauncherUpdate
    if (!ready || !install) return { error: 'Bản cập nhật launcher chưa tải xong' }
    return {
      key: 'launcher:install',
      body: async (taskId, emit) => {
        emit({ taskId, kind: 'done', code: 0, text: `Khởi động lại để cài launcher v${ready}…` })
        install()
      },
    }
  }

  if (cid === 'settings') {
    if (kind === 'fix' && id === 'open-settings')
      // Navigation happens in the renderer; main only acknowledges so a fix button can await it.
      return { key: 'settings:open', body: async (taskId, emit) => emit({ taskId, kind: 'done', code: 0 }) }
    return unsupported
  }

  if (cid === 'squarel') {
    if (kind === 'fix' && id === 'register-mcp') {
      const dir = ctx.state.squarelDir
      if (!dir) return { error: 'Chưa chọn thư mục Squarel' }
      return {
        key: 'squarel:register-mcp',
        squarelDir: true,
        body: async (taskId, emit) => {
          const r = await registerMcp(dir, ctx.d)
          for (const text of r.output.split(/\r?\n/).filter(Boolean))
            emit({ taskId, kind: 'line', text: maskCredentials(text) })
          emit(
            r.ok
              ? { taskId, kind: 'done', code: 0, text: 'Đã đăng ký Squarel với Claude Code' }
              : { taskId, kind: 'error', text: 'Đăng ký Squarel với Claude Code thất bại' },
          )
        },
      }
    }
    if (kind === 'update' && id === 'update') return squarelUpdate(ctx)
    if (kind === 'install' && id === 'clone') return cloneSquarel(ctx)
    const dir = ctx.state.squarelDir
    if (kind === 'install' && id === 'deps') {
      if (!dir) return { error: 'Chưa chọn thư mục Squarel' }
      return {
        key: 'squarel:deps',
        squarelDir: true,
        busyText: 'Đang cài thư viện Squarel…',
        body: async (taskId, emit, signal) => {
          const code = await withBridgePaused(ctx, taskId, emit, () =>
            runStep(taskId, ['pnpm', 'install'], dir, emit, ctx.d, undefined, signal),
          )
          emit(
            code === 0
              ? { taskId, kind: 'done', code: 0, text: 'Đã cài thư viện' }
              : { taskId, kind: 'error', code, text: `pnpm install thất bại (mã thoát ${code})` },
          )
        },
      }
    }
    if (kind === 'fix' && id === 'copy-skills') {
      if (!dir) return { error: 'Chưa chọn thư mục Squarel' }
      return {
        key: 'squarel:skills',
        body: async (taskId, emit) => {
          const names = await copySkills(dir, ctx.homeDir, ctx.d)
          if (names.length === 0)
            return emit({ taskId, kind: 'error', text: 'Không tìm thấy skill nào trong Squarel' })
          emit({ taskId, kind: 'done', code: 0, text: `Đã chép ${names.length} skill: ${names.join(', ')}` })
        },
      }
    }
    return unsupported
  }

  const integration = ctx.reg.integrations.find((x) => x.manifest.id === cid)
  if (!integration) return unsupported
  const m = integration.manifest

  if (kind === 'extension' && id === 'install') {
    const task = m.extension?.install
    if (!task) return unsupported
    const i = selectedIntegration(ctx, cid)
    if (typeof i === 'string') return { error: i }
    return {
      key: `${cid}:extension`,
      squarelDir: i.source === 'squarel',
      body: (taskId, emit, signal) =>
        runManifestCommand(
          taskId,
          emit,
          ctx,
          i,
          task.run,
          { toolsDir: ctx.toolsDir(cid) },
          `Cài extension ${m.name}`,
          task.requiresClosed,
          signal,
        ),
    }
  }

  if (kind === 'update' && id === 'update') {
    const repo = m.latest?.repo
    if (!m.update || !repo) return unsupported
    const i = selectedIntegration(ctx, cid)
    if (typeof i === 'string') return { error: i }
    return {
      key: `${cid}:update`,
      squarelDir: i.source === 'squarel',
      busyText: `${m.name} đang cập nhật…`,
      body: async (taskId, emit, signal) => {
        const latest = await latestGitTag(repo, ctx.d)
        if (!latest.ok)
          return emit({ taskId, kind: 'error', text: `Không lấy được phiên bản mới: ${latest.message}` })
        // latestGitTag strips the "v"; `{version}` is a release ref (e.g. aseprite:build --ref v1.3.19).
        const r = await applyToolUpdate(
          i,
          `v${latest.version}`,
          {
            ...(signal ? { signal } : {}),
            squarelDir: ctx.state.squarelDir ?? '',
            toolsDir: ctx.toolsDir(cid),
            selected: ctx.state.selected,
            onEvent: withProgress(emit),
            taskId,
          },
          ctx.d,
        )
        if (r.blocked) emit({ taskId, kind: 'error', text: r.blocked })
      },
    }
  }

  if (kind === 'launch') {
    const a = m.launch.find((x) => x.id === id)
    if (!a) return unsupported
    const i = selectedIntegration(ctx, cid)
    if (typeof i === 'string') return { error: i }
    return {
      key: `${cid}:launch:${id}`,
      body: (taskId, emit) => runLaunch(taskId, emit, ctx, i, a, ref.project),
    }
  }

  if (kind === 'install') {
    const opt = m.install.find((o) => o.id === id)
    if (!opt?.run)
      return opt ? { error: 'Cách cài này chọn file trong giao diện, không chạy lệnh' } : unsupported
    const run = opt.run
    const i = selectedIntegration(ctx, cid)
    if (typeof i === 'string') return { error: i }
    return {
      key: `${cid}:install`,
      squarelDir: i.source === 'squarel',
      busyText: `${m.name} đang ${run.some((a) => /build/i.test(a)) ? 'build' : 'cài'}…`,
      body: (taskId, emit, signal) =>
        runManifestCommand(
          taskId,
          emit,
          ctx,
          i,
          run,
          { toolsDir: ctx.toolsDir(cid) },
          `Cài ${m.name}`,
          undefined,
          signal,
        ),
    }
  }

  return unsupported
}
