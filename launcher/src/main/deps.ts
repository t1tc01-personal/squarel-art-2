/** The single injection seam for main-process modules; unit tests use createDeps('fake', …). */
import { spawn } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import { WebSocket } from 'ws'
import {
  ABORTED_CODE,
  isProcessRunning,
  type RunSpec,
  resolveExecutable,
  runCommand,
  spawnDetached,
} from './run'

export type DetachedSpec = Omit<RunSpec, 'onLine' | 'signal'>

export interface BridgeChild {
  pid?: number
  exited: Promise<{ code: number | null; stderr: string }>
  kill(): void
}

export interface WsLike {
  // biome-ignore lint/suspicious/noExplicitAny: minimal ws-compatible surface
  on(ev: 'open' | 'message' | 'close' | 'error', cb: (...a: any[]) => void): void
  send(data: string): void
  close(): void
  terminate(): void
}

type FsApi = Pick<
  typeof import('node:fs/promises'),
  'readFile' | 'writeFile' | 'readdir' | 'stat' | 'lstat' | 'mkdir' | 'rm' | 'rename' | 'realpath' | 'open'
>

export interface Deps {
  run: (spec: RunSpec) => Promise<{ code: number }>
  /** Starts a GUI tool detached (launch actions); never waits for it to exit. */
  spawnDetached: (spec: DetachedSpec) => Promise<{ pid?: number }>
  fetch: typeof globalThis.fetch
  fs: FsApi
  now: () => Date
  isPidAlive: (pid: number) => boolean
  /** True when a process with this image name (e.g. "aseprite.exe", case-insensitive) is running. */
  isProcessRunning: (imageName: string) => Promise<boolean>
  statfs: (path: string) => Promise<{ freeBytes: number }>
  spawnBridge: (opts: { squarelDir: string; env?: Record<string, string> }) => BridgeChild
  connectWs: (url: string) => WsLike
  /** Timer seam (setTimeout/clearTimeout in real deps) so state machines can run on a fake clock in tests. */
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  /** Absolute path of a program found on PATH (PATHEXT, App Execution Aliases), or undefined. */
  which: (name: string) => string | undefined
}

export interface Fixtures {
  /** Key: argv joined by a single space. Unknown commands exit 127. `files` are written when it runs. */
  /** `lineDelayMs` spaces the lines out (a slow build in e2e); the run signal stops it with ABORTED_CODE. */
  run?: Record<
    string,
    { code: number; lines?: string[]; files?: Record<string, string>; lineDelayMs?: number }
  >
  /** Key: exact URL. Unknown URLs reject like a network failure. */
  fetch?: Record<string, { status: number; headers?: Record<string, string>; body?: string }>
  /** realpath results by path (symlink / 8.3 simulation); other existing files resolve to themselves. */
  realpaths?: Record<string, string>
  /** File symbolic links, link path → target path (the target may be missing: a dangling link). */
  links?: Record<string, string>
  /** Initial in-memory files, by path. */
  files?: Record<string, string>
  now?: Date
  alivePids?: number[]
  /** Running process image names (case-insensitive). */
  running?: string[]
  /** spawnDetached calls are recorded here (the fake never starts anything). */
  launched?: DetachedSpec[]
  freeBytes?: number
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** `which` results by program name; others are not found. */
  which?: Record<string, string>
}

function realIsPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function realSpawnBridge(opts: { squarelDir: string; env?: Record<string, string> }): BridgeChild {
  const child = spawn(process.platform === 'win32' ? 'node.exe' : 'node', ['src/bridge/index.ts'], {
    cwd: opts.squarelDir,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (b: Buffer) => {
    stderr = (stderr + b.toString()).slice(-8192)
  })
  const exited = new Promise<{ code: number | null; stderr: string }>((resolve) => {
    child.once('error', (e) => resolve({ code: null, stderr: stderr + String(e.message) }))
    child.once('close', (code) => resolve({ code, stderr }))
  })
  return { pid: child.pid, exited, kill: () => void child.kill() }
}

function fakeFs(
  files: Record<string, string>,
  realpaths: Record<string, string> = {},
  fileLinks: Record<string, string> = {},
): FsApi {
  const norm = (s: string) => String(s).replace(/\\/g, '/')
  const store = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  /** File symlinks: link path → target path (as given). Reads and writes go to the target. */
  const links = new Map(Object.entries(fileLinks).map(([k, v]) => [norm(k), v]))
  const follow = (p: string) => (links.has(norm(p)) ? norm(links.get(norm(p)) as string) : norm(p))
  /** Folders made with mkdir; a folder also exists while any file lives below it. */
  const dirs = new Set<string>()
  const trim = (p: string) => norm(p).replace(/\/+$/, '')
  const isDir = (p: string) => dirs.has(trim(p)) || [...store.keys()].some((k) => k.startsWith(`${trim(p)}/`))
  const enoent = (p: string) =>
    Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' }) as NodeJS.ErrnoException
  const fs = {
    async readFile(p: string) {
      const v = store.get(follow(p))
      if (v === undefined) throw enoent(p)
      return v
    },
    async writeFile(p: string, data: string) {
      store.set(follow(p), String(data))
    },
    async readdir(p: string, opts?: { withFileTypes?: boolean }) {
      const prefix = `${norm(p).replace(/\/+$/, '')}/`
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix))
      const all = [...keys, ...[...links.keys()].filter((k) => k.startsWith(prefix))]
      const names = [...new Set(all.map((k) => k.slice(prefix.length).split('/')[0] as string))]
      if (!opts?.withFileTypes) return names
      return names.map((name) => {
        const dir = keys.some((k) => k.startsWith(`${prefix}${name}/`))
        return { name, isDirectory: () => dir, isFile: () => !dir, isSymbolicLink: () => false }
      })
    },
    async stat(p: string) {
      const v = store.get(follow(p))
      if (v === undefined) {
        if (isDir(p)) return { isFile: () => false, isDirectory: () => true, size: 0 }
        throw enoent(p)
      }
      return { isFile: () => true, isDirectory: () => false, size: v.length }
    },
    async lstat(p: string) {
      if (links.has(norm(p)))
        return { isFile: () => false, isDirectory: () => false, isSymbolicLink: () => true, size: 0 }
      return { ...(await fs.stat(p)), isSymbolicLink: () => false }
    },
    async realpath(p: string) {
      const mapped = Object.entries(realpaths).find(([k]) => norm(k) === norm(p))?.[1]
      if (mapped !== undefined) return mapped
      const target = links.get(norm(p))
      if (target !== undefined) {
        if (!store.has(norm(target))) throw enoent(p)
        return target
      }
      const prefix = `${norm(p).replace(/\/+$/, '')}/`
      if (!store.has(norm(p)) && !dirs.has(trim(p)) && ![...store.keys()].some((k) => k.startsWith(prefix)))
        throw enoent(p)
      return p
    },
    async open(p: string) {
      const v = store.get(norm(p))
      if (v === undefined) throw enoent(p)
      const buf = Buffer.from(v)
      return {
        async read(target: Buffer, off: number, len: number, pos: number) {
          const n = buf.copy(target, off, pos, Math.min(buf.length, pos + len))
          return { bytesRead: n, buffer: target }
        },
        async close() {},
      }
    },
    async mkdir(p: string) {
      dirs.add(trim(p))
      return undefined
    },
    async rm(p: string) {
      const prefix = `${norm(p).replace(/\/+$/, '')}/`
      store.delete(norm(p))
      links.delete(norm(p))
      for (const k of [...store.keys()]) if (k.startsWith(prefix)) store.delete(k)
      for (const k of [...dirs]) if (k === trim(p) || k.startsWith(prefix)) dirs.delete(k)
    },
    async rename(a: string, b: string) {
      const v = store.get(norm(a))
      if (v !== undefined) {
        store.delete(norm(a))
        links.delete(norm(b)) // like a real rename: a link at `b` is replaced by the file
        store.set(norm(b), v)
        return
      }
      // A folder: move every file below it.
      const from = `${norm(a).replace(/\/+$/, '')}/`
      const to = `${norm(b).replace(/\/+$/, '')}/`
      const keys = [...store.keys()].filter((k) => k.startsWith(from))
      if (keys.length === 0) throw enoent(a)
      for (const k of keys) {
        store.set(to + k.slice(from.length), store.get(k) as string)
        store.delete(k)
      }
    },
  }
  return fs as unknown as FsApi
}

function createFake(fx: Fixtures): Deps {
  const alive = new Set(fx.alivePids ?? [])
  const fs = fakeFs(fx.files ?? {}, fx.realpaths, fx.links)
  return {
    async run(spec) {
      const hit = fx.run?.[spec.argv.join(' ')]
      if (!hit) return { code: 127 }
      for (const [path, data] of Object.entries(hit.files ?? {})) await fs.writeFile(path, data)
      for (const l of hit.lines ?? []) {
        if (hit.lineDelayMs) {
          const ms = hit.lineDelayMs
          await new Promise<void>((r) => {
            const t = setTimeout(r, ms)
            const stop = () => {
              clearTimeout(t)
              r()
            }
            spec.signal?.addEventListener('abort', stop, { once: true })
          })
        }
        if (spec.signal?.aborted) return { code: ABORTED_CODE }
        spec.onLine?.(l, 'stdout')
      }
      return { code: hit.code }
    },
    async spawnDetached(spec) {
      fx.launched?.push(spec)
      return { pid: 1 }
    },
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const hit = fx.fetch?.[url]
      if (!hit) throw new TypeError(`fetch failed: no fixture for ${url}`)
      return new Response(hit.body ?? '', { status: hit.status, headers: hit.headers })
    }) as typeof fetch,
    fs,
    now: () => fx.now ?? new Date('2026-01-01T00:00:00Z'),
    isPidAlive: (pid) => alive.has(pid),
    isProcessRunning: async (name) => (fx.running ?? []).some((r) => r.toLowerCase() === name.toLowerCase()),
    statfs: async () => ({ freeBytes: fx.freeBytes ?? 100 * 1024 ** 3 }),
    spawnBridge: () => ({ exited: new Promise(() => {}), kill() {} }),
    connectWs: () => ({ on() {}, send() {}, close() {}, terminate() {} }),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    platform: fx.platform ?? 'win32',
    env: fx.env ?? {},
    which: (name) => fx.which?.[name],
  }
}

function createReal(): Deps {
  return {
    run: runCommand,
    spawnDetached,
    fetch: globalThis.fetch.bind(globalThis),
    fs: nodeFs,
    now: () => new Date(),
    isPidAlive: realIsPidAlive,
    isProcessRunning,
    statfs: async (path) => {
      const s = await nodeFs.statfs(path)
      return { freeBytes: Number(s.bavail) * Number(s.bsize) }
    },
    spawnBridge: realSpawnBridge,
    connectWs: (url) => new WebSocket(url) as unknown as WsLike,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    platform: process.platform,
    env: process.env,
    which: (name) => resolveExecutable(name, process.env)?.path,
  }
}

export function createDeps(mode: 'real' | 'fake', fixtures: Fixtures = {}): Deps {
  return mode === 'real' ? createReal() : createFake(fixtures)
}
