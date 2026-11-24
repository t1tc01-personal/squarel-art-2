import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { ProjectDirectory } from '../src/bridge/projects.ts'
import type { ServerMessage } from '../src/bridge/protocol.ts'
import { openViaBridge } from '../src/bridge/remote.ts'
import { BridgeServer, isLocalClientOrigin } from '../src/bridge/server.ts'
import { celKey, deserializeDoc, serializeDoc } from '../src/core/index.ts'
import { silentLogger } from '../src/log.ts'
import { MockProvider } from '../src/providers/mock.ts'
import { artRef } from '../src/shared/ref.ts'
import { Store } from '../src/store/store.ts'
import { NO_PROJECT_TEXT } from '../src/tools/common.ts'
import { createToolContext } from '../src/tools/context.ts'
import { runTool } from '../src/tools/registry.ts'
import type { ToolContext } from '../src/tools/types.ts'
import { SQUAREL_VERSION } from '../src/version.ts'
import { makeProjectFolder, tempDir } from './helpers.ts'

const OUTDATED =
  'This Squarel bridge (0.4) needs the Squarel extension 0.4 or newer. Update it from Squarel Art Launcher: Aseprite → Cài extension.'

let t: ReturnType<typeof tempDir>
let ctx: ToolContext
let bridge: BridgeServer
const sockets: WebSocket[] = []
const REF = 'game/bridge'

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
  closed() {
    return new Promise<void>((res) => {
      if (this.ws.readyState === this.ws.CLOSED) res()
      else this.ws.once('close', () => res())
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

/** Register a project folder in the launcher's index (DATA_DIR/workspaces/<id>.json). */
function index(folder: string, id: string, name = 'Game') {
  mkdirSync(join(t.dir, 'workspaces'), { recursive: true })
  writeFileSync(
    join(t.dir, 'workspaces', `${id}.json`),
    JSON.stringify({ schema: 1, id, name, folder, createdAt: '2026-01-01T00:00:00Z' }),
  )
}

/** A project folder `<t>/<folderName>` declaring `id`. */
function projectFolder(folderName: string, id: string, name: string): string {
  const folder = join(t.dir, folderName)
  mkdirSync(join(folder, '.squarel'), { recursive: true })
  writeFileSync(join(folder, '.squarel', 'project.json'), JSON.stringify({ schema: 1, id, name }))
  return folder
}

/** A context for Claude working in `folder` (like the MCP server), committing through the bridge. */
async function projectCtx(folder: string): Promise<ToolContext> {
  const c = await createToolContext({
    config: { dataDir: t.dir, imageProvider: 'mock', asepritePath: undefined },
    providers: { mock: new MockProvider() },
    log: silentLogger,
    projectStart: folder,
  })
  const id = c.session.workspace!.id
  c.editor = bridge
  // a late notify may outlive the temp dir
  c.onCommit = (slug, v) => void bridge.notify(artRef(id, slug), v).catch(() => {})
  return c
}

/** Another registered project folder with one art. */
async function otherProject(folderName: string, id: string, name: string, art = 'Hero') {
  const folder = projectFolder(folderName, id, name)
  index(folder, id, name)
  const c = await projectCtx(folder)
  await runTool('art_create', { name: art, width: 8, height: 8 }, c)
  return { home: folder, ctx: c }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
async function until(pred: () => boolean, ms = 5000, what = 'condition') {
  const end = Date.now() + ms
  while (!pred()) {
    if (Date.now() > end) throw new Error(`timeout waiting for ${what}`)
    await sleep(20)
  }
}

let home: string
beforeEach(async () => {
  t = tempDir()
  home = makeProjectFolder(t.dir)
  index(home, 'game')
  const base = await createToolContext({
    config: { dataDir: t.dir, imageProvider: 'mock', asepritePath: undefined },
    providers: { mock: new MockProvider() },
    log: silentLogger,
  })
  bridge = new BridgeServer(base, {
    port: 0,
    projects: new ProjectDirectory({ dataDir: t.dir, log: silentLogger }),
  })
  expect(await bridge.start()).toBe(true)
  ctx = await projectCtx(home)
  await runTool('art_create', { name: 'Bridge', width: 8, height: 8 }, ctx)
})
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate()
  await bridge.stop()
  t.cleanup()
})

async function connect(): Promise<TestClient> {
  const c = new TestClient(bridge.port)
  await c.opened()
  c.send({ type: 'hello', client: 'aseprite', protocol: 2 })
  const w = await c.next('welcome')
  expect(w.protocol).toBe(2)
  expect(w.arts.map((a) => a.ref)).toContain(REF)
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
    const second = new BridgeServer(ctx, {
      port: bridge.port,
      projects: new ProjectDirectory({ dataDir: t.dir, log: silentLogger }),
    })
    expect(await second.start()).toBe(false)
  })

  it('open → doc; Claude edits are pushed as doc.updated', async () => {
    const c = await connect()
    c.send({ type: 'open', ref: REF })
    const d = await c.next('doc')
    expect(d.versionId).toBe('v000001')
    await runTool(
      'draw_pixels',
      { art: 'bridge', ops: [{ op: 'set', points: [[1, 1]], color: '#ff004d' }] },
      ctx,
    )
    const up = await c.next('doc.updated')
    expect(up.versionId).toBe('v000002')
    expect(up.source).toBe('claude')
    expect(up.label).toContain('Claude: draw')
  })

  it('editor strokes become versions; concurrent Claude edits are merged (nothing lost)', async () => {
    const c = await connect()
    c.send({ type: 'open', ref: REF })
    const d = await c.next('doc')
    // editor draws on its copy of v1
    const editorDoc = deserializeDoc(d.doc)
    editorDoc.cels[celKey(editorDoc.layers[0].id, editorDoc.frames[0].id)][0] = 1
    // meanwhile Claude commits v2 (pixel at the other corner)
    await runTool('draw_pixels', { art: 'bridge', ops: [{ op: 'set', points: [[7, 7]], color: 2 }] }, ctx)
    await c.next('doc.updated')
    c.send({
      type: 'cels',
      ref: REF,
      baseVersion: 'v000001',
      doc: serializeDoc(editorDoc),
      label: 'brush',
    })
    const merged = await c.next('rebased')
    const doc = deserializeDoc(merged.doc)
    const cel = doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)]
    expect(cel[0]).toBe(1)
    expect(cel[63]).toBe(2)
    const hist = await ctx.arts!.history('bridge', 1)
    expect(hist[0].source).toBe('editor')
    expect(hist[0].label).toContain('brush (1 px)')
    // a no-op save on the latest base is just acknowledged
    c.send({ type: 'cels', ref: REF, baseVersion: merged.versionId, doc: merged.doc })
    expect((await c.next('ack')).versionId).toBe(merged.versionId)
  })

  it('commits from another process reach the editor through the file watcher', async () => {
    const c = await connect()
    c.send({ type: 'open', ref: REF })
    await c.next('doc')
    const other = new Store(ctx.arts!.root) // no onCommit hook: only the watcher can see this
    await other.withHead('bridge', 'cli', 'external', (doc) => {
      doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)][5] = 3
    })
    const up = await c.next('doc.updated', 8000)
    expect(up.source).toBe('cli')
  })

  it('runs tools for editor menus and asks the editor to open projects', async () => {
    const c = await connect()
    c.send({ type: 'tool', id: '1', name: 'export', ref: REF, input: { preset: 'game-png' } })
    const r = await c.next('tool_result')
    expect(r.ok).toBe(true)
    expect(r.files?.[0]).toMatch(/bridge@1x\.png$/)
    const msg = await runTool('open_in_editor', { art: 'bridge' }, ctx)
    expect(msg.text).toContain('live sync on')
    expect((await c.next('open.request')).ref).toBe(REF)
    // the same request coming over the socket (e.g. from another client) must reach the editor too
    const driver = await connect()
    driver.send({ type: 'tool', id: '2', name: 'open_in_editor', ref: REF, input: {} })
    expect((await driver.next('tool_result')).ok).toBe(true)
    expect((await c.next('open.request')).ref).toBe(REF)
    c.send({ type: 'nope' })
    expect((await c.next('error')).message).toContain('unknown message type')
  })

  it('status lists connected clients with what they have open', async () => {
    const c = await connect() // hello client=aseprite
    c.send({ type: 'open', ref: REF })
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
    expect(ase.ref).toBe(REF)
    expect(Date.parse(ase.lastSeen)).toBeGreaterThan(0)
    expect(Date.parse(ase.connectedAt)).toBeGreaterThan(0)
    expect(s.clients.some((x) => x.name === 'unknown')).toBe(true) // the probe never said hello
  })

  it('hello records ext and app (legacy aseprite field still accepted)', async () => {
    const a = new TestClient(bridge.port)
    await a.opened()
    a.send({ type: 'hello', client: 'aseprite', ext: '0.1.1', app: '1.3.18.6', protocol: 2 })
    await a.next('welcome')
    const b = new TestClient(bridge.port)
    await b.opened()
    b.send({ type: 'hello', client: 'legacy', aseprite: '1.3.0', protocol: 2 })
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

  it('hello without protocol 2 gets extension-outdated and is closed', async () => {
    for (const hello of [
      { type: 'hello', client: 'aseprite', ext: '0.3.0' },
      { type: 'hello', client: 'aseprite', protocol: 1 },
    ]) {
      const c = new TestClient(bridge.port)
      await c.opened()
      c.send(hello)
      const e = await c.next('error')
      expect(e).toEqual({ type: 'error', code: 'extension-outdated', message: OUTDATED })
      await c.closed()
      expect(c.inbox.some((m) => m.type === 'welcome')).toBe(false)
    }
  })

  it('list returns ArtEntry for every known project', async () => {
    await otherProject('Dự án game', 'du-an', 'Dự án game')
    const c = await connect()
    c.send({ type: 'list' })
    const { arts } = await c.next('arts')
    const byRef = Object.fromEntries(arts.map((a) => [a.ref, a]))
    expect(byRef[REF]).toEqual({
      ref: REF,
      project: 'game',
      projectName: 'Game',
      art: 'bridge',
      name: 'Bridge',
      head: 'v000001',
    })
    expect(byRef['du-an/hero']).toEqual({
      ref: 'du-an/hero',
      project: 'du-an',
      projectName: 'Dự án game',
      art: 'hero',
      name: 'Hero',
      head: 'v000001',
    })
  })

  it('two projects with an art named hero stay apart', async () => {
    const a = await otherProject('a', 'a', 'A')
    await otherProject('b', 'b', 'B')
    const ca = await connect()
    ca.send({ type: 'open', ref: 'a/hero' })
    expect((await ca.next('doc')).ref).toBe('a/hero')
    const cb = await connect()
    cb.send({ type: 'open', ref: 'b/hero' })
    expect((await cb.next('doc')).ref).toBe('b/hero')
    // a Claude edit in project a (hook + watcher both fire)
    await runTool('draw_pixels', { art: 'hero', ops: [{ op: 'set', points: [[0, 0]], color: 1 }] }, a.ctx)
    const up = await ca.next('doc.updated')
    expect(up.ref).toBe('a/hero')
    // an editor edit in project a
    const doc = deserializeDoc(up.doc)
    doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)][9] = 1
    ca.send({ type: 'cels', ref: 'a/hero', baseVersion: up.versionId, doc: serializeDoc(doc) })
    expect((await ca.next('ack')).ref).toBe('a/hero')
    await sleep(600) // longer than the watcher's debounce
    expect(cb.inbox.filter((m) => m.type !== 'welcome')).toEqual([])
    const bStore = new Store(join(t.dir, 'b', 'squarel_art'))
    expect((await bStore.readHead('hero')).versionId).toBe('v000001')
    expect((await a.ctx.arts!.readHead('hero')).versionId).toBe('v000003')
  })

  it('a commit by another process in a project folder reaches Aseprite', async () => {
    const { home: viHome } = await otherProject('Dự án game', 'du-an', 'Dự án game')
    const c = await connect()
    c.send({ type: 'open', ref: 'du-an/hero' })
    await c.next('doc')
    const other = new Store(join(viHome, 'squarel_art')) // no onCommit hook: only the watcher can see this
    await other.withHead('hero', 'cli', 'external', (doc) => {
      doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)][5] = 3
    })
    const up = await c.next('doc.updated', 8000)
    expect(up.ref).toBe('du-an/hero')
    expect(up.source).toBe('cli')
  })

  it('a project that appears after start (new presence file) is watched', async () => {
    const late = projectFolder('Dự án muộn', 'late', 'Late')
    const lateCtx = await createToolContext({
      config: { dataDir: t.dir, imageProvider: 'mock', asepritePath: undefined },
      providers: { mock: new MockProvider() },
      log: silentLogger,
      projectStart: late,
    })
    await runTool('art_create', { name: 'Hero', width: 8, height: 8 }, lateCtx)
    const root = join(late, 'squarel_art')
    expect(bridge.watchedRoots()).not.toContain(root)
    mkdirSync(join(t.dir, 'run'), { recursive: true })
    writeFileSync(
      join(t.dir, 'run', `mcp-${process.pid}.json`),
      JSON.stringify({ pid: process.pid, workspace: { id: 'late', name: 'Late', folder: late } }),
    )
    await until(() => bridge.watchedRoots().includes(root), 5000, 'the new project root to be watched')
    const c = await connect()
    c.send({ type: 'open', ref: 'late/hero' })
    await c.next('doc')
    await new Store(root).withHead('hero', 'cli', 'external', (doc) => {
      doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)][2] = 1
    })
    expect((await c.next('doc.updated', 8000)).ref).toBe('late/hero')
  })

  it('tool export with ref runs in that project and writes to its squarel_art/<art>/exports', async () => {
    const { home: aHome } = await otherProject('a', 'a', 'A')
    const c = await connect()
    c.send({ type: 'tool', id: 'x', name: 'export', ref: 'a/hero', input: { preset: 'game-png' } })
    const r = await c.next('tool_result')
    expect(r.ok, r.text).toBe(true)
    expect(r.files?.length).toBeGreaterThan(0)
    for (const f of r.files ?? [])
      expect(f.startsWith(join(aHome, 'squarel_art', 'hero', 'exports'))).toBe(true)
    // without a ref (and nothing open) art tools have no project
    c.send({ type: 'tool', id: 'y', name: 'art_list', input: {} })
    const none = await c.next('tool_result')
    expect(none.ok).toBe(false)
    expect(none.text).toContain(NO_PROJECT_TEXT)
    // after open, the client's current ref picks the project
    c.send({ type: 'open', ref: 'a/hero' })
    await c.next('doc')
    c.send({ type: 'tool', id: 'z', name: 'art_info', input: {} })
    const info = await c.next('tool_result')
    expect(info.ok, info.text).toBe(true)
    expect(info.text).toContain(join(aHome, 'squarel_art', 'hero'))
  })

  it('explains setup when no Aseprite is connected', async () => {
    const r = await runTool('open_in_editor', { art: 'bridge' }, ctx)
    expect(r.text).toContain('ASEPRITE_PATH')
  })
  it('openViaBridge asks the running bridge to open the project in the connected editor', async () => {
    const c = await connect()
    const text = await openViaBridge({ port: bridge.port, ref: REF })
    expect(text).toContain('live sync on')
    expect((await c.next('open.request')).ref).toBe(REF)
  })

  it('openViaBridge on a closed port says what to do', async () => {
    const srv = createServer()
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const port = (srv.address() as { port: number }).port
    await new Promise((r) => srv.close(r))
    const err = await openViaBridge({ port, ref: REF }).catch((e: Error) => e)
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
      await expect(openViaBridge({ port, ref: REF, timeoutMs: 300 })).rejects.toThrow(
        `bridge on port ${port} did not answer`,
      )
      expect(Date.now() - started).toBeLessThan(800)
    } finally {
      for (const sock of held) sock.destroy()
      await new Promise((r) => srv.close(r))
    }
  })
})
