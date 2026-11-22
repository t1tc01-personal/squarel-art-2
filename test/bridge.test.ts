import { readFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import type { ServerMessage } from '../src/bridge/protocol.ts'
import { openViaBridge } from '../src/bridge/remote.ts'
import { BridgeServer, isLocalClientOrigin } from '../src/bridge/server.ts'
import { celKey, deserializeDoc, serializeDoc } from '../src/core/index.ts'
import { silentLogger } from '../src/log.ts'
import { MockProvider } from '../src/providers/mock.ts'
import { Store } from '../src/store/store.ts'
import { createToolContext } from '../src/tools/context.ts'
import { runTool } from '../src/tools/registry.ts'
import type { ToolContext } from '../src/tools/types.ts'
import { SQUAREL_VERSION } from '../src/version.ts'
import { tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
let ctx: ToolContext
let bridge: BridgeServer
const sockets: WebSocket[] = []

class TestClient {
  ws: WebSocket
  inbox: ServerMessage[] = []
  waiters: { pred: (m: ServerMessage) => boolean; resolve: (m: ServerMessage) => void }[] = []
  constructor(port: number, headers: Record<string, string> = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}/bridge`, { headers })
    sockets.push(this.ws)
    this.ws.on('message', (raw) => {
      const m = JSON.parse(String(raw)) as ServerMessage
      const w = this.waiters.find((x) => x.pred(m))
      if (w) {
        this.waiters.splice(this.waiters.indexOf(w), 1)
        w.resolve(m)
      } else this.inbox.push(m)
    })
  }
  opened() {
    return new Promise<void>((res, rej) => {
      this.ws.once('open', () => res())
      this.ws.once('error', rej)
    })
  }
  send(m: unknown) {
    this.ws.send(JSON.stringify(m))
  }
  next<T extends ServerMessage['type']>(
    type: T,
    timeoutMs = 5000,
  ): Promise<Extract<ServerMessage, { type: T }>> {
    const i = this.inbox.findIndex((m) => m.type === type)
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0] as any)
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timeout waiting for ${type}; inbox: ${this.inbox.map((m) => m.type)}`)),
        timeoutMs,
      )
      this.waiters.push({
        pred: (m) => m.type === type,
        resolve: (m) => {
          clearTimeout(timer)
          resolve(m as any)
        },
      })
    })
  }
}

beforeEach(async () => {
  t = tempDir()
  ctx = await createToolContext({
    config: { dataDir: t.dir, imageProvider: 'mock', asepritePath: undefined },
    providers: { mock: new MockProvider() },
    log: silentLogger,
  })
  bridge = new BridgeServer(ctx, { port: 0 })
  expect(await bridge.start()).toBe(true)
  ctx.editor = bridge
  ctx.onCommit = (slug, v) => void bridge.notify(slug, v)
  await runTool('project_create', { name: 'Bridge', width: 8, height: 8 }, ctx)
})
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  await bridge.stop()
  t.cleanup()
})

async function connect(): Promise<TestClient> {
  const c = new TestClient(bridge.port)
  await c.opened()
  c.send({ type: 'hello', client: 'aseprite' })
  const w = await c.next('welcome')
  expect(w.projects.map((p) => p.slug)).toContain('bridge')
  return c
}

describe('bridge', () => {
  it('refuses browser origins and reports a busy port', async () => {
    const c = new TestClient(bridge.port, { Origin: 'https://evil.example' })
    await expect(c.opened()).rejects.toThrow(/403/)
    for (const origin of ['http://127.0.0.1:4321', 'null', 'file://', 'ws://evil.example:4321']) {
      expect(isLocalClientOrigin(origin), origin).toBe(false)
    }
    // Aseprite (ixwebsocket) always sends its own ws:// origin
    const ase = new TestClient(bridge.port, { Origin: `ws://127.0.0.1:${bridge.port}` })
    await ase.opened()
    expect(isLocalClientOrigin('ws://localhost:4321')).toBe(true)
    const second = new BridgeServer(ctx, { port: bridge.port })
    expect(await second.start()).toBe(false)
  })

  it('open → doc; Claude edits are pushed as doc.updated', async () => {
    const c = await connect()
    c.send({ type: 'open', slug: 'bridge' })
    const d = await c.next('doc')
    expect(d.versionId).toBe('v000001')
    await runTool(
      'draw_pixels',
      { project: 'bridge', ops: [{ op: 'set', points: [[1, 1]], color: '#ff004d' }] },
      ctx,
    )
    const up = await c.next('doc.updated')
    expect(up.versionId).toBe('v000002')
    expect(up.source).toBe('claude')
    expect(up.label).toContain('Claude: draw')
  })

  it('editor strokes become versions; concurrent Claude edits are merged (nothing lost)', async () => {
    const c = await connect()
    c.send({ type: 'open', slug: 'bridge' })
    const d = await c.next('doc')
    // editor draws on its copy of v1
    const editorDoc = deserializeDoc(d.doc)
    editorDoc.cels[celKey(editorDoc.layers[0].id, editorDoc.frames[0].id)][0] = 1
    // meanwhile Claude commits v2 (pixel at the other corner)
    await runTool('draw_pixels', { project: 'bridge', ops: [{ op: 'set', points: [[7, 7]], color: 2 }] }, ctx)
    await c.next('doc.updated')
    c.send({
      type: 'cels',
      slug: 'bridge',
      baseVersion: 'v000001',
      doc: serializeDoc(editorDoc),
      label: 'brush',
    })
    const merged = await c.next('rebased')
    const doc = deserializeDoc(merged.doc)
    const cel = doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)]
    expect(cel[0]).toBe(1)
    expect(cel[63]).toBe(2)
    const hist = await ctx.store.history('bridge', 1)
    expect(hist[0].source).toBe('editor')
    expect(hist[0].label).toContain('brush (1 px)')
    // a no-op save on the latest base is just acknowledged
    c.send({ type: 'cels', slug: 'bridge', baseVersion: merged.versionId, doc: merged.doc })
    expect((await c.next('ack')).versionId).toBe(merged.versionId)
  })

  it('commits from another process reach the editor through the file watcher', async () => {
    const c = await connect()
    c.send({ type: 'open', slug: 'bridge' })
    await c.next('doc')
    const other = new Store(t.dir) // no onCommit hook: only the watcher can see this
    await other.withHead('bridge', 'cli', 'external', (doc) => {
      doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)][5] = 3
    })
    const up = await c.next('doc.updated', 8000)
    expect(up.source).toBe('cli')
  })

  it('runs tools for editor menus and asks the editor to open projects', async () => {
    const c = await connect()
    c.send({ type: 'tool', id: '1', name: 'export', slug: 'bridge', input: { preset: 'game-png' } })
    const r = await c.next('tool_result')
    expect(r.ok).toBe(true)
    expect(r.files?.[0]).toMatch(/bridge@1x\.png$/)
    const msg = await runTool('open_in_editor', { project: 'bridge' }, ctx)
    expect(msg.text).toContain('live sync on')
    expect((await c.next('open.request')).slug).toBe('bridge')
    // the same request coming over the socket (e.g. from another client) must reach the editor too
    const driver = await connect()
    driver.send({ type: 'tool', id: '2', name: 'open_in_editor', input: { project: 'bridge' } })
    expect((await driver.next('tool_result')).ok).toBe(true)
    expect((await c.next('open.request')).slug).toBe('bridge')
    c.send({ type: 'nope' })
    expect((await c.next('error')).message).toContain('unknown message type')
  })

  it('status lists connected clients with what they have open', async () => {
    const c = await connect() // hello client=aseprite
    c.send({ type: 'open', slug: 'bridge' })
    await c.next('doc')
    const probe = new TestClient(bridge.port)
    await probe.opened()
    probe.send({ type: 'status' })
    const s = await probe.next('status')
    expect(s.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(s.version).toBe(SQUAREL_VERSION)
    expect(SQUAREL_VERSION).toBe(
      JSON.parse(readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf8')).version,
    )
    const ase = s.clients.find((x) => x.name === 'aseprite')!
    expect(ase.slug).toBe('bridge')
    expect(Date.parse(ase.lastSeen)).toBeGreaterThan(0)
    expect(Date.parse(ase.connectedAt)).toBeGreaterThan(0)
    expect(s.clients.some((x) => x.name === 'unknown')).toBe(true) // the probe never said hello
  })

  it('hello records ext and app (legacy aseprite field still accepted)', async () => {
    const a = new TestClient(bridge.port)
    await a.opened()
    a.send({ type: 'hello', client: 'aseprite', ext: '0.1.1', app: '1.3.18.6' })
    await a.next('welcome')
    const b = new TestClient(bridge.port)
    await b.opened()
    b.send({ type: 'hello', client: 'legacy', aseprite: '1.3.0' })
    await b.next('welcome')
    const probe = new TestClient(bridge.port)
    await probe.opened()
    probe.send({ type: 'status' })
    const s = await probe.next('status')
    const ase = s.clients.find((x) => x.name === 'aseprite')!
    expect(ase.ext).toBe('0.1.1')
    expect(ase.app).toBe('1.3.18.6')
    expect(s.clients.find((x) => x.name === 'legacy')!.app).toBe('1.3.0')
  })

  it('ping refreshes lastSeen', async () => {
    const c = await connect()
    const probe = new TestClient(bridge.port)
    await probe.opened()
    const lastSeen = async () => {
      probe.send({ type: 'status' })
      const s = await probe.next('status')
      return Date.parse(s.clients.find((x) => x.name === 'aseprite')!.lastSeen)
    }
    const before = await lastSeen()
    await new Promise((r) => setTimeout(r, 20))
    c.send({ type: 'ping' })
    await c.next('pong')
    expect(await lastSeen()).toBeGreaterThan(before)
  })

  it('explains setup when no Aseprite is connected', async () => {
    const r = await runTool('open_in_editor', { project: 'bridge' }, ctx)
    expect(r.text).toContain('ASEPRITE_PATH')
  })
  it('openViaBridge asks the running bridge to open the project in the connected editor', async () => {
    const c = await connect()
    const text = await openViaBridge({ port: bridge.port, slug: 'bridge' })
    expect(text).toContain('live sync on')
    expect((await c.next('open.request')).slug).toBe('bridge')
  })

  it('openViaBridge on a closed port says what to do', async () => {
    const srv = createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as { port: number }).port
    await new Promise((r) => srv.close(r))
    const err = await openViaBridge({ port, slug: 'bridge' }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect((err as Error).message).toContain(`bridge on port ${port} did not answer`)
    expect((err as Error).message).toContain('pnpm bridge')
    expect((err as Error).message).toContain('restart this Claude Code session')
  })

  it('openViaBridge fails fast when something else holds the port', async () => {
    const held: Socket[] = []
    const srv = createServer((sock) => held.push(sock)) // accepts TCP, never speaks websocket
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as { port: number }).port
    const started = Date.now()
    try {
      await expect(openViaBridge({ port, slug: 'bridge', timeoutMs: 300 })).rejects.toThrow(
        `bridge on port ${port} did not answer`,
      )
      expect(Date.now() - started).toBeLessThan(800)
    } finally {
      for (const sock of held) sock.destroy()
      await new Promise((r) => srv.close(r))
    }
  })
})
