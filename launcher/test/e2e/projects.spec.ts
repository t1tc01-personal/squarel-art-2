import { resolve } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchIsolated } from './launch'

const FAKE = 'fixtures/workspaces'
const ROOT = 'Z:\\squarel-fixture'
const SHOTS = resolve(process.cwd(), '..', '.superpowers/sdd/2026-11-22-launcher-app')

const rail = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng chính' })
const content = (page: Page) => page.getByRole('main')
const h1 = (page: Page) => page.getByRole('heading', { level: 1 })

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

/** Answers the next native folder dialog with `path`. */
async function stubDialog(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog
  }, path)
}

/** Screenshot of the whole page: the window grows to the content height for a moment. */
async function shot(app: ElectronApplication, page: Page, name: string) {
  const height = await page.locator('.content').evaluate((el) => {
    el.scrollTo(0, 0)
    return el.scrollHeight
  })
  const grow = Math.max(800, Math.min(height + 80, 1400))
  await app.evaluate(({ BrowserWindow }, h) => BrowserWindow.getAllWindows()[0]?.setSize(1280, h), grow)
  await page.waitForTimeout(400) // layout, fonts and pixel icons
  await page.screenshot({ path: resolve(SHOTS, name) })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1280, 800))
}

test('Dự án: list, create through the form, detail, brief, remove', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await expect(rail(page)).toBeVisible()

    // ---- list ----------------------------------------------------------------------------------
    const item = rail(page).getByRole('button', { name: 'Dự án', exact: true })
    const order = await rail(page)
      .getByRole('button')
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(order.slice(0, 3)).toEqual(['Trang chủ', 'Dự án', 'Thư viện tích hợp'])
    await item.click()
    await expect(h1(page)).toHaveText('Dự án')
    await expect(item).toHaveAttribute('aria-current', 'page')
    await expect(content(page)).toContainText('Mỗi dự án là một thư mục.')

    const dungeon = content(page).getByRole('listitem', { name: 'Game dungeon' })
    await expect(dungeon).toContainText('2 art')
    await expect(dungeon).toContainText('1 phiên Claude đang mở')
    await expect(dungeon).toContainText(`${ROOT}\\work\\game-dungeon`)
    await expect(dungeon).toContainText('Game')
    await expect(dungeon.locator('.ws-thumb')).toHaveCount(2)
    await expect(dungeon.getByRole('button')).toHaveText(['Mở Claude', 'Chi tiết'])

    const missing = content(page).getByRole('listitem', { name: 'Sticker cũ' })
    await expect(missing).toContainText('Mất thư mục')
    await expect(missing.getByRole('alert')).toContainText('Không thấy thư mục')
    await expect(missing.getByRole('button')).toHaveText(['Gỡ'])

    const unassigned = content(page).getByRole('listitem', { name: 'Chưa phân loại' })
    await expect(unassigned).toContainText('1 art tạo trước khi có dự án')
    await expect(unassigned).toContainText('"chuyển art Hiệp sĩ dungeon vào dự án này"')
    await expect(unassigned.locator('.ws-thumb')).toHaveCount(1)
    await expect(content(page).getByRole('listitem', { name: 'Mẹo' })).toContainText('AGENTS.md')

    // Mở Claude from the card: cwd = the folder, the outside repo with --add-dir.
    await dungeon.getByRole('button', { name: 'Mở Claude' }).click()
    await expect.poll(async () => (await sink(app)).launched.length).toBe(1)
    const first = (await sink(app)).launched[0]
    expect(first?.cwd).toBe(`${ROOT}\\work\\game-dungeon`)
    expect(first?.argv.slice(-2)).toEqual(['--add-dir', `${ROOT}\\shared\\assets`])
    await shot(app, page, 'projects-list.png')

    // ---- Dự án mới -----------------------------------------------------------------------------
    await content(page).getByRole('button', { name: 'Dự án mới', exact: true }).click()
    await expect(h1(page)).toHaveText('Dự án mới')
    await expect(rail(page).getByRole('button', { name: 'Dự án', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    // Inline validation before anything is filled in.
    await content(page).getByRole('button', { name: 'Tạo dự án', exact: true }).click()
    await expect(content(page)).toContainText('Nhập tên dự án')
    await expect(content(page)).toContainText('Chọn thư mục dự án')
    await expect(page.locator('[data-testid="write-AGENTS.md"]')).toContainText('tạo mới')

    const info = content(page).getByRole('region', { name: 'Thông tin' })
    await info.getByLabel('Tên dự án').fill('Rừng đêm')
    await stubDialog(app, `${ROOT}\\work\\parent`)
    await info.getByRole('button', { name: 'Chọn…' }).click()
    await expect(info.getByLabel('Thư mục dự án')).toHaveValue(`${ROOT}\\work\\parent`)
    await info.getByLabel('Tạo thư mục con (tuỳ chọn)').fill('rung-dem')
    const folder = `${ROOT}\\work\\parent\\rung-dem`
    await expect(info.getByLabel('Thư mục dự án')).toHaveValue(folder)
    await info.getByLabel('Mô tả').fill('Platformer rừng đêm')
    await content(page).getByLabel('Phong cách và quy tắc').fill('Sprite 16×16, viền tím đậm')

    const defaults = content(page).getByRole('region', { name: 'Mặc định cho art mới' })
    await defaults.getByText('Digital', { exact: true }).click()
    await expect(defaults.getByRole('radio', { name: 'Digital' })).toBeChecked()
    await defaults.getByLabel('Rộng').fill('300')
    await defaults.getByLabel('Cao').fill('16')
    await defaults.getByText('Sweetie 16', { exact: true }).click()

    const repos = content(page).getByRole('region', { name: 'Repo gắn kèm' })
    const shared = `${ROOT}\\shared\\assets`
    await stubDialog(app, shared)
    await repos.getByRole('button', { name: 'Thêm repo' }).click()
    const repo = repos.getByRole('listitem', { name: 'assets' })
    await expect(repo).toContainText('ở ngoài · --add-dir')
    await expect(repo).toContainText(shared)
    await repos.getByLabel('Thư mục nhận file xuất').fill('assets/sprites')

    const writes = page.getByTestId('ws-writes')
    await expect(writes.getByTestId('write-AGENTS.md')).toContainText('tạo mới · brief cho mọi agent')
    await expect(writes.getByTestId('write-CLAUDE.md')).toContainText('tạo mới · dòng @AGENTS.md')
    await expect(writes.getByTestId('write-.squarel/project.json')).toContainText('tạo mới')

    // 300 is refused inline; fixed to 16 the form goes through.
    await content(page).getByRole('button', { name: 'Tạo và mở Claude' }).click()
    await expect(defaults).toContainText('Từ 1 đến 256')
    await expect(h1(page)).toHaveText('Dự án mới')
    await defaults.getByLabel('Rộng').fill('16')
    await expect(defaults).not.toContainText('Từ 1 đến 256')
    await shot(app, page, 'projects-new.png')
    await content(page).getByRole('button', { name: 'Tạo và mở Claude' }).click()

    await expect(h1(page)).toHaveText('Rừng đêm')
    await expect(content(page)).toContainText('Digital · 16×16 · Sweetie 16')
    await expect(content(page)).toContainText(folder)
    const agents = (await file(app, `${folder}\\AGENTS.md`)) ?? ''
    expect(agents).toContain('<!-- squarel:begin')
    expect(agents).toContain('# Rừng đêm')
    expect(agents).toContain('## Art brief\n\nSprite 16×16, viền tím đậm')
    expect(await file(app, `${folder}\\CLAUDE.md`)).toBe('@AGENTS.md\n')
    const cfg = JSON.parse((await file(app, `${folder}\\.squarel\\project.json`)) ?? 'null')
    expect(cfg).toMatchObject({
      id: 'rung-dem',
      name: 'Rừng đêm',
      description: 'Platformer rừng đêm',
      defaults: { purpose: 'digital', width: 16, height: 16, palette: 'sweetie16' },
      repos: [shared],
      exportDir: 'assets/sprites',
    })
    await expect.poll(async () => (await sink(app)).launched.length).toBe(2)
    const launched = (await sink(app)).launched[1]
    expect(launched?.cwd).toBe(folder)
    expect(launched?.argv.slice(-2)).toEqual(['--add-dir', shared])
    await expect(content(page).getByTestId('ws-repos')).toContainText('ở ngoài · --add-dir')

    // ---- detail of game-dungeon ----------------------------------------------------------------
    await content(page).getByRole('button', { name: '← Dự án' }).click()
    await expect(h1(page)).toHaveText('Dự án')
    await expect(content(page).getByRole('listitem', { name: 'Rừng đêm' })).toContainText('0 art')
    await content(page)
      .getByRole('listitem', { name: 'Game dungeon' })
      .getByRole('button', { name: 'Chi tiết' })
      .click()
    await expect(h1(page)).toHaveText('Game dungeon')
    await expect(content(page).getByRole('tab')).toHaveText(['Tổng quan', 'Brief', 'Cài đặt'])
    await expect(content(page)).toContainText('Game · 32×32 · PICO-8')
    await expect(content(page)).toContainText('Art · 2')
    await expect(content(page).getByTestId('ws-art')).toHaveCount(2)
    await expect(content(page).getByRole('listitem', { name: 'Slime xanh' })).toBeVisible()
    await expect(content(page).getByRole('listitem', { name: 'Kiếm sắt' })).toBeVisible()
    await expect(content(page).getByRole('listitem', { name: 'Slime xanh' }).locator('img')).toHaveAttribute(
      'src',
      /^data:image\/png;base64,/,
    )
    await expect(content(page).getByTestId('ws-sessions')).toContainText('1 phiên đang mở')
    const sessionRows = content(page).getByTestId('ws-session')
    await expect(sessionRows).toHaveCount(1)
    await expect(sessionRows.first()).toHaveAttribute('aria-label', 'game-client')
    await expect(sessionRows.first()).toContainText('Rảnh')
    const detailRepos = content(page).getByTestId('ws-repos')
    await expect(detailRepos.getByRole('listitem', { name: 'game-client' })).toContainText('trong thư mục')
    await expect(detailRepos.getByRole('listitem', { name: 'assets' })).toContainText('ở ngoài · --add-dir')
    await expect(content(page).getByTestId('ws-brief')).toContainText('Sprite 32×32')
    await shot(app, page, 'projects-detail.png')

    // Mở thư mục from the Mở Claude menu.
    await content(page).getByRole('button', { name: 'Cách mở khác' }).click()
    await page.getByRole('menuitem', { name: 'Mở thư mục' }).click()
    await expect.poll(async () => (await sink(app)).folders.at(-1)).toBe(`${ROOT}\\work\\game-dungeon`)

    // ---- Brief tab -----------------------------------------------------------------------------
    await content(page).getByTestId('ws-brief').getByRole('button', { name: 'Sửa brief' }).click()
    await expect(content(page).getByRole('tab', { name: 'Brief' })).toHaveAttribute('aria-selected', 'true')
    const save = content(page).getByRole('button', { name: 'Lưu', exact: true })
    await expect(save).toBeDisabled()
    await content(page).getByLabel('Phong cách và quy tắc').fill('Sprite 32×32, viền trắng 2px')
    await save.click()
    await expect(page.locator('.toast').filter({ hasText: 'Đã ghi AGENTS.md' })).toBeVisible()
    const rewritten = (await file(app, `${ROOT}\\work\\game-dungeon\\AGENTS.md`)) ?? ''
    expect(rewritten).toContain('viền trắng 2px')
    expect(rewritten).toContain('# Quy ước nhóm') // the user's own text stays
    await expect(save).toBeDisabled()

    // ---- Cài đặt → Gỡ khỏi launcher ------------------------------------------------------------
    await content(page).getByRole('tab', { name: 'Cài đặt' }).click()
    await expect(content(page).getByRole('region', { name: 'Mặc định cho art mới' })).toBeVisible()
    await expect(
      content(page)
        .getByRole('region', { name: 'Mặc định cho art mới' })
        .getByRole('radio', { name: 'PICO-8' }),
    ).toBeChecked()
    await content(page).getByRole('button', { name: 'Gỡ khỏi launcher' }).click()
    const dlg = page.getByRole('dialog')
    await expect(dlg).toContainText('Gỡ “Game dungeon” khỏi launcher?')
    await expect(dlg).toContainText('vẫn giữ nguyên')
    await dlg.getByRole('button', { name: 'Gỡ khỏi launcher' }).click()
    await expect(h1(page)).toHaveText('Dự án')
    await expect(content(page).getByRole('listitem', { name: 'Rừng đêm' })).toBeVisible()
    await expect(content(page).getByRole('listitem', { name: 'Game dungeon' })).toHaveCount(0)
    expect(await file(app, `${ROOT}\\data\\workspaces\\game-dungeon.json`)).toBeNull()
    expect(await file(app, `${ROOT}\\work\\game-dungeon\\.squarel\\project.json`)).not.toBeNull()
    expect(await file(app, `${ROOT}\\work\\game-dungeon\\AGENTS.md`)).toContain('viền trắng 2px')
  } finally {
    await close()
  }
})
