import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { celKey, createDoc } from '../src/core/index.ts'
import { ConflictError, Store, slugify } from '../src/store/store.ts'
import { celOf, spriteDoc, tempDir } from './helpers.ts'

const run = promisify(execFile)
let t: ReturnType<typeof tempDir>
let store: Store

beforeEach(async () => {
  t = tempDir()
  store = new Store(t.dir)
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
      run(process.execPath, [worker, t.dir, p.slug, '0', '12']),
      run(process.execPath, [worker, t.dir, p.slug, '100', '12']),
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

  it('saves proposals and summarizes usage per day/month', async () => {
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
    const now = new Date()
    await store.appendUsage({
      ts: now.toISOString(),
      provider: 'cloudflare',
      model: 'm',
      op: 'generate',
      units: 43,
      unitKind: 'neuron',
      usd: 0,
      ok: true,
    })
    await store.appendUsage({
      ts: now.toISOString(),
      provider: 'retrodiffusion',
      model: 'm',
      op: 'generate',
      units: 2,
      unitKind: 'credit',
      usd: 0.02,
      ok: true,
    })
    await store.appendUsage({
      ts: '2000-01-01T00:00:00Z',
      provider: 'retrodiffusion',
      model: 'm',
      op: 'generate',
      units: 2,
      unitKind: 'credit',
      usd: 5,
      ok: true,
    })
    const s = await store.usageSummary(now)
    expect(s.todayUsd).toBeCloseTo(0.02)
    expect(s.monthUsd).toBeCloseTo(0.02)
    expect(s.todayNeurons).toBe(43)
  })
})
