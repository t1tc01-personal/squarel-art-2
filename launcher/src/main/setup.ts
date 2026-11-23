/**
 * First-run setup (spec §9): which wizard step to show, what to install, and the exact commands.
 *
 * Installs never run hidden: winget and the Claude Code installer open in their own visible
 * terminal window (`cmd /c start`), where the user answers admin prompts and license questions
 * themselves. No `--accept-*` flag is ever passed. Without winget the launcher only opens the
 * official download page in the browser; it never downloads or starts an installer itself.
 */
import { tmpdir } from 'node:os'
import { isAbsolute } from 'node:path'
import type { ActionRef, ComponentView } from '../shared/model'
import type { Deps } from './deps'
import { CORE, type InstallSpec } from './registry/core'
import { wingetCommand } from './registry/registry'
import type { LauncherState } from './state'
import { system32 as system32In } from './system-root'
import { releaseTag } from './updates/squarel'

export const SQUAREL_REPO = 'https://github.com/t1tc01-personal/squarel-art-2.git'

/** The official Claude Code installer, run in a visible PowerShell window (spec §9). */
export const CLAUDE_INSTALL_COMMAND = 'irm https://claude.ai/install.ps1 | iex'

/** Official pages for installing by hand (no winget). Fixed table: the renderer only names the id. */
export const OFFICIAL_DOWNLOADS: Readonly<Record<string, string>> = {
  /** App Installer (contains winget) in the Microsoft Store. */
  winget: 'https://apps.microsoft.com/detail/9nblggh4nns1',
  git: 'https://git-scm.com/downloads/win',
  node: 'https://nodejs.org/en/download',
  pnpm: 'https://pnpm.io/installation',
  'claude-code': 'https://docs.anthropic.com/en/docs/claude-code/setup',
  'vs-build-tools': 'https://visualstudio.microsoft.com/visual-cpp-build-tools/',
}

/** Aseprite EULA: self-built copies are for personal use only and must not be redistributed. */
export const ASEPRITE_EULA = 'https://github.com/aseprite/aseprite/blob/main/EULA.txt'

const TERMINAL_TITLE = 'Squarel Art Launcher'

// ---- which step ----------------------------------------------------------------------------

export interface SetupFacts {
  squarelOk: boolean
  /** Ids of required components that are missing or too old (+ 'squarel-deps' without node_modules). */
  requiredMissing: string[]
}

/** Required tools besides the launcher itself and Squarel (which `squarelOk` covers). */
export function setupFacts(views: ComponentView[], depsInstalled: boolean): SetupFacts {
  const squarelOk = !!views.find((v) => v.id === 'squarel')?.installed
  const requiredMissing = views
    .filter((v) => v.kind === 'core' && v.required && v.id !== 'launcher' && v.id !== 'squarel')
    .filter((v) => !v.installed || v.level === 'error')
    .map((v) => v.id)
  if (squarelOk && !depsInstalled) requiredMissing.push('squarel-deps')
  return { squarelOk, requiredMissing }
}

/** Without these Squarel cannot run at all: a finished setup goes back to step 2. */
const BLOCKING_DONE = ['node', 'git', 'pnpm']
/** Steps 3–4 also need the libraries; Claude Code can be installed later (Health shows it). */
const BLOCKING_STEPS = [...BLOCKING_DONE, 'squarel-deps']

/**
 * The step to show: the saved one (closing mid-way resumes there), except that
 * - a finished setup whose Squarel folder is gone starts over at step 1,
 * - a finished setup with Node, Git or pnpm missing goes back to step 2 (a missing Claude Code
 *   only shows in Health and Connections),
 * - steps 3–4 with Squarel, Node, Git, pnpm or the libraries missing go back to step 2,
 * - no install mode chosen yet means step 1.
 */
export function nextSetupStep(state: LauncherState, facts: SetupFacts): LauncherState['setupStep'] {
  const s = state.setupStep
  const missing = (ids: string[]) => facts.requiredMissing.some((id) => ids.includes(id))
  if (s === 'done') {
    if (!facts.squarelOk) return 1
    return missing(BLOCKING_DONE) ? 2 : 'done'
  }
  if (s === 1) return 1
  if (!state.mode && !facts.squarelOk) return 1
  if (s >= 3 && (!facts.squarelOk || missing(BLOCKING_STEPS))) return 2
  return s
}

/** Step 2 is satisfied: Squarel, Node, Git, pnpm and the libraries are there. */
export function step2Done(facts: SetupFacts): boolean {
  return facts.squarelOk && !facts.requiredMissing.some((id) => BLOCKING_STEPS.includes(id))
}

// ---- what to install -----------------------------------------------------------------------

/**
 * Absolute path of winget.exe on PATH, or undefined when there is none or when the path cannot be
 * passed through the visible terminal window safely (SAFE_ITEM, e.g. a user folder with `'` or `(`).
 */
export function wingetPath(d: Deps): string | undefined {
  const exe = d.which('winget')
  return exe && isAbsolute(exe) && /\\winget\.exe$/i.test(exe) && SAFE_ITEM.test(exe) ? exe : undefined
}

/** winget usable for installs: found at a safe path and `winget --version` works. */
export async function hasWinget(d: Deps): Promise<boolean> {
  if (!wingetPath(d)) return false
  try {
    const { code } = await d.run({
      argv: ['winget', '--version'],
      cwd: tmpdir(),
      signal: AbortSignal.timeout(10_000),
    })
    return code === 0
  } catch {
    return false
  }
}

const PLAN_ORDER = ['git', 'node', 'pnpm', 'claude-code'] as const

/**
 * Install actions for the missing (or too old) base tools, in order. Every action is a
 * `terminal` action: winget in a visible window, or (no winget) the official download page.
 */
export function installPlan(views: ComponentView[], winget: boolean): ActionRef[] {
  const plan: ActionRef[] = []
  for (const id of PLAN_ORDER) {
    const v = views.find((x) => x.id === id)
    if (!v || (v.installed && v.level !== 'error')) continue
    const spec = CORE.find((c) => c.id === id)?.install
    if (id === 'claude-code') {
      plan.push({
        componentId: id,
        kind: 'terminal',
        id: 'terminal',
        label: 'Mở PowerShell để cài',
        needsConsent: { command: CLAUDE_INSTALL_COMMAND },
      })
    } else if (winget && spec?.winget) {
      plan.push({
        componentId: id,
        kind: 'terminal',
        id: 'winget',
        label: 'Cài',
        needsConsent: { command: wingetCommand(spec), ...(spec.sizeHint ? { sizeHint: spec.sizeHint } : {}) },
      })
    } else {
      plan.push({ componentId: id, kind: 'terminal', id: 'download', label: 'Mở trang tải' })
    }
  }
  if (!winget && plan.some((a) => a.id === 'download'))
    plan.unshift({
      componentId: 'winget',
      kind: 'terminal',
      id: 'download',
      label: 'Mở Microsoft Store',
    })
  return plan
}

// ---- visible terminal ----------------------------------------------------------------------

function envGet(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const k = Object.keys(env).find((x) => x.toUpperCase() === key.toUpperCase())
  return k ? env[k] : undefined
}

/** `%SystemRoot%\System32\<name>`; never taken from ComSpec or PATH. */
function system32(d: Deps, name: string): string {
  return system32In(d.env, name)
}

/**
 * Plain tokens only: the inner command line is parsed by cmd.exe again (`start` → `cmd /k`), so
 * nothing that cmd treats specially may appear. Spaces are allowed (libuv quotes such items).
 */
const SAFE_ITEM = /^[A-Za-z0-9 _.:\\/+=-]+$/

/**
 * argv that opens `inner` in a new, visible console window: `cmd.exe /d /c start "<title>" …`.
 * The window stays until the user closes it, so they see every prompt and the result.
 */
export function terminalArgv(d: Deps, inner: string[], allowPipe = false): string[] {
  return terminalArgvWith(d, inner, (a) => SAFE_ITEM.test(a) || (allowPipe && a === CLAUDE_INSTALL_COMMAND))
}

/**
 * Like SAFE_ITEM, but letters and digits of any script (a Vietnamese folder name): still none of
 * cmd's special characters (`& | < > ^ % ! " ' ( ) ;` …), so the re-parse by cmd cannot split it.
 */
export const SAFE_PATH_ITEM = /^[\p{L}\p{M}\p{N} _.:\\/+=-]+$/u

/** terminalArgv with the caller's rule for which inner items are safe. */
export function terminalArgvWith(d: Deps, inner: string[], isSafe: (a: string) => boolean): string[] {
  if (inner.length === 0) throw new Error('Lệnh rỗng')
  for (const a of inner) {
    if (!isSafe(a)) throw new Error(`Tham số không an toàn cho cửa sổ lệnh: ${JSON.stringify(a)}`)
  }
  return [system32(d, 'cmd.exe'), '/d', '/c', 'start', TERMINAL_TITLE, ...inner]
}

const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9.+-]{0,127}$/
const OVERRIDE = /^[A-Za-z0-9 .-]{1,1000}$/

/**
 * `<winget.exe> install --id <id> -e [--override …]` inside `cmd /k`; no `--accept-*`, no silent
 * flags. `wingetExe` is the absolute path found on PATH (never a bare name cmd would search).
 */
export function wingetTerminalArgv(d: Deps, spec: InstallSpec, wingetExe: string): string[] {
  if (!spec.winget || !PACKAGE_ID.test(spec.winget)) throw new Error('Mã gói winget không hợp lệ')
  if (spec.override !== undefined && !OVERRIDE.test(spec.override))
    throw new Error('Tham số --override không hợp lệ')
  if (!isAbsolute(wingetExe) || !/\\winget\.exe$/i.test(wingetExe))
    throw new Error('Đường dẫn winget không hợp lệ')
  const winget = [wingetExe, 'install', '--id', spec.winget, '-e']
  if (spec.override) winget.push('--override', spec.override)
  // `call` keeps cmd from stripping the outer quotes when the exe path and --override both have spaces.
  return terminalArgv(d, [system32(d, 'cmd.exe'), '/d', '/k', 'call', ...winget])
}

/** The official Claude Code installer in a PowerShell window that stays open. */
export function claudeTerminalArgv(d: Deps): string[] {
  return terminalArgv(
    d,
    [
      system32(d, 'WindowsPowerShell\\v1.0\\powershell.exe'),
      '-NoExit',
      '-NoProfile',
      '-Command',
      CLAUDE_INSTALL_COMMAND,
    ],
    true,
  )
}

// ---- clone ---------------------------------------------------------------------------------

/** `git clone` of the launcher's own release tag; throws when the version is not a release tag. */
export function cloneArgv(launcherVersion: string, target: string): string[] {
  const tag = releaseTag(launcherVersion.trim())
  return ['git', 'clone', '--branch', tag, '--depth', '1', '--', SQUAREL_REPO, target]
}

/** Why the clone target cannot be used (undefined = absent or empty, fine). */
export async function checkCloneTarget(target: string, d: Deps): Promise<string | undefined> {
  if (!isAbsolute(target) || /^[\\/]{2}/.test(target))
    return 'Thư mục cài phải là đường dẫn tuyệt đối trên máy'
  try {
    const names = await d.fs.readdir(target)
    if (names.length > 0) return `Thư mục ${target} không trống; hãy dọn trống hoặc chọn "Dùng repo đã clone"`
  } catch (e) {
    const code = (e as NodeJS.ErrnoException)?.code
    if (code !== 'ENOENT') return `Không đọc được thư mục ${target} (${code ?? 'lỗi'})`
  }
  return undefined
}

// ---- PATH after an install -----------------------------------------------------------------

const REG_KEYS = [
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
  'HKCU\\Environment',
]

/**
 * Tools installed in another window only show up in a fresh PATH: re-read the machine and user
 * PATH from the registry (as a new process would) and use it for the launcher's own commands.
 */
export async function refreshPath(d: Deps): Promise<void> {
  if (d.platform !== 'win32') return
  const parts: string[] = []
  for (const key of REG_KEYS) {
    const lines: string[] = []
    try {
      const { code } = await d.run({
        argv: [system32(d, 'reg.exe'), 'query', key, '/v', 'Path'],
        cwd: tmpdir(),
        onLine: (l) => lines.push(l),
        signal: AbortSignal.timeout(5000),
      })
      if (code !== 0) continue
    } catch {
      continue
    }
    const m = lines.map((l) => /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/i.exec(l)).find(Boolean)
    if (m?.[1]) parts.push(m[1].replace(/%([^%]+)%/g, (all, v: string) => envGet(d.env, v) ?? all))
  }
  if (parts.length === 0) return
  const key = Object.keys(d.env).find((k) => k.toUpperCase() === 'PATH') ?? 'Path'
  d.env[key] = mergePath(parts.join(';'), d.env[key] ?? '')
}

/**
 * Registry PATH first, then whatever the launcher's own PATH had on top (e.g. entries its parent
 * added); duplicates dropped case-insensitively, ignoring a trailing backslash.
 */
export function mergePath(fromRegistry: string, current: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...fromRegistry.split(';'), ...current.split(';')]) {
    const p = raw.trim()
    const k = p.replace(/[\\/]+$/, '').toLowerCase()
    if (!p || seen.has(k)) continue
    seen.add(k)
    out.push(p)
  }
  return out.join(';')
}
