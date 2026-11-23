import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type ElectronApplication, _electron as electron } from '@playwright/test'

export interface LaunchOptions {
  /** `fixtures/<name>`: main runs on createDeps('fake') from test/fixtures/<name>. */
  fake?: string
  /** Reuse this profile folder (the caller deletes it); default: a fresh temp folder. */
  root?: string
  /** launcher state.json written before the start (only when the file is not there yet). */
  state?: Record<string, unknown>
  /** Extra environment (e.g. SQUAREL_LAUNCHER_TEST_BRIDGE_PORT, DATA_DIR). */
  env?: Record<string, string>
}

/** Environment of an isolated launcher run on the profile folder `root`. */
export function isolatedEnv(root: string, opts: LaunchOptions = {}): Record<string, string> {
  return {
    ...(process.env as Record<string, string>),
    APPDATA: join(root, 'Roaming'),
    LOCALAPPDATA: join(root, 'Local'),
    SQUAREL_LAUNCHER_TEST: '1',
    SQUAREL_LAUNCHER_FAKE: opts.fake ?? '',
    ...opts.env,
  }
}

/**
 * Starts the built launcher against a throwaway profile: APPDATA and LOCALAPPDATA point into a
 * fresh temp dir, and SQUAREL_LAUNCHER_TEST=1 turns off the bridge supervisor (unless
 * SQUAREL_LAUNCHER_TEST_BRIDGE_PORT is given), the scheduler and network checks. `close()` quits
 * the app and deletes the temp dir (not a `root` passed in).
 * `fake: 'fixtures/basic'` also runs main on createDeps('fake') from test/fixtures/basic.
 */
export async function launchIsolated(
  opts: LaunchOptions = {},
): Promise<{ app: ElectronApplication; root: string; close(): Promise<void> }> {
  const root = opts.root ?? mkdtempSync(join(tmpdir(), 'squarel-launcher-e2e-'))
  if (opts.state) {
    const dir = join(root, 'Roaming', 'SquarelArt Launcher')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'state.json'), JSON.stringify({ schema: 1, ...opts.state }), { flag: 'wx' })
  }
  const app = await electron.launch({ args: ['.'], env: isolatedEnv(root, opts) })
  return {
    app,
    root,
    async close() {
      try {
        await app.close()
      } finally {
        if (!opts.root) rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
      }
    },
  }
}
