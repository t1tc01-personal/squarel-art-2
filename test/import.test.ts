import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createDoc } from '../src/core/index.ts'
import { silentLogger } from '../src/log.ts'
import { MockProvider } from '../src/providers/mock.ts'
import { withLock } from '../src/store/fsutil.ts'
import { importLegacyArt } from '../src/store/import.ts'
import { Store } from '../src/store/store.ts'
import { readWorkspace } from '../src/store/workspace.ts'
import { createToolContext } from '../src/tools/context.ts'
import { runTool } from '../src/tools/registry.ts'
import { makeProjectFolder, tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
let legacy: Store
let target: Store

async function seed(slug = 'hero') {
  const w = new Store(join(t.dir, 'projects'), { log: silentLogger })
  const doc = createDoc({ width: 8, height: 8, purpose: 'game' })
  const info = await w.createProject({ name: 'Hero', doc, source: 'claude', slug })
  await w.restore(slug, info.head, 'claude')
  await w.restore(slug, info.head, 'claude')
  return w
}

beforeEach(async () => {
  t = tempDir()
  const folder = makeProjectFolder(t.dir)
  const ws = await readWorkspace(folder)
  target = new Store(join(folder, 'squarel_art'), { log: silentLogger, project: ws })
  await seed()
  legacy = new Store(join(t.dir, 'projects'), { readOnly: 'legacy is read-only' })
})
afterEach(() => t.cleanup())

describe('importLegacyArt', () => {
  it('moves an art with its history', async () => {
    const count = () =>
      readdirSync(legacy.projectPath('hero', 'versions')).filter((f) => f.endsWith('.gz')).length
    const head = (await legacy.info('hero')).head
    const hist = (await legacy.history('hero', 100)).length
    const n = count()
    const r = await importLegacyArt(legacy, target, 'hero', { log: silentLogger })
    expect(r.slug).toBe('hero')
    expect(existsSync(legacy.projectPath('hero'))).toBe(false)
    expect(readdirSync(target.projectPath('hero', 'versions')).filter((f) => f.endsWith('.gz')).length).toBe(
      n,
    )
    expect((await target.info('hero')).head).toBe(head)
    expect((await target.history('hero', 100)).length).toBe(hist)
    const pj = JSON.parse(readFileSync(target.projectPath('hero', 'project.json'), 'utf8'))
    expect(pj).not.toHaveProperty('workspace')
    expect(existsSync(target.projectPath('hero', 'thumb.png'))).toBe(true)
    expect(readFileSync(join(target.root, '..', '.squarel', 'arts.md'), 'utf8')).toContain('hero')
  })

  it('an id taken in the project gets -2', async () => {
    await target.createProject({
      name: 'Hero',
      doc: createDoc({ width: 8, height: 8, purpose: 'game' }),
      source: 'claude',
      slug: 'hero',
    })
    expect((await importLegacyArt(legacy, target, 'hero')).slug).toBe('hero-2')
    expect((await target.info('hero-2')).slug).toBe('hero-2')
  })

  it('a failure after copying keeps the source and removes the temp copy', async () => {
    let n = 0
    const fs = {
      cp: (await import('node:fs/promises')).cp,
      rename: (await import('node:fs/promises')).rename,
      rm: async (...a: Parameters<typeof import('node:fs/promises').rm>) => {
        if (n++ === 0) throw new Error('disk gone')
        return (await import('node:fs/promises')).rm(...a)
      },
    }
    await expect(importLegacyArt(legacy, target, 'hero', { fs })).rejects.toThrow('disk gone')
    expect(await legacy.hasProject('hero')).toBe(true)
    expect(existsSync(join(target.root, '.hero.importing'))).toBe(false)
    expect(existsSync(target.projectPath('hero'))).toBe(false)
  })

  describe('failures keep the source', () => {
    const real = () => import('node:fs/promises')
    const gone = () => {
      expect(existsSync(join(target.root, '.hero.importing'))).toBe(false)
      expect(existsSync(target.projectPath('hero'))).toBe(false)
    }

    it('a rename that fails (not EXDEV)', async () => {
      const r = await real()
      const fs = {
        cp: r.cp,
        rm: r.rm,
        rename: async () => {
          throw Object.assign(new Error('denied'), { code: 'EPERM' })
        },
      }
      await expect(importLegacyArt(legacy, target, 'hero', { fs })).rejects.toThrow('denied')
      expect(await legacy.hasProject('hero')).toBe(true)
      gone()
    })

    it('the cross-drive copy fails', async () => {
      const r = await real()
      let n = 0
      const fs = {
        rm: r.rm,
        rename: async () => {
          throw Object.assign(new Error('x'), { code: 'EXDEV' })
        },
        cp: async (...a: Parameters<typeof r.cp>) => {
          await r.cp(...a)
          if (n++ === 1) throw new Error('copy broke')
        },
      }
      await expect(importLegacyArt(legacy, target, 'hero', { fs })).rejects.toThrow('copy broke')
      expect(await legacy.hasProject('hero')).toBe(true)
      gone()
    })

    it('a half-removed source keeps the imported copy and warns', async () => {
      const r = await real()
      const warns: string[] = []
      const log = { ...silentLogger, warn: (m: string) => void warns.push(m) }
      const fs = {
        cp: r.cp,
        rename: r.rename,
        rm: async (path: Parameters<typeof r.rm>[0]) => {
          if (String(path) === legacy.projectPath('hero')) {
            await r.rm(legacy.projectPath('hero', 'thumb.png'), { force: true })
            await r.rm(legacy.projectPath('hero', 'project.json'))
            throw new Error('rm broke')
          }
        },
      }
      await expect(importLegacyArt(legacy, target, 'hero', { fs, log })).rejects.toThrow('rm broke')
      expect(await target.hasProject('hero')).toBe(true)
      expect(warns.length).toBe(1)
    })
  })

  it('works across drives', async () => {
    const real = await import('node:fs/promises')
    const fs = {
      cp: real.cp,
      rm: real.rm,
      rename: async () => {
        throw Object.assign(new Error('x'), { code: 'EXDEV' })
      },
    }
    const r = await importLegacyArt(legacy, target, 'hero', { fs })
    expect(await target.hasProject(r.slug)).toBe(true)
    expect(existsSync(legacy.projectPath('hero'))).toBe(false)
  })

  it('refuses while the source is locked', async () => {
    void withLock(legacy.projectPath('hero', '.lock'), () => new Promise<never>(() => {}))
    await new Promise((r) => setTimeout(r, 50))
    await expect(importLegacyArt(legacy, target, 'hero')).rejects.toThrow(/lock/)
    expect(await legacy.hasProject('hero')).toBe(true)
    expect(existsSync(target.projectPath('hero'))).toBe(false)
  }, 20_000)

  it('refuses an unknown slug', async () => {
    mkdirSync(target.root, { recursive: true })
    await expect(importLegacyArt(legacy, target, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('art_import tool reports the move', async () => {
    const ctx = await createToolContext({
      projectStart: join(target.root, '..'),
      config: { dataDir: t.dir, imageProvider: 'mock', previewPx: 0 },
      providers: { mock: new MockProvider() },
      log: silentLogger,
    })
    const r = await runTool('art_import', { slug: 'hero' }, ctx)
    expect(r.text).toBe(`Moved "Hero" into Game as "hero" (${target.projectPath('hero')}).`)
  })
})
