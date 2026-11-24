import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectDirectory } from '../src/bridge/projects.ts'
import { silentLogger } from '../src/log.ts'
import { ToolError } from '../src/tools/types.ts'
import { tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
beforeEach(() => {
  t = tempDir()
})
afterEach(() => t.cleanup())

const NAME = 'Dự án game'
const dir = () => new ProjectDirectory({ dataDir: join(t.dir, 'data'), log: silentLogger })

function project(folder: string, id: string, name = 'Game') {
  mkdirSync(join(folder, '.squarel'), { recursive: true })
  writeFileSync(join(folder, '.squarel', 'project.json'), JSON.stringify({ id, name }))
  return folder
}
function presence(folder: string, id: string, pid = process.pid) {
  mkdirSync(join(t.dir, 'data', 'run'), { recursive: true })
  writeFileSync(
    join(t.dir, 'data', 'run', `mcp-${pid}.json`),
    JSON.stringify({ pid, workspace: { id, name: 'Game', folder } }),
  )
}
function index(folder: string, id: string) {
  mkdirSync(join(t.dir, 'data', 'workspaces'), { recursive: true })
  writeFileSync(
    join(t.dir, 'data', 'workspaces', `${id}.json`),
    JSON.stringify({ schema: 1, id, name: 'Game', folder, createdAt: '2026-01-01T00:00:00Z' }),
  )
}
const code = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e) => (e instanceof ToolError ? e : e),
  )

describe('ProjectDirectory', () => {
  it('resolves an id from a live presence file', async () => {
    const home = project(join(t.dir, NAME), 'game')
    presence(home, 'game')
    const k = await dir().get('game')
    expect(k.home).toBe(home)
    expect(k.name).toBe('Game')
    expect(k.store.root).toBe(join(home, 'squarel_art'))
  })

  it('ignores a presence file whose pid is dead', async () => {
    const home = project(join(t.dir, NAME), 'game')
    presence(home, 'game', 2 ** 22 + 12345)
    const e = await code(dir().get('game'))
    expect((e as ToolError).code).toBe('NOT_FOUND')
  })

  it("keeps the mapping after the session's presence file is removed", async () => {
    const home = project(join(t.dir, NAME), 'game')
    presence(home, 'game')
    const d = dir()
    await d.get('game')
    rmSync(join(t.dir, 'data', 'run'), { recursive: true })
    expect((await d.get('game')).home).toBe(home)
    expect(d.homes()).toEqual([home])
  })

  it('falls back to the index', async () => {
    const home = project(join(t.dir, NAME), 'game')
    index(home, 'game')
    expect((await dir().get('game')).home).toBe(home)
  })

  it('a worktree presence and the main index entry are one project, not a duplicate', async () => {
    const main = join(t.dir, 'main')
    const wt = join(t.dir, 'wt')
    mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true })
    writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n')
    mkdirSync(wt, { recursive: true })
    writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`)
    const mainHome = project(join(main, NAME), 'game')
    const wtHome = project(join(wt, NAME), 'game')
    presence(wtHome, 'game')
    index(mainHome, 'game')
    const d = dir()
    expect((await d.get('game')).home).toBe(mainHome)
    expect((await d.list()).map((k) => k.id)).toEqual(['game'])
  })

  it('two copied folders with one id are DUPLICATE_PROJECT naming both', async () => {
    const a = project(join(t.dir, 'a', NAME), 'game')
    const b = project(join(t.dir, 'b', NAME), 'game')
    presence(a, 'game')
    index(b, 'game')
    const d = dir()
    const e = (await code(d.get('game'))) as ToolError
    expect(e.code).toBe('DUPLICATE_PROJECT')
    expect(e.message).toContain(a)
    expect(e.message).toContain(b)
    expect(await d.list()).toEqual([])
  })

  it('after the user edits the id, get(old) is NOT_FOUND and get(new) resolves via the index', async () => {
    const home = project(join(t.dir, NAME), 'old')
    index(home, 'old')
    const d = dir()
    await d.get('old')
    project(home, 'new')
    index(home, 'new')
    expect(((await code(d.get('old'))) as ToolError).code).toBe('NOT_FOUND')
    expect((await d.get('new')).id).toBe('new')
  })

  it('refresh reports whether the set of homes changed', async () => {
    const d = dir()
    expect(await d.refresh()).toBe(false)
    index(project(join(t.dir, NAME), 'game'), 'game')
    expect(await d.refresh()).toBe(true)
    expect(await d.refresh()).toBe(false)
  })
})
