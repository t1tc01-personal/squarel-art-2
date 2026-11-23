/**
 * Tool (integration) updates. The command comes only from the loaded manifest of a selected
 * integration (`update.run`), with variables filled by `substitute`; nothing from the network runs.
 */
import { substitute } from '@squarel/integration-schema'
import type { TaskEvent } from '../../shared/model'
import type { Deps } from '../deps'
import type { LoadedIntegration } from '../registry/registry'

export interface UpdateCtx {
  squarelDir: string
  /** Per-tool folder (`{toolsDir}`), e.g. %LOCALAPPDATA%\SquarelArt\tools\<id>. */
  toolsDir: string
  /** Integrations the user chose (ruling B7): others are never run. */
  selected: string[]
  onEvent: (e: TaskEvent) => void
  taskId?: string
}

const IMAGE_NAME = /^[\w.-]+\.exe$/i
/** A release tag or version; never starts with "-" so it cannot become an option. */
const TOOL_VERSION = /^v?\d+(\.\d+){1,3}(-[0-9A-Za-z.-]+)?$/

/** Hides credentials embedded in URLs (`https://user:token@host` → `https://***@host`). */
export function maskCredentials(text: string): string {
  return text.replace(/\/\/[^/@\s]+@/g, '//***@')
}

/** " Đóng <exe> trước rồi thử lại." when the task declares a valid `requiresClosed`, else "". */
export function closeHint(requiresClosed: string | undefined): string {
  return requiresClosed && IMAGE_NAME.test(requiresClosed) ? ` Đóng ${requiresClosed} trước rồi thử lại.` : ''
}

/** Display form of an argv (for the task log only; never executed). */
export function showArgv(argv: string[]): string {
  return argv.map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ')
}

/** Folder a manifest command runs from: the Squarel folder or the user integration's own folder. */
export function manifestCwd(i: LoadedIntegration, squarelDir: string): string {
  return i.source === 'user' ? i.dir : squarelDir
}

/** Why `requiresClosed` blocks the command now, or undefined when it may run. */
export async function closedBlocker(
  requiresClosed: string | undefined,
  d: Deps,
): Promise<string | undefined> {
  if (!requiresClosed) return undefined
  if (!IMAGE_NAME.test(requiresClosed)) return `Tên tiến trình không hợp lệ: ${requiresClosed}`
  try {
    if (await d.isProcessRunning(requiresClosed)) return `Đóng ${requiresClosed} trước`
  } catch (e) {
    return `Không kiểm tra được ${requiresClosed} có đang chạy: ${String((e as Error)?.message ?? e)}`
  }
  return undefined
}

/** Runs one step, streaming its output as `line` events; resolves with the exit code (-1 if it could not start). */
export async function runStep(
  taskId: string,
  argv: string[],
  cwd: string,
  onEvent: (e: TaskEvent) => void,
  d: Deps,
  env?: Record<string, string>,
  signal?: AbortSignal,
): Promise<number> {
  onEvent({ taskId, kind: 'line', text: `> ${showArgv(argv)}` })
  try {
    const { code } = await d.run({
      argv,
      cwd,
      ...(env ? { env } : {}),
      ...(signal ? { signal } : {}),
      onLine: (text) => onEvent({ taskId, kind: 'line', text: maskCredentials(text) }),
    })
    return code
  } catch (e) {
    onEvent({ taskId, kind: 'line', text: maskCredentials(String((e as Error)?.message ?? e)) })
    return -1
  }
}

export async function applyToolUpdate(
  i: LoadedIntegration,
  version: string,
  ctx: UpdateCtx,
  d: Deps,
): Promise<{ blocked?: string }> {
  const m = i.manifest
  const taskId = ctx.taskId ?? `update:${m.id}`
  if (i.incompatible) return { blocked: i.incompatible }
  if (!ctx.selected.includes(m.id)) return { blocked: `Chưa chọn tích hợp ${m.name}` }
  if (!m.update) return { blocked: `${m.name} không khai báo lệnh cập nhật` }
  if (!TOOL_VERSION.test(version)) return { blocked: `Phiên bản không hợp lệ: ${version}` }
  const why = await closedBlocker(m.update.requiresClosed, d)
  if (why) return { blocked: why }
  let argv: string[]
  try {
    argv = m.update.run.map((a) => substitute(a, { toolsDir: ctx.toolsDir, version }))
  } catch (e) {
    return { blocked: `Lệnh cập nhật không hợp lệ: ${String((e as Error)?.message ?? e)}` }
  }
  const code = await runStep(taskId, argv, manifestCwd(i, ctx.squarelDir), ctx.onEvent, d)
  if (code === 0) ctx.onEvent({ taskId, kind: 'done', code: 0, text: `Đã cập nhật ${m.name}` })
  else
    ctx.onEvent({
      taskId,
      kind: 'error',
      code,
      text: `Cập nhật ${m.name} thất bại (mã thoát ${code}).${closeHint(m.update.requiresClosed)}`,
    })
  return {}
}
