import { _electron as electron, expect, test } from '@playwright/test'

test('window.squarel exposes only the typed API and main validates calls', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const page = await app.firstWindow()
    await expect(page.getByText('SQUAREL', { exact: true })).toBeVisible()
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
        'applyUpdates',
        'checkUpdates',
        'getEnv',
        'getPresence',
        'getState',
        'lastChecks',
        'listComponents',
        'onChecksChanged',
        'onComponentsChanged',
        'onPresenceChanged',
        'onTaskEvent',
        'pickFile',
        'pickFolder',
        'recentProjects',
        'reveal',
        'runAction',
        'runChecks',
        'setEnv',
        'setState',
      ].sort(),
    )
    expect(r.schema).toBe(1)
    expect(r.bad).toMatch(/không hợp lệ/)
    expect(r.hasIpc).toBe(false)
    expect(r.frozen).toBe(true)
  } finally {
    await app.close()
  }
})
