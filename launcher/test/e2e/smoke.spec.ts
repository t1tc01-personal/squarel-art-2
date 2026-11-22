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
