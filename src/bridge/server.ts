import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { type FSWatcher, watch } from 'chokidar'
import { type WebSocket, WebSocketServer } from 'ws'
import { deserializeDoc, serializeDoc } from '../core/codec.ts'
import { diff, isEmptyPatch, rebase } from '../core/diff.ts'
import { validateDoc } from '../core/doc.ts'
import { artRef, parseArtRef } from '../shared/ref.ts'
import type { PixelDocJSON } from '../shared/types.ts'
import { ConflictError } from '../store/store.ts'
import { ART_DIR, readWorkspace } from '../store/workspace.ts'
import { runTool } from '../tools/registry.ts'
import { type EditorHost, type ToolContext, ToolError } from '../tools/types.ts'
import { SQUAREL_VERSION } from '../version.ts'
import { asepriteAvailable, CLI_SCRIPTS, launchAseprite, runAsepriteScript } from './aseprite-cli.ts'
import type { KnownProject, ProjectDirectory } from './projects.ts'
import {
  type ArtEntry,
  BRIDGE_PATH,
  BRIDGE_PROTOCOL,
  type BridgeClientInfo,
  type ClientMessage,
  EXTENSION_OUTDATED_MESSAGE,
  type ServerMessage,
} from './protocol.ts'

interface Client {
  ws: WebSocket
  name: string
  ext?: string
  app?: string
  connectedAt: string
  lastSeen: string
  /** Art the client has open: `<project id>/<art id>`. */
  ref?: string
  /** Last version this client is known to have (sent to it, or committed by it). */
  version?: string
}

export interface BridgeOptions {
  port: number
  host?: string
  /** Optional shared secret; clients pass it as ?token=… */
  token?: string
  /** Every project on this machine: resolves the project id of an art ref to its folder. */
  projects: ProjectDirectory
  watchFiles?: boolean
}

/** Folders inside an art that never carry a version the editor needs. */
const IGNORED_IN_ART = /^[^/]+\/(versions|proposals|exports|assets|\.lock)(\/|$)/

const rootKey = (p: string) => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))

/**
 * Who may connect: native clients only. No Origin (Node `ws`, most tools) or a `ws://` origin on this machine
 * (Aseprite's ixwebsocket adds `Origin: ws://127.0.0.1:<port>`). Browsers never send a ws:// origin, so any
 * web page — whose Origin is http(s)://…, file://, or null — is refused.
 */
export function isLocalClientOrigin(origin: string | undefined): boolean {
  if (!origin) return true
  return /^wss?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\/?$/i.test(origin)
}

/**
 * WebSocket bridge between the stores of every project on this machine and Aseprite.
 * Art is addressed by ref (`<project id>/<art id>`); the project folder comes from the ProjectDirectory.
 * - pushes every new version of an opened art to the editor (`doc.updated`)
 * - turns editor states into versions via diff + rebase (never loses strokes)
 * - handles the work.aseprite file round-trip when the extension is not running
 */
export class BridgeServer implements EditorHost {
  private ctx: ToolContext
  private opts: BridgeOptions
  private projects: ProjectDirectory
  private wss?: WebSocketServer
  /** Watches every known `<home>/squarel_art/` (depth 1). */
  private artWatcher?: FSWatcher
  /** Watches DATA_DIR/run and DATA_DIR/workspaces: new sessions or projects add roots. */
  private dataWatcher?: FSWatcher
  /** Watched art roots: key (case-folded on Windows) → root and its project home. */
  private roots = new Map<string, { root: string; home: string }>()
  private clients = new Set<Client>()
  /** work.aseprite files we wrote ourselves (path → mtimeMs), so the watcher ignores them. */
  private selfWritten = new Map<string, number>()
  private pending = new Map<string, NodeJS.Timeout>()
  port = 0

  constructor(ctx: ToolContext, opts: BridgeOptions) {
    // Tools run for editor clients use this copy: the bridge itself is their editor integration
    // (the caller usually sets ctx.editor only after constructing us). The project of each tool call
    // comes from its art ref, never from the process that owns the bridge.
    this.ctx = { ...ctx, arts: undefined, source: 'editor', session: {}, editor: ctx.editor ?? this }
    this.opts = opts
    this.projects = opts.projects
  }

  /** Start listening. Resolves false if the port is taken (another bridge already runs). */
  start(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      const wss = new WebSocketServer({
        host: this.opts.host ?? '127.0.0.1',
        port: this.opts.port,
        path: BRIDGE_PATH,
        maxPayload: 32 * 1024 * 1024,
        verifyClient: (info, cb) => {
          // Refuse anything coming from a web page. Browsers always send the page's Origin
          // (http/https/file/null…); Aseprite's ixwebsocket sends `ws://127.0.0.1:<port>` itself.
          if (!isLocalClientOrigin(info.req.headers.origin)) return cb(false, 403, 'origin not allowed')
          if (this.opts.token) {
            const url = new URL(info.req.url ?? '/', 'http://localhost')
            if (url.searchParams.get('token') !== this.opts.token) return cb(false, 401, 'bad token')
          }
          cb(true)
        },
      })
      wss.once('error', (e: any) => {
        if (e?.code === 'EADDRINUSE') resolve(false)
        else reject(e)
      })
      wss.once('listening', async () => {
        this.wss = wss
        const addr = wss.address()
        this.port = typeof addr === 'object' && addr ? addr.port : this.opts.port
        wss.on('connection', (ws) => this.onConnection(ws))
        if (this.opts.watchFiles ?? true)
          await this.startWatchers().catch((e) =>
            this.ctx.log.warn('bridge file watching failed to start', { error: String(e) }),
          )
        this.ctx.log.info('bridge listening', { port: this.port })
        resolve(true)
      })
    })
  }

  async stop(): Promise<void> {
    for (const t of this.pending.values()) clearTimeout(t)
    this.pending.clear()
    await this.dataWatcher?.close()
    await this.artWatcher?.close()
    this.dataWatcher = undefined
    this.artWatcher = undefined
    for (const c of this.clients) c.ws.terminate()
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()))
  }

  get connectedClients(): number {
    return this.clients.size
  }

  /** Art roots (`<home>/squarel_art`) the file watcher covers. */
  watchedRoots(): string[] {
    return [...this.roots.values()].map((r) => r.root)
  }

  private send(c: Client, m: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m))
  }

  private clientInfos(): BridgeClientInfo[] {
    return [...this.clients].map((c) => ({
      name: c.name,
      ext: c.ext,
      app: c.app,
      ref: c.ref,
      version: c.version,
      connectedAt: c.connectedAt,
      lastSeen: c.lastSeen,
    }))
  }

  /** The project and art id of a ref; throws INVALID, NOT_FOUND or DUPLICATE_PROJECT. */
  private async resolveRef(ref: string): Promise<{ p: KnownProject; art: string }> {
    const r = typeof ref === 'string' ? parseArtRef(ref) : undefined
    if (!r) throw new ToolError('INVALID', `invalid art ref "${ref}" (expected <project id>/<art id>)`)
    const p = await this.projects.get(r.project)
    this.watchRoot(p.home) // its squarel_art/ may have appeared since the last scan
    return { p, art: r.art }
  }

  /** Every art of every known project. A project whose art folder cannot be read is skipped. */
  private async artList(): Promise<ArtEntry[]> {
    const out: ArtEntry[] = []
    for (const p of await this.projects.list()) {
      this.watchRoot(p.home)
      try {
        for (const a of await p.store.listProjects())
          out.push({
            ref: artRef(p.id, a.slug),
            project: p.id,
            projectName: p.name,
            art: a.slug,
            name: a.name,
            head: a.head,
          })
      } catch (e) {
        this.ctx.log.warn('cannot list art of project', { project: p.id, error: String(e) })
      }
    }
    return out
  }

  /** The context a tool runs in for an art ref: that project's store and workspace, with the art active. */
  private async toolContext(ref: string): Promise<ToolContext> {
    const { p, art } = await this.resolveRef(ref)
    return {
      ...this.ctx,
      arts: p.store,
      session: { workspace: p.ws, activeProject: art },
      onCommit: (slug, versionId) => {
        this.notify(artRef(p.id, slug), versionId).catch((e) =>
          this.ctx.log.warn('notify failed', { error: String(e) }),
        )
      },
    }
  }

  private onConnection(ws: WebSocket) {
    const now = new Date().toISOString()
    const client: Client = { ws, name: 'unknown', connectedAt: now, lastSeen: now }
    this.clients.add(client)
    this.ctx.log.info('editor connected', { clients: this.clients.size })
    ws.on('close', () => {
      this.clients.delete(client)
      this.ctx.log.info('editor disconnected', { client: client.name, clients: this.clients.size })
    })
    ws.on('message', async (raw) => {
      client.lastSeen = new Date().toISOString()
      let msg: ClientMessage
      try {
        msg = JSON.parse(String(raw))
      } catch {
        return this.send(client, { type: 'error', code: 'INVALID', message: 'malformed JSON' })
      }
      try {
        await this.handle(client, msg)
      } catch (e: any) {
        this.ctx.log.warn('bridge message failed', { type: msg.type, error: e?.message })
        this.send(client, { type: 'error', code: e?.code ?? 'INVALID', message: e?.message ?? String(e) })
      }
    })
  }

  private async handle(c: Client, m: ClientMessage) {
    switch (m.type) {
      case 'hello':
        c.name = m.client
        c.ext = m.ext
        c.app = m.app ?? m.aseprite
        if (m.protocol !== BRIDGE_PROTOCOL) {
          this.ctx.log.warn('editor refused: outdated protocol', { client: m.client, protocol: m.protocol })
          this.send(c, { type: 'error', code: 'extension-outdated', message: EXTENSION_OUTDATED_MESSAGE })
          c.ws.close()
          return
        }
        this.ctx.log.info('editor hello', { client: m.client })
        return this.send(c, {
          type: 'welcome',
          server: 'squarel-bridge',
          version: SQUAREL_VERSION,
          protocol: BRIDGE_PROTOCOL,
          arts: await this.artList(),
        })
      case 'list':
        return this.send(c, { type: 'arts', arts: await this.artList() })
      case 'ping':
        return this.send(c, { type: 'pong' })
      case 'status':
        return this.send(c, { type: 'status', version: SQUAREL_VERSION, clients: this.clientInfos() })
      case 'open': {
        const { p, art } = await this.resolveRef(m.ref)
        const { versionId, doc } = await p.store.readHead(art)
        c.ref = m.ref
        c.version = versionId
        this.ctx.log.info('editor opened art', { ref: m.ref, versionId })
        return this.send(c, { type: 'doc', ref: m.ref, versionId, doc: serializeDoc(doc) })
      }
      case 'cels': {
        c.ref = m.ref
        const r = await this.applyEditorState(m.ref, m.baseVersion, m.doc, m.label ?? 'Aseprite edit')
        c.version = r.versionId
        this.ctx.log.info('editor edit', { ref: m.ref, base: m.baseVersion, versionId: r.versionId })
        if (r.rebasedDoc)
          return this.send(c, {
            type: 'rebased',
            ref: m.ref,
            versionId: r.versionId,
            doc: r.rebasedDoc,
            warnings: r.warnings,
          })
        return this.send(c, { type: 'ack', ref: m.ref, versionId: r.versionId })
      }
      case 'tool': {
        const ref = m.ref ?? c.ref
        try {
          // Without a ref the tool runs outside any project: art tools fail with NO_PROJECT.
          const ctx = ref ? await this.toolContext(ref) : { ...this.ctx, session: {} }
          const res = await runTool(m.name, m.input ?? {}, ctx)
          return this.send(c, { type: 'tool_result', id: m.id, ok: true, text: res.text, files: res.files })
        } catch (e: any) {
          return this.send(c, {
            type: 'tool_result',
            id: m.id,
            ok: false,
            text: `[${e.code ?? 'ERROR'}] ${e.message}`,
          })
        }
      }
      default:
        return this.send(c, {
          type: 'error',
          code: 'INVALID',
          message: `unknown message type ${(m as { type: string }).type}`,
        })
    }
  }

  /**
   * Turn an editor snapshot into a version. If the art moved on since `baseVersion`,
   * the editor's changes are rebased onto the head and the merged doc is returned.
   */
  async applyEditorState(
    ref: string,
    baseVersion: string,
    json: PixelDocJSON,
    label: string,
  ): Promise<{ versionId: string; rebasedDoc?: PixelDocJSON; warnings: string[] }> {
    const { p, art } = await this.resolveRef(ref)
    const store = p.store
    const incoming = deserializeDoc(json)
    validateDoc(incoming)
    const base = await store.readVersion(art, baseVersion)
    const patch = diff(base, incoming)
    for (let attempt = 0; ; attempt++) {
      const head = await store.readHead(art)
      if (isEmptyPatch(patch)) {
        const moved = head.versionId !== baseVersion
        return {
          versionId: head.versionId,
          rebasedDoc: moved ? serializeDoc(head.doc) : undefined,
          warnings: [],
        }
      }
      // Always replay as a patch: keeps head-only data (title, maxColors) and works whether or not head moved.
      const { doc, warnings } = rebase(patch, head.doc)
      try {
        const versionId = await store.commit(art, {
          baseVersion: head.versionId,
          doc,
          source: 'editor',
          label: `Editor: ${label} (${patch.pixelCount} px)`,
        })
        return {
          versionId,
          rebasedDoc: head.versionId !== baseVersion ? serializeDoc(doc) : undefined,
          warnings,
        }
      } catch (e) {
        if (!(e instanceof ConflictError) || attempt >= 3) throw e
      }
    }
  }

  /** Push the head of `ref` to every client that has it open and does not have it yet. */
  async notify(ref: string, versionId?: string): Promise<void> {
    const targets = [...this.clients].filter((c) => c.ref === ref)
    if (!targets.length) return
    const { p, art } = await this.resolveRef(ref)
    const head = await p.store.readHead(art)
    if (versionId && head.versionId !== versionId) versionId = head.versionId
    const [info] = await p.store.history(art, 1)
    for (const c of targets) {
      if (c.version === head.versionId) continue
      c.version = head.versionId
      this.send(c, {
        type: 'doc.updated',
        ref,
        versionId: head.versionId,
        source: info?.source ?? 'claude',
        label: info?.label ?? '',
        doc: serializeDoc(head.doc),
      })
    }
  }

  // ---- EditorHost ----
  async open(ref: string): Promise<string> {
    const live = [...this.clients].filter((c) => c.name === 'aseprite')
    if (live.length) {
      for (const c of live) this.send(c, { type: 'open.request', ref })
      return `Opened "${ref}" in Aseprite (live sync on). Strokes you draw there come back as new versions.`
    }
    const exe = this.ctx.config.asepritePath
    if (!asepriteAvailable(exe))
      return [
        'Aseprite is not connected and ASEPRITE_PATH is not set or not found.',
        '1) Install Aseprite and the Squarel extension (pnpm aseprite:pack, then double-click squarel.aseprite-extension).',
        '2) Set ASEPRITE_PATH in .env, or open Aseprite yourself: the extension connects to ws://127.0.0.1:' +
          `${this.port || this.ctx.config.bridgePort}/bridge and you can pick the art from the Squarel menu.`,
      ].join('\n')
    const file = await this.writeWorkFile(ref)
    launchAseprite(exe, file)
    return `Launching Aseprite with ${file}. With the Squarel extension installed it syncs live; otherwise just press Ctrl+S in Aseprite and the bridge imports your changes.`
  }

  /** Export head to <art folder>/work.aseprite using Aseprite's batch mode. */
  async writeWorkFile(ref: string): Promise<string> {
    const exe = this.ctx.config.asepritePath
    if (!asepriteAvailable(exe)) throw new Error('ASEPRITE_PATH not set')
    const { p, art } = await this.resolveRef(ref)
    const { versionId, doc } = await p.store.readHead(art)
    const jsonPath = await p.store.writeProjectFile(
      art,
      '.work-in.json',
      JSON.stringify({ ref, slug: art, baseVersion: versionId, doc: serializeDoc(doc) }),
    )
    const out = p.store.projectPath(art, 'work.aseprite')
    await runAsepriteScript(exe, CLI_SCRIPTS.docToAseprite, { in: jsonPath, out })
    await rm(jsonPath, { force: true })
    this.selfWritten.set(out, statSync(out).mtimeMs)
    return out
  }

  /** Import a saved work.aseprite (file round-trip mode). */
  async importWorkFile(ref: string): Promise<string | undefined> {
    const exe = this.ctx.config.asepritePath
    if (!asepriteAvailable(exe)) return undefined
    const { p, art } = await this.resolveRef(ref)
    const file = p.store.projectPath(art, 'work.aseprite')
    const outJson = p.store.projectPath(art, '.work-out.json')
    await runAsepriteScript(exe, CLI_SCRIPTS.asepriteToDoc, { in: file, out: outJson })
    const parsed = JSON.parse(await readFile(outJson, 'utf8')) as { baseVersion: string; doc: PixelDocJSON }
    await rm(outJson, { force: true })
    const r = await this.applyEditorState(ref, parsed.baseVersion, parsed.doc, 'work.aseprite saved')
    await this.notify(ref, r.versionId)
    return r.versionId
  }

  // ---- file watching ----

  /** The watched root holding `path`, and `path` relative to it ('/'-separated). */
  private rootOf(path: string): { root: string; home: string; rel: string } | undefined {
    for (const r of this.roots.values()) {
      const rel = relative(r.root, path)
      if (rel && !rel.startsWith('..') && !isAbsolute(rel)) return { ...r, rel: rel.replace(/\\/g, '/') }
    }
    return undefined
  }

  /** Start watching `<home>/squarel_art` once it exists. */
  private watchRoot(home: string) {
    if (!this.artWatcher) return
    const root = join(home, ART_DIR)
    const key = rootKey(root)
    if (this.roots.has(key) || !existsSync(root)) return
    this.roots.set(key, { root, home })
    this.artWatcher.add(root)
  }

  /** Re-scan the project sources and watch every new art root. */
  private async syncRoots() {
    await this.projects.refresh()
    for (const home of this.projects.homes()) this.watchRoot(home)
  }

  private async startWatchers() {
    const dataDirs = ['run', 'workspaces'].map((d) => join(this.ctx.config.dataDir, d))
    // chokidar only sees inside folders that exist when they are added.
    await Promise.all(dataDirs.map((d) => mkdir(d, { recursive: true })))
    await this.projects.refresh()
    const roots = this.projects
      .homes()
      .map((home) => ({ root: join(home, ART_DIR), home }))
      .filter((r) => existsSync(r.root))
    for (const r of roots) this.roots.set(rootKey(r.root), r)
    this.artWatcher = watch(
      roots.map((r) => r.root),
      {
        ignoreInitial: true,
        depth: 1,
        awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
        ignored: (p) => {
          if (p.endsWith('.tmp')) return true
          const r = this.rootOf(p)
          return r ? IGNORED_IN_ART.test(r.rel) : false
        },
      },
    )
    this.artWatcher.on('change', (p) => this.onArtFile(p)).on('add', (p) => this.onArtFile(p))
    this.dataWatcher = watch(dataDirs, { ignoreInitial: true, depth: 0 })
    const onData = () => this.debounce('projects', 100, () => this.syncRoots())
    this.dataWatcher.on('add', onData).on('change', onData).on('unlink', onData)
    await Promise.all(
      [this.artWatcher, this.dataWatcher].map((w) => new Promise<void>((r) => w.once('ready', () => r()))),
    )
  }

  private debounce(key: string, ms: number, fn: () => Promise<unknown>) {
    clearTimeout(this.pending.get(key))
    this.pending.set(
      key,
      setTimeout(() => {
        this.pending.delete(key)
        fn().catch((e) => this.ctx.log.warn('bridge watcher task failed', { key, error: String(e) }))
      }, ms),
    )
  }

  private onArtFile(path: string) {
    const r = this.rootOf(path)
    const m = r?.rel.match(/^([a-z0-9][a-z0-9-]*)\/(project\.json|work\.aseprite)$/)
    if (!r || !m) return
    const [, art, file] = m
    this.debounce(`${rootKey(r.root)}|${art}/${file}`, 60, async () => {
      // The id is read when the file changes: the project's id may have been edited since.
      const ws = await readWorkspace(r.home)
      const ref = artRef(ws.id, art)
      if (file === 'project.json') await this.notify(ref)
      else await this.onWorkFile(ref, path)
    })
  }

  private async onWorkFile(ref: string, path: string) {
    const mtime = (await stat(path)).mtimeMs
    if (this.selfWritten.get(path) === mtime) return
    if ([...this.clients].some((c) => c.ref === ref)) return // live sync already handles it
    await this.importWorkFile(ref)
  }
}

export function readBridgeToken(dataDir: string): string | undefined {
  const f = join(dataDir, 'bridge.token')
  return existsSync(f) ? readFileSync(f, 'utf8').trim() || undefined : undefined
}
