import { resolve } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchIsolated } from './launch'

const FAKE = 'fixtures/basic'
const ROOT = 'Z:\\squarel-fixture'
const RAW_TOKEN = 'fixture-placeholder-not-a-token'
const SHOTS = resolve(process.cwd(), '..', '.superpowers/sdd/2026-11-22-launcher-app')

const rail = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng chính' })
const content = (page: Page) => page.getByRole('main')
const h1 = (page: Page) => page.getByRole('heading', { level: 1 })

interface Sink {
  launched: { argv: string[]; cwd: string; env?: Record<string, string> }[]
  bridgeTools: { name: string; input: { art: string } }[]
  opened: string[]
  folders: string[]
  external: string[]
  clipboard: string[]
}
const sink = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __squarelTest: Sink }).__squarelTest)

async function open(fake = FAKE) {
  const r = await launchIsolated({ fake })
  const page = await r.app.firstWindow()
  await expect(rail(page)).toBeVisible()
  return { ...r, page }
}

async function settle(page: Page) {
  await page.waitForTimeout(300) // pixel icons and fonts
}

test('integration page is generated from a fixture manifest named "Demo Tool" without code changes', async () => {
  const { app, page, close } = await open()
  try {
    await expect(rail(page).getByRole('button', { name: 'Demo Tool' })).toHaveCount(0)
    await rail(page).getByRole('button', { name: 'Thư viện tích hợp' }).click()
    await expect(h1(page)).toHaveText('Thư viện tích hợp')
    const card = content(page).getByRole('listitem', { name: 'Demo Tool' })
    await expect(card).toContainText('Chưa chọn')
    await expect(content(page).getByRole('listitem', { name: 'LibreSprite' })).toContainText('Sắp có')
    await card.getByRole('button', { name: 'Thêm vào launcher' }).click()

    const item = rail(page).getByRole('button', { name: 'Demo Tool' })
    await expect(item).toBeVisible()
    await expect(item.locator('img')).toHaveAttribute('src', /^data:image\/png;base64,iVBORw0KGgo/)
    await item.click()
    await expect(h1(page)).toHaveText('Demo Tool')
    await expect(content(page).locator('.page-int')).toHaveAttribute('data-accent', '#29ADFF')
    await expect(content(page).getByRole('tab')).toHaveText(['Tổng quan', 'Cập nhật', 'Health', 'Cài đặt'])
    await expect(content(page)).toContainText('dựng hoàn toàn từ file khai báo')
    await expect(content(page).getByTestId('card-update')).toContainText('Demo Tool 2.0.1')
    await expect(content(page).getByTestId('card-extension')).toContainText('Chưa kiểm tra')
    await page.evaluate(() => (window as any).squarel.runChecks())
    await expect(content(page).getByTestId('card-extension')).toContainText('Không có extension')
    await expect(content(page).getByTestId('card-activity')).toContainText('Không kết nối')
    await content(page).getByRole('tab', { name: 'Health' }).click()
    await expect(content(page).getByRole('region', { name: 'Kiểm tra Demo Tool' })).toContainText(
      'Demo Tool chạy được',
    )
    await content(page).getByRole('tab', { name: 'Tổng quan' }).click()

    await content(page).getByRole('button', { name: 'Mở Demo Tool' }).click()
    await content(page).getByRole('button', { name: 'Cách mở khác' }).click()
    await expect(page.getByRole('menuitem')).toHaveText(['Chế độ an toàn', 'Mở thư mục cài đặt'])
    await page.getByRole('menuitem', { name: 'Chế độ an toàn' }).click()
    const exe = `${ROOT}\\tools\\demo\\DemoTool.exe`
    await expect
      .poll(async () => (await sink(app)).launched.map((l) => l.argv))
      .toEqual([[exe], [exe, '--safe']])
  } finally {
    await close()
  }
})

test('launch menu lists all non-default actions and runs the chosen one', async () => {
  const { app, page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Aseprite' }).click()
    await expect(h1(page)).toHaveText('Aseprite')
    // Updates tab carries the "needs attention" dot (1.3.19 > 1.3.18.6).
    await expect(
      content(page)
        .getByRole('tab', { name: /Cập nhật/ })
        .getByRole('img'),
    ).toHaveAttribute('aria-label', 'cần chú ý')
    await expect(content(page).getByTestId('card-activity')).toContainText('Đang kết nối')
    const exe = `${ROOT}\\tools\\aseprite\\Aseprite.exe`

    await content(page).getByRole('button', { name: 'Mở Aseprite' }).click()
    await expect
      .poll(async () => (await sink(app)).launched)
      .toEqual([{ argv: [exe], cwd: `${ROOT}\\squarel` }])

    const more = content(page).getByRole('button', { name: 'Cách mở khác' })
    await more.click()
    await expect(page.getByRole('menuitem')).toHaveText([
      'Mở art…',
      'Mở game-dungeon/thu-sync',
      'Mở không đồng bộ',
      'Mở thư mục cài đặt',
    ])
    await page.getByRole('menuitem', { name: 'Mở không đồng bộ' }).click()
    await expect
      .poll(async () => (await sink(app)).launched[1])
      .toEqual({ argv: [exe], cwd: `${ROOT}\\squarel`, env: { SQUAREL_NO_SYNC: '1' } })

    await more.click()
    await page.getByRole('menuitem', { name: 'Mở game-dungeon/thu-sync' }).click()
    await expect
      .poll(async () => (await sink(app)).bridgeTools)
      .toEqual([{ name: 'open_in_editor', input: {}, ref: 'game-dungeon/thu-sync' }])

    await more.click()
    await page.getByRole('menuitem', { name: 'Mở art…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Chọn art' })
    await dialog.getByRole('button', { name: /Hiệp sĩ dungeon/ }).click()
    await expect
      .poll(async () => (await sink(app)).bridgeTools.at(-1))
      .toEqual({ name: 'open_in_editor', input: {}, ref: 'game-dungeon/hiep-si' })

    await more.click()
    await page.getByRole('menuitem', { name: 'Mở thư mục cài đặt' }).click()
    await expect.poll(async () => (await sink(app)).folders).toEqual([`${ROOT}\\tools\\aseprite`])
  } finally {
    await close()
  }
})

test('launch menu keyboard: arrows rove and wrap, Escape returns focus to ▾', async () => {
  const { page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Aseprite' }).click()
    await page.evaluate(() => (window as any).squarel.runChecks())
    await expect(content(page).getByTestId('card-extension')).not.toContainText('Chưa kiểm tra')
    await settle(page)
    await page.screenshot({ path: `${SHOTS}/task-13-integration.png` })
    const more = content(page).getByRole('button', { name: 'Cách mở khác' })
    await more.focus()
    await page.keyboard.press('Enter')
    const items = page.getByRole('menuitem')
    await expect(items).toHaveCount(4)
    await expect(items.nth(0)).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(1)).toBeFocused()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await expect(items.nth(3)).toBeFocused() // wrapped
    await page.keyboard.press('ArrowDown')
    await expect(items.nth(0)).toBeFocused() // wrapped back
    await page.keyboard.press('End')
    await expect(items.nth(3)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(more).toBeFocused()
    await expect(more).toHaveAttribute('aria-expanded', 'false')
  } finally {
    await close()
  }
})

test('system → components: Squarel at the launcher version waits for a launcher update', async () => {
  const { page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Hệ thống' }).click()
    await expect(h1(page)).toHaveText('Hệ thống')
    const rows = content(page).getByTestId('component-row')
    await expect(rows.first()).toBeVisible()
    const squarel = rows.and(page.locator('[data-id="squarel"]'))
    await expect(squarel).toContainText('0.4.5')
    await expect(squarel).toContainText('0.4.6')
    // Squarel 0.4.5 = the launcher's version: the newer tag 0.4.6 comes with a launcher update, so
    // the row says so and offers no button (Squarel only ever moves to the launcher's own tag).
    await expect(squarel).toContainText('Cập nhật launcher trước')
    const node = rows.and(page.locator('[data-id="node"]'))
    await expect(node).toContainText('24.19.0')
    const updates = content(page)
      .getByRole('region', { name: 'Thành phần' })
      .getByRole('button', { name: 'Cập nhật' })
    await expect(updates).toHaveCount(0)
    await expect(node.getByRole('button')).toHaveCount(0)
    await expect(rows.and(page.locator('[data-id="launcher"]')).getByRole('button')).toHaveCount(0)
    await expect(content(page).getByRole('button', { name: 'Cập nhật (1)' })).toHaveCount(0)
    await expect(rows.and(page.locator('[data-id="aseprite"]'))).toHaveCount(0)
    await settle(page)
    await page.screenshot({ path: `${SHOTS}/task-13-system.png` })
  } finally {
    await close()
  }
})

test('"Hoàn tất cập nhật" (tag plan from === to with a pending marker) runs updates:apply', async () => {
  const { page, close } = await open('fixtures/squarel-pending')
  try {
    await rail(page).getByRole('button', { name: 'Hệ thống' }).click()
    await content(page).getByRole('button', { name: 'Kiểm tra' }).click()
    await expect(content(page).getByTestId('squarel-plan')).toHaveText('Hoàn tất cập nhật')
    await content(page).getByRole('button', { name: 'Hoàn tất cập nhật' }).click()
    const toast = page.getByTestId('toast').last()
    await expect(toast).toContainText('Hoàn tất cập nhật')
    await expect(toast).toContainText('Đã cập nhật Squarel')
    // The marker is gone, so the next check finds nothing left to do.
    await content(page).getByRole('button', { name: 'Kiểm tra' }).click()
    await expect(content(page).getByTestId('squarel-plan')).toHaveText('Squarel đã đúng phiên bản')
  } finally {
    await close()
  }
})

test('health tab groups results and the fix button opens Settings', async () => {
  const { page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Hệ thống' }).click()
    await content(page).getByRole('tab', { name: 'Health check' }).click()
    const groups = content(page).getByTestId('check-group')
    await expect(groups.first()).toBeVisible({ timeout: 30_000 })
    await expect(groups.locator('.check-group-head')).toHaveText([
      'Claude',
      'Bridge & công cụ',
      'Aseprite',
      'Ảnh AI',
      'Máy',
    ])
    await expect(content(page).getByRole('region', { name: 'Aseprite' })).toContainText('Đã cài và chạy được')
    const rd = content(page)
      .getByRole('region', { name: 'Ảnh AI' })
      .locator('.row-check', { hasText: 'Retro Diffusion' })
    await rd.getByRole('button', { name: 'Thêm key' }).click()
    await expect(h1(page)).toHaveText('Cài đặt')
    await expect(rail(page).getByRole('button', { name: 'Cài đặt' })).toHaveAttribute('aria-current', 'page')
  } finally {
    await close()
  }
})

test('settings shows masked token and saving writes .env', async () => {
  const { page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Cài đặt' }).click()
    await expect(h1(page)).toHaveText('Cài đặt')
    const token = content(page).getByLabel('Cloudflare API token')
    await expect(token).toHaveAttribute('placeholder', '••••oken')
    await expect(token).toHaveValue('')
    expect(await page.content()).not.toContain(RAW_TOKEN)

    const port = content(page).getByLabel('Cổng bridge')
    await expect(port).toHaveValue('4321')
    await port.fill('4400')
    await content(page).getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(content(page).getByRole('button', { name: 'Đã lưu' })).toBeVisible()
    const env = await page.evaluate(() => (window as any).squarel.getEnv())
    expect(env.BRIDGE_PORT.value).toBe('4400')
    // The token was not touched by saving the port.
    expect(env.CLOUDFLARE_API_TOKEN).toMatchObject({ set: true, value: '••••oken' })
    await settle(page)
    await page.screenshot({ path: `${SHOTS}/task-13-settings.png` })

    // A bad value is refused by main and reported, nothing is written.
    await port.fill('99999')
    await content(page).getByRole('button', { name: 'Lưu thay đổi' }).click()
    await expect(page.getByTestId('toast').last()).toContainText('BRIDGE_PORT phải là số cổng')
    const after = await page.evaluate(() => (window as any).squarel.getEnv())
    expect(after.BRIDGE_PORT.value).toBe('4400')
  } finally {
    await close()
  }
})

test('about section shows both versions and opens the bundled LICENSE.md', async () => {
  const { app, page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Cài đặt' }).click()
    const about = content(page).getByTestId('about')
    await expect(about).toContainText('Launcherv0.4.5')
    await expect(about).toContainText('Squarelv0.4.5')
    await about.getByRole('button', { name: /LICENSE\.md/ }).click()
    await expect
      .poll(async () => (await sink(app)).opened)
      .toEqual([resolve(process.cwd(), '..', 'LICENSE.md')])
    const repo = about.getByRole('link')
    await expect(repo).toHaveAttribute('href', 'https://github.com/t1tc01-personal/squarel-art-2')
    await repo.click()
    await expect
      .poll(async () => (await sink(app)).external)
      .toEqual(['https://github.com/t1tc01-personal/squarel-art-2'])
  } finally {
    await close()
  }
})

test('logs view filters by source and copy never includes a raw token', async () => {
  const { app, page, close } = await open()
  try {
    await rail(page).getByRole('button', { name: 'Hệ thống' }).click()
    await content(page).getByRole('tab', { name: 'Nhật ký' }).click()
    const lines = content(page).getByTestId('log-line')
    await expect(lines).toHaveCount(4)
    await expect(content(page)).toContainText(`${ROOT}\\data\\logs`)

    await content(page).getByRole('button', { name: 'Bridge' }).click()
    await expect(lines).toHaveCount(2)
    await expect(lines.locator('.log-source')).toHaveText(['bridge', 'bridge'])
    await content(page).getByRole('button', { name: 'MCP' }).click()
    await expect(lines.locator('.log-source')).toHaveText(['mcp', 'mcp'])
    await content(page).getByRole('tab', { name: 'Lỗi' }).click()
    await expect(lines).toHaveCount(1)
    await content(page).getByRole('tab', { name: 'Info' }).click()
    await content(page).getByRole('button', { name: 'Tất cả' }).click()
    await expect(lines).toHaveCount(4)
    expect(await page.content()).not.toContain(RAW_TOKEN)

    await content(page).getByRole('button', { name: 'Sao chép cho Claude' }).click()
    await expect.poll(async () => (await sink(app)).clipboard.length).toBe(1)
    const copied = (await sink(app)).clipboard[0] ?? ''
    expect(copied).not.toContain(RAW_TOKEN)
    expect(copied).toContain('••••oken')
    expect(copied.split('\n')).toHaveLength(4)
  } finally {
    await close()
  }
})

test('connections tip mentions Aseprite only while Aseprite is selected', async () => {
  const { page, close } = await open()
  try {
    const tip = page.getByTestId('panel-tip')
    await expect(tip).toContainText('Aseprite')
    await page.evaluate(() => (window as any).squarel.setState({ selected: [] }))
    await page.reload()
    await expect(tip).toBeVisible()
    await expect(tip).not.toContainText('Aseprite')
  } finally {
    await close()
  }
})

test('screenshots: home and library', async () => {
  const { page, close } = await open()
  try {
    await expect(content(page).getByRole('list', { name: 'Art gần đây' }).getByRole('listitem')).toHaveCount(
      2,
    )
    await expect(content(page)).toContainText('Squarel Art v0.4.5 đã sẵn sàng')
    await settle(page)
    await page.screenshot({ path: `${SHOTS}/task-13-home.png` })
    await rail(page).getByRole('button', { name: 'Thư viện tích hợp' }).click()
    await expect(content(page).getByTestId('library-card').first()).toBeVisible()
    await settle(page)
    await page.screenshot({ path: `${SHOTS}/task-13-library.png` })
  } finally {
    await close()
  }
})
