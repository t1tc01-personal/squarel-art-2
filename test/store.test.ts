import { execFile } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { celKey, createDoc } from '../src/core/index.ts'
import { ConflictError, Store, slugify } from '../src/store/store.ts'
import { ART_GITIGNORE, catalogPath, type Workspace } from '../src/store/workspace.ts'
import { celOf, spriteDoc, tempDir } from './helpers.ts'

const run = promisify(execFile)
let t: ReturnType<typeof tempDir>
let store: Store

beforeEach(async () => {
  t = tempDir()
  store = new Store(join(t.dir, 'squarel_art'))
  await store.init()
})
afterEach(() => t.cleanup())

describe('store', () => {
  it('slugifies Vietnamese names and refuses path escapes', () => {
    expect(slugify('Hiệp sĩ Đỏ #1')).toBe('hiep-si-do-1')
    expect(slugify('***')).toBe('project')
    expect(() => store.projectDir('../etc')).toThrow()
    expect(() => store.projectPath('ok', '..', 'other')).toThrow(/escapes/)
  })

  it('creates projects with unique slugs and reads head', async () => {
    const a = await store.createProject({ name: 'Knight', doc: spriteDoc(), source: 'claude' })
    const b = await store.createProject({ name: 'Knight', doc: spriteDoc(), source: 'claude' })
    expect(a.slug).toBe('knight')
    expect(b.slug).toBe('knight-2')
    const head = await store.readHead('knight')
    expect(head.versionId).toBe('v000001')
    expect(head.doc.palette).toEqual(spriteDoc().palette)
    expect(celOf(head.doc)).toEqual(celOf(spriteDoc()))
    expect((await store.listProjects()).map((p) => p.slug).sort()).toEqual(['knight', 'knight-2'])
  })

  it('commit enforces baseVersion (optimistic concurrency)', async () => {
    const p = await store.createProject({ name: 'x', doc: spriteDoc(), source: 'claude' })
    const { doc } = await store.readHead(p.slug)
    await store.commit(p.slug, { baseVersion: 'v000001', doc, source: 'editor', label: 'a' })
    await expect(
      store.commit(p.slug, { baseVersion: 'v000001', doc, source: 'editor', label: 'b' }),
    ).rejects.toBeInstanceOf(ConflictError)
  })

  it('rejects invalid docs before writing', async () => {
    const p = await store.createProject({ name: 'x', doc: spriteDoc(), source: 'claude' })
    const { doc, versionId } = await store.readHead(p.slug)
    celOf(doc)[0] = 250
    await expect(
      store.commit(p.slug, { baseVersion: versionId, doc, source: 'claude', label: 'bad' }),
    ).rejects.toThrow(/invalid doc/)
    expect((await store.readHead(p.slug)).versionId).toBe('v000001')
  })

  it('undo walks back repeatedly and history is never rewritten', async () => {
    const p = await store.createProject({
      name: 'u',
      doc: createDoc({ width: 4, height: 4, purpose: 'game' }),
      source: 'claude',
    })
    for (let i = 0; i < 3; i++)
      await store.withHead(p.slug, 'claude', `px ${i}`, (doc) => {
        celOf(doc)[i] = 1
      })
    // v4 has pixels 0,1,2
    let r = await store.undo(p.slug, 'claude')
    expect(r.restored).toBe('v000003')
    expect([...celOf(r.doc).slice(0, 3)]).toEqual([1, 1, 0])
    r = await store.undo(p.slug, 'claude')
    expect(r.restored).toBe('v000002')
    r = await store.undo(p.slug, 'claude')
    expect(r.restored).toBe('v000001')
    await expect(store.undo(p.slug, 'claude')).rejects.toThrow(/nothing to undo/)
    const hist = await store.history(p.slug, 100)
    expect(hist).toHaveLength(7)
    const back = await store.restore(p.slug, 'v000004', 'claude')
    expect([...celOf(back.doc).slice(0, 3)]).toEqual([1, 1, 1])
  })

  it('serializes concurrent writers from two processes without losing changes', async () => {
    const p = await store.createProject({
      name: 'race',
      doc: createDoc({ width: 16, height: 16, purpose: 'game' }),
      source: 'claude',
    })
    const worker = join(import.meta.dirname, 'fixtures', 'commit-worker.ts')
    await Promise.all([
      run(process.execPath, [worker, store.root, p.slug, '0', '12']),
      run(process.execPath, [worker, store.root, p.slug, '100', '12']),
    ])
    const { versionId, doc } = await store.readHead(p.slug)
    expect(versionId).toBe('v000025')
    const cel = doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)]
    for (let i = 0; i < 12; i++) {
      expect(cel[i]).toBe(1)
      expect(cel[100 + i]).toBe(1)
    }
    expect(existsSync(store.projectPath(p.slug, '.lock'))).toBe(false)
  }, 60000)

  it('saves and lists proposals', async () => {
    const p = await store.createProject({ name: 'p', doc: spriteDoc(), source: 'claude' })
    await store.saveProposal(
      p.slug,
      {
        id: 'p_test1',
        createdAt: new Date().toISOString(),
        kind: 'generate',
        baseVersion: 'v000001',
        request: { prompt: 'x' },
        provider: 'mock',
        model: 'mock',
        costUsd: 0,
        variants: [],
        status: 'open',
      },
      { 'sheet.png': new Uint8Array([1, 2, 3]) },
    )
    expect((await store.listProposals(p.slug, 'open')).map((x) => x.id)).toEqual(['p_test1'])
    expect([...(await store.readProposalFile(p.slug, 'p_test1', 'sheet.png'))]).toEqual([1, 2, 3])
    await expect(store.readProposal(p.slug, '../x')).rejects.toThrow()
  })

  it('init on a project store writes .gitignore once and never overwrites it', async () => {
    const ws = { id: 'w', name: 'W', folder: t.dir, home: t.dir, config: {} } as unknown as Workspace
    const root = join(t.dir, 'kept', 'squarel_art')
    const kept = new Store(root, { project: ws, hooks: false })
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, '.gitignore'), 'custom\n')
    await kept.init()
    expect(readFileSync(join(root, '.gitignore'), 'utf8')).toBe('custom\n')
    const fresh = join(t.dir, 'fresh', 'squarel_art')
    await new Store(fresh, { project: ws, hooks: false }).init()
    expect(readFileSync(join(fresh, '.gitignore'), 'utf8')).toBe(ART_GITIGNORE)
  })

  it('listProjects on a missing root returns [] and creates nothing', async () => {
    const root = join(t.dir, 'nope', 'squarel_art')
    expect(await new Store(root).listProjects()).toEqual([])
    expect(existsSync(root)).toBe(false)
  })

  it('a readOnly store refuses writes with its reason', async () => {
    const s = new Store(join(t.dir, 'legacy'), { readOnly: 'legacy art is read-only' })
    await expect(s.createProject({ name: 'x', doc: spriteDoc(), source: 'claude' })).rejects.toThrow(
      'legacy art',
    )
    const meta = {
      id: 'p_x',
      createdAt: '',
      kind: 'generate' as const,
      baseVersion: '',
      request: {},
      provider: 'mock',
      model: 'mock',
      costUsd: 0,
      variants: [],
      status: 'open' as const,
    }
    const writes: Promise<unknown>[] = [
      s.writeProjectFile('x', 'a.txt', 'a'),
      s.commit('x', { baseVersion: '', doc: spriteDoc(), source: 'claude', label: 'l' }),
      s.withHead('x', 'claude', 'l', () => {}),
      s.restore('x', 'v000001', 'claude'),
      s.undo('x', 'claude'),
      s.saveProposal('x', meta, {}),
      s.updateProposal('x', meta),
    ]
    for (const w of writes) await expect(w).rejects.toThrow('legacy art')
  })

  it('init on a readOnly store is a no-op that creates nothing', async () => {
    const root = join(t.dir, 'legacy-missing')
    const ws = { id: 'w', name: 'W', folder: t.dir, home: t.dir, config: {} } as unknown as Workspace
    await expect(new Store(root, { readOnly: 'r', project: ws }).init()).resolves.toBeUndefined()
    expect(existsSync(root)).toBe(false)
  })

  it('the catalog goes to <home>/.squarel/arts.md', async () => {
    const ws = { id: 'w', name: 'W', folder: t.dir, home: t.dir, config: {} } as unknown as Workspace
    const s = new Store(join(t.dir, 'squarel_art'), { project: ws })
    await s.createProject({ name: 'Knight', doc: spriteDoc(), source: 'claude' })
    const md = readFileSync(catalogPath(t.dir), 'utf8')
    expect(md).toContain('## Knight')
    expect(md).toContain('`knight`')
  })
})
