import { appendFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve, sep } from 'node:path'
import { gunzipSync, gzipSync } from 'fflate'
import { deserializeDoc, serializeDoc } from '../core/codec.ts'
import { validateDoc } from '../core/doc.ts'
import type { PixelDoc, PixelDocJSON, Purpose, Source } from '../shared/types.ts'
import { exists, readJson, withLock, writeAtomic } from './fsutil.ts'

export interface ProjectInfo {
  slug: string
  name: string
  purpose: Purpose
  createdAt: string
  updatedAt: string
  head: string
}

export interface VersionInfo {
  id: string
  parent: string | null
  ts: string
  source: Source
  label: string
  bytes: number
  /** Set when this version restores the content of an earlier one (undo/restore). */
  contentOf?: string
}

export class ConflictError extends Error {
  readonly head: string
  constructor(head: string) {
    super(`head moved to ${head}`)
    this.head = head
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export function slugify(name: string): string {
  const s = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
  return s || 'project'
}

export class Store {
  readonly dataDir: string
  constructor(dataDir: string) {
    this.dataDir = resolve(dataDir)
  }

  get projectsDir(): string {
    return join(this.dataDir, 'projects')
  }
  get inboxDir(): string {
    return join(this.dataDir, 'inbox')
  }

  projectDir(slug: string): string {
    if (!SLUG_RE.test(slug)) throw new Error(`invalid project slug "${slug}"`)
    return join(this.projectsDir, slug)
  }

  /** Resolve a path inside a project, refusing anything that escapes it. */
  projectPath(slug: string, ...parts: string[]): string {
    const root = this.projectDir(slug)
    const p = resolve(root, ...parts)
    if (p !== root && !p.startsWith(root + sep)) throw new Error('path escapes project directory')
    return p
  }

  async init(): Promise<void> {
    await mkdir(this.projectsDir, { recursive: true })
    await mkdir(this.inboxDir, { recursive: true })
  }

  async listProjects(): Promise<ProjectInfo[]> {
    await this.init()
    const out: ProjectInfo[] = []
    for (const e of await readdir(this.projectsDir, { withFileTypes: true })) {
      if (!e.isDirectory() || !SLUG_RE.test(e.name)) continue
      try {
        out.push(await this.info(e.name))
      } catch {
        /* skip broken project */
      }
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async info(slug: string): Promise<ProjectInfo> {
    const file = this.projectPath(slug, 'project.json')
    if (!(await exists(file))) throw new Error(`project "${slug}" not found`)
    return readJson<ProjectInfo>(file)
  }

  async hasProject(slug: string): Promise<boolean> {
    return SLUG_RE.test(slug) && exists(this.projectPath(slug, 'project.json'))
  }

  async createProject(o: {
    name: string
    doc: PixelDoc
    source: Source
    slug?: string
  }): Promise<ProjectInfo> {
    await this.init()
    validateDoc(o.doc)
    const base = o.slug ?? slugify(o.name)
    let slug = base
    for (let i = 2; await exists(this.projectDir(slug)); i++) slug = `${base}-${i}`.slice(0, 64)
    const dir = this.projectDir(slug)
    await mkdir(join(dir, 'versions'), { recursive: true })
    const now = new Date().toISOString()
    const info: ProjectInfo = {
      slug,
      name: o.name,
      purpose: o.doc.meta.purpose,
      createdAt: now,
      updatedAt: now,
      head: '',
    }
    await writeAtomic(join(dir, 'project.json'), JSON.stringify(info, null, 2))
    const head = await this.commit(slug, {
      baseVersion: '',
      doc: o.doc,
      source: o.source,
      label: 'Create project',
    })
    return { ...info, head }
  }

  async readHead(slug: string): Promise<{ versionId: string; doc: PixelDoc }> {
    const info = await this.info(slug)
    return { versionId: info.head, doc: await this.readVersion(slug, info.head) }
  }

  async readVersion(slug: string, id: string): Promise<PixelDoc> {
    if (!/^v\d{6}$/.test(id)) throw new Error(`invalid version id "${id}"`)
    const file = this.projectPath(slug, 'versions', `${id}.json.gz`)
    if (!(await exists(file))) throw new Error(`version ${id} not found in ${slug}`)
    const raw = await readFile(file)
    const json = JSON.parse(new TextDecoder().decode(gunzipSync(raw))) as { doc: PixelDocJSON }
    return deserializeDoc(json.doc)
  }

  /** Append a version. Throws ConflictError if head !== baseVersion. */
  async commit(
    slug: string,
    c: { baseVersion: string; doc: PixelDoc; source: Source; label: string; contentOf?: string },
  ): Promise<string> {
    validateDoc(c.doc)
    return withLock(this.projectPath(slug, '.lock'), () => this.commitLocked(slug, c))
  }

  /** Commit body; caller must hold the project lock. */
  private async commitLocked(
    slug: string,
    c: { baseVersion: string; doc: PixelDoc; source: Source; label: string; contentOf?: string },
  ): Promise<string> {
    {
      const info = await this.info(slug)
      if (info.head !== c.baseVersion) throw new ConflictError(info.head)
      const index = await this.readIndex(slug)
      const id = `v${String(index.length + 1).padStart(6, '0')}`
      const ts = new Date().toISOString()
      const body = gzipSync(
        new TextEncoder().encode(
          JSON.stringify({
            id,
            parent: info.head || null,
            ts,
            source: c.source,
            label: c.label,
            doc: serializeDoc(c.doc),
          }),
        ),
      )
      await writeAtomic(this.projectPath(slug, 'versions', `${id}.json.gz`), body)
      const entry: VersionInfo = {
        id,
        parent: info.head || null,
        ts,
        source: c.source,
        label: c.label,
        bytes: body.length,
        ...(c.contentOf ? { contentOf: c.contentOf } : {}),
      }
      await appendFile(this.projectPath(slug, 'versions', 'index.jsonl'), `${JSON.stringify(entry)}\n`)
      await writeAtomic(
        this.projectPath(slug, 'project.json'),
        JSON.stringify({ ...info, head: id, updatedAt: ts, purpose: c.doc.meta.purpose }, null, 2),
      )
      return id
    }
  }

  /**
   * Read head → mutate → commit, all under the project lock, so concurrent writers
   * (Claude, Aseprite bridge, CLI in other processes) are serialized and never lose changes.
   * `fn` must be quick (pure doc edits); do slow work (AI calls) before calling this.
   */
  async withHead<T = void>(
    slug: string,
    source: Source,
    label: string,
    fn: (doc: PixelDoc, versionId: string) => T | Promise<T>,
  ): Promise<{ versionId: string; doc: PixelDoc; result: T }> {
    return withLock(this.projectPath(slug, '.lock'), async () => {
      const { versionId, doc } = await this.readHead(slug)
      const result = await fn(doc, versionId)
      validateDoc(doc)
      const id = await this.commitLocked(slug, { baseVersion: versionId, doc, source, label })
      return { versionId: id, doc, result }
    })
  }

  async readIndex(slug: string): Promise<VersionInfo[]> {
    const file = this.projectPath(slug, 'versions', 'index.jsonl')
    if (!(await exists(file))) return []
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as VersionInfo)
  }

  async history(slug: string, limit = 20): Promise<VersionInfo[]> {
    return (await this.readIndex(slug)).slice(-limit).reverse()
  }

  /** Restore the content of `id` as a new version (history is never rewritten). */
  async restore(
    slug: string,
    id: string,
    source: Source,
    label?: string,
  ): Promise<{ versionId: string; doc: PixelDoc }> {
    const doc = await this.readVersion(slug, id)
    return withLock(this.projectPath(slug, '.lock'), async () => {
      const info = await this.info(slug)
      const versionId = await this.commitLocked(slug, {
        baseVersion: info.head,
        doc,
        source,
        label: label ?? `Restore ${id}`,
        contentOf: id,
      })
      return { versionId, doc }
    })
  }

  /** Step back one version from what is currently shown (repeated undo keeps walking back). */
  async undo(slug: string, source: Source): Promise<{ versionId: string; doc: PixelDoc; restored: string }> {
    const index = await this.readIndex(slug)
    const byId = new Map(index.map((v) => [v.id, v]))
    const info = await this.info(slug)
    const effective = (id: string) => byId.get(id)?.contentOf ?? id
    const current = byId.get(effective(info.head))
    if (!current?.parent) throw new Error('nothing to undo')
    const target = effective(current.parent)
    const r = await this.restore(slug, target, source, `Undo → ${target}`)
    return { ...r, restored: target }
  }

  async writeProjectFile(slug: string, rel: string, data: string | Uint8Array): Promise<string> {
    const p = this.projectPath(slug, rel)
    await writeAtomic(p, data)
    return p
  }

  async writeExport(slug: string, name: string, data: Uint8Array): Promise<string> {
    return this.writeProjectFile(slug, join('exports', basename(name)), data)
  }

  // ---- proposals ----
  async saveProposal(
    slug: string,
    meta: ProposalMeta,
    files: Record<string, Uint8Array | string>,
  ): Promise<void> {
    for (const [name, data] of Object.entries(files))
      await this.writeProjectFile(slug, join('proposals', meta.id, name), data)
    await this.writeProjectFile(slug, join('proposals', meta.id, 'meta.json'), JSON.stringify(meta, null, 2))
  }

  async readProposal(slug: string, id: string): Promise<ProposalMeta> {
    if (!/^p_[a-z0-9]+$/.test(id)) throw new Error(`invalid proposal id "${id}"`)
    const file = this.projectPath(slug, 'proposals', id, 'meta.json')
    if (!(await exists(file))) throw new Error(`proposal ${id} not found in ${slug}`)
    return readJson<ProposalMeta>(file)
  }

  async readProposalFile(slug: string, id: string, name: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.projectPath(slug, 'proposals', id, basename(name))))
  }

  async updateProposal(slug: string, meta: ProposalMeta): Promise<void> {
    await this.writeProjectFile(slug, join('proposals', meta.id, 'meta.json'), JSON.stringify(meta, null, 2))
  }

  async listProposals(slug: string, status?: ProposalMeta['status']): Promise<ProposalMeta[]> {
    const dir = this.projectPath(slug, 'proposals')
    if (!(await exists(dir))) return []
    const out: ProposalMeta[] = []
    for (const e of await readdir(dir, { withFileTypes: true }))
      if (e.isDirectory())
        try {
          const m = await this.readProposal(slug, e.name)
          if (!status || m.status === status) out.push(m)
        } catch {
          /* ignore partial proposal */
        }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }

  // ---- usage ----
  async appendUsage(e: UsageEntry): Promise<void> {
    await mkdir(this.dataDir, { recursive: true })
    await appendFile(join(this.dataDir, 'usage.jsonl'), `${JSON.stringify(e)}\n`)
  }

  async usageEntries(): Promise<UsageEntry[]> {
    const file = join(this.dataDir, 'usage.jsonl')
    if (!(await exists(file))) return []
    return (await readFile(file, 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as UsageEntry)
  }

  async usageSummary(now = new Date()): Promise<UsageSummary> {
    const day = now.toISOString().slice(0, 10)
    const month = day.slice(0, 7)
    const s: UsageSummary = { todayUsd: 0, monthUsd: 0, todayNeurons: 0, todayCalls: 0, byProvider: {} }
    for (const e of await this.usageEntries()) {
      if (e.ts.slice(0, 7) !== month) continue
      s.monthUsd += e.usd
      if (e.ts.slice(0, 10) === day) {
        s.todayUsd += e.usd
        s.todayCalls++
        if (e.unitKind === 'neuron') s.todayNeurons += e.units
        s.byProvider[e.provider] = (s.byProvider[e.provider] ?? 0) + e.usd
      }
    }
    return s
  }

  /** Raw write for tests and tools that need a file next to the doc. */
  async writeRaw(path: string, data: string | Uint8Array): Promise<void> {
    await writeFile(path, data)
  }
}

export interface ProposalVariant {
  n: number
  raw: string
  normalized: string
  metrics: import('../core/normalize.ts').NormalizeReport
}

export interface ProposalMeta {
  id: string
  createdAt: string
  kind: 'generate' | 'edit' | 'animate'
  baseVersion: string
  request: Record<string, unknown>
  provider: string
  model: string
  costUsd: number
  variants: ProposalVariant[]
  status: 'open' | 'accepted' | 'discarded'
  acceptedVariant?: number
  acceptedInVersion?: string
}

export interface UsageEntry {
  ts: string
  provider: string
  model: string
  op: string
  units: number
  unitKind: 'neuron' | 'credit' | 'none'
  usd: number
  project?: string
  proposal?: string
  ok: boolean
}

export interface UsageSummary {
  todayUsd: number
  monthUsd: number
  todayNeurons: number
  todayCalls: number
  byProvider: Record<string, number>
}
