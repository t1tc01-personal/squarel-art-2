import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export interface Config {
  dataDir: string
  imageProvider: 'cloudflare' | 'local-sd' | 'mock'
  cloudflare: { accountId?: string; token?: string }
  retroDiffusion: { apiKey?: string; usdPerCredit: number }
  localSdUrl: string
  dailyBudgetUsd: number
  previewPx: number
  bridgePort: number
  asepritePath?: string
}

let envLoaded = false

/** Load `.env` from the repo root once (never from cwd, which Claude Code may set elsewhere). */
export function loadEnv(): void {
  if (envLoaded) return
  envLoaded = true
  const file = join(REPO_ROOT, '.env')
  if (existsSync(file)) process.loadEnvFile(file)
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  loadEnv()
  const e = process.env
  const provider = (e.IMAGE_PROVIDER ?? 'cloudflare') as Config['imageProvider']
  const cfg: Config = {
    dataDir: resolve(e.DATA_DIR || join(homedir(), 'SquarelArt-data')),
    imageProvider: ['cloudflare', 'local-sd', 'mock'].includes(provider) ? provider : 'cloudflare',
    cloudflare: {
      accountId: e.CLOUDFLARE_ACCOUNT_ID || undefined,
      token: e.CLOUDFLARE_API_TOKEN || undefined,
    },
    retroDiffusion: {
      apiKey: e.RETRO_DIFFUSION_API_KEY || undefined,
      usdPerCredit: Number(e.RETRO_DIFFUSION_USD_PER_CREDIT ?? 0.01),
    },
    localSdUrl: e.LOCAL_SD_URL || 'http://127.0.0.1:7861',
    dailyBudgetUsd: Number(e.IMAGE_DAILY_BUDGET_USD ?? 1),
    previewPx: Number(e.PREVIEW_DEFAULT_PX ?? 256),
    bridgePort: Number(e.BRIDGE_PORT ?? 4321),
    asepritePath: e.ASEPRITE_PATH || undefined,
  }
  return { ...cfg, ...overrides }
}

/** Where files dropped for import are looked up. */
export function inboxDir(config: Config): string {
  return join(config.dataDir, 'inbox')
}
