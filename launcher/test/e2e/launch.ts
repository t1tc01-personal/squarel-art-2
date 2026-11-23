import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron } from '@playwright/test'

/**
 * Starts the built launcher against a throwaway profile: APPDATA and LOCALAPPDATA point into a
 * fresh temp dir, and SQUAREL_LAUNCHER_TEST=1 turns off the bridge supervisor, the scheduler and
 * network checks. `close()` quits the app and deletes the temp dir.
 * `fake: 'fixtures/basic'` also runs main on createDeps('fake') from test/fixtures/basic.
 */
export async function launchIsolated(
  opts: { fake?: string } = {},
): Promise<{ app: ElectronApplication; close(): Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), 'squarel-launcher-e2e-'))
  const app = await electron.launch({
    args: ['.'],
    env: {
      ...(process.env as Record<string, string>),
      APPDATA: join(root, 'Roaming'),
      LOCALAPPDATA: join(root, 'Local'),
      SQUAREL_LAUNCHER_TEST: '1',
      SQUAREL_LAUNCHER_FAKE: opts.fake ?? '',
    },
  })
  return {
    app,
    async close() {
      try {
        await app.close()
      } finally {
        rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    },
  }
}
