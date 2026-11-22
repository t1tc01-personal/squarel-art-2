/**
 * Squarel updates (spec §6, §11). The target is always the tag of the launcher's own version
 * (`v<launcherVersion>`), never a newer tag. A clone that follows a branch is fast-forwarded,
 * uncommitted changes block, and a launcher running from source never moves the repo.
 */
import { substitute } from '@squarel/integration-schema'
import type { TaskEvent } from '../../shared/model'
import type { Deps } from '../deps'
import { appPaths } from '../paths'
import type { Registry } from '../registry/registry'
import { closedBlocker, manifestCwd, runStep, showArgv } from './tools'

export type SquarelPlan =
  | { kind: 'tag'; from?: string; to: string }
  | { kind: 'branch'; branch: string }
  | { kind: 'blocked'; reason: 'dirty' | 'not-a-repo'; message: string }
  | { kind: 'none' }

const RELEASE_TAG = /^v\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
/** Never wait for credentials: an update must fail instead of hanging. */
const GIT_ENV = { GIT_TERMINAL_PROMPT: '0' }
const STATUS = ['git', 'status', '--porcelain', '--untracked-files=no']
const DIRTY_MSG = 'Thư mục Squarel có thay đổi chưa commit. Hãy commit hoặc bỏ các thay đổi rồi cập nhật lại.'

/** `v<version>` after checking it is a plain release tag (it is passed to git). */
function releaseTag(version: string): string {
  const tag = `v${version}`
  if (!RELEASE_TAG.test(tag)) throw new Error(`Phiên bản không hợp lệ cho tag: ${JSON.stringify(version)}`)
  return tag
}

async function git(args: string[], cwd: string, d: Deps): Promise<{ code: number; lines: string[] }> {
  const lines: string[] = []
  try {
    const { code } = await d.run({
      argv: ['git', ...args],
      cwd,
      env: GIT_ENV,
      onLine: (l) => lines.push(l),
      signal: AbortSignal.timeout(30_000),
    })
    return { code, lines }
  } catch (e) {
    return { code: -1, lines: [String((e as Error)?.message ?? e)] }
  }
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string) => {
    const s = p.trim().replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? s.toLowerCase() : s
  }
  return norm(a) === norm(b)
}

export async function planSquarelUpdate(
  squarelDir: string,
  launcherVersion: string,
  d: Deps,
  opts: { isDev?: boolean } = {},
): Promise<SquarelPlan> {
  if (opts.isDev) return { kind: 'none' }
  const to = launcherVersion.trim()
  releaseTag(to)

  const top = await git(['rev-parse', '--show-toplevel'], squarelDir, d)
  if (top.code !== 0 || !top.lines[0] || !samePath(top.lines[0], squarelDir, d.platform))
    return {
      kind: 'blocked',
      reason: 'not-a-repo',
      message: 'Thư mục Squarel không phải bản clone git nên không cập nhật được bằng git.',
    }

  const head = await git(['rev-parse', '--abbrev-ref', 'HEAD'], squarelDir, d)
  const ref = head.lines[0]?.trim()
  if (head.code !== 0 || !ref)
    return { kind: 'blocked', reason: 'not-a-repo', message: 'Không đọc được nhánh hiện tại của Squarel.' }

  let plan: SquarelPlan
  if (ref !== 'HEAD') {
    plan = { kind: 'branch', branch: ref }
  } else {
    const desc = await git(['describe', '--tags', '--exact-match', 'HEAD'], squarelDir, d)
    const current = desc.code === 0 ? desc.lines[0]?.trim() : undefined
    const from = current && RELEASE_TAG.test(current) ? current.slice(1) : undefined
    if (from === to) return { kind: 'none' }
    plan = from ? { kind: 'tag', from, to } : { kind: 'tag', to }
  }

  const status = await git(STATUS.slice(1), squarelDir, d)
  if (status.code !== 0)
    return { kind: 'blocked', reason: 'not-a-repo', message: 'Không đọc được trạng thái git của Squarel.' }
  if (status.lines.some((l) => l.trim() !== ''))
    return { kind: 'blocked', reason: 'dirty', message: DIRTY_MSG }
  return plan
}

/**
 * fetch --tags → checkout v{to} (or pull --ff-only on a branch) → pnpm install → extension.install
 * of the selected integrations. Streams TaskEvents and ends with exactly one `done` or `error`.
 */
export async function applySquarelUpdate(
  plan: SquarelPlan,
  ctx: {
    squarelDir: string
    reg: Registry
    /** Selected integration ids (ruling B7): only their extensions are reinstalled. */
    selected: string[]
    onEvent: (e: TaskEvent) => void
    taskId?: string
  },
  d: Deps,
): Promise<void> {
  const taskId = ctx.taskId ?? 'update:squarel'
  const emit = ctx.onEvent
  const fail = (text: string, code?: number) =>
    emit({ taskId, kind: 'error', text, ...(code !== undefined ? { code } : {}) })
  if (plan.kind === 'none')
    return emit({ taskId, kind: 'done', code: 0, text: 'Squarel đã ở đúng phiên bản' })
  if (plan.kind === 'blocked') return fail(plan.message)

  let gitSteps: string[][]
  try {
    gitSteps =
      plan.kind === 'tag'
        ? [
            ['git', 'fetch', '--tags'],
            ['git', 'checkout', '--detach', `refs/tags/${releaseTag(plan.to)}`],
          ]
        : [['git', 'pull', '--ff-only']]
  } catch (e) {
    return fail(String((e as Error)?.message ?? e))
  }

  const exts = ctx.reg.integrations.filter(
    (i) => ctx.selected.includes(i.manifest.id) && !i.incompatible && i.manifest.extension,
  )
  const total = gitSteps.length + 1 + exts.length
  let done = 0
  const progress = () => emit({ taskId, kind: 'progress', percent: Math.round((++done / total) * 100) })

  // The plan may be stale: never touch a tree that became dirty since it was made.
  const status = await git(STATUS.slice(1), ctx.squarelDir, d)
  if (status.code !== 0 || status.lines.some((l) => l.trim() !== ''))
    return fail(status.code !== 0 ? 'Không đọc được trạng thái git của Squarel.' : DIRTY_MSG)

  for (const argv of [...gitSteps, ['pnpm', 'install']]) {
    const env = argv[0] === 'git' ? GIT_ENV : undefined
    const code = await runStep(taskId, argv, ctx.squarelDir, emit, d, env)
    if (code !== 0) return fail(`${showArgv(argv)} thất bại (mã thoát ${code})`, code)
    progress()
  }

  let skipped = 0
  for (const i of exts) {
    const task = i.manifest.extension?.install
    if (!task) continue
    const why = await closedBlocker(task.requiresClosed, d)
    if (why) {
      skipped++
      emit({
        taskId,
        kind: 'line',
        text: `Bỏ qua cài lại extension ${i.manifest.name}: ${why}, rồi cài lại ở trang ${i.manifest.name}.`,
      })
      progress()
      continue
    }
    let toolsDir: string | undefined
    try {
      toolsDir = appPaths(d.env).toolsDir(i.manifest.id)
    } catch {}
    let argv: string[]
    try {
      argv = task.run.map((a) => substitute(a, toolsDir ? { toolsDir } : {}))
    } catch (e) {
      skipped++
      emit({
        taskId,
        kind: 'line',
        text: `Bỏ qua extension ${i.manifest.name}: ${String((e as Error)?.message ?? e)}`,
      })
      progress()
      continue
    }
    const code = await runStep(taskId, argv, manifestCwd(i, ctx.squarelDir), emit, d)
    if (code !== 0) return fail(`Cài lại extension ${i.manifest.name} thất bại (mã thoát ${code})`, code)
    progress()
  }
  emit({
    taskId,
    kind: 'done',
    code: 0,
    text: skipped ? `Đã cập nhật Squarel; ${skipped} extension chưa cài lại` : 'Đã cập nhật Squarel',
  })
}
