import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { bridgeUrl, connectBridge } from '../src/main/bridge/client'
import { createBridgeSupervisor, toolTimeoutMs } from '../src/main/bridge/supervisor'
import type { BridgeState } from '../src/main/bridge/types'
import { type BridgeChild, createDeps, type Deps } from '../src/main/deps'

const SQ = join(tmpdir(), 'squarel-fake-dir')

/**
 * The real Squarel bridge, imported across the repo (test only). The paths are computed so the launcher's tsc
 * does not type-check Squarel's sources under the launcher's compiler options (root `pnpm check` covers them);
 * only the small surface used here is typed.
 */
interface RealBridge {
  port: number
  start(): Promise<boolean>
  stop(): Promise<void>
}
interface RootModules {
  BridgeServer: new (
    ctx: unknown,
    opts: { port: number; watchFiles?: boolean; projects: unknown },
  ) => RealBridge
  ProjectDirectory: new (o: { dataDir: string; log: unknown }) => unknown
  createToolContext: (o: unknown) => Promise<{ editor?: unknown }>
  silentLogger: unknown
  MockProvider: new () => unknown
}
async function rootModules(): Promise<RootModules> {
  const load = (rel: string) =>
    import(/* @vite-ignore */ fileURLToPath(new URL(`../../src/${rel}`, import.meta.url)))
  const [server, projects, context, log, mock] = await Promise.all([
    load('bridge/server.ts'),
    load('bridge/projects.ts'),
    load('tools/context.ts'),
    load('log.ts'),
    load('providers/mock.ts'),
  ])
  return {
    BridgeServer: server.BridgeServer,
    ProjectDirectory: projects.ProjectDirectory,
    createToolContext: context.createToolContext,
    silentLogger: log.silentLogger,
    MockProvider: mock.MockProvider,
  }
}
const cleanups: (() => unknown)[] = []
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c()
})

const realDelay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(pred: () => boolean, ms = 3000, what = 'condition') {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
    await realDelay(10)
  }
}

async function startRealBridge(): Promise<RealBridge> {
  const { BridgeServer, ProjectDirectory, createToolContext, silentLogger, MockProvider } =
    await rootModules()
  const dir = mkdtempSync(join(tmpdir(), 'sq-launcher-bridge-'))
  // One indexed project `game`, so a tool call carrying the ref `game/hero` can resolve its folder.
  const home = join(dir, 'proj-game')
  mkdirSync(join(home, '.squarel'), { recursive: true })
  writeFileSync(
    join(home, '.squarel', 'project.json'),
    JSON.stringify({ schema: 1, id: 'game', name: 'Game' }),
  )
  mkdirSync(join(dir, 'workspaces'), { recursive: true })
  writeFileSync(
    join(dir, 'workspaces', 'game.json'),
    JSON.stringify({ schema: 1, id: 'game', name: 'Game', folder: home, createdAt: '2026-01-01T00:00:00Z' }),
  )
  const ctx = await createToolContext({
    config: { dataDir: dir, imageProvider: 'mock', asepritePath: undefined },
    providers: { mock: new MockProvider() },
    log: silentLogger,
  })
  const bridge = new BridgeServer(ctx, {
    port: 0,
    watchFiles: false,
    projects: new ProjectDirectory({ dataDir: dir, log: silentLogger }),
  })
  expect(await bridge.start()).toBe(true)
  ctx.editor = bridge
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }))
  cleanups.push(() => bridge.stop())
  return bridge
}

async function asepriteClient(port: number): Promise<WebSocket> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`)
  cleanups.push(() => ws.terminate())
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res())
    ws.once('error', rej)
  })
  ws.send(JSON.stringify({ type: 'hello', client: 'aseprite', app: '1.3.18.6', protocol: 2 }))
  await new Promise<void>((res) => ws.once('message', () => res()))
  return ws
}

async function freePort(): Promise<number> {
  const s = createServer()
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
  const port = (s.address() as { port: number }).port
  await new Promise<void>((r) => s.close(() => r()))
  return port
}

interface SpawnSpy {
  calls: { squarelDir: string; env?: Record<string, string> }[]
  kills: number
  fn: Deps['spawnBridge']
}
/** A child that never exits on its own; kill() makes it exit. */
function spawnSpy(exit?: () => { code: number | null; stderr: string } | undefined): SpawnSpy {
  const spy: SpawnSpy = {
    calls: [],
    kills: 0,
    fn: (opts) => {
      spy.calls.push(opts)
      const immediate = exit?.()
      let done: (v: { code: number | null; stderr: string }) => void = () => {}
      const exited = immediate
        ? Promise.resolve(immediate)
        : new Promise<{ code: number | null; stderr: string }>((r) => {
            done = r
          })
      const child: BridgeChild = {
        pid: 4242,
        exited,
        kill: () => {
          spy.kills++
          done({ code: null, stderr: '' })
        },
      }
      return child
    },
  }
  return spy
}

function realWsDeps(over: Partial<Deps> = {}): Deps {
  const real = createDeps('real')
  return { ...createDeps('fake'), connectWs: real.connectWs, ...over }
}

/** Manual clock: timers only fire when advance() moves time past them; real I/O gets a few ms per step. */
function fakeClock() {
  let now = 0
  let seq = 0
  const timers: { at: number; fn: () => void; id: number }[] = []
  return {
    now: () => new Date(Date.UTC(2026, 0, 1) + now),
    setTimer: (fn: () => void, ms: number) => {
      timers.push({ at: now + ms, fn, id: ++seq })
      return seq
    },
    clearTimer: (h: unknown) => {
      const i = timers.findIndex((t) => t.id === h)
      if (i >= 0) timers.splice(i, 1)
    },
    async advance(ms: number, step = 250) {
      const end = now + ms
      while (now < end) {
        now = Math.min(end, now + step)
        for (;;) {
          const due = timers.filter((t) => t.at <= now).sort((a, b) => a.at - b.at)[0]
          if (!due) break
          timers.splice(timers.indexOf(due), 1)
          due.fn()
        }
        await realDelay(3)
      }
    },
  }
}

describe('bridge supervisor', () => {
  it('attaches to a running Squarel bridge and reports its clients', async () => {
    const bridge = await startRealBridge()
    await asepriteClient(bridge.port)
    const spawn = spawnSpy()
    const sup = createBridgeSupervisor(
      { port: bridge.port, squarelDir: SQ, pollMs: 50 },
      realWsDeps({ spawnBridge: spawn.fn }),
    )
    cleanups.push(() => sup.stop())
    const events: BridgeState[] = []
    sup.onChange((s) => events.push(s))
    await sup.start()
    await sup.start() // idempotent
    expect(sup.state().mode).toBe('attached')
    expect(sup.state().port).toBe(bridge.port)
    expect(sup.state().clients.map((c) => c.name)).toEqual(['aseprite'])
    expect(sup.state().clients[0]?.app).toBe('1.3.18.6')
    expect(spawn.calls).toHaveLength(0)
    // polling every 50 ms with nothing changing must not spam onChange
    await realDelay(400)
    expect(events.length).toBeLessThanOrEqual(1)
    // a new client shows up on the next poll
    await asepriteClient(bridge.port)
    await until(() => sup.state().clients.length === 2, 2000, 'second client')
    // tool calls go over the same socket
    await expect(sup.sendTool('art_list', {})).rejects.toThrow(/NO_PROJECT/)
    const text = await sup.sendTool('art_list', {}, 'game/hero')
    expect(typeof text).toBe('string')
    await expect(sup.sendTool('no_such_tool', {}, 'game/hero')).rejects.toThrow(/unknown tool/)
  })

  it('the launcher hello declares protocol 2', async () => {
    const sent: unknown[] = []
    let open: () => void = () => {}
    const attempt = connectBridge(
      {
        ...createDeps('fake'),
        connectWs: () => ({
          on: (ev: string, cb: () => void) => {
            if (ev === 'open') open = cb
          },
          send: (data: string) => void sent.push(JSON.parse(data)),
          close() {},
          terminate() {},
        }),
      },
      bridgeUrl(1),
      50,
    )
    open()
    expect(sent[0]).toEqual({ type: 'hello', client: 'launcher', protocol: 2 })
    attempt.abort()
    await attempt.result
  })

  it('spawns its own bridge when nothing listens', async () => {
    const port = await freePort()
    const spawn = spawnSpy()
    const sup = createBridgeSupervisor(
      { port, squarelDir: SQ, token: 'sekret' },
      realWsDeps({ spawnBridge: spawn.fn }),
    )
    cleanups.push(() => sup.stop())
    await sup.start()
    expect(sup.state().mode).toBe('own')
    expect(spawn.calls).toHaveLength(1)
    expect(spawn.calls[0]?.squarelDir).toBe(SQ)
    expect(spawn.calls[0]?.env?.BRIDGE_PORT).toBe(String(port))
    await expect(sup.sendTool('art_list', {})).rejects.toThrow(/chưa kết nối/)
  })

  it('takes over when the attached bridge goes away', async () => {
    const bridge = await startRealBridge()
    const spawn = spawnSpy()
    const sup = createBridgeSupervisor(
      { port: bridge.port, squarelDir: SQ, pollMs: 5000 },
      realWsDeps({ spawnBridge: spawn.fn }),
    )
    cleanups.push(() => sup.stop())
    await sup.start()
    expect(sup.state().mode).toBe('attached')
    const t0 = Date.now()
    await bridge.stop()
    await until(() => spawn.calls.length === 1, 1000, 'takeover spawn')
    expect(Date.now() - t0).toBeLessThanOrEqual(1000)
    expect(sup.state().mode).toBe('own')
    await realDelay(100)
    expect(spawn.calls).toHaveLength(1)
  })

  it('foreign program on the port → mode foreign, retries at foreignRetryMs, never spawns in a tight loop', async () => {
    const sockets: Socket[] = []
    const raw: Server = createServer((s) => {
      sockets.push(s)
      s.on('data', () => {}) // accepts the upgrade request and never answers
    })
    await new Promise<void>((r) => raw.listen(0, '127.0.0.1', () => r()))
    cleanups.push(() => new Promise<void>((r) => raw.close(() => r())))
    cleanups.push(() => {
      for (const s of sockets) s.destroy()
    })
    const port = (raw.address() as { port: number }).port
    const clock = fakeClock()
    const spawn = spawnSpy()
    const real = createDeps('real')
    let connects = 0
    const sup = createBridgeSupervisor(
      { port, squarelDir: SQ, foreignRetryMs: 30_000 },
      realWsDeps({
        spawnBridge: spawn.fn,
        connectWs: (url) => {
          connects++
          return real.connectWs(url)
        },
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      }),
    )
    cleanups.push(() => sup.stop())
    void sup.start()
    await clock.advance(60_000)
    expect(sup.state().mode).toBe('foreign')
    expect(sup.state().message).toBe(`Cổng ${port} đang bị chương trình khác dùng`)
    expect(spawn.calls).toHaveLength(0)
    expect(connects).toBeGreaterThanOrEqual(2)
    expect(connects).toBeLessThanOrEqual(3)
  })

  it('child exiting with port-in-use goes back to probing, without a tight loop', async () => {
    const port = await freePort()
    const clock = fakeClock()
    const spawn = spawnSpy(() => ({
      code: 1,
      stderr: `Port ${port} is already in use (another bridge, or squarel-mcp inside Claude Code).\n`,
    }))
    let connects = 0
    const real = createDeps('real')
    const sup = createBridgeSupervisor(
      { port, squarelDir: SQ, foreignRetryMs: 30_000 },
      realWsDeps({
        spawnBridge: spawn.fn,
        connectWs: (url) => {
          connects++
          return real.connectWs(url)
        },
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      }),
    )
    cleanups.push(() => sup.stop())
    void sup.start()
    // no fake time passes: every in-use exit is followed by a fresh probe (step 1) right away…
    await until(() => spawn.calls.length >= 3, 3000, 'three spawns')
    await realDelay(150)
    expect(connects).toBeGreaterThanOrEqual(spawn.calls.length) // a probe before every spawn
    // …but after a few failures in a row it backs off instead of looping
    expect(spawn.calls).toHaveLength(3)
    expect(sup.state().mode).toBe('down')
    expect(sup.state().message).toMatch(/bridge/i)
    await clock.advance(59_000) // one foreignRetryMs round (at 30 s); the next is due at ≥60 s
    expect(spawn.calls.length).toBeLessThanOrEqual(6)
  })

  it('stop() kills only an own child', async () => {
    // own: stop kills the child it spawned
    const port = await freePort()
    const spawn = spawnSpy()
    const own = createBridgeSupervisor({ port, squarelDir: SQ }, realWsDeps({ spawnBridge: spawn.fn }))
    await own.start()
    expect(own.state().mode).toBe('own')
    await own.stop()
    expect(spawn.kills).toBe(1)
    expect(own.state().mode).toBe('down')
    await own.stop()
    expect(spawn.kills).toBe(1)

    // attached: stop leaves the other bridge running
    const bridge = await startRealBridge()
    const spawn2 = spawnSpy()
    const att = createBridgeSupervisor(
      { port: bridge.port, squarelDir: SQ },
      realWsDeps({ spawnBridge: spawn2.fn }),
    )
    await att.start()
    expect(att.state().mode).toBe('attached')
    await att.stop()
    expect(att.state().mode).toBe('down')
    expect(spawn2.calls).toHaveLength(0)
    expect(spawn2.kills).toBe(0)
    await asepriteClient(bridge.port) // still serving
    await realDelay(50)
    expect(spawn2.calls).toHaveLength(0) // the closed socket did not trigger a takeover

    // stop during an in-flight probe: the late result is a no-op
    const clock = fakeClock()
    const spawn3 = spawnSpy()
    const mid = createBridgeSupervisor(
      { port: await freePort(), squarelDir: SQ },
      realWsDeps({ spawnBridge: spawn3.fn, setTimer: clock.setTimer, clearTimer: clock.clearTimer }),
    )
    void mid.start()
    await mid.stop()
    await realDelay(100)
    expect(spawn3.calls).toHaveLength(0)
    expect(mid.state().mode).toBe('down')
  })
  it('own child alive but unreachable → backs off with a message, then is killed', async () => {
    const port = await freePort() // nothing ever listens: our (fake) child never binds
    const clock = fakeClock()
    const spawn = spawnSpy()
    const real = createDeps('real')
    let connects = 0
    const sup = createBridgeSupervisor(
      { port, squarelDir: SQ, pollMs: 5000, foreignRetryMs: 30_000 },
      realWsDeps({
        spawnBridge: spawn.fn,
        connectWs: (url) => {
          connects++
          return real.connectWs(url)
        },
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      }),
    )
    cleanups.push(() => sup.stop())
    await sup.start()
    expect(sup.state().mode).toBe('own')
    await clock.advance(10_000)
    expect(sup.state().mode).toBe('own')
    expect(sup.state().message).toBe('Bridge không phản hồi')
    const after10s = connects
    expect(after10s).toBeLessThanOrEqual(1 + 14 + 2) // probe + ~3 s of 250 ms retries + every 5 s
    await clock.advance(60_000, 1000) // give-up lands on the first retry after 60 s of failures
    expect(spawn.kills).toBe(1)
    expect(sup.state().mode).toBe('down')
    expect(sup.state().message).toMatch(/không phản hồi/)
    expect(spawn.calls).toHaveLength(1)
    expect(connects).toBeLessThanOrEqual(1 + 14 + 14) // bounded over 70 s: no 4×/s loop
  }, 15_000)

  it('killOwnChild() synchronously kills an own child and never an attached bridge', async () => {
    const spawn = spawnSpy()
    const own = createBridgeSupervisor(
      { port: await freePort(), squarelDir: SQ },
      realWsDeps({ spawnBridge: spawn.fn }),
    )
    await own.start()
    expect(own.state().mode).toBe('own')
    own.killOwnChild()
    expect(spawn.kills).toBe(1)
    expect(own.state().mode).toBe('down')
    own.killOwnChild()
    expect(spawn.kills).toBe(1)
    await realDelay(100)
    expect(spawn.calls).toHaveLength(1) // no respawn after the kill

    const bridge = await startRealBridge()
    const spawn2 = spawnSpy()
    const att = createBridgeSupervisor(
      { port: bridge.port, squarelDir: SQ },
      realWsDeps({ spawnBridge: spawn2.fn }),
    )
    await att.start()
    expect(att.state().mode).toBe('attached')
    att.killOwnChild()
    expect(spawn2.kills).toBe(0)
    await realDelay(100)
    expect(spawn2.calls).toHaveLength(0) // closing the socket did not trigger a takeover
    await asepriteClient(bridge.port) // the other bridge still serves
  })
  it('own child rejecting our token → token-specific message', async () => {
    const clock = fakeClock()
    let n = 0
    // first connect: nothing listens (→ spawn); afterwards our child answers the upgrade with 401
    const connectWs: Deps['connectWs'] = () => {
      const first = n++ === 0
      const handlers: Record<string, ((...a: unknown[]) => void)[]> = {}
      queueMicrotask(() => {
        const err = first
          ? Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })
          : new Error('Unexpected server response: 401')
        for (const cb of handlers.error ?? []) cb(err)
      })
      return {
        on: (ev, cb) => {
          handlers[ev] = [...(handlers[ev] ?? []), cb]
        },
        send() {},
        close() {},
        terminate() {},
      }
    }
    const spawn = spawnSpy()
    const sup = createBridgeSupervisor(
      { port: 4321, token: 'old', squarelDir: SQ },
      realWsDeps({
        connectWs,
        spawnBridge: spawn.fn,
        now: clock.now,
        setTimer: clock.setTimer,
        clearTimer: clock.clearTimer,
      }),
    )
    cleanups.push(() => sup.stop())
    await sup.start()
    await clock.advance(5_000)
    expect(sup.state().mode).toBe('own')
    expect(sup.state().message).toBe('Bridge trên cổng 4321 từ chối token')
  })
})

describe('toolTimeoutMs', () => {
  it('waits about a minute for open_in_editor (it may start the editor), 5 s for other tools', () => {
    expect(toolTimeoutMs('open_in_editor')).toBe(60_000)
    expect(toolTimeoutMs('art_list')).toBe(5000)
    expect(toolTimeoutMs('constructor')).toBe(5000)
  })
})
