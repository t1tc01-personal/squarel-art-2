import { resolve } from 'node:path'
import { type ElectronApplication, expect, type Page, test } from '@playwright/test'
import { launchIsolated } from './launch'

const FAKE = 'fixtures/fresh'
const ROOT = 'Z:\\squarel-fixture'
const SHOTS = resolve(process.cwd(), '..', '.superpowers/sdd/2026-11-22-launcher-app')

const wizard = (page: Page) => page.getByRole('main', { name: 'Thiết lập lần đầu' })
const h1 = (page: Page) => page.getByRole('heading', { level: 1 })

interface Sink {
  launched: { argv: string[]; cwd: string }[]
  external: string[]
  clipboard: string[]
}
const sink = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __squarelTest: Sink }).__squarelTest)

/** Answers the next native folder / file dialog with `path` (Electron's dialog is the only stub). */
async function stubDialog(app: ElectronApplication, path: string) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [p],
    })) as typeof dialog.showOpenDialog
  }, path)
}

/** Confirms the consent dialog after checking it shows the exact command. */
async function consent(page: Page, command: RegExp, button = 'Cài') {
  const dlg = page.getByRole('dialog')
  await expect(dlg).toBeVisible()
  await expect(dlg.locator('.modal-command')).toHaveText(command)
  await dlg.getByRole('button', { name: button, exact: true }).click()
  await expect(dlg).toHaveCount(0)
}

async function shot(page: Page, n: number) {
  await page.locator('.wiz-scroll').evaluate((el) => el.scrollTo(0, 0))
  await page.waitForTimeout(300) // fonts and pixel icons
  await page.screenshot({ path: resolve(SHOTS, `task-14-step${n}.png`) })
}

test('fresh mode walks steps 1→4 with fake deps and ends on Home', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    // ---- step 1 -------------------------------------------------------------------------------
    await expect(wizard(page)).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toHaveCount(0)
    await expect(wizard(page)).toContainText('BƯỚC 1 / 4')
    await expect(h1(page)).toHaveText('Chào mừng tới Squarel Art')
    const fresh = wizard(page).getByRole('radio', { name: /Cài mới/ })
    await expect(fresh).toBeChecked()
    await expect(wizard(page)).toContainText('SquarelArt\\app')
    await shot(page, 1)
    await wizard(page).getByRole('button', { name: 'Tiếp tục' }).click()

    // ---- step 2 -------------------------------------------------------------------------------
    await expect(h1(page)).toHaveText('Cài công cụ cần thiết')
    const rows = wizard(page).getByTestId('install-row')
    await expect(rows.filter({ hasText: 'Git' })).toContainText('2.55.0')
    await expect(rows.filter({ hasText: 'Node.js' })).toContainText('Có sẵn')
    await expect(rows.filter({ hasText: 'Claude Code' })).toContainText('Có sẵn')
    const next = wizard(page).getByRole('button', { name: 'Tiếp tục' })
    await expect(next).toBeDisabled()
    // Nothing runs until the user clicks: clone first.
    await rows.filter({ hasText: 'Squarel Art' }).getByRole('button', { name: 'Tải về' }).click()
    await consent(
      page,
      /^git clone --branch v0.4.2 --depth 1 -- https:\/\/github\.com\/t1tc01-personal\/squarel-art-2\.git .+SquarelArt\\app$/,
    )
    await expect(rows.filter({ hasText: 'Squarel Art' })).toContainText('Xong')
    await rows.filter({ hasText: 'pnpm install' }).getByRole('button', { name: 'Cài' }).click()
    await consent(page, /^pnpm install$/)
    await expect(rows.filter({ hasText: 'pnpm install' })).toContainText('Xong')
    await expect(wizard(page).getByTestId('install-log')).toContainText('Done in 12.3s')
    await shot(page, 2)
    await expect(next).toBeEnabled()
    await next.click()

    // ---- step 3 -------------------------------------------------------------------------------
    await expect(h1(page)).toHaveText('Cấu hình')
    // local-sd is not running: the GPU option stays off.
    await expect(wizard(page).getByRole('tab', { name: 'GPU của máy' })).toBeDisabled()
    await wizard(page).getByLabel('Cloudflare account ID').fill('fixture-account')
    await wizard(page).getByLabel('Cloudflare API token').fill('fixture-placeholder-not-a-token')
    await wizard(page).getByRole('button', { name: 'Kiểm tra' }).click()
    await expect(wizard(page).getByTestId('cloudflare-result')).toContainText('Hợp lệ')
    // The token never comes back unmasked.
    await expect(wizard(page).getByLabel('Cloudflare API token')).toHaveValue('')
    await expect(wizard(page)).not.toContainText('fixture-placeholder-not-a-token')

    const ase = wizard(page).getByRole('region', { name: 'Aseprite' })
    await ase.getByRole('radio', { name: /Tự build từ source/ }).click()
    await expect(ase.getByTestId('eula-notice')).toContainText('dùng cá nhân')
    await expect(ase.getByRole('link', { name: /EULA/ })).toHaveAttribute('href', /^https:\/\//)
    // VS Build Tools: winget in a visible terminal, the user answers its prompts there.
    await ase.getByRole('button', { name: 'Cài Build Tools' }).click()
    await consent(
      page,
      /^winget install --id Microsoft\.VisualStudio\.2022\.BuildTools -e --override /,
      'Chạy',
    )
    await expect.poll(async () => (await sink(app)).launched.length).toBe(1)
    const term = (await sink(app)).launched[0]?.argv ?? []
    expect(term.slice(1, 4)).toEqual(['/d', '/c', 'start'])
    expect(term).toContain(`${ROOT}\\WindowsApps\\winget.exe`)
    expect(term.join(' ')).not.toMatch(/--accept|--passive|--quiet/)
    // The build runs in the background; the wizard can go on.
    await ase.getByRole('button', { name: 'Bắt đầu build' }).click()
    await consent(page, /aseprite:build -- --src .+ --json-progress$/)
    const progress = ase.getByTestId('install-progress')
    // Running: the card replaces the choice; cancelling asks first, then the task ends "Đã huỷ".
    await expect(progress).toContainText('Đang build Aseprite')
    await expect(ase.getByRole('radio', { name: /Tự build từ source/ })).toBeHidden()
    await expect(progress).toContainText('Bước 5/6 · Biên dịch')
    await progress.screenshot({ path: resolve(SHOTS, 'install-progress-running.png') })
    await progress.getByRole('button', { name: 'Huỷ build' }).click()
    await expect(progress).toContainText('Dừng và huỷ?')
    await progress.getByRole('button', { name: 'Huỷ build' }).click()
    await expect(progress).toContainText('Đã huỷ build Aseprite')
    // Thử lại runs the same command again (consent again) and this time it finishes.
    await progress.getByRole('button', { name: 'Thử lại' }).click()
    await consent(page, /aseprite:build -- --src .+ --json-progress$/)
    await expect(progress).toContainText('Đã build xong Aseprite', { timeout: 15_000 })
    await expect(progress.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100')
    await expect(progress.getByRole('listitem')).toHaveCount(6)
    await progress.getByRole('button', { name: 'Xem log' }).click()
    await expect(progress.getByTestId('install-log')).toContainText('Linking CXX executable')
    await shot(page, 3)
    await wizard(page).getByRole('button', { name: 'Lưu & tiếp tục' }).click()

    // ---- step 4 -------------------------------------------------------------------------------
    await expect(h1(page)).toHaveText('Kết nối với Claude')
    await wizard(page).getByRole('button', { name: 'Kết nối' }).click()
    const steps = wizard(page).getByTestId('connect-row')
    await expect(steps.filter({ hasText: 'Đăng ký MCP server' })).toHaveAttribute('data-result', 'pass')
    await expect(steps.filter({ hasText: 'Chép' })).toContainText('2 / 2')
    await expect(steps.filter({ hasText: 'Chạy thử MCP server' })).toContainText('41 tool')
    await expect(steps.filter({ hasText: 'Claude Code thấy squarel' })).toHaveAttribute('data-result', 'pass')
    await expect(wizard(page).getByTestId('extension-row')).toContainText('Aseprite')
    await wizard(page).getByRole('button', { name: 'Sao chép' }).click()
    await expect.poll(async () => (await sink(app)).clipboard.at(-1)).toMatch(/^\/pixel-new /)
    await shot(page, 4)
    await wizard(page).getByRole('button', { name: 'Hoàn tất' }).click()

    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible()
    await expect(h1(page)).toHaveText('Trang chủ')
    const st = await page.evaluate(() => (window as any).squarel.getState())
    expect(st).toMatchObject({ setupStep: 'done', mode: 'fresh', selected: ['aseprite'] })
    expect(st.installChoice).toEqual({ aseprite: 'build' })
  } finally {
    await close()
  }
})

test('clone mode rejects a folder that is not squarel-art', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await expect(h1(page)).toHaveText('Chào mừng tới Squarel Art')
    await wizard(page)
      .getByRole('radio', { name: /Dùng repo đã clone/ })
      .click()
    const next = wizard(page).getByRole('button', { name: 'Tiếp tục' })
    await expect(next).toBeDisabled()
    await stubDialog(app, `${ROOT}\\not-squarel`)
    await wizard(page).getByRole('button', { name: 'Chọn thư mục' }).click()
    await expect(wizard(page).getByRole('alert')).toContainText('không phải Squarel')
    await expect(next).toBeDisabled()
    const st = await page.evaluate(() => (window as any).squarel.getState())
    expect(st.squarelDir).toBeUndefined()
    expect(st.setupStep).toBe(1)
  } finally {
    await close()
  }
})

test('step 2 is never a trap: "Bỏ qua, vào launcher" opens the launcher', async () => {
  const { close, app } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await wizard(page).getByRole('button', { name: 'Tiếp tục' }).click()
    await expect(h1(page)).toHaveText('Cài công cụ cần thiết')
    await expect(wizard(page).getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
    // Without a Squarel folder the launcher has nothing to work on: the skip waits for it.
    const skip = wizard(page).getByRole('button', { name: 'Bỏ qua, vào launcher' })
    await expect(skip).toBeDisabled()
    const rows = wizard(page).getByTestId('install-row')
    await rows.filter({ hasText: 'Squarel Art' }).getByRole('button', { name: 'Tải về' }).click()
    await consent(page, /^git clone /)
    await expect(rows.filter({ hasText: 'Squarel Art' })).toContainText('Xong')
    // pnpm install still missing: "Tiếp tục" stays off, the skip is now allowed.
    await expect(wizard(page).getByRole('button', { name: 'Tiếp tục' })).toBeDisabled()
    await expect(skip).toBeEnabled()
    await skip.click()
    await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).toBeVisible()
    const st = await page.evaluate(() => (window as any).squarel.getState())
    expect(st).toMatchObject({ setupStep: 'done' })
    expect(st.squarelDir).toBeTruthy()
    expect(st.setupCompleted).toBeUndefined() // skipping never counts as finishing steps 3–4
  } finally {
    await close()
  }
})

test('closing mid-way resumes at the saved step', async () => {
  const { app, close } = await launchIsolated({ fake: FAKE })
  try {
    const page = await app.firstWindow()
    await wizard(page).getByRole('button', { name: 'Tiếp tục' }).click()
    await expect(h1(page)).toHaveText('Cài công cụ cần thiết')
    await page.reload()
    await expect(h1(page)).toHaveText('Cài công cụ cần thiết')
    await wizard(page).getByRole('button', { name: 'Quay lại' }).click()
    await expect(h1(page)).toHaveText('Chào mừng tới Squarel Art')
  } finally {
    await close()
  }
})
