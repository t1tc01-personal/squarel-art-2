import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addFrame, createDoc, decodePng, encodePng } from '../src/core/index.ts'
import { type Logger, silentLogger } from '../src/log.ts'
import { type McpPresence, presenceFile, startPresence } from '../src/mcp/presence.ts'
import { SERVER_INSTRUCTIONS, serverInstructions } from '../src/mcp/server.ts'
import { MockProvider } from '../src/providers/mock.ts'
import { Store } from '../src/store/store.ts'
import {
  artsDirOf,
  catalogPath,
  detectWorkspace,
  ensureWorkspaceIndex,
  exportDirProblem,
  normalizePaletteName,
  parseWorkspaceConfig,
  readWorkspace,
  readWorkspaceIndex,
  workspaceIndexPath,
} from '../src/store/workspace.ts'
import { NO_PROJECT_TEXT } from '../src/tools/common.ts'
import { createToolContext } from '../src/tools/context.ts'
import { runTool } from '../src/tools/registry.ts'
import type { ToolContext } from '../src/tools/types.ts'
import { fakeAiImage, spriteDoc, tempDir } from './helpers.ts'

let t: ReturnType<typeof tempDir>
let dataDir: string
let folder: string

const CONFIG = {
  schema: 1,
  id: 'game-dungeon',
  name: 'Game dungeon',
  description: 'Roguelike 2D',
  brief: 'Sprites 32x32, 1px black outline',
  defaults: { purpose: 'game', width: 32, height: 32, palette: 'sweetie16' },
  repos: ['game-client', 'D:\\code\\shared-assets'],
  exportDir: 'game-client/assets/sprites',
  futureField: { keep: true },
}

function writeConfig(dir: string, cfg: unknown) {
  mkdirSync(join(dir, '.squarel'), { recursive: true })
  writeFileSync(join(dir, '.squarel', 'project.json'), typeof cfg === 'string' ? cfg : JSON.stringify(cfg))
}

/** Register the folder in DATA_DIR/workspaces like the launcher does. */
function registerIndex(dir: string, id = 'game-dungeon', extra: Record<string, unknown> = {}) {
  mkdirSync(join(dataDir, 'workspaces'), { recursive: true })
  writeFileSync(
    workspaceIndexPath(dataDir, id),
    JSON.stringify({
      schema: 1,
      id,
      name: 'Launcher name',
      folder: dir,
      createdAt: '2026-01-01T00:00:00.000Z',
      ...extra,
    }),
  )
}

function captureLog(): Logger & { warnings: string[] } {
  const warnings: string[] = []
  return { ...silentLogger, warnings, warn: (m, e) => warnings.push(`${m} ${JSON.stringify(e ?? {})}`) }
}

async function makeCtx(withWorkspace = true): Promise<ToolContext> {
  return createToolContext({
    config: { dataDir, imageProvider: 'mock', previewPx: 0 },
    providers: { mock: new MockProvider() },
    log: silentLogger,
    projectStart: withWorkspace ? folder : undefined,
  })
}

beforeEach(() => {
  t = tempDir()
  dataDir = join(t.dir, 'data')
  folder = join(t.dir, 'Dự án game')
  writeConfig(folder, CONFIG)
  registerIndex(folder)
})
afterEach(() => t.cleanup())

describe('workspace detection', () => {
  it('walks up from a subfolder; works without an index entry and never creates one', async () => {
    rmSync(workspaceIndexPath(dataDir, 'game-dungeon'))
    const sub = join(folder, 'game-client', 'src', 'deep')
    mkdirSync(sub, { recursive: true })
    const ws = await detectWorkspace({ start: sub, dataDir })
    expect(ws).toMatchObject({ id: 'game-dungeon', name: 'Game dungeon', folder })
    expect(ws?.config.defaults).toMatchObject({ width: 32, palette: 'sweetie16' })
    expect((ws?.config as Record<string, unknown> | undefined)?.futureField).toEqual({ keep: true })
    // A workspace removed in the launcher stays removed.
    expect(existsSync(workspaceIndexPath(dataDir, 'game-dungeon'))).toBe(false)
  })

  it('repairs an index entry only when its folder no longer holds the workspace (moved)', async () => {
    // Moved: the indexed folder is gone, so the entry follows, keeping its other fields.
    registerIndex(join(t.dir, 'old'), 'game-dungeon', { extra: 1 })
    await detectWorkspace({ start: folder, dataDir })
    expect(await readWorkspaceIndex(dataDir, 'game-dungeon')).toMatchObject({
      folder,
      name: 'Launcher name',
      createdAt: '2026-01-01T00:00:00.000Z',
      extra: 1,
    })

    // A copy of the folder (same id) never takes over the live entry.
    const copy = join(t.dir, 'copy')
    writeConfig(copy, CONFIG)
    const ws = await detectWorkspace({ start: copy, dataDir })
    expect(ws).toMatchObject({ id: 'game-dungeon', folder: copy })
    expect((await readWorkspaceIndex(dataDir, 'game-dungeon'))?.folder).toBe(folder)

    // The indexed folder now holds another workspace: the entry is repaired.
    writeConfig(folder, { ...CONFIG, id: 'something-else' })
    expect(await ensureWorkspaceIndex(dataDir, ws!)).toBe(true)
    expect((await readWorkspaceIndex(dataDir, 'game-dungeon'))?.folder).toBe(copy)
    expect(await ensureWorkspaceIndex(dataDir, ws!)).toBe(false)
  })

  it('returns nothing without a workspace file, and warns on a broken one', async () => {
    const other = join(t.dir, 'plain')
    mkdirSync(other)
    expect(await detectWorkspace({ start: other, dataDir })).toBeUndefined()

    const broken = join(t.dir, 'broken', 'sub')
    mkdirSync(broken, { recursive: true })
    writeConfig(join(t.dir, 'broken'), '{ not json')
    const log = captureLog()
    expect(await detectWorkspace({ start: broken, dataDir, log })).toBeUndefined()
    expect(log.warnings.join('\n')).toMatch(/broken workspace/)

    writeConfig(join(t.dir, 'broken'), { ...CONFIG, id: 'Bad Id' })
    expect(await detectWorkspace({ start: broken, dataDir, log })).toBeUndefined()
    expect(log.warnings).toHaveLength(2)
  })

  describe('home (git worktrees)', () => {
    let main: string
    let wt: string
    beforeEach(() => {
      main = join(t.dir, 'main')
      wt = join(t.dir, 'wt')
      mkdirSync(join(main, '.git', 'worktrees', 'wt'), { recursive: true })
      writeFileSync(join(main, '.git', 'worktrees', 'wt', 'commondir'), '../..\n')
      mkdirSync(wt, { recursive: true })
      writeFileSync(join(wt, '.git'), `gitdir: ${join(main, '.git', 'worktrees', 'wt')}\n`)
      writeConfig(join(main, 'app'), { id: 'game', name: 'Game' })
      writeConfig(join(wt, 'app'), { id: 'game', name: 'Game' })
    })

    it('is the main checkout folder from a linked worktree', async () => {
      const ws = await detectWorkspace({ start: join(wt, 'app') })
      expect(ws?.folder).toBe(join(wt, 'app'))
      expect(ws?.home).toBe(join(main, 'app'))
      expect(artsDirOf(ws!)).toBe(join(main, 'app', 'squarel_art'))
    })

    it('stays in the worktree when main has another project id or none', async () => {
      writeConfig(join(main, 'app'), { id: 'other', name: 'Other' })
      expect((await detectWorkspace({ start: join(wt, 'app') }))?.home).toBe(join(wt, 'app'))
      rmSync(join(main, 'app', '.squarel'), { recursive: true })
      expect((await detectWorkspace({ start: join(wt, 'app') }))?.home).toBe(join(wt, 'app'))
    })

    it('is the folder itself for a plain folder', async () => {
      expect((await detectWorkspace({ start: folder }))?.home).toBe(folder)
      expect((await readWorkspace(folder)).home).toBe(folder)
    })
  })
})

describe('workspace config parsing', () => {
  it('keeps the workspace when optional fields are bad, dropping them one by one', () => {
    const { config, warnings } = parseWorkspaceConfig({
      id: 'game-dungeon',
      name: `  ${'N'.repeat(100)}  `,
      description: 42,
      brief: 'ok brief',
      defaults: { purpose: 'game', width: 0, height: 16, palette: 'PICO8', extra: 'kept' },
      repos: ['a', '', 7],
      exportDir: 5,
      futureField: 1,
    })
    expect(config.schema).toBe(1)
    expect(config.name).toBe('N'.repeat(80))
    expect(config.description).toBeUndefined()
    expect(config.brief).toBe('ok brief')
    expect(config.defaults).toEqual({ purpose: 'game', height: 16, palette: 'pico8', extra: 'kept' })
    expect(config.repos).toEqual(['a'])
    expect(config.exportDir).toBeUndefined()
    expect(config.futureField).toBe(1)
    const all = warnings.join('\n')
    expect(all).toMatch(/name/)
    expect(all).toMatch(/defaults\.width/)
    expect(all).toMatch(/description/)
    expect(all).toMatch(/exportDir/)
    expect(all).not.toMatch(/schema/) // a missing schema quietly defaults to 1

    const bad = parseWorkspaceConfig({
      schema: 'x',
      id: 'a',
      name: 'A',
      defaults: { palette: 'nope', purpose: 'x' },
    })
    expect(bad.config.schema).toBe(1)
    expect(bad.config.defaults).toEqual({})
    expect(bad.warnings).toHaveLength(3)

    expect(() => parseWorkspaceConfig({ id: 'a', name: '  ' })).toThrow(/name/)
    expect(() => parseWorkspaceConfig({ id: 'Bad Id', name: 'A' })).toThrow(/id/)
    expect(() => parseWorkspaceConfig([])).toThrow(/object/)
  })

  it('matches palette names loosely', () => {
    expect(normalizePaletteName('PICO-8')).toBe('pico8')
    expect(normalizePaletteName('pico_8')).toBe('pico8')
    expect(normalizePaletteName('Sweetie-16')).toBe('sweetie16')
    expect(normalizePaletteName('nope')).toBeUndefined()
  })

  it('a hand-edited file still gives a workspace, with a logged warning', async () => {
    const { schema: _schema, ...noSchema } = CONFIG
    writeConfig(folder, { ...noSchema, defaults: { width: 0, height: 32, palette: 'PICO-8' } })
    const log = captureLog()
    const ws = await detectWorkspace({ start: folder, dataDir, log })
    expect(ws?.config).toMatchObject({ schema: 1, defaults: { height: 32, palette: 'pico8' } })
    expect(ws?.config.defaults?.width).toBeUndefined()
    expect(log.warnings.join('\n')).toMatch(/invalid fields/)
  })
})

describe('export folder rule', () => {
  it('accepts only sub-folders strictly inside the workspace folder', () => {
    expect(exportDirProblem(folder, 'game-client/assets')).toBeUndefined()
    expect(exportDirProblem(folder, '..assets')).toBeUndefined()
    expect(exportDirProblem(folder, './sprites')).toBeUndefined()
    expect(exportDirProblem(folder, '')).toMatch(/empty/)
    expect(exportDirProblem(folder, '.')).toMatch(/itself/)
    expect(exportDirProblem(folder, 'a/..')).toMatch(/itself/)
    expect(exportDirProblem(folder, '..')).toMatch(/outside/)
    expect(exportDirProblem(folder, '../x')).toMatch(/outside/)
    expect(exportDirProblem(folder, 'a/../../x')).toMatch(/outside/)
    expect(exportDirProblem(folder, join(t.dir, 'abs'))).toMatch(/absolute/)
  })
})

describe('workspace tools', () => {
  it('project_create fills in project defaults', async () => {
    const ctx = await makeCtx()
    const r = await runTool('project_create', { name: 'Hero' }, ctx)
    expect(r.data).toMatchObject({ slug: 'hero', purpose: 'game' })
    const { doc } = await ctx.arts!.readHead('hero')
    expect([doc.width, doc.height]).toEqual([32, 32])
    expect(doc.palette.length).toBe(17) // sweetie16 + transparent
    // explicit values win
    const r2 = await runTool('project_create', { name: 'Big', width: 64, height: 16, purpose: 'print' }, ctx)
    expect(r2.data).toMatchObject({ purpose: 'print' })
    expect((await ctx.arts!.readHead('big')).doc.width).toBe(64)
  })

  it('project_create needs a size without workspace defaults', async () => {
    const ctx = await makeCtx(false)
    await expect(runTool('project_create', { name: 'x' }, ctx)).rejects.toMatchObject({
      code: 'NO_PROJECT',
      message: NO_PROJECT_TEXT,
    })
    writeConfig(folder, { ...CONFIG, defaults: undefined })
    const ctx1 = await makeCtx()
    await expect(runTool('project_create', { name: 'x' }, ctx1)).rejects.toMatchObject({
      code: 'INVALID',
      message: expect.stringMatching(/width and height are required/),
    })

    writeConfig(folder, { ...CONFIG, defaults: { purpose: 'print' } })
    const ctx2 = await makeCtx()
    await expect(runTool('project_create', { name: 'y' }, ctx2)).rejects.toMatchObject({
      code: 'INVALID',
      message: expect.stringMatching(/no default size/),
    })
  })

  it('project_list shows the art of the current project', async () => {
    const ctx = await makeCtx()
    await runTool('project_create', { name: 'Hero' }, ctx)
    const mine = await runTool('project_list', {}, ctx)
    expect((mine.data as { slug: string }[]).map((p) => p.slug)).toEqual(['hero'])
    expect(mine.text).toContain('Project "Game dungeon"')
    await expect(runTool('project_list', {}, await makeCtx(false))).rejects.toMatchObject({
      code: 'NO_PROJECT',
    })
  })

  it('workspace_info', async () => {
    const plain = await makeCtx(false)
    const none = await runTool('workspace_info', {}, plain)
    expect(none.text).toMatch(/No Squarel workspace/)
    expect(none.data).toEqual({ workspace: null })

    const ctx = await makeCtx()
    const info = await runTool('workspace_info', {}, ctx)
    expect(info.text).toContain('Game dungeon')
    expect(info.text).toContain('Sprites 32x32')
    expect(info.data).toMatchObject({
      workspace: {
        id: 'game-dungeon',
        folder,
        exportDir: 'game-client/assets/sprites',
        defaults: { width: 32 },
        repos: [
          { path: 'game-client', inside: true },
          { path: 'D:\\code\\shared-assets', inside: false },
        ],
      },
      arts: [],
    })

    await runTool('project_create', { name: 'Loose' }, ctx)
    expect(readFileSync(catalogPath(folder), 'utf8')).toContain('`loose`')
    const after = await runTool('workspace_info', {}, ctx)
    expect((after.data as { arts: { slug: string }[] }).arts.map((a) => a.slug)).toEqual(['loose'])
  })

  it('photo_to_pixel as a new project uses the project defaults', async () => {
    const ctx = await makeCtx()
    const img = join(t.dir, 'photo.png')
    writeFileSync(img, encodePng(fakeAiImage(4, { noise: 0 })))
    await runTool('photo_to_pixel', { path: img, width: 8, colors: 8 }, ctx)
    const p = await ctx.arts!.info(ctx.session.activeProject!)
    expect(p).toMatchObject({ purpose: 'game' })
    expect(p).not.toHaveProperty('workspace')
  })

  it('export also copies files into the workspace exportDir', async () => {
    const ctx = await makeCtx()
    await runTool('project_create', { name: 'Hero', width: 8, height: 8 }, ctx)
    const r = await runTool('export', { preset: 'game-png' }, ctx)
    const data = r.data as { files: string[]; copies: string[] }
    const target = join(folder, 'game-client', 'assets', 'sprites')
    expect(data.copies).toHaveLength(data.files.length)
    for (const c of data.copies) {
      expect(c.startsWith(target)).toBe(true)
      expect(existsSync(c)).toBe(true)
    }
    expect(r.text).toContain('Also copied to')
    expect(readFileSync(catalogPath(folder), 'utf8')).toContain('Latest exports')
  })

  it('export with a bad exportDir still writes exports/ and warns that the copy was skipped', async () => {
    for (const bad of ['../outside', '.', join(t.dir, 'abs')]) {
      writeConfig(folder, { ...CONFIG, exportDir: bad })
      const ctx = await makeCtx()
      if (!(await ctx.arts!.hasProject('hero')))
        await runTool('project_create', { name: 'Hero', width: 8, height: 8 }, ctx)
      const r = await runTool('export', { project: 'hero', preset: 'game-png' }, ctx)
      const data = r.data as { files: string[]; copies: string[]; copySkipped?: string }
      expect(data.files.length).toBeGreaterThan(0)
      for (const f of data.files) expect(existsSync(f)).toBe(true)
      expect(data.copies).toEqual([])
      expect(data.copySkipped).toMatch(/exportDir/)
      expect(r.text).toMatch(/Warning: not copied/)
    }
    expect(existsSync(join(t.dir, 'outside'))).toBe(false)
    expect(existsSync(join(t.dir, 'abs'))).toBe(false)
  })

  it('export copies into a folder literally named "..assets"', async () => {
    writeConfig(folder, { ...CONFIG, exportDir: '..assets' })
    const ctx = await makeCtx()
    await runTool('project_create', { name: 'Hero', width: 8, height: 8 }, ctx)
    const r = await runTool('export', { preset: 'game-png' }, ctx)
    const data = r.data as { files: string[]; copies: string[] }
    expect(data.copies).toHaveLength(data.files.length)
    for (const c of data.copies) expect(c.startsWith(join(folder, '..assets'))).toBe(true)
  })
})

describe('store hooks', () => {
  it('regenerates the catalog after a commit made by another Store (the bridge process)', async () => {
    const ctx = await makeCtx()
    await runTool('project_create', { name: 'Hero' }, ctx)
    const cat = catalogPath(folder)
    expect(readFileSync(cat, 'utf8')).toMatch(/^<!-- Generated by Squarel/)
    expect(readFileSync(cat, 'utf8')).toContain('Head version: v000001')

    const bridgeStore = new Store(ctx.arts!.root, { project: ctx.session.workspace }) // separate instance, as in `pnpm bridge`
    const { versionId, doc } = await bridgeStore.readHead('hero')
    addFrame(doc)
    await bridgeStore.commit('hero', { baseVersion: versionId, doc, source: 'editor', label: 'Aseprite' })
    const text = readFileSync(cat, 'utf8')
    expect(text).toContain('Head version: v000002')
    expect(text).toContain('32×32, 2 frames')
  })

  it('a broken catalog target never breaks a commit', async () => {
    const ctx = await makeCtx()
    await runTool('project_create', { name: 'Hero', width: 8, height: 8 }, ctx)
    // Make .squarel/arts.md a directory so the write fails.
    const cat = catalogPath(folder)
    rmSync(cat, { force: true })
    mkdirSync(cat)
    const log = captureLog()
    ctx.arts!.log = log
    const r = await runTool('draw_pixels', { ops: [{ op: 'set', points: [[1, 1]], color: '#ff0000' }] }, ctx)
    expect((r.data as { version: string }).version).toBe('v000002')
    expect(log.warnings.join('\n')).toMatch(/catalog/)
  })

  it('writes thumb.png (frame 0, longest side ≤ 128) after create and commit', async () => {
    const store = new Store(dataDir)
    const small = await store.createProject({ name: 'small', doc: spriteDoc(), source: 'claude' })
    const thumb = decodePng(readFileSync(store.projectPath(small.slug, 'thumb.png')))
    expect([thumb.width, thumb.height]).toEqual([128, 128])
    const wide = await store.createProject({
      name: 'wide',
      doc: createDoc({ width: 256, height: 64, purpose: 'print', palette: 'pico8' }),
      source: 'claude',
    })
    const t2 = decodePng(readFileSync(store.projectPath(wide.slug, 'thumb.png')))
    expect([t2.width, t2.height]).toEqual([128, 32])
    expect(readdirSync(store.projectDir(wide.slug))).toContain('thumb.png')
  })
})

describe('MCP instructions and presence', () => {
  it('adds a workspace paragraph only when a workspace is active', async () => {
    const ctx = await makeCtx()
    await runTool('project_create', { name: 'Hero' }, ctx)
    const ws = ctx.session.workspace!
    const text = serverInstructions({ workspace: ws, arts: await ctx.arts!.listProjects() })
    expect(text.startsWith(SERVER_INSTRUCTIONS)).toBe(true)
    expect(text).toContain('Active workspace: "Game dungeon"')
    expect(text).toContain('game, 32×32, palette sweetie16')
    expect(text).toContain('1 art in this workspace; newest: hero')
    expect(text).toContain('AGENTS.md')
    expect(text).toContain('.squarel/arts.md')
    expect(serverInstructions()).toBe(SERVER_INSTRUCTIONS)
  })

  it('presence carries the workspace', async () => {
    const p = startPresence({
      dataDir,
      version: '1',
      bridge: 'none',
      intervalMs: 100000,
      workspace: { id: 'game-dungeon', name: 'Game dungeon' },
    })
    let doc: McpPresence | undefined
    for (let i = 0; i < 100 && !doc; i++) {
      await new Promise((r) => setTimeout(r, 20))
      if (existsSync(presenceFile(dataDir))) doc = JSON.parse(readFileSync(presenceFile(dataDir), 'utf8'))
    }
    expect(doc?.workspace).toEqual({ id: 'game-dungeon', name: 'Game dungeon' })
    await p.stop()
  })

  it('stdio server detects the workspace from CLAUDE_PROJECT_DIR', async () => {
    const sub = join(folder, 'game-client')
    mkdirSync(sub, { recursive: true })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(import.meta.dirname, '..', 'src', 'mcp', 'index.ts')],
      env: {
        ...(process.env as Record<string, string>),
        DATA_DIR: dataDir,
        IMAGE_PROVIDER: 'mock',
        SQUAREL_NO_BRIDGE: '1',
        CLAUDE_PROJECT_DIR: sub,
      },
      stderr: 'pipe',
    })
    const client = new Client({ name: 'ws-test', version: '1.0.0' })
    await client.connect(transport)
    expect(client.getInstructions()).toContain('Active workspace: "Game dungeon"')
    // The startup catalog is written in the background.
    for (let i = 0; i < 100 && !existsSync(catalogPath(folder)); i++)
      await new Promise((r) => setTimeout(r, 50))
    expect(existsSync(catalogPath(folder))).toBe(true)
    const runDir = join(dataDir, 'run')
    let presence: McpPresence | undefined
    for (let i = 0; i < 100 && !presence; i++) {
      await new Promise((r) => setTimeout(r, 50))
      const f = existsSync(runDir) ? readdirSync(runDir).find((x) => /^mcp-\d+\.json$/.test(x)) : undefined
      if (f) presence = JSON.parse(readFileSync(join(runDir, f), 'utf8'))
    }
    expect(presence?.workspace).toEqual({ id: 'game-dungeon', name: 'Game dungeon' })
    const created = await client.callTool({ name: 'project_create', arguments: { name: 'Slime' } })
    expect(created.isError).toBeFalsy()
    expect(readFileSync(catalogPath(folder), 'utf8')).toContain('`slime`')
    await client.close()
  }, 60000)
})
