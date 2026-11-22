import { _electron as electron, expect, test } from '@playwright/test'

test('launches a frameless 1280x800 window showing the SQUAREL wordmark', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('SQUAREL', { exact: true })).toBeVisible()
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
    await app.close()
  }
})

test('blocks new windows and navigation away from the app page', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('SQUAREL', { exact: true })).toBeVisible()
    // Record shell.openExternal instead of opening a real browser.
    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      ;(globalThis as any).__opened = opened
      ;(shell as any).openExternal = async (url: string) => {
        opened.push(url)
      }
    })
    const appUrl = page.url()

    await page.evaluate(() => {
      window.open('https://example.com')
    })
    await page.waitForTimeout(500)
    expect(app.windows()).toHaveLength(1)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1)
    expect(await app.evaluate(() => (globalThis as any).__opened)).toEqual(['https://example.com/'])

    await page.evaluate(() => {
      location.href = 'https://example.com'
    })
    await page.waitForTimeout(500)
    expect(page.url()).toBe(appUrl)
    expect(await page.evaluate(() => document.body.innerText)).toContain('SQUAREL')
  } finally {
    await app.close()
  }
})
