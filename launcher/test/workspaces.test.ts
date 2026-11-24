import {
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { createDeps, type DetachedSpec, type Fixtures } from '../src/main/deps'
import {
  ART_GITIGNORE,
  BLOCK_BEGIN,
  BLOCK_END,
  checkExportDir,
  checkFolder,
  claudeWorkspaceSpec,
  createWorkspace,
  ensureClaudeImport,
  getWorkspace,
  inspectFolder,
  legacyArts,
  listWorkspaces,
  mergeAgentsBlock,
  normalizePalette,
  openClaude,
  readArts,
  readThumb,
  removeWorkspace,
  renderAgentsBlock,
  sessionTitle,
  slugify,
  updateWorkspace,
  type WorkspaceConfig,
  type WorkspaceCtx,
} from '../src/main/workspaces'
import { worktreeMain } from '../src/main/worktree'
import { exportDirError } from '../src/renderer/pages/project-paths'

const DATA = 'D:\\data'
const NOW = new Date('2026-11-24T10:00:00.000Z')
const CLAUDE = 'D:\\Tools\\Claude\\claude.exe'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const json = (x: unknown) => JSON.stringify(x)

function world(files: Record<string, string> = {}, fx: Partial<Fixtures> = {}) {
  const launched: DetachedSpec[] = []
  const d = createDeps('fake', { files, now: NOW, launched, which: { claude: CLAUDE }, ...fx })
  const chosen: string[] = []
  const ctx: WorkspaceCtx = {
    d,
    dataDir: DATA,
    chosen: (p) => chosen.some((c) => c.toLowerCase() === p.toLowerCase()),
  }
  const read = async (p: string) => {
    try {
      return String(await d.fs.readFile(p, 'utf8'))
    } catch {
      return undefined
    }
  }
  return { d, ctx, chosen, launched, read }
}

/** An art in a project folder (`<folder>\\squarel_art\\<slug>`), or in DATA_DIR/projects when no folder. */
const art = (slug: string, updatedAt: string, folder?: string) => ({
  [`${folder ? `${folder}\\squarel_art` : `${DATA}\\projects`}\\${slug}\\project.json`]: json({
    slug,
    name: slug.toUpperCase(),
    purpose: 'game',
    updatedAt,
    head: 'v000001',
  }),
})

const SPEC_CFG: WorkspaceConfig = {
  id: 'game-dungeon',
  name: 'Game dungeon',
  description: 'Game roguelike 2D…',
  brief: 'Sprite 32×32…',
  defaults: { purpose: 'game', width: 32, height: 32, palette: 'pico8' },
  repos: ['game-client', 'D:\\code\\shared-assets'],
  exportDir: 'game-client/assets/sprites',
}

describe('AGENTS.md / CLAUDE.md', () => {
  it('renders the managed block exactly as the spec shows', () => {
    expect(renderAgentsBlock(SPEC_CFG)).toBe(
      [
        BLOCK_BEGIN,
        '# Game dungeon',
        '',
        'Game roguelike 2D…',
        '',
        '## Art brief',
        '',
        'Sprite 32×32…',
        '',
        '## Squarel',
        '- Pixel art for this project is made with the `squarel` MCP tools; new art joins this project automatically.',
        '- Defaults for new art: game, 32×32, palette pico8.',
        '- Art catalog: `.squarel/arts.md`. Exports are also copied to `game-client/assets/sprites`.',
        '- Repos: `game-client` (inside), `D:\\code\\shared-assets` (outside).',
        BLOCK_END,
      ].join('\n'),
    )
  })

  it('leaves out empty sections and keeps user text from closing the block', () => {
    const b = renderAgentsBlock({
      ...SPEC_CFG,
      description: 'x <!-- squarel:end --> y',
      brief: '',
      defaults: {},
      repos: [],
      exportDir: null,
    })
    expect(b).not.toContain('## Art brief')
    expect(b).not.toContain('Repos:')
    expect(b).toContain('- Art catalog: `.squarel/arts.md`.\n')
    expect(b.split(BLOCK_END)).toHaveLength(2)
  })

  const block = `${BLOCK_BEGIN}\nnew\n${BLOCK_END}`
  it('merge: no file → the block alone', () => {
    expect(mergeAgentsBlock(undefined, block)).toBe(`${block}\n`)
  })
  it('merge: file without block → block on top, the rest untouched (CRLF kept)', () => {
    expect(mergeAgentsBlock('# Mine\n\ntext\n', block)).toBe(`${block}\n\n# Mine\n\ntext\n`)
    expect(mergeAgentsBlock('\uFEFF# Mine\r\ntext\r\n', block)).toBe(
      `\uFEFF${BLOCK_BEGIN}\r\nnew\r\n${BLOCK_END}\r\n\r\n# Mine\r\ntext\r\n`,
    )
  })
  it('merge: file with block → only the block changes', () => {
    const before = `intro\n<!-- squarel:begin (old) -->\nold stuff\n${BLOCK_END}\n\n## Mine\nkeep\n`
    expect(mergeAgentsBlock(before, block)).toBe(`intro\n${block}\n\n## Mine\nkeep\n`)
  })

  it('merge: a begin line without the end line is refused, never stacked', () => {
    const half = `intro\n<!-- squarel:begin (old) -->\nold stuff\n## Mine\n`
    expect(() => mergeAgentsBlock(half, block)).toThrow(
      'AGENTS.md có dòng mở khối Squarel nhưng thiếu dòng <!-- squarel:end -->; hãy sửa tay rồi thử lại',
    )
  })

  it('CLAUDE.md: created, line added on top, or left alone', () => {
    expect(ensureClaudeImport(undefined)).toBe('@AGENTS.md\n')
    expect(ensureClaudeImport('# Rules\nbe nice\n')).toBe('@AGENTS.md\n# Rules\nbe nice\n')
    const has = '# Rules\r\n  @AGENTS.md\r\n'
    expect(ensureClaudeImport(has)).toBe(has)
  })
})

describe('paths', () => {
  it('folder must be an absolute local path, not UNC or a drive root', () => {
    expect(checkFolder('D:\\code\\Trò chơi\\')).toBe('D:\\code\\Trò chơi')
    for (const bad of [
      '\\\\server\\share\\x',
      '//server/share',
      'code\\x',
      'D:',
      'D:\\',
      'D:\\a|b',
      'D:\\a\nb',
    ])
      expect(() => checkFolder(bad), bad).toThrow()
  })

  it('exportDir stays inside the folder', () => {
    const f = 'D:\\proj'
    expect(checkExportDir(f, 'game-client\\assets\\sprites\\')).toBe('game-client/assets/sprites')
    // Same rule as Squarel's exportDirProblem: "..assets" is a plain folder name, a/../b is inside.
    expect(checkExportDir(f, '..assets')).toBe('..assets')
    expect(checkExportDir(f, 'a/../b')).toBe('b')
    for (const bad of ['..\\x', '..', 'a/../../x', 'D:\\proj\\x', '\\x', '\\\\srv\\x', 'C:x', '   '])
      expect(() => checkExportDir(f, bad), bad).toThrow(/tương đối/)
    for (const self of ['.', './', 'a/..', '.\\.'])
      expect(() => checkExportDir(f, self), self).toThrow(/thư mục con/)
  })

  it('the renderer check agrees with main', () => {
    expect(exportDirError('')).toBeUndefined()
    for (const ok of ['..assets', 'a/../b', 'game-client/assets/sprites'])
      expect(exportDirError(ok), ok).toBeUndefined()
    for (const bad of ['..', '../x', 'a/../../x', 'D:\\x', '/x', 'C:x', '.', 'a/..', 'a|b'])
      expect(exportDirError(bad), bad).toBeDefined()
  })
})

describe('create / update / remove', () => {
  const FOLDER = 'D:\\work\\Trò chơi Đường phố'

  it('creates the folder files and the index; id from the slugified name', async () => {
    const w = world({ 'D:\\shared\\assets\\x.txt': '' })
    w.chosen.push('D:\\work', 'D:\\shared\\assets')
    const r = await createWorkspace(w.ctx, {
      name: 'Trò chơi Đường phố',
      folder: FOLDER,
      description: 'Mô tả',
      brief: 'Viền đen',
      defaults: { purpose: 'game', width: 32, height: 32 },
      repos: ['client', 'D:\\shared\\assets', `${FOLDER}\\server`],
      exportDir: 'client/assets',
    })
    expect(r).toMatchObject({
      id: 'tro-choi-duong-pho',
      name: 'Trò chơi Đường phố',
      status: 'ok',
      artCount: 0,
    })
    expect(r.repos).toEqual([
      { path: 'client', outside: false, exists: false },
      { path: 'D:\\shared\\assets', outside: true, exists: true },
      { path: 'server', outside: false, exists: false },
    ])
    const cfg = JSON.parse((await w.read(`${FOLDER}\\.squarel\\project.json`)) ?? '')
    expect(cfg).toEqual({
      schema: 1,
      id: 'tro-choi-duong-pho',
      name: 'Trò chơi Đường phố',
      description: 'Mô tả',
      brief: 'Viền đen',
      defaults: { purpose: 'game', width: 32, height: 32 },
      repos: ['client', 'D:\\shared\\assets', 'server'],
      exportDir: 'client/assets',
    })
    expect(await w.read(`${FOLDER}\\AGENTS.md`)).toMatch(/^<!-- squarel:begin[^\n]*\n# Trò chơi Đường phố\n/)
    expect(await w.read(`${FOLDER}\\CLAUDE.md`)).toBe('@AGENTS.md\n')
    expect(JSON.parse((await w.read(`${DATA}\\workspaces\\tro-choi-duong-pho.json`)) ?? '')).toEqual({
      schema: 1,
      id: 'tro-choi-duong-pho',
      name: 'Trò chơi Đường phố',
      folder: FOLDER,
      createdAt: NOW.toISOString(),
    })
  })

  it('adds to existing AGENTS.md / CLAUDE.md without touching their content', async () => {
    const w = world({ 'D:\\p\\AGENTS.md': '# Team rules\n', 'D:\\p\\CLAUDE.md': 'Use tabs.\n' })
    w.chosen.push('D:\\p')
    expect((await inspectFolder(w.ctx, 'D:\\p')).files).toEqual({
      project: 'create',
      agents: 'update',
      claude: 'update',
      art: 'create',
      artIgnore: 'create',
    })
    await createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })
    expect(await w.read('D:\\p\\AGENTS.md')).toMatch(/<!-- squarel:end -->\n\n# Team rules\n$/)
    expect(await w.read('D:\\p\\CLAUDE.md')).toBe('@AGENTS.md\nUse tabs.\n')
  })

  it('the folder must come from the pick dialog (or be new inside a picked one)', async () => {
    const w = world()
    await expect(createWorkspace(w.ctx, { name: 'X', folder: 'D:\\a\\b' })).rejects.toThrow(/Chọn/)
    w.chosen.push('D:\\a')
    await expect(createWorkspace(w.ctx, { name: 'X', folder: 'D:\\a\\b\\c' })).rejects.toThrow(/Chọn/)
    await expect(createWorkspace(w.ctx, { name: 'X', folder: 'D:\\a\\b' })).resolves.toMatchObject({
      id: 'x',
    })
  })

  it('repos: relative must stay inside, absolute must exist and be chosen', async () => {
    const w = world({ 'D:\\elsewhere\\f': '' })
    w.chosen.push('D:\\p')
    const create = (repos: string[]) => createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p', repos })
    await expect(create(['..\\up'])).rejects.toThrow(/trong thư mục dự án/)
    await expect(create(['\\\\srv\\share'])).rejects.toThrow(/mạng/)
    await expect(create(['D:\\elsewhere'])).rejects.toThrow(/hộp thoại/)
    w.chosen.push('D:\\elsewhere', 'D:\\missing')
    await expect(create(['D:\\missing'])).rejects.toThrow(/không phải thư mục/)
    await expect(create(['D:\\elsewhere'])).resolves.toMatchObject({ repos: [{ path: 'D:\\elsewhere' }] })
  })

  it('a folder that already has .squarel/project.json is registered as is', async () => {
    const project = json({ schema: 1, id: 'old-id', name: 'Old', extra: { keep: true } })
    const files = {
      'D:\\old\\.squarel\\project.json': project,
      'D:\\old\\AGENTS.md': 'hand made\n',
    }
    const w = world(files)
    w.chosen.push('D:\\old')
    expect((await inspectFolder(w.ctx, 'D:\\old')).existing).toEqual({ id: 'old-id', name: 'Old' })
    const r = await createWorkspace(w.ctx, { name: 'New name', folder: 'D:\\old', brief: 'ignored' })
    expect(r).toMatchObject({ id: 'old-id', name: 'Old', brief: '' })
    expect(await w.read('D:\\old\\.squarel\\project.json')).toBe(project)
    expect(await w.read('D:\\old\\AGENTS.md')).toBe('hand made\n')
    expect(await w.read('D:\\old\\CLAUDE.md')).toBeUndefined()
    expect(await w.read(`${DATA}\\workspaces\\old-id.json`)).toContain('"folder": "D:\\\\old"')
    // Registering the same folder again returns it; the same id in another folder is refused.
    await expect(createWorkspace(w.ctx, { name: 'x', folder: 'D:\\OLD' })).resolves.toMatchObject({
      id: 'old-id',
    })
    await w.d.fs.writeFile('D:\\copy\\.squarel\\project.json', project)
    w.chosen.push('D:\\copy')
    await expect(createWorkspace(w.ctx, { name: 'x', folder: 'D:\\copy' })).rejects.toThrow(/old-id/)
  })

  it('a broken project.json is reported, never overwritten', async () => {
    const w = world({ 'D:\\b\\.squarel\\project.json': '{oops' })
    w.chosen.push('D:\\b')
    await expect(createWorkspace(w.ctx, { name: 'B', folder: 'D:\\b' })).rejects.toThrow(/hỏng/)
    expect(await w.read('D:\\b\\.squarel\\project.json')).toBe('{oops')
  })

  it('unique ids get a numeric suffix', async () => {
    const w = world({
      [`${DATA}\\workspaces\\game-dungeon.json`]: json({ id: 'game-dungeon', folder: 'D:\\g1' }),
    })
    w.chosen.push('D:\\g2', 'D:\\g3')
    expect((await createWorkspace(w.ctx, { name: 'Game dungeon', folder: 'D:\\g2' })).id).toBe(
      'game-dungeon-2',
    )
    expect((await createWorkspace(w.ctx, { name: 'Game  Dungeon!', folder: 'D:\\g3' })).id).toBe(
      'game-dungeon-3',
    )
    expect(slugify('***')).toBe('du-an')
  })

  it('an id held by a known folder (project.json edited) is not reused', async () => {
    const w = world({
      'D:\\k\\.squarel\\project.json': json({ schema: 1, id: 'renamed', name: 'K' }),
      [`${DATA}\\workspaces\\k.json`]: json({ schema: 1, id: 'k', name: 'K', folder: 'D:\\k' }),
    })
    w.chosen.push('D:\\n')
    expect((await createWorkspace(w.ctx, { name: 'Renamed', folder: 'D:\\n' })).id).toBe('renamed-2')
  })

  it('nothing is written when a check fails, and a failed write leaves no project.json or index', async () => {
    const w = world({ 'D:\\p\\AGENTS.md': `${BLOCK_BEGIN}\nno end\n` })
    w.chosen.push('D:\\p', 'D:\\q')
    await expect(createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })).rejects.toThrow(/squarel:end/)
    await expect(createWorkspace(w.ctx, { name: 'Q', folder: 'D:\\q', exportDir: '..' })).rejects.toThrow()
    for (const f of ['D:\\p\\CLAUDE.md', 'D:\\p\\.squarel\\project.json', 'D:\\q\\AGENTS.md'])
      expect(await w.read(f), f).toBeUndefined()

    // CLAUDE.md cannot be written: AGENTS.md may be there, but no project.json and no index entry.
    const fs = w.d.fs
    const failing: WorkspaceCtx = {
      ...w.ctx,
      d: {
        ...w.d,
        fs: {
          ...fs,
          writeFile: (async (p: string, data: string, o: unknown) => {
            if (String(p).includes('CLAUDE.md')) throw Object.assign(new Error('EACCES'), { code: 'EACCES' })
            return fs.writeFile(p, data, o as 'utf8')
          }) as typeof fs.writeFile,
        },
      },
    }
    await expect(createWorkspace(failing, { name: 'Q', folder: 'D:\\q' })).rejects.toThrow(/EACCES/)
    expect(await w.read('D:\\q\\.squarel\\project.json')).toBeUndefined()
    expect(await w.read(`${DATA}\\workspaces\\q.json`)).toBeUndefined()
    expect(await listWorkspaces(w.ctx)).toEqual([])
  })

  it('reads project.json like Squarel: palette matched loosely, bad fields dropped, broken only without id/name', async () => {
    const files = {
      'D:\\t\\.squarel\\project.json': json({
        id: 't',
        name: ' T ',
        description: 42,
        defaults: { purpose: 'nope', width: 9999, height: 16, palette: 'PICO-8', future: 1 },
        repos: 'not a list',
        exportDir: 7,
      }),
      'D:\\b\\.squarel\\project.json': json({ id: 'b', name: '' }),
      [`${DATA}\\workspaces\\t.json`]: json({ schema: 1, id: 't', name: 'T', folder: 'D:\\t' }),
      [`${DATA}\\workspaces\\b.json`]: json({ schema: 1, id: 'b', name: 'B', folder: 'D:\\b' }),
    }
    const w = world(files)
    const t = await getWorkspace(w.ctx, 't')
    expect(t).toMatchObject({ status: 'ok', name: 'T', description: '', repos: [], exportDir: null })
    expect(t.defaults).toEqual({ height: 16, palette: 'pico8' })
    expect((await getWorkspace(w.ctx, 'b')).status).toBe('broken')
    expect(normalizePalette('Sweetie_16')).toBe('sweetie16')
    expect(normalizePalette('game boy')).toBe('gameboy')
    expect(normalizePalette('nes')).toBeUndefined()
    // Saving keeps unknown keys inside defaults.
    await updateWorkspace(w.ctx, 't', { brief: 'x' })
    const cfg = JSON.parse((await w.read('D:\\t\\.squarel\\project.json')) ?? '')
    expect(cfg.defaults).toEqual({ future: 1, height: 16, palette: 'pico8' })
  })

  it('update keeps unknown fields and text outside the block, rewrites the block', async () => {
    const w = world({
      'D:\\p\\.squarel\\project.json': json({
        schema: 1,
        id: 'p',
        name: 'P',
        brief: 'old brief',
        future: { a: 1 },
        exportDir: 'out',
      }),
      'D:\\p\\AGENTS.md': `top\n${BLOCK_BEGIN}\n# P\nold brief\n${BLOCK_END}\nbottom\n`,
      'D:\\p\\CLAUDE.md': 'mine\n',
      [`${DATA}\\workspaces\\p.json`]: json({ schema: 1, id: 'p', name: 'P', folder: 'D:\\p' }),
    })
    const r = await updateWorkspace(w.ctx, 'p', { name: 'P2', brief: 'new brief', exportDir: null })
    expect(r).toMatchObject({ name: 'P2', brief: 'new brief', exportDir: null })
    const cfg = JSON.parse((await w.read('D:\\p\\.squarel\\project.json')) ?? '')
    expect(cfg.future).toEqual({ a: 1 })
    expect(cfg).not.toHaveProperty('exportDir')
    const agents = (await w.read('D:\\p\\AGENTS.md')) ?? ''
    expect(agents.startsWith(`top\n${BLOCK_BEGIN}\n# P2\n`)).toBe(true)
    expect(agents).toContain('new brief')
    expect(agents).not.toContain('old brief')
    expect(agents.endsWith(`${BLOCK_END}\nbottom\n`)).toBe(true)
    expect(await w.read('D:\\p\\CLAUDE.md')).toBe('mine\n')
    expect(await w.read(`${DATA}\\workspaces\\p.json`)).toContain('"name": "P2"')
    await expect(updateWorkspace(w.ctx, 'p', { exportDir: '../x' })).rejects.toThrow(/tương đối/)
  })

  it('remove deletes only the index file', async () => {
    const files = {
      'D:\\p\\.squarel\\project.json': json({ schema: 1, id: 'p', name: 'P' }),
      'D:\\p\\AGENTS.md': 'a',
      [`${DATA}\\workspaces\\p.json`]: json({ schema: 1, id: 'p', name: 'P', folder: 'D:\\p' }),
      ...art('a1', '2026-01-01T00:00:00Z', 'D:\\p'),
    }
    const w = world(files)
    await removeWorkspace(w.ctx, 'p')
    expect(await w.read(`${DATA}\\workspaces\\p.json`)).toBeUndefined()
    for (const f of Object.keys(files).filter((k) => !k.includes('workspaces')))
      expect(await w.read(f), f).toBeDefined()
    await expect(removeWorkspace(w.ctx, 'p')).rejects.toThrow(/Không có dự án/)
  })
})

describe('list / get / unassigned', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(70 * 1024)])
  const files = {
    [`${DATA}\\workspaces\\a.json`]: json({
      schema: 1,
      id: 'a',
      name: 'A',
      folder: 'D:\\a',
      createdAt: '2025-01-01T00:00:00Z',
    }),
    [`${DATA}\\workspaces\\gone.json`]: json({ schema: 1, id: 'gone', name: 'Gone', folder: 'D:\\gone' }),
    [`${DATA}\\workspaces\\bad.json`]: '{nope',
    'D:\\a\\.squarel\\project.json': json({
      schema: 1,
      id: 'a',
      name: 'A real',
      defaults: { purpose: 'print' },
    }),
    ...art('a1', '2026-01-01T00:00:00Z', 'D:\\a'),
    ...art('a2', '2026-01-03T00:00:00Z', 'D:\\a'),
    ...art('a3', '2026-01-02T00:00:00Z', 'D:\\a'),
    ...art('a4', '2025-12-01T00:00:00Z', 'D:\\a'),
    ...art('g1', '2026-01-05T00:00:00Z', 'D:\\gone'),
    ...art('free', '2026-01-04T00:00:00Z'),
    'D:\\a\\squarel_art\\a2\\thumb.png': PNG.toString('latin1'),
    'D:\\a\\squarel_art\\a3\\thumb.png': big.toString('latin1'),
    'D:\\a\\squarel_art\\a1\\thumb.png': 'not a png',
    [`${DATA}\\run\\mcp-7.json`]: json({
      pid: 7,
      cwd: 'D:\\a\\sub',
      updatedAt: NOW.toISOString(),
      workspace: { id: 'a', name: 'A real' },
    }),
  }

  it('lists workspaces with counts, newest arts, sessions and missing folders', async () => {
    const w = world(files, { alivePids: [7] })
    const list = await listWorkspaces(w.ctx)
    expect(list.map((x) => [x.id, x.status, x.artCount, x.updatedAt, x.sessions])).toEqual([
      ['gone', 'missing', 1, '2026-01-05T00:00:00Z', 0],
      ['a', 'ok', 4, '2026-01-03T00:00:00Z', 1],
    ])
    const a = list[1]
    expect(a).toMatchObject({ name: 'A real', purpose: 'print', folder: 'D:\\a' })
    expect(a?.recent.map((r) => r.slug)).toEqual(['a2', 'a3', 'a1'])
    expect(a?.recent[0]?.thumb).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
    expect(a?.recent[1]?.thumb).toBeUndefined() // above 64 KB
    expect(a?.recent[2]?.thumb).toBeUndefined() // not a PNG
  })

  it('get returns config and every art; unassigned are the arts still in DATA_DIR/projects', async () => {
    const w = world(files)
    const a = await getWorkspace(w.ctx, 'a')
    expect(a.arts.map((x) => x.slug)).toEqual(['a2', 'a3', 'a1', 'a4'])
    expect(a.arts[0]).toMatchObject({ name: 'A2', purpose: 'game', head: 'v000001' })
    expect((await getWorkspace(w.ctx, 'gone')).status).toBe('missing')
    await expect(getWorkspace(w.ctx, 'bad')).rejects.toThrow(/Không có dự án/)
    expect((await legacyArts(w.ctx)).map((x) => x.slug)).toEqual(['free'])
  })

  it('legacyArts ignores the old workspace field and lists all', async () => {
    const w = world({
      ...files,
      [`${DATA}\\projects\\old\\project.json`]: json({
        slug: 'old',
        name: 'OLD',
        purpose: 'game',
        updatedAt: '2026-01-06T00:00:00Z',
        head: 'v000001',
        workspace: 'a',
      }),
    })
    expect((await legacyArts(w.ctx)).map((x) => x.slug)).toEqual(['old', 'free'])
  })

  it('get lists the live sessions of the workspace, busy ones with their tool', async () => {
    const w = world(
      {
        ...files,
        [`${DATA}\\run\\mcp-8.json`]: json({
          pid: 8,
          cwd: 'D:\\a',
          updatedAt: NOW.toISOString(),
          lastTool: 'draw_pixels',
          lastToolAt: NOW.toISOString(),
          workspace: { id: 'a', name: 'A real' },
        }),
        [`${DATA}\\run\\mcp-9.json`]: json({
          pid: 9,
          cwd: 'D:\\other',
          updatedAt: NOW.toISOString(),
          workspace: { id: 'gone', name: 'Gone' },
        }),
      },
      { alivePids: [7, 8, 9] },
    )
    const a = await getWorkspace(w.ctx, 'a')
    expect(a.sessions).toBe(2)
    expect(a.sessionList).toEqual([
      { title: 'sub', busy: false, subtitle: 'Rảnh' },
      { title: 'a', busy: true, subtitle: 'Đang gọi draw_pixels' },
    ])
    expect(sessionTitle('D:\\a', 'D:\\a\\x\\y')).toBe('x/y')
    expect(sessionTitle('D:\\a', 'E:\\elsewhere\\repo')).toBe('repo')
  })

  it('readThumb refuses a path outside squarel_art', async () => {
    const w = world(
      { ...files, 'E:\\evil.png': PNG.toString('latin1'), 'D:\\a\\other.png': PNG.toString('latin1') },
      {
        realpaths: {
          'D:\\a\\squarel_art\\a2\\thumb.png': 'E:\\evil.png',
          'D:\\a\\squarel_art\\a3\\thumb.png': 'D:\\a\\other.png',
        },
      },
    )
    expect((await getWorkspace(w.ctx, 'a')).arts[0]?.thumb).toBeUndefined()
    expect(await readThumb(w.ctx, 'D:\\a', 'a2')).toBeUndefined()
    expect(await readThumb(w.ctx, 'D:\\a', 'a3')).toBeUndefined()
    expect(await readThumb(w.ctx, 'D:\\a', '..')).toBeUndefined()
    const ok = world(files)
    expect(await readThumb(ok.ctx, 'D:\\a', 'a2')).toBe(`data:image/png;base64,${PNG.toString('base64')}`)
  })

  it('arts come from <folder>/squarel_art, not from DATA_DIR', async () => {
    const w = world({
      ...files,
      ...art('only-in-data', '2026-02-01T00:00:00Z'),
    })
    expect((await readArts(w.ctx, 'D:\\a')).map((x) => x.slug)).toEqual(['a2', 'a3', 'a1', 'a4'])
    expect(await readArts(w.ctx, 'D:\\nothing')).toEqual([])
    expect((await getWorkspace(w.ctx, 'a')).arts.map((x) => x.slug)).not.toContain('only-in-data')
  })

  it('a live session declaring the id from another folder marks duplicate', async () => {
    const run = (pid: number, folder?: string) => ({
      [`${DATA}\\run\\mcp-${pid}.json`]: json({
        pid,
        cwd: 'D:\\x',
        updatedAt: NOW.toISOString(),
        workspace: { id: 'a', name: 'A real', ...(folder ? { folder } : {}) },
      }),
    })
    const base = Object.fromEntries(Object.entries(files).filter(([k]) => !k.includes('\\run\\')))
    const same = world({ ...base, ...run(11, 'd:\\A') }, { alivePids: [11] })
    expect((await listWorkspaces(same.ctx)).find((x) => x.id === 'a')?.duplicate).toBeUndefined()
    const none = world({ ...base, ...run(12) }, { alivePids: [12] })
    expect((await listWorkspaces(none.ctx)).find((x) => x.id === 'a')?.duplicate).toBeUndefined()
    const dup = world({ ...base, ...run(13, 'D:\\copy\\a') }, { alivePids: [13] })
    expect((await listWorkspaces(dup.ctx)).find((x) => x.id === 'a')).toMatchObject({
      id: 'a',
      duplicate: 'D:\\copy\\a',
    })
    expect((await getWorkspace(dup.ctx, 'a')).duplicate).toBe('D:\\copy\\a')
    // A session that is dead no longer counts.
    const dead = world({ ...base, ...run(14, 'D:\\copy\\a') }, { alivePids: [] })
    expect((await listWorkspaces(dead.ctx)).find((x) => x.id === 'a')?.duplicate).toBeUndefined()
  })
})

describe('squarel_art, worktree, id', () => {
  it('inspectFolder plans squarel_art and its .gitignore', async () => {
    const fresh = world()
    fresh.chosen.push('D:\\p')
    expect((await inspectFolder(fresh.ctx, 'D:\\p')).files).toMatchObject({
      art: 'create',
      artIgnore: 'create',
    })
    const had = world({ 'D:\\p\\squarel_art\\.gitignore': '*.tmp\n' })
    had.chosen.push('D:\\p')
    expect((await inspectFolder(had.ctx, 'D:\\p')).files).toMatchObject({ art: 'keep', artIgnore: 'keep' })
    const dirOnly = world({ 'D:\\p\\squarel_art\\x\\project.json': '{}' })
    dirOnly.chosen.push('D:\\p')
    expect((await inspectFolder(dirOnly.ctx, 'D:\\p')).files).toMatchObject({
      art: 'keep',
      artIgnore: 'create',
    })
  })

  it('create writes squarel_art/.gitignore with the exact text', async () => {
    const w = world()
    w.chosen.push('D:\\p')
    await createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })
    expect(await w.read('D:\\p\\squarel_art\\.gitignore')).toBe(ART_GITIGNORE)
    expect(ART_GITIGNORE).toBe(
      '*/.lock\n*.tmp\n*/.work-*.json\n*/proposals/\n*/exports/\n*/work.aseprite\n*/thumb.png\n',
    )
  })

  it('create keeps an existing squarel_art/.gitignore', async () => {
    const w = world({ 'D:\\p\\squarel_art\\.gitignore': 'mine\n' })
    w.chosen.push('D:\\p')
    await createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })
    expect(await w.read('D:\\p\\squarel_art\\.gitignore')).toBe('mine\n')
    expect(await w.read('D:\\p\\.squarel\\project.json')).toBeDefined()
  })

  it('update does not create squarel_art', async () => {
    const w = world({
      'D:\\p\\.squarel\\project.json': json({ schema: 1, id: 'p', name: 'P' }),
      [`${DATA}\\workspaces\\p.json`]: json({ schema: 1, id: 'p', name: 'P', folder: 'D:\\p' }),
    })
    await updateWorkspace(w.ctx, 'p', { brief: 'x' })
    expect(await w.read('D:\\p\\squarel_art\\.gitignore')).toBeUndefined()
  })

  const WT = {
    'D:\\main\\.git\\HEAD': 'ref: refs/heads/main\n',
    'D:\\main\\.git\\worktrees\\wt\\commondir': '../..\n',
    'D:\\wt\\.git': 'gitdir: D:/main/.git/worktrees/wt\n',
    'D:\\wt\\sub\\readme.txt': '',
  }

  it('a linked worktree folder is refused with the main folder named', async () => {
    const w = world(WT)
    w.chosen.push('D:\\wt', 'D:\\wt\\sub')
    await expect(inspectFolder(w.ctx, 'D:\\wt')).rejects.toThrow(
      'Thư mục này là một git worktree. Hãy chọn thư mục dự án ở bản chính: D:\\main',
    )
    await expect(createWorkspace(w.ctx, { name: 'S', folder: 'D:\\wt\\sub' })).rejects.toThrow(
      'ở bản chính: D:\\main\\sub',
    )
    expect(await w.read('D:\\wt\\.squarel\\project.json')).toBeUndefined()
    // The main checkout itself, and a plain folder, are fine.
    w.chosen.push('D:\\main')
    await expect(inspectFolder(w.ctx, 'D:\\main')).resolves.toMatchObject({ existing: null })
  })

  it('worktreeMain: relative gitdir, bare repo and broken files are not worktrees', async () => {
    const d = world().d
    const rel = world({
      'D:\\main\\.git\\HEAD': '',
      'D:\\main\\.git\\worktrees\\wt\\commondir': '../..',
      'D:\\main\\wt\\.git': 'gitdir: ../.git/worktrees/wt',
    })
    expect(await worktreeMain(rel.d, 'D:\\main\\wt')).toBe('D:\\main')
    const bare = world({
      'D:\\bare\\worktrees\\wt\\commondir': '../..',
      'D:\\wt\\.git': 'gitdir: D:/bare/worktrees/wt',
    })
    expect(await worktreeMain(bare.d, 'D:\\wt')).toBeUndefined()
    const junk = world({ 'D:\\wt\\.git': 'nonsense' })
    expect(await worktreeMain(junk.d, 'D:\\wt')).toBeUndefined()
    expect(await worktreeMain(d, 'D:\\nowhere\\x')).toBeUndefined()
  })

  const idWorld = () =>
    world({
      'D:\\p\\.squarel\\project.json': json({ schema: 1, id: 'p', name: 'P', future: 1 }),
      'D:\\q\\.squarel\\project.json': json({ schema: 1, id: 'q', name: 'Q' }),
      [`${DATA}\\workspaces\\p.json`]: json({ schema: 1, id: 'p', name: 'P', folder: 'D:\\p' }),
      [`${DATA}\\workspaces\\q.json`]: json({ schema: 1, id: 'q', name: 'Q', folder: 'D:\\q' }),
      ...art('a1', '2026-01-01T00:00:00Z', 'D:\\p'),
    })

  it('changing the id rewrites project.json and the index; a taken id is refused', async () => {
    const w = idWorld()
    const r = await updateWorkspace(w.ctx, 'p', { id: 'p-new' })
    expect(r).toMatchObject({ id: 'p-new', name: 'P', artCount: 1 })
    const cfg = JSON.parse((await w.read('D:\\p\\.squarel\\project.json')) ?? '')
    expect(cfg).toMatchObject({ id: 'p-new', future: 1 })
    expect(await w.read(`${DATA}\\workspaces\\p.json`)).toBeUndefined()
    expect(JSON.parse((await w.read(`${DATA}\\workspaces\\p-new.json`)) ?? '')).toMatchObject({
      id: 'p-new',
      folder: 'D:\\p',
    })
    expect((await listWorkspaces(w.ctx)).map((x) => x.id).sort()).toEqual(['p-new', 'q'])

    await expect(updateWorkspace(w.ctx, 'p-new', { id: 'q' })).rejects.toThrow(/đã được dùng/)
    await expect(updateWorkspace(w.ctx, 'p-new', { id: 'Bad Id' })).rejects.toThrow(/Mã dự án/)
    expect(JSON.parse((await w.read('D:\\p\\.squarel\\project.json')) ?? '').id).toBe('p-new')
    // The same id is a plain save.
    await expect(updateWorkspace(w.ctx, 'p-new', { id: 'p-new', brief: 'x' })).resolves.toMatchObject({
      id: 'p-new',
      brief: 'x',
    })
  })
})

describe('changing the id survives a failing write', () => {
  const start = () =>
    world({
      'D:\\p\\.squarel\\project.json': json({ schema: 1, id: 'p', name: 'P' }),
      [`${DATA}\\workspaces\\p.json`]: json({ schema: 1, id: 'p', name: 'P', folder: 'D:\\p' }),
    })
  /** The same world, but writes to a path containing `failOn` (or removal of it) throw. */
  const failing = (w: ReturnType<typeof start>, failOn: string, op: 'writeFile' | 'rm'): WorkspaceCtx => {
    const fs = w.d.fs
    const boom = () => Object.assign(new Error('EIO'), { code: 'EIO' })
    return {
      ...w.ctx,
      d: {
        ...w.d,
        fs: {
          ...fs,
          writeFile: (async (p: string, data: string, o: unknown) => {
            if (op === 'writeFile' && String(p).includes(failOn)) throw boom()
            return fs.writeFile(p, data, o as 'utf8')
          }) as typeof fs.writeFile,
          rm: (async (p: string, o: unknown) => {
            if (op === 'rm' && String(p).includes(failOn)) throw boom()
            return fs.rm(p, o as { force: boolean })
          }) as typeof fs.rm,
        },
      },
    }
  }
  const cfgId = async (w: ReturnType<typeof start>) =>
    JSON.parse((await w.read('D:\\p\\.squarel\\project.json')) ?? '').id

  it('new index write fails: nothing changed, the project still opens as p', async () => {
    const w = start()
    await expect(
      updateWorkspace(failing(w, 'workspaces\\p-new', 'writeFile'), 'p', { id: 'p-new' }),
    ).rejects.toThrow(/EIO/)
    expect(await cfgId(w)).toBe('p')
    expect((await getWorkspace(w.ctx, 'p')).status).toBe('ok')
    expect((await listWorkspaces(w.ctx)).map((x) => x.id)).toEqual(['p'])
  })

  it('project.json write fails: the new index is removed, the project still opens as p', async () => {
    const w = start()
    await expect(
      updateWorkspace(failing(w, 'project.json', 'writeFile'), 'p', { id: 'p-new' }),
    ).rejects.toThrow(/EIO/)
    expect(await cfgId(w)).toBe('p')
    expect(await w.read(`${DATA}\\workspaces\\p-new.json`)).toBeUndefined()
    expect((await getWorkspace(w.ctx, 'p')).status).toBe('ok')
    expect((await listWorkspaces(w.ctx)).map((x) => x.id)).toEqual(['p'])
  })

  it('removing the old index fails: the project opens as p-new, the leftover entry is the only mess', async () => {
    const w = start()
    await expect(
      updateWorkspace(failing(w, 'workspaces\\p.json', 'rm'), 'p', { id: 'p-new' }),
    ).rejects.toThrow(/EIO/)
    expect(await cfgId(w)).toBe('p-new')
    expect((await getWorkspace(w.ctx, 'p-new')).status).toBe('ok')
    // Retrying the removal (what the user gets by removing the stale entry) leaves one project.
    await removeWorkspace(w.ctx, 'p')
    expect((await listWorkspaces(w.ctx)).map((x) => x.id)).toEqual(['p-new'])
  })
})

describe('Mở Claude', () => {
  const d = createDeps('fake', {})
  const CMD = 'C:\\Windows\\System32\\cmd.exe'

  it('visible window in the folder; --add-dir and env only for outside repos', () => {
    expect(claudeWorkspaceSpec(d, CLAUDE, 'D:\\Dự án\\game', [])).toEqual({
      argv: [CMD, '/d', '/c', 'start', 'Squarel Art Launcher', CMD, '/d', '/k', 'call', CLAUDE],
      cwd: 'D:\\Dự án\\game',
    })
    expect(claudeWorkspaceSpec(d, CLAUDE, 'D:\\g', ['D:\\Tài sản chung', 'E:\\lib'])).toEqual({
      argv: [
        CMD,
        '/d',
        '/c',
        'start',
        'Squarel Art Launcher',
        CMD,
        '/d',
        '/k',
        'call',
        CLAUDE,
        '--add-dir',
        'D:\\Tài sản chung',
        '--add-dir',
        'E:\\lib',
      ],
      cwd: 'D:\\g',
      env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' },
    })
  })

  it('claude.exe and a repo with spaces: the /k text starts with `call`, so cmd keeps the quotes', () => {
    const exe = 'D:\\Program Tools\\claude.exe'
    const { argv } = claudeWorkspaceSpec(d, exe, 'D:\\g', ['D:\\my repo'])
    expect(argv.slice(5)).toEqual([CMD, '/d', '/k', 'call', exe, '--add-dir', 'D:\\my repo'])
    // The text cmd /k gets (libuv quotes items with spaces) must not start with a quote.
    const kText = argv
      .slice(argv.indexOf('/k') + 1)
      .map((a) => (a.includes(' ') ? `"${a}"` : a))
      .join(' ')
    expect(kText).toBe('call "D:\\Program Tools\\claude.exe" --add-dir "D:\\my repo"')
    expect(kText.startsWith('"')).toBe(false)
  })

  it('refuses cmd metacharacters and non-absolute or non-.exe claude', () => {
    for (const ch of ['&', '|', '<', '>', '^', '%', '!', '"', "'", '(', ')', ';'])
      expect(() => claudeWorkspaceSpec(d, CLAUDE, 'D:\\g', [`D:\\a${ch}b`]), ch).toThrow(/ký tự/)
    expect(() => claudeWorkspaceSpec(d, 'claude.exe', 'D:\\g', [])).toThrow(/tuyệt đối/)
    expect(() => claudeWorkspaceSpec(d, 'C:\\npm\\claude.cmd', 'D:\\g', [])).toThrow(/tuyệt đối/)
    expect(() => claudeWorkspaceSpec(d, 'C:\\a&b\\claude.exe', 'D:\\g', [])).toThrow(/ký tự/)
  })

  const files = {
    'D:\\g\\.squarel\\project.json': json({
      schema: 1,
      id: 'g',
      name: 'G',
      repos: ['client', 'D:\\g\\server', 'D:\\shared', 'D:\\vanished'],
    }),
    'D:\\shared\\x': '',
    [`${DATA}\\workspaces\\g.json`]: json({ schema: 1, id: 'g', name: 'G', folder: 'D:\\g' }),
  }

  it('openClaude starts claude.exe from PATH with only existing outside repos', async () => {
    const w = world(files)
    await openClaude(w.ctx, 'g')
    expect(w.launched).toHaveLength(1)
    expect(w.launched[0]?.cwd).toBe('D:\\g')
    expect(w.launched[0]?.argv.slice(-3)).toEqual([CLAUDE, '--add-dir', 'D:\\shared'])
    expect(w.launched[0]?.env).toEqual({ CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' })
  })

  it('openClaude without Claude Code says how to install it', async () => {
    const w = world(files, { which: {} })
    await expect(openClaude(w.ctx, 'g')).rejects.toThrow(/Không tìm thấy Claude Code.*cài/i)
    const npm = world(files, { which: { claude: 'C:\\npm\\claude.cmd' } })
    await expect(openClaude(npm.ctx, 'g')).rejects.toThrow(/bản chính thức/)
    expect(w.launched).toEqual([])
  })
})

describe('links (fake fs)', () => {
  it('CLAUDE.md as a link is kept; AGENTS.md as a link is written through to its target', async () => {
    const w = world(
      { 'D:\\p\\AGENTS.md': '# Team\n', 'D:\\shared\\AGENTS.md': '# Shared\n' },
      { links: { 'D:\\p\\CLAUDE.md': 'D:\\p\\AGENTS.md' } },
    )
    w.chosen.push('D:\\p')
    expect((await inspectFolder(w.ctx, 'D:\\p')).files.claude).toBe('keep')
    await createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })
    expect((await w.d.fs.lstat('D:\\p\\CLAUDE.md')).isSymbolicLink()).toBe(true)
    expect(await w.read('D:\\p\\AGENTS.md')).toMatch(/squarel:end -->\n\n# Team\n$/)
    expect(await w.read('D:\\p\\AGENTS.md')).not.toContain('@AGENTS.md')

    const l = world(
      { 'D:\\shared\\AGENTS.md': '# Shared\n' },
      { links: { 'D:\\q\\AGENTS.md': 'D:\\shared\\AGENTS.md' } },
    )
    l.chosen.push('D:\\q')
    await createWorkspace(l.ctx, { name: 'Q', folder: 'D:\\q' })
    expect((await l.d.fs.lstat('D:\\q\\AGENTS.md')).isSymbolicLink()).toBe(true)
    expect(await l.read('D:\\shared\\AGENTS.md')).toMatch(/squarel:end -->\n\n# Shared\n$/)
    expect(await l.read('D:\\q\\CLAUDE.md')).toBe('@AGENTS.md\n')
  })

  it('AGENTS.md linked to CLAUDE.md: the block goes to CLAUDE.md, no self import is added', async () => {
    const w = world(
      { 'D:\\p\\CLAUDE.md': '# Rules\n' },
      { links: { 'D:\\p\\AGENTS.md': 'D:\\p\\CLAUDE.md' } },
    )
    w.chosen.push('D:\\p')
    expect((await inspectFolder(w.ctx, 'D:\\p')).files.claude).toBe('keep')
    await createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })
    const text = (await w.read('D:\\p\\CLAUDE.md')) ?? ''
    expect(text).toMatch(/squarel:end -->\n\n# Rules\n$/)
    expect(text).not.toContain('@AGENTS.md')
  })

  it('a dangling AGENTS.md link: refused, nothing written', async () => {
    const w = world({}, { links: { 'D:\\p\\AGENTS.md': 'D:\\gone.md' } })
    w.chosen.push('D:\\p')
    await expect(createWorkspace(w.ctx, { name: 'P', folder: 'D:\\p' })).rejects.toThrow(/liên kết/)
    expect(await w.read('D:\\p\\.squarel\\project.json')).toBeUndefined()
    expect(await w.read('D:\\p\\CLAUDE.md')).toBeUndefined()
    expect(await w.read('D:\\gone.md')).toBeUndefined()
  })
})

describe('links (real temp folders)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'sq-ws-links-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))
  /** File symlinks need Developer Mode or admin on Windows: those tests are skipped without it. */
  const canSymlink = (() => {
    try {
      writeFileSync(join(tmp, 'probe-target'), '')
      symlinkSync(join(tmp, 'probe-target'), join(tmp, 'probe-link'), 'file')
      return true
    } catch {
      return false
    }
  })()

  let n = 0
  function real() {
    const root = join(tmp, `case-${++n}`)
    const folder = join(root, 'ws')
    mkdirSync(folder, { recursive: true })
    const ctx: WorkspaceCtx = {
      d: createDeps('real'),
      dataDir: join(root, 'data'),
      chosen: (p) => p.toLowerCase() === folder.toLowerCase(),
    }
    return { root, folder, ctx }
  }

  it('CLAUDE.md hard-linked to AGENTS.md: CLAUDE.md is left alone and the link survives', async () => {
    const { folder, ctx } = real()
    writeFileSync(join(folder, 'AGENTS.md'), '# Team\n')
    linkSync(join(folder, 'AGENTS.md'), join(folder, 'CLAUDE.md'))
    expect((await inspectFolder(ctx, folder)).files.claude).toBe('keep')
    await createWorkspace(ctx, { name: 'Hard', folder })
    const agents = readFileSync(join(folder, 'AGENTS.md'), 'utf8')
    expect(agents).toContain(BLOCK_BEGIN)
    expect(agents).not.toContain('@AGENTS.md')
    expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe(agents)
    expect(statSync(join(folder, 'CLAUDE.md')).nlink).toBe(2)
  })

  it.runIf(canSymlink)('CLAUDE.md symlinked to AGENTS.md is never replaced', async () => {
    const { folder, ctx } = real()
    writeFileSync(join(folder, 'AGENTS.md'), '# Team\n')
    symlinkSync(join(folder, 'AGENTS.md'), join(folder, 'CLAUDE.md'), 'file')
    expect((await inspectFolder(ctx, folder)).files.claude).toBe('keep')
    await createWorkspace(ctx, { name: 'Sym', folder })
    expect(lstatSync(join(folder, 'CLAUDE.md')).isSymbolicLink()).toBe(true)
    expect(readFileSync(join(folder, 'AGENTS.md'), 'utf8')).toContain(BLOCK_BEGIN)
    expect(readFileSync(join(folder, 'AGENTS.md'), 'utf8')).not.toContain('@AGENTS.md')
  })

  it.runIf(canSymlink)(
    'AGENTS.md as a symlink: the target gets the block, the link stays a link',
    async () => {
      const { root, folder, ctx } = real()
      const target = join(root, 'shared-AGENTS.md')
      writeFileSync(target, '# Shared\n')
      symlinkSync(target, join(folder, 'AGENTS.md'), 'file')
      await createWorkspace(ctx, { name: 'Linked', folder })
      expect(lstatSync(join(folder, 'AGENTS.md')).isSymbolicLink()).toBe(true)
      expect(readFileSync(target, 'utf8')).toMatch(/squarel:end -->\n\n# Shared\n$/)
      expect(readFileSync(join(folder, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n')
    },
  )

  it.runIf(canSymlink)('a dangling AGENTS.md link is refused before anything is written', async () => {
    const { root, folder, ctx } = real()
    symlinkSync(join(root, 'missing.md'), join(folder, 'AGENTS.md'), 'file')
    await expect(createWorkspace(ctx, { name: 'Dangling', folder })).rejects.toThrow(/liên kết/)
    expect(lstatSync(join(folder, 'AGENTS.md')).isSymbolicLink()).toBe(true)
    expect(existsSync(join(folder, '.squarel'))).toBe(false)
    expect(existsSync(join(folder, 'CLAUDE.md'))).toBe(false)
  })
})
