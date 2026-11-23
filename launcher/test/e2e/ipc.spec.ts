import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { launchIsolated } from './launch'

test('window.squarel exposes only the typed API and main validates calls', async () => {
  const { app, close } = await launchIsolated()
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('main', { name: 'Thiết lập lần đầu' })).toBeVisible()
    const r = await page.evaluate(async () => {
      const api = (window as any).squarel
      const keys = Object.keys(api).sort()
      const state = await api.getState()
      const bad = await api.setState({ schema: 2 }).then(
        () => 'accepted',
        (e: Error) => String(e.message),
      )
      return { keys, schema: state.schema, bad, hasIpc: 'ipcRenderer' in api, frozen: Object.isFrozen(api) }
    })
    expect(r.keys).toEqual(
      [
        'about',
        'catalog',
        'openLicense',
        'readLogs',
        'writeClipboard',
        'applyUpdates',
        'checkUpdates',
        'closeWindow',
        'getEnv',
        'getPresence',
        'getState',
        'lastChecks',
        'listComponents',
        'minimizeWindow',
        'onChecksChanged',
        'onComponentsChanged',
        'onPresenceChanged',
        'onTaskEvent',
        'pickFile',
        'pickFolder',
        'recentProjects',
        'reveal',
        'runAction',
        'runCheck',
        'runChecks',
        'setEnv',
        'setState',
        'setupInfo',
      ].sort(),
    )
    expect(r.schema).toBe(1)
    expect(r.bad).toMatch(/không hợp lệ/)
    expect(r.hasIpc).toBe(false)
    expect(r.frozen).toBe(true)

    // State goes to the throwaway profile, never the real one.
    await page.evaluate(() => (window as any).squarel.setState({ closeToTray: false }))
    const appData = await app.evaluate(() => process.env.APPDATA ?? '')
    expect(appData).toContain('squarel-launcher-e2e-')
    expect(existsSync(join(appData, 'SquarelArt Launcher', 'state.json'))).toBe(true)
  } finally {
    await close()
  }
})
