/** The single injection seam for main-process modules; unit tests use createDeps('fake', …). */
import { spawn } from 'node:child_process'
import * as nodeFs from 'node:fs/promises'
import { WebSocket } from 'ws'
import { type RunSpec, runCommand } from './run'

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
  'readFile' | 'writeFile' | 'readdir' | 'stat' | 'mkdir' | 'rm' | 'rename'
>

export interface Deps {
  run: (spec: RunSpec) => Promise<{ code: number }>
  fetch: typeof globalThis.fetch
  fs: FsApi
  now: () => Date
  isPidAlive: (pid: number) => boolean
  statfs: (path: string) => Promise<{ freeBytes: number }>
  spawnBridge: (opts: { squarelDir: string; env?: Record<string, string> }) => BridgeChild
  connectWs: (url: string) => WsLike
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
}

export interface Fixtures {
  /** Key: argv joined by a single space. Unknown commands exit 127. */
  run?: Record<string, { code: number; lines?: string[] }>
  /** Key: exact URL. Unknown URLs reject like a network failure. */
  fetch?: Record<string, { status: number; headers?: Record<string, string>; body?: string }>
  /** Initial in-memory files, by path. */
  files?: Record<string, string>
  now?: Date
  alivePids?: number[]
  freeBytes?: number
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
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

function fakeFs(files: Record<string, string>): FsApi {
  const norm = (s: string) => String(s).replace(/\\/g, '/')
  const store = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  const enoent = (p: string) =>
    Object.assign(new Error(`ENOENT: ${p}`), { code: 'ENOENT' }) as NodeJS.ErrnoException
  const fs = {
    async readFile(p: string) {
      const v = store.get(norm(p))
      if (v === undefined) throw enoent(p)
      return v
    },
    async writeFile(p: string, data: string) {
      store.set(norm(p), String(data))
    },
    async readdir(p: string) {
      const prefix = `${norm(p).replace(/\/+$/, '')}/`
      const names = [...store.keys()]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length).split('/')[0] as string)
      return [...new Set(names)]
    },
    async stat(p: string) {
      const v = store.get(norm(p))
      if (v === undefined) throw enoent(p)
      return { isFile: () => true, isDirectory: () => false, size: v.length }
    },
    async mkdir() {
      return undefined
    },
    async rm(p: string) {
      store.delete(norm(p))
    },
    async rename(a: string, b: string) {
      const v = store.get(norm(a))
      if (v === undefined) throw enoent(a)
      store.delete(norm(a))
      store.set(norm(b), v)
    },
  }
  return fs as unknown as FsApi
}

function createFake(fx: Fixtures): Deps {
  const alive = new Set(fx.alivePids ?? [])
  return {
    async run(spec) {
      const hit = fx.run?.[spec.argv.join(' ')]
      if (!hit) return { code: 127 }
      for (const l of hit.lines ?? []) spec.onLine?.(l, 'stdout')
      return { code: hit.code }
    },
    fetch: (async (input: Parameters<typeof fetch>[0]) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const hit = fx.fetch?.[url]
      if (!hit) throw new TypeError(`fetch failed: no fixture for ${url}`)
      return new Response(hit.body ?? '', { status: hit.status, headers: hit.headers })
    }) as typeof fetch,
    fs: fakeFs(fx.files ?? {}),
    now: () => fx.now ?? new Date('2026-01-01T00:00:00Z'),
    isPidAlive: (pid) => alive.has(pid),
    statfs: async () => ({ freeBytes: fx.freeBytes ?? 100 * 1024 ** 3 }),
    spawnBridge: () => ({ exited: new Promise(() => {}), kill() {} }),
    connectWs: () => ({ on() {}, send() {}, close() {}, terminate() {} }),
    platform: fx.platform ?? 'win32',
    env: fx.env ?? {},
  }
}

function createReal(): Deps {
  return {
    run: runCommand,
    fetch: globalThis.fetch.bind(globalThis),
    fs: nodeFs,
    now: () => new Date(),
    isPidAlive: realIsPidAlive,
    statfs: async (path) => {
      const s = await nodeFs.statfs(path)
      return { freeBytes: Number(s.bavail) * Number(s.bsize) }
    },
    spawnBridge: realSpawnBridge,
    connectWs: (url) => new WebSocket(url) as unknown as WsLike,
    platform: process.platform,
    env: process.env,
  }
}

export function createDeps(mode: 'real' | 'fake', fixtures: Fixtures = {}): Deps {
  return mode === 'real' ? createReal() : createFake(fixtures)
}
