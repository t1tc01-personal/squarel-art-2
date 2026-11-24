import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchIsolated } from './launch'

const FAKE = 'fixtures/workspaces'
const ROOT = 'Z:\\squarel-fixture'
const CMD = 'C:\\Windows\\System32\\cmd.exe'

interface Sink {
  launched: { argv: string[]; cwd: string; env?: Record<string, string> }[]
  folders: string[]
}
const sink = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __squarelTest: Sink }).__squarelTest)
/** A file of the fake world's in-memory fs (what main wrote), null when absent. */
const file = (app: ElectronApplication, path: string) =>
  app.evaluate(
    (_e, p) =>
      (
        globalThis as unknown as { __squarelTest: { readFile(p: string): Promise<string | null> } }
      ).__squarelTest.readFile(p),
    path,
  )

/** Answers the next native folder dialog with `path`, then picks it through window.squarel. */
async function pick(app: ElectronApplication, page: Page, path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog
  }, path)
  expect(await page.evaluate(() => (window as any).squarel.pickFolder())).toBe(path)
}

// The Dự án UI comes later; this drives the typed API (create → list → get → Mở Claude → remove).
test('workspaces API: list, create with files, open Claude in the folder, remove keeps files', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible()
    const api = <T>(fn: string, arg?: unknown) =>
      page.evaluate(([f, a]) => (window as any).squarel[f as string](a), [fn, arg] as const) as Promise<T>

    // ---- list / unassigned ----------------------------------------------------------------------
    const list = await api<any[]>('listWorkspaces')
    expect(list.map((w) => [w.id, w.status, w.artCount, w.sessions])).toEqual([
      ['game-dungeon', 'ok', 2, 1],
      ['pixel-sea', 'ok', 0, 1],
      ['old-stickers', 'missing', 0, 0],
    ])
    expect(list[0].recent.map((a: any) => a.slug)).toEqual(['slime', 'kiem-sat'])
    expect(list[0].recent[0].thumb).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)
    expect((await api<any[]>('unassignedArts')).map((a) => a.slug)).toEqual(['hiep-si'])
    const presence = await api<any[]>('getPresence')
    expect(presence[0].items.map((i: any) => i.title)).toEqual(['Phiên · Game dungeon', 'Phiên · Biển pixel'])

    // ---- create (folder and outside repo come from the pick dialog) ------------------------------
    const folder = `${ROOT}\\work\\parent\\Trò chơi mới`
    const shared = `${ROOT}\\shared\\assets`
    const refused = await api('createWorkspace', { name: 'X', folder: `${ROOT}\\elsewhere` }).then(
      () => 'accepted',
      (e: Error) => e.message,
    )
    expect(refused).toMatch(/Chọn/)
    await pick(app, page, shared)
    await pick(app, page, `${ROOT}\\work\\parent`)
    const info = await api<any>('inspectWorkspaceFolder', { folder })
    expect(info).toEqual({
      folderExists: false,
      existing: null,
      files: { project: 'create', agents: 'create', claude: 'create', art: 'create', artIgnore: 'create' },
    })
    const created = await api<any>('createWorkspace', {
      name: 'Trò chơi mới',
      folder,
      description: 'Bộ sprite thử',
      brief: 'Viền đen 1px',
      defaults: { purpose: 'game', width: 16, height: 16, palette: 'pico8' },
      repos: ['client', shared],
      exportDir: 'client/sprites',
    })
    expect(created).toMatchObject({ id: 'tro-choi-moi', status: 'ok', folder, artCount: 0 })
    const cfg = JSON.parse((await file(app, `${folder}\\.squarel\\project.json`)) ?? 'null')
    expect(cfg).toMatchObject({
      schema: 1,
      id: 'tro-choi-moi',
      repos: ['client', shared],
      exportDir: 'client/sprites',
    })
    expect(await file(app, `${folder}\\AGENTS.md`)).toContain('## Art brief\n\nViền đen 1px')
    expect(await file(app, `${folder}\\CLAUDE.md`)).toBe('@AGENTS.md\n')
    expect(await file(app, `${folder}\\squarel_art\\.gitignore`)).toBe(
      '*/.lock\n*.tmp\n*/.work-*.json\n*/proposals/\n*/exports/\n*/work.aseprite\n*/thumb.png\n',
    )
    expect(await file(app, `${ROOT}\\data\\workspaces\\tro-choi-moi.json`)).toContain('"id": "tro-choi-moi"')
    expect((await api<any[]>('listWorkspaces')).map((w) => w.id)).toContain('tro-choi-moi')
    const detail = await api<any>('getWorkspace', { id: 'tro-choi-moi' })
    expect(detail.repos).toEqual([
      { path: 'client', outside: false, exists: false },
      { path: shared, outside: true, exists: true },
    ])

    // ---- Mở Claude / Mở thư mục ------------------------------------------------------------------
    await api('openWorkspaceClaude', { id: 'tro-choi-moi' })
    expect((await sink(app)).launched.at(-1)).toEqual({
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
        `${ROOT}\\bin\\claude.exe`,
        '--add-dir',
        shared,
      ],
      cwd: folder,
      env: { CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD: '1' },
    })
    await api('openWorkspaceFolder', { id: 'tro-choi-moi' })
    expect((await sink(app)).folders.at(-1)).toBe(folder)

    // ---- update rewrites the AGENTS.md block -----------------------------------------------------
    await api('updateWorkspace', { id: 'tro-choi-moi', patch: { brief: 'Viền trắng 2px' } })
    const agents = (await file(app, `${folder}\\AGENTS.md`)) ?? ''
    expect(agents).toContain('Viền trắng 2px')
    expect(agents).not.toContain('Viền đen 1px')

    // ---- remove: only the index goes ------------------------------------------------------------
    await api('removeWorkspace', { id: 'tro-choi-moi' })
    expect((await api<any[]>('listWorkspaces')).map((w) => w.id)).not.toContain('tro-choi-moi')
    expect(await file(app, `${ROOT}\\data\\workspaces\\tro-choi-moi.json`)).toBeNull()
    expect(await file(app, `${folder}\\.squarel\\project.json`)).not.toBeNull()
    expect(await file(app, `${folder}\\AGENTS.md`)).not.toBeNull()
    const gone = await api('getWorkspace', { id: 'tro-choi-moi' }).then(
      () => 'found',
      (e: Error) => e.message,
    )
    expect(gone).toMatch(/Không có dự án/)
  } finally {
    await close()
  }
})
