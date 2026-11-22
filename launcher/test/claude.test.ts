import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copySkills, registerMcp } from '../src/main/claude'
import { createDeps } from '../src/main/deps'

describe('registerMcp', () => {
  const dir = resolve('/Squarel Art/app dir')
  const entry = join(dir, 'src', 'mcp', 'index.ts')
  const removeCmd = 'claude mcp remove squarel --scope user'
  const addCmd = (p: string) => `claude mcp add squarel --scope user -- node ${p}`

  it('registerMcp passes the absolute path as a single argv item', async () => {
    const calls: { argv: string[]; cwd: string }[] = []
    const d = createDeps('fake', { files: { [entry]: '' } })
    d.run = async (spec) => {
      calls.push({ argv: spec.argv, cwd: spec.cwd })
      if (spec.argv[2] === 'add') spec.onLine?.('Added', 'stdout')
      return { code: spec.argv[2] === 'add' ? 0 : 1 }
    }
    const r = await registerMcp(dir, d)
    expect(r.ok).toBe(true)
    expect(r.output).toContain('Added')
    expect(calls).toHaveLength(2)
    expect(calls[0]?.argv.join(' ')).toBe(removeCmd)
    expect(calls[1]?.argv).toEqual([
      'claude',
      'mcp',
      'add',
      'squarel',
      '--scope',
      'user',
      '--',
      'node',
      entry,
    ])
    expect(calls.every((c) => c.cwd === dir)).toBe(true)
  })

  it('ignores remove failure but reports add failure', async () => {
    const d = createDeps('fake', {
      files: { [entry]: '' },
      run: { [removeCmd]: { code: 1 }, [addCmd(entry)]: { code: 3 } },
    })
    expect((await registerMcp(dir, d)).ok).toBe(false)
  })

  it('refuses relative dirs and missing entry without running anything', async () => {
    let ran = 0
    const run = async () => {
      ran++
      return { code: 0 }
    }
    const d = createDeps('fake', { files: { [entry]: '' } })
    d.run = run
    expect((await registerMcp('relative/dir', d)).ok).toBe(false)
    const missing = createDeps('fake')
    missing.run = run
    const r = await registerMcp(dir, missing)
    expect(r.ok).toBe(false)
    expect(r.output).not.toBe('')
    expect(ran).toBe(0)
  })
})

describe('copySkills', () => {
  let root = ''
  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('copySkills replaces only pixel-* folders and leaves other skills untouched', async () => {
    root = await mkdtemp(join(tmpdir(), 'sq-skills-'))
    const sq = join(root, 'sq')
    const home = join(root, 'home')
    const src = join(sq, '.claude', 'skills')
    const dst = join(home, '.claude', 'skills')
    await mkdir(join(src, 'pixel-b', 'sub'), { recursive: true })
    await mkdir(join(src, 'pixel-a'), { recursive: true })
    await mkdir(join(src, 'other-src'), { recursive: true })
    await writeFile(join(src, 'pixel-a', 'SKILL.md'), 'new-a')
    await writeFile(join(src, 'pixel-b', 'sub', 'x.txt'), 'new-b')
    await writeFile(join(src, 'other-src', 'SKILL.md'), 'nope')
    await writeFile(join(src, 'pixel-file'), 'not a dir')
    await mkdir(join(dst, 'pixel-a'), { recursive: true })
    await mkdir(join(dst, 'pixel-gone'), { recursive: true })
    await mkdir(join(dst, 'mine'), { recursive: true })
    await writeFile(join(dst, 'pixel-a', 'old.txt'), 'old')
    await writeFile(join(dst, 'pixel-gone', 'SKILL.md'), 'keep')
    await writeFile(join(dst, 'mine', 'SKILL.md'), 'mine')
    try {
      await symlink(sq, join(src, 'pixel-link'), 'junction')
    } catch {
      // symlinks unavailable: the skip rule is still covered by the filter
    }

    const names = await copySkills(sq, home, createDeps('real'))
    expect(names).toEqual(['pixel-a', 'pixel-b'])
    expect(await readFile(join(dst, 'pixel-a', 'SKILL.md'), 'utf8')).toBe('new-a')
    expect(await readdir(join(dst, 'pixel-a'))).toEqual(['SKILL.md'])
    expect(await readFile(join(dst, 'pixel-b', 'sub', 'x.txt'), 'utf8')).toBe('new-b')
    expect(await readFile(join(dst, 'mine', 'SKILL.md'), 'utf8')).toBe('mine')
    expect(await readFile(join(dst, 'pixel-gone', 'SKILL.md'), 'utf8')).toBe('keep')
    expect((await readdir(dst)).sort()).toEqual(['mine', 'pixel-a', 'pixel-b', 'pixel-gone'])
  })

  async function setup() {
    root = await mkdtemp(join(tmpdir(), 'sq-skills-'))
    const sq = join(root, 'sq')
    const home = join(root, 'home')
    const src = join(sq, '.claude', 'skills', 'pixel-a')
    const dst = join(home, '.claude', 'skills')
    await mkdir(src, { recursive: true })
    await writeFile(join(src, 'SKILL.md'), 'new')
    await mkdir(join(dst, 'pixel-a'), { recursive: true })
    await writeFile(join(dst, 'pixel-a', 'SKILL.md'), 'old')
    return { sq, home, dst }
  }

  it('keeps the old skill when the final rename fails, and sweeps leftovers next time', async () => {
    const { sq, home, dst } = await setup()
    const d = createDeps('real')
    const realRename = d.fs.rename
    d.fs = {
      ...d.fs,
      rename: async (a, b) => {
        if (String(a).includes('.tmp-')) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        return realRename(a, b)
      },
    }
    await expect(copySkills(sq, home, d)).rejects.toThrow('EPERM')
    expect(await readFile(join(dst, 'pixel-a', 'SKILL.md'), 'utf8')).toBe('old')
    expect((await readdir(dst)).sort()).toEqual(['pixel-a'])

    await mkdir(join(dst, '.pixel-zz.tmp-1'))
    await mkdir(join(dst, '.pixel-zz.bak-1'))
    await writeFile(join(dst, '.other'), 'x')
    expect(await copySkills(sq, home, createDeps('real'))).toEqual(['pixel-a'])
    expect(await readFile(join(dst, 'pixel-a', 'SKILL.md'), 'utf8')).toBe('new')
    expect((await readdir(dst)).sort()).toEqual(['.other', 'pixel-a'])
  })

  it('does not follow a junction at the destination', async (ctx) => {
    const { sq, home, dst } = await setup()
    const sentinel = join(root, 'sentinel')
    await mkdir(sentinel)
    await writeFile(join(sentinel, 'keep.txt'), 'keep')
    await rm(join(dst, 'pixel-a'), { recursive: true })
    try {
      await symlink(sentinel, join(dst, 'pixel-a'), 'junction')
    } catch {
      ctx.skip()
      return
    }
    await copySkills(sq, home, createDeps('real'))
    expect(await readFile(join(sentinel, 'keep.txt'), 'utf8')).toBe('keep')
    expect(await readdir(sentinel)).toEqual(['keep.txt'])
    expect(await readFile(join(dst, 'pixel-a', 'SKILL.md'), 'utf8')).toBe('new')
  })

  it('returns [] when the source has no skills', async () => {
    root = await mkdtemp(join(tmpdir(), 'sq-skills-'))
    expect(await copySkills(join(root, 'none'), join(root, 'home'), createDeps('real'))).toEqual([])
  })
})
