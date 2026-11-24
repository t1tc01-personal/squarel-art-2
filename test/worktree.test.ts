import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { artRef, parseArtRef } from '../src/shared/ref.ts'
import { gitCommonDir, mainCheckoutOf } from '../src/store/worktree.ts'
import { tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
let main: string
let wt: string

beforeEach(() => {
  t = tempDir()
  main = join(t.dir, 'main')
  wt = join(t.dir, 'wt')
  mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true })
  writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n')
  mkdirSync(wt, { recursive: true })
  writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`)
  for (const root of [main, wt]) {
    mkdirSync(join(root, 'app', '.squarel'), { recursive: true })
    writeFileSync(join(root, 'app', '.squarel', 'project.json'), '{"id":"game","name":"Game"}')
  }
})
afterEach(() => t.cleanup())

describe('art refs', () => {
  it('parses and builds <project>/<art>', () => {
    expect(parseArtRef('game/hero')).toEqual({ project: 'game', art: 'hero' })
    expect(parseArtRef('game/Hero')).toBeUndefined()
    expect(parseArtRef('a/b/c')).toBeUndefined()
    expect(parseArtRef('hero')).toBeUndefined()
    expect(artRef('game', 'hero')).toBe('game/hero')
    expect(() => artRef('Game', 'hero')).toThrow()
    expect(() => artRef('game', 'a/b')).toThrow()
  })
})

describe('git worktree detection', () => {
  it('finds the main checkout of a linked worktree', async () => {
    expect(await mainCheckoutOf(join(wt, 'app'))).toBe(join(main, 'app'))
    expect(await mainCheckoutOf(wt)).toBe(main)
    expect(await mainCheckoutOf(join(main, 'app'))).toBeUndefined() // not a linked worktree
  })

  it('finds the common git dir', async () => {
    expect(await gitCommonDir(join(wt, 'app'))).toBe(join(main, '.git'))
    expect(await gitCommonDir(join(main, 'app'))).toBe(join(main, '.git'))
    expect(await gitCommonDir(t.dir)).toBeUndefined()
  })

  it('returns undefined when the main checkout was deleted', async () => {
    rmSync(main, { recursive: true })
    expect(await mainCheckoutOf(join(wt, 'app'))).toBeUndefined()
  })
})
