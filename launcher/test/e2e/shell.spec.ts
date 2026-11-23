import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { launchIsolated } from './launch'

const FAKE = 'fixtures/basic'

const rail = (page: Page) => page.getByRole('navigation', { name: 'Điều hướng chính' })
const panel = (page: Page) => page.getByRole('complementary', { name: 'Kết nối', exact: true })

test('rail shows home, library, Aseprite (from manifest), add, system, settings', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    const buttons = rail(page).getByRole('button')
    await expect(buttons).toHaveCount(6)
    const labels = await buttons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    expect(labels).toEqual([
      'Trang chủ',
      'Thư viện tích hợp',
      'Aseprite',
      'Thêm tích hợp',
      'Hệ thống',
      'Cài đặt',
    ])

    // The integration icon is the manifest's icon.png, sent as a data URL.
    const src = await rail(page).getByRole('button', { name: 'Aseprite' }).locator('img').getAttribute('src')
    expect(src).toMatch(/^data:image\/png;base64,iVBORw0KGgo/)

    const home = rail(page).getByRole('button', { name: 'Trang chủ' })
    await expect(home).toHaveAttribute('aria-current', 'page')
    await rail(page).getByRole('button', { name: 'Aseprite' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Aseprite')
    await expect(rail(page).getByRole('button', { name: 'Aseprite' })).toHaveAttribute('aria-current', 'page')
    await expect(home).not.toHaveAttribute('aria-current', 'page')
    await rail(page).getByRole('button', { name: 'Hệ thống' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hệ thống')
    await rail(page).getByRole('button', { name: 'Thêm tích hợp' }).click()
    await expect(rail(page).getByRole('button', { name: 'Thư viện tích hợp' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await rail(page).getByRole('button', { name: 'Trang chủ' }).click()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Trang chủ')
    await page.waitForTimeout(300) // let the pixel icons and fonts settle for the screenshot
    await page.screenshot({
      path: resolve(process.cwd(), '..', '.superpowers/sdd/2026-11-22-launcher-app/task-12-shell.png'),
    })
  } finally {
    await close()
  }
})

test('connections panel shows 2 Claude sessions, Aseprite, Bridge, Cloudflare, Retro Diffusion', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    const p = panel(page)
    await expect(p.getByRole('heading', { name: 'Kết nối' })).toBeVisible()
    const rows = p.getByTestId('presence-row')
    await expect(rows).toHaveCount(6)
    await expect(rows.locator('.presence-title')).toHaveText([
      'Phiên · game-dungeon',
      'Phiên · squarel-art-2',
      'Aseprite',
      'Bridge',
      'Cloudflare AI',
      'Retro Diffusion',
    ])
    await expect(rows.nth(0)).toContainText('Đang gọi generate_image')
    await expect(rows.nth(1)).toContainText('Rảnh')
    await expect(rows.nth(2)).toContainText('thu-sync · 1.3.18.6')
    await expect(rows.nth(3)).toContainText('ws://127.0.0.1:4321')
    await expect(rows.nth(4)).toContainText('Còn 9.140 neuron hôm nay')
    await expect(rows.nth(5)).toContainText('Chưa có key · tuỳ chọn')
    await expect(p.getByRole('region', { name: 'Claude Code' })).toContainText('2')
    await expect(p).toContainText('Mọi thứ ổn · 5 kết nối')
    // The tool row uses the integration's own icon.
    await expect(rows.nth(2).locator('img')).toHaveAttribute('src', /^data:image\/png;base64,/)

    // Filter tab "Phiên Claude Code" leaves only the sessions.
    await p.getByRole('tab', { name: 'Phiên Claude Code' }).click()
    await expect(rows).toHaveCount(2)
  } finally {
    await close()
  }
})

test('collapse button hides the panel and survives reload', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await expect(panel(page)).toBeVisible()
    await page.getByRole('button', { name: 'Thu gọn panel Kết nối' }).click()
    await expect(panel(page)).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Mở rộng panel Kết nối' })).toBeVisible()

    await page.reload()
    await expect(rail(page)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mở rộng panel Kết nối' })).toBeVisible()
    await expect(panel(page)).toHaveCount(0)

    await page.getByRole('button', { name: 'Mở rộng panel Kết nối' }).click()
    await expect(panel(page)).toBeVisible()
    await page.reload()
    await expect(panel(page)).toBeVisible()
  } finally {
    await close()
  }
})

test('custom title bar buttons minimize/close', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await expect(rail(page)).toBeVisible()
    const win = () =>
      app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        return w ? { minimized: w.isMinimized(), visible: w.isVisible() } : null
      })

    await page.getByRole('button', { name: 'Thu nhỏ' }).click()
    await expect.poll(async () => (await win())?.minimized).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore())
    await expect.poll(async () => (await win())?.minimized).toBe(false)

    // closeToTray (fixture: on) → the app keeps running; until the tray exists (T15) the window
    // minimizes instead of hiding, so it can always be brought back.
    await page.getByRole('button', { name: 'Đóng' }).click()
    await expect.poll(async () => (await win())?.minimized).toBe(true)
    expect(app.windows()).toHaveLength(1)

    // closeToTray off → closing quits the app.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.restore())
    await page.evaluate(() => (window as any).squarel.setState({ closeToTray: false }))
    const quit = app.waitForEvent('close')
    await page.getByRole('button', { name: 'Đóng' }).click()
    await quit
  } finally {
    await close()
  }
})
