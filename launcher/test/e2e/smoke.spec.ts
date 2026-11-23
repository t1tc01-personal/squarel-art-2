import { expect, test } from '@playwright/test'
import { launchIsolated } from './launch'

test('launches a frameless 1280x800 window showing the shell', async () => {
  const { app, close } = await launchIsolated()
  try {
    const page = await app.firstWindow()
    // A fresh profile has no Squarel yet: main shows the setup wizard under the same title bar.
    await expect(page.getByRole('main', { name: 'Thiết lập lần đầu' })).toBeVisible()
    const size = await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]
      return { bounds: win.getContentBounds() }
    })
    expect(size.bounds.width).toBe(1280)
    expect(size.bounds.height).toBe(800)
    const prefs = await page.evaluate(() => ({
      hasRequire: typeof (window as any).require,
      hasProcess: typeof (window as any).process,
    }))
    expect(prefs.hasRequire).toBe('undefined')
    expect(prefs.hasProcess).toBe('undefined')
  } finally {
    await close()
  }
})

test('blocks new windows and navigation away from the app page', async () => {
  const { app, close } = await launchIsolated()
  try {
    const page = await app.firstWindow()
    // A fresh profile has no Squarel yet: main shows the setup wizard under the same title bar.
    await expect(page.getByRole('main', { name: 'Thiết lập lần đầu' })).toBeVisible()
    // In test mode main records https links (globalThis.__squarelTest.external) instead of opening a browser.
    const appUrl = page.url()

    await page.evaluate(() => {
      window.open('https://example.com')
    })
    await page.waitForTimeout(500)
    expect(app.windows()).toHaveLength(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(await app.evaluate(() => (globalThis as any).__squarelTest.external)).toEqual([
      'https://example.com/',
    ])

    await page.evaluate(() => {
      location.href = 'https://example.com'
    })
    await page.waitForTimeout(500)
    expect(page.url()).toBe(appUrl)
    expect(await page.evaluate(() => document.body.textContent)).toContain('Squarel Art Launcher')
  } finally {
    await close()
  }
})
