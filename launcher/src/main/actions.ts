/**
 * `action:run` dispatch. Only ActionRefs listed here run; the command always comes from the
 * launcher's own code or from the loaded manifest of a selected integration, never from the
 * ActionRef itself (its `label` / `needsConsent` are display-only and ignored here).
 *
 * Supported now: settings/fix/open-settings, squarel/fix/register-mcp, squarel/update/update,
 * <integration>/extension/install, <integration>/update/update, <integration>/install/<option with run>,
 * <integration>/launch/<launch id>.
 * Not yet: core installs (winget / terminal) — T14 adds them here.
 */
import { dirname } from 'node:path'
import { substitute } from '@squarel/integration-schema'
import type { ActionRef, TaskEvent } from '../shared/model'
import { registerMcp } from './claude'
import type { Deps } from './deps'
import type { EnvDoc } from './env-store'
import { detectIntegration, type LoadedIntegration, type Registry } from './registry/registry'
import { parseProgressLine } from './run'
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
export type ActionBody = (taskId: string, emit: Emit) => Promise<void>

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
}

/**
 * `squarelDir: true` = the task runs in or changes the Squarel folder; at most one such task runs
 * at a time (a git checkout must never race a `pnpm install` or an extension build).
 */
export type Resolved = { key: string; body: ActionBody; squarelDir?: boolean } | { error: string }

const msg = (e: unknown) => maskCredentials(String((e as Error)?.message ?? e))

/** Squarel update task (also used by `updates:apply`). */
export function squarelUpdate(ctx: ActionCtx): Resolved {
  const dir = ctx.state.squarelDir
  if (!dir) return { error: 'Chưa chọn thư mục Squarel' }
  return {
    key: 'squarel:update',
    squarelDir: true,
    body: async (taskId, emit) => {
      // TODO(T15): stop the launcher's own bridge before moving the Squarel checkout, restart after.
      let plan: Awaited<ReturnType<typeof planSquarelUpdate>>
      try {
        plan = await planSquarelUpdate(dir, ctx.launcherVersion, ctx.d, { isDev: ctx.isDev })
      } catch (e) {
        return emit({ taskId, kind: 'error', text: msg(e) })
      }
      await applySquarelUpdate(
        plan,
        { squarelDir: dir, reg: ctx.reg, selected: ctx.state.selected, onEvent: emit, taskId },
        ctx.d,
      )
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

/** Turns `@@progress {json}` output lines into progress events. */
function withProgress(emit: Emit): Emit {
  return (e) => {
    const p = e.kind === 'line' && e.text ? parseProgressLine(e.text) : undefined
    if (!p) return emit(e)
    const percent = p.percent ?? (p.total > 0 ? Math.round((p.step / p.total) * 100) : undefined)
    emit({ taskId: e.taskId, kind: 'progress', text: p.label, ...(percent !== undefined ? { percent } : {}) })
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
      const text = await ctx.bridgeTool(a.bridgeTool, { project: slug })
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

export function resolveAction(ref: ActionRef, ctx: ActionCtx): Resolved {
  const { componentId: cid, kind, id } = ref
  const unsupported = { error: 'Thao tác không được hỗ trợ' }

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
      body: (taskId, emit) =>
        runManifestCommand(
          taskId,
          emit,
          ctx,
          i,
          task.run,
          { toolsDir: ctx.toolsDir(cid) },
          `Cài extension ${m.name}`,
          task.requiresClosed,
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
      body: async (taskId, emit) => {
        const latest = await latestGitTag(repo, ctx.d)
        if (!latest.ok)
          return emit({ taskId, kind: 'error', text: `Không lấy được phiên bản mới: ${latest.message}` })
        const r = await applyToolUpdate(
          i,
          latest.version,
          {
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
      body: (taskId, emit) =>
        runManifestCommand(taskId, emit, ctx, i, run, { toolsDir: ctx.toolsDir(cid) }, `Cài ${m.name}`),
    }
  }

  return unsupported
}
