/**
 * Safe command runner: the only place the launcher starts external programs
 * (winget, git, pnpm, node, claude, tool executables).
 *
 * Rules:
 * - argv is always an array; nothing is ever handed to a shell as a string.
 * - `.exe`/`.com` are spawned directly (shell: false); libuv quotes each argument
 *   for CreateProcess/CommandLineToArgvW, so any string arrives unchanged.
 * - `.cmd`/`.bat` shims cannot be started without cmd.exe. They run as
 *   `cmd.exe /d /s /v:off /c "<line>"` where every part of <line> went through
 *   quoteForCmd. That line is parsed twice: once by `cmd /c` and again by the
 *   shim when it expands `%*` (BatBadBut, CVE-2024-27980), so quoteForCmd keeps
 *   every metacharacter inside double quotes, where neither parse acts on it.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { extname, isAbsolute, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export interface RunSpec {
  argv: string[]
  cwd: string
  env?: Record<string, string>
  signal?: AbortSignal
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
}

/** Exit code reported when the process was killed through the AbortSignal. */
export const ABORTED_CODE = -1

const IS_WIN = process.platform === 'win32'

/** Case-insensitive env lookup (Windows has `Path`, `PATH`, …). */
function envGet(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key]
  const upper = key.toUpperCase()
  for (const k of Object.keys(env)) if (k.toUpperCase() === upper) return env[k]
  return undefined
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile()
  } catch {
    return false
  }
}

function kindOf(path: string): 'exe' | 'cmd' | undefined {
  const ext = extname(path).toLowerCase()
  if (ext === '.exe' || ext === '.com') return 'exe'
  if (ext === '.cmd' || ext === '.bat') return 'cmd'
  if (!IS_WIN) return 'exe'
  return undefined
}

/**
 * Finds `name` on the PATH of `env` using PATHEXT. Absolute paths are checked as
 * given (PATHEXT is appended when they have no runnable extension). Relative paths
 * containing a separator and the current directory are never searched. Only
 * `.exe`/`.com` (kind 'exe') and `.cmd`/`.bat` (kind 'cmd') are accepted.
 */
export function resolveExecutable(
  name: string,
  env: NodeJS.ProcessEnv,
): { path: string; kind: 'exe' | 'cmd' } | undefined {
  if (!name || name.includes('\0')) return undefined
  const exts = (envGet(env, 'PATHEXT') ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim())
    .filter((e) => e.startsWith('.'))
  const candidates = (base: string): string[] => {
    const list: string[] = []
    if (kindOf(base) && (!IS_WIN || extname(base) !== '')) list.push(base)
    if (IS_WIN) for (const e of exts) list.push(base + e.toLowerCase())
    return list
  }
  const pick = (base: string) => {
    for (const c of candidates(base)) {
      const kind = kindOf(c)
      if (kind && isFile(c)) return { path: c, kind }
    }
    return undefined
  }
  if (isAbsolute(name)) return pick(name)
  if (/[\\/]/.test(name)) return undefined
  const dirs = (envGet(env, 'PATH') ?? '')
    .split(IS_WIN ? ';' : ':')
    .map((d) => d.trim().replace(/^"(.*)"$/, '$1'))
    .filter((d) => d !== '' && isAbsolute(d))
  for (const dir of dirs) {
    const hit = pick(join(dir, name))
    if (hit) return hit
  }
  return undefined
}

/**
 * Quotes one argument for a `cmd.exe /d /s /v:off /c "<line>"` command line that
 * starts a `.cmd`/`.bat` shim.
 *
 * - Rejects `"`, CR, LF and NUL (they cannot be passed through cmd safely).
 * - Returns plain tokens (`[A-Za-z0-9_+\-.:\\/@]+`) unchanged.
 * - Wraps everything else in double quotes. Inside quotes `& | < > ( ) ^ !` and
 *   spaces are literal for cmd /c and stay quoted (so literal) when the shim
 *   re-parses `%*`; `!` is inert because delayed expansion is off (`/v:off`).
 *   Escaping with `^` instead would be unsafe: cmd /c strips the caret and the
 *   shim's re-parse then executes `a&calc`.
 * - `%` expands even inside quotes, so each `%` becomes `%%cd:~,%`: the second `%`
 *   starts `%cd:~,%`, a zero-length substring, which leaves a lone literal `%` that
 *   can no longer pair with a later `%`.
 * - Trailing backslashes are doubled so they do not escape the closing quote when
 *   the target program splits its command line (CommandLineToArgvW rules).
 */
export function quoteForCmd(arg: string): string {
  if (/["\r\n\0]/.test(arg)) {
    throw new Error(
      `Không thể truyền tham số chứa dấu " hoặc xuống dòng qua tệp .cmd: ${JSON.stringify(arg)}`,
    )
  }
  if (/^[A-Za-z0-9_+\-.:\\/@]+$/.test(arg)) return arg
  const body = arg.replace(/%/g, '%%cd:~,%').replace(/(\\+)$/, '$1$1')
  return `"${body}"`
}

/** Builds the env for the child: parent env with overrides replacing keys case-insensitively. */
function mergeEnv(overrides: Record<string, string> | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (!overrides) return env
  for (const [k, v] of Object.entries(overrides)) {
    if (IS_WIN)
      for (const existing of Object.keys(env))
        if (existing.toUpperCase() === k.toUpperCase()) delete env[existing]
    env[k] = v
  }
  return env
}

function systemExe(name: string): string {
  const root = envGet(process.env, 'SystemRoot') ?? 'C:\\Windows'
  return join(root, 'System32', name)
}

/** Kills the child and, on Windows, its whole process tree. */
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (IS_WIN) {
    const killer = spawn(systemExe('taskkill.exe'), ['/T', '/F', '/PID', String(child.pid)], {
      stdio: 'ignore',
      windowsHide: true,
    })
    killer.on('error', () => child.kill())
  } else {
    child.kill('SIGKILL')
  }
}

/** Splits a byte stream into UTF-8 lines (LF or CRLF), flushing the last partial line at the end. */
function lineSplitter(emit: (line: string) => void) {
  const decoder = new StringDecoder('utf8')
  let buf = ''
  const drain = () => {
    let i = buf.indexOf('\n')
    while (i !== -1) {
      emit(buf.slice(0, i).replace(/\r$/, ''))
      buf = buf.slice(i + 1)
      i = buf.indexOf('\n')
    }
  }
  return {
    push(chunk: Buffer) {
      buf += decoder.write(chunk)
      drain()
    },
    end() {
      buf += decoder.end()
      drain()
      if (buf !== '') emit(buf.replace(/\r$/, ''))
      buf = ''
    },
  }
}

/**
 * Runs argv[0] (resolved via PATH/PATHEXT of the effective env) with argv[1..] in
 * `cwd`. Streams stdout/stderr line by line to onLine and resolves with the exit
 * code, or ABORTED_CODE (-1) when the signal aborted it. Rejects when the program
 * or cwd cannot be found or the arguments cannot be passed safely.
 */
export async function runCommand(spec: RunSpec): Promise<{ code: number }> {
  const [program, ...args] = spec.argv
  if (program === undefined || program === '') throw new Error('Lệnh rỗng: thiếu tên chương trình')
  const env = mergeEnv(spec.env)
  const resolved = resolveExecutable(program, env)
  if (!resolved) throw new Error(`Không tìm thấy chương trình "${program}" (ENOENT)`)
  let isDir = false
  try {
    isDir = statSync(spec.cwd).isDirectory()
  } catch {}
  if (!isDir) throw new Error(`Thư mục chạy lệnh không tồn tại: ${spec.cwd}`)

  let file: string
  let fileArgs: string[]
  let verbatim = false
  if (resolved.kind === 'cmd') {
    const line = [resolved.path, ...args].map(quoteForCmd).join(' ')
    file = envGet(env, 'ComSpec') ?? systemExe('cmd.exe')
    if (!isAbsolute(file)) file = systemExe('cmd.exe')
    fileArgs = ['/d', '/s', '/v:off', '/c', `"${line}"`]
    verbatim = true
  } else {
    file = resolved.path
    fileArgs = args
  }

  if (spec.signal?.aborted) return { code: ABORTED_CODE }

  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, fileArgs, {
      cwd: spec.cwd,
      env,
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: verbatim,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let aborted = false
    const onAbort = () => {
      aborted = true
      killTree(child)
    }
    spec.signal?.addEventListener('abort', onAbort, { once: true })
    const out = lineSplitter((l) => spec.onLine?.(l, 'stdout'))
    const err = lineSplitter((l) => spec.onLine?.(l, 'stderr'))
    child.stdout?.on('data', (c: Buffer) => out.push(c))
    child.stderr?.on('data', (c: Buffer) => err.push(c))
    child.on('error', (e: NodeJS.ErrnoException) => {
      spec.signal?.removeEventListener('abort', onAbort)
      reject(new Error(`Không chạy được "${program}": ${e.code ?? e.message}`, { cause: e }))
    })
    child.on('close', (code) => {
      spec.signal?.removeEventListener('abort', onAbort)
      out.end()
      err.end()
      resolvePromise({ code: aborted ? ABORTED_CODE : (code ?? ABORTED_CODE) })
    })
  })
}

/** Parses a `@@progress {json}` line printed by `pnpm aseprite:build -- --json-progress`. */
export function parseProgressLine(
  line: string,
): { step: number; total: number; label: string; percent?: number } | undefined {
  const prefix = '@@progress '
  if (!line.startsWith(prefix)) return undefined
  let data: unknown
  try {
    data = JSON.parse(line.slice(prefix.length))
  } catch {
    return undefined
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return undefined
  const { step, total, label, percent } = data as Record<string, unknown>
  if (typeof step !== 'number' || typeof total !== 'number' || typeof label !== 'string') return undefined
  if (!Number.isFinite(step) || !Number.isFinite(total)) return undefined
  const result: { step: number; total: number; label: string; percent?: number } = { step, total, label }
  if (typeof percent === 'number' && Number.isFinite(percent)) result.percent = percent
  return result
}

/** True when a process with this image name (e.g. "Aseprite.exe") is running. */
export async function isProcessRunning(imageName: string): Promise<boolean> {
  if (!/^[\w.-]+\.exe$/i.test(imageName)) {
    throw new Error(`Tên tiến trình không hợp lệ: ${JSON.stringify(imageName)}`)
  }
  const lines: string[] = []
  const { code } = await runCommand({
    argv: [systemExe('tasklist.exe'), '/FI', `IMAGENAME eq ${imageName}`, '/NH', '/FO', 'CSV'],
    cwd: envGet(process.env, 'SystemRoot') ?? 'C:\\Windows',
    onLine: (l) => lines.push(l),
  })
  if (code !== 0) throw new Error(`tasklist thoát với mã ${code}`)
  const needle = `"${imageName.toLowerCase()}"`
  return lines.some((l) => l.trim().toLowerCase().startsWith(`${needle},`))
}
