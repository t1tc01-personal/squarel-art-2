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

  it('returns [] when the source has no skills', async () => {
    root = await mkdtemp(join(tmpdir(), 'sq-skills-'))
    expect(await copySkills(join(root, 'none'), join(root, 'home'), createDeps('real'))).toEqual([])
  })
})
