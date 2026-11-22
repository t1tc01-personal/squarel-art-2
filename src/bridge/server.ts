import { existsSync, readFileSync, statSync } from 'node:fs'
import { readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { type FSWatcher, watch } from 'chokidar'
import { type WebSocket, WebSocketServer } from 'ws'
import { deserializeDoc, serializeDoc } from '../core/codec.ts'
import { diff, isEmptyPatch, rebase } from '../core/diff.ts'
import { validateDoc } from '../core/doc.ts'
import type { PixelDocJSON } from '../shared/types.ts'
import { ConflictError } from '../store/store.ts'
import { runTool } from '../tools/registry.ts'
import type { EditorHost, ToolContext } from '../tools/types.ts'
import { asepriteAvailable, CLI_SCRIPTS, launchAseprite, runAsepriteScript } from './aseprite-cli.ts'
import { BRIDGE_PATH, type BridgeClientInfo, type ClientMessage, type ServerMessage } from './protocol.ts'

interface Client {
  ws: WebSocket
  name: string
  ext?: string
  app?: string
  connectedAt: string
  lastSeen: string
  slug?: string
  /** Last version this client is known to have (sent to it, or committed by it). */
  version?: string
}

export interface BridgeOptions {
  port: number
  host?: string
  /** Optional shared secret; clients pass it as ?token=… */
  token?: string
  watchFiles?: boolean
}

const VERSION = '0.1.1'

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
 * WebSocket bridge between the store and Aseprite.
 * - pushes every new version of an opened project to the editor (`doc.updated`)
 * - turns editor states into versions via diff + rebase (never loses strokes)
 * - handles the work.aseprite file round-trip when the extension is not running
 */
export class BridgeServer implements EditorHost {
  private ctx: ToolContext
  private opts: BridgeOptions
  private wss?: WebSocketServer
  private watcher?: FSWatcher
  private clients = new Set<Client>()
  /** work.aseprite files we wrote ourselves (path → mtimeMs), so the watcher ignores them. */
  private selfWritten = new Map<string, number>()
  private pending = new Map<string, NodeJS.Timeout>()
  port = 0

  constructor(ctx: ToolContext, opts: BridgeOptions) {
    // Tools run for editor clients use this copy: the bridge itself is their editor integration
    // (the caller usually sets ctx.editor only after constructing us).
    this.ctx = { ...ctx, source: 'editor', session: {}, editor: ctx.editor ?? this }
    this.opts = opts
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
      wss.once('listening', () => {
        this.wss = wss
        const addr = wss.address()
        this.port = typeof addr === 'object' && addr ? addr.port : this.opts.port
        wss.on('connection', (ws) => this.onConnection(ws))
        if (this.opts.watchFiles ?? true) this.startWatcher()
        this.ctx.log.info('bridge listening', { port: this.port })
        resolve(true)
      })
    })
  }

  async stop(): Promise<void> {
    for (const t of this.pending.values()) clearTimeout(t)
    await this.watcher?.close()
    for (const c of this.clients) c.ws.terminate()
    await new Promise<void>((r) => (this.wss ? this.wss.close(() => r()) : r()))
  }

  get connectedClients(): number {
    return this.clients.size
  }

  private send(c: Client, m: ServerMessage) {
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(JSON.stringify(m))
  }

  private clientInfos(): BridgeClientInfo[] {
    return [...this.clients].map((c) => ({
      name: c.name,
      ext: c.ext,
      app: c.app,
      slug: c.slug,
      version: c.version,
      connectedAt: c.connectedAt,
      lastSeen: c.lastSeen,
    }))
  }

  private async projectList() {
    return (await this.ctx.store.listProjects()).map((p) => ({ slug: p.slug, name: p.name, head: p.head }))
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
        this.ctx.log.info('editor hello', { client: m.client })
        return this.send(c, {
          type: 'welcome',
          server: 'squarel-bridge',
          version: VERSION,
          projects: await this.projectList(),
        })
      case 'list':
        return this.send(c, { type: 'projects', projects: await this.projectList() })
      case 'ping':
        return this.send(c, { type: 'pong' })
      case 'status':
        return this.send(c, { type: 'status', version: VERSION, clients: this.clientInfos() })
      case 'open': {
        const { versionId, doc } = await this.ctx.store.readHead(m.slug)
        c.slug = m.slug
        c.version = versionId
        this.ctx.log.info('editor opened project', { slug: m.slug, versionId })
        return this.send(c, { type: 'doc', slug: m.slug, versionId, doc: serializeDoc(doc) })
      }
      case 'cels': {
        c.slug = m.slug
        const r = await this.applyEditorState(m.slug, m.baseVersion, m.doc, m.label ?? 'Aseprite edit')
        c.version = r.versionId
        this.ctx.log.info('editor edit', { slug: m.slug, base: m.baseVersion, versionId: r.versionId })
        if (r.rebasedDoc)
          return this.send(c, {
            type: 'rebased',
            slug: m.slug,
            versionId: r.versionId,
            doc: r.rebasedDoc,
            warnings: r.warnings,
          })
        return this.send(c, { type: 'ack', slug: m.slug, versionId: r.versionId })
      }
      case 'tool': {
        const session = { activeProject: m.slug ?? c.slug }
        try {
          const res = await runTool(m.name, m.input ?? {}, { ...this.ctx, session })
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
   * Turn an editor snapshot into a version. If the project moved on since `baseVersion`,
   * the editor's changes are rebased onto the head and the merged doc is returned.
   */
  async applyEditorState(
    slug: string,
    baseVersion: string,
    json: PixelDocJSON,
    label: string,
  ): Promise<{ versionId: string; rebasedDoc?: PixelDocJSON; warnings: string[] }> {
    const incoming = deserializeDoc(json)
    validateDoc(incoming)
    const base = await this.ctx.store.readVersion(slug, baseVersion)
    const patch = diff(base, incoming)
    for (let attempt = 0; ; attempt++) {
      const head = await this.ctx.store.readHead(slug)
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
        const versionId = await this.ctx.store.commit(slug, {
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

  /** Push the head of `slug` to every client that has it open and does not have it yet. */
  async notify(slug: string, versionId?: string): Promise<void> {
    const targets = [...this.clients].filter((c) => c.slug === slug)
    if (!targets.length) return
    const head = await this.ctx.store.readHead(slug)
    if (versionId && head.versionId !== versionId) versionId = head.versionId
    const [info] = await this.ctx.store.history(slug, 1)
    for (const c of targets) {
      if (c.version === head.versionId) continue
      c.version = head.versionId
      this.send(c, {
        type: 'doc.updated',
        slug,
        versionId: head.versionId,
        source: info?.source ?? 'claude',
        label: info?.label ?? '',
        doc: serializeDoc(head.doc),
      })
    }
  }

  // ---- EditorHost ----
  async open(slug: string): Promise<string> {
    const live = [...this.clients].filter((c) => c.name === 'aseprite')
    if (live.length) {
      for (const c of live) this.send(c, { type: 'open.request', slug })
      return `Opened "${slug}" in Aseprite (live sync on). Strokes you draw there come back as new versions.`
    }
    const exe = this.ctx.config.asepritePath
    if (!asepriteAvailable(exe))
      return [
        'Aseprite is not connected and ASEPRITE_PATH is not set or not found.',
        '1) Install Aseprite and the Squarel extension (pnpm aseprite:pack, then double-click squarel.aseprite-extension).',
        '2) Set ASEPRITE_PATH in .env, or open Aseprite yourself: the extension connects to ws://127.0.0.1:' +
          `${this.port || this.ctx.config.bridgePort}/bridge and you can pick the project from the Squarel menu.`,
      ].join('\n')
    const file = await this.writeWorkFile(slug)
    launchAseprite(exe, file)
    return `Launching Aseprite with ${file}. With the Squarel extension installed it syncs live; otherwise just press Ctrl+S in Aseprite and the bridge imports your changes.`
  }

  /** Export head to <project>/work.aseprite using Aseprite's batch mode. */
  async writeWorkFile(slug: string): Promise<string> {
    const exe = this.ctx.config.asepritePath
    if (!asepriteAvailable(exe)) throw new Error('ASEPRITE_PATH not set')
    const { versionId, doc } = await this.ctx.store.readHead(slug)
    const jsonPath = await this.ctx.store.writeProjectFile(
      slug,
      '.work-in.json',
      JSON.stringify({ slug, baseVersion: versionId, doc: serializeDoc(doc) }),
    )
    const out = this.ctx.store.projectPath(slug, 'work.aseprite')
    await runAsepriteScript(exe, CLI_SCRIPTS.docToAseprite, { in: jsonPath, out })
    await rm(jsonPath, { force: true })
    this.selfWritten.set(out, statSync(out).mtimeMs)
    return out
  }

  /** Import a saved work.aseprite (file round-trip mode). */
  async importWorkFile(slug: string): Promise<string | undefined> {
    const exe = this.ctx.config.asepritePath
    if (!asepriteAvailable(exe)) return undefined
    const file = this.ctx.store.projectPath(slug, 'work.aseprite')
    const outJson = this.ctx.store.projectPath(slug, '.work-out.json')
    await runAsepriteScript(exe, CLI_SCRIPTS.asepriteToDoc, { in: file, out: outJson })
    const parsed = JSON.parse(await readFile(outJson, 'utf8')) as { baseVersion: string; doc: PixelDocJSON }
    await rm(outJson, { force: true })
    const r = await this.applyEditorState(slug, parsed.baseVersion, parsed.doc, 'work.aseprite saved')
    await this.notify(slug, r.versionId)
    return r.versionId
  }

  private startWatcher() {
    const projects = this.ctx.store.projectsDir
    this.watcher = watch(projects, {
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: { stabilityThreshold: 80, pollInterval: 20 },
      ignored: (p) =>
        /[\\/](versions|proposals|exports|assets|\.lock)([\\/]|$)/.test(p) || p.endsWith('.tmp'),
    })
    const onFile = (path: string) => {
      const m = path
        .replace(/\\/g, '/')
        .match(/projects\/([a-z0-9][a-z0-9-]*)\/(project\.json|work\.aseprite)$/)
      if (!m) return
      const [, slug, file] = m
      const key = `${slug}/${file}`
      clearTimeout(this.pending.get(key))
      this.pending.set(
        key,
        setTimeout(() => {
          this.pending.delete(key)
          if (file === 'project.json')
            this.notify(slug).catch((e) => this.ctx.log.warn('notify failed', { error: String(e) }))
          else
            this.onWorkFile(slug, path).catch((e) =>
              this.ctx.log.warn('work file import failed', { error: String(e) }),
            )
        }, 60),
      )
    }
    this.watcher.on('change', onFile).on('add', onFile)
  }

  private async onWorkFile(slug: string, path: string) {
    const mtime = (await stat(path)).mtimeMs
    if (this.selfWritten.get(path) === mtime) return
    if ([...this.clients].some((c) => c.slug === slug)) return // live sync already handles it
    await this.importWorkFile(slug)
  }
}

export function readBridgeToken(dataDir: string): string | undefined {
  const f = join(dataDir, 'bridge.token')
  return existsSync(f) ? readFileSync(f, 'utf8').trim() || undefined : undefined
}
