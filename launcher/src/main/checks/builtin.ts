/** The individual health checks. Each returns a CheckResult; runner.ts isolates failures. */
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'
import { substitute } from '@squarel/integration-schema'
import type { ActionRef, CheckResult } from '../../shared/model'
import type { BridgeState } from '../bridge/types'
import type { Deps } from '../deps'
import { type EnvDoc, getVar } from '../env-store'
import { isInsideDir, type LoadedIntegration } from '../registry/integrations'
import { detectIntegration, expandEnv } from '../registry/registry'
import { compareVersions } from '../versions'

export interface CheckCtx {
  squarelDir?: string
  dataDir: string
  env: EnvDoc
  bridge: BridgeState
  /** Ids of the integrations the user selected; only those get checks. */
  selected: string[]
  /** Test seam: replaces the real MCP stdio smoke test. */
  smoke?: (squarelDir: string, d: Deps) => Promise<{ ok: boolean; tools: number; ms: number; error?: string }>
}

export type Draft = Omit<CheckResult, 'id' | 'group' | 'label' | 'description'> &
  Partial<Pick<CheckResult, 'label' | 'description'>>

export const OPEN_SETTINGS: ActionRef = {
  componentId: 'settings',
  kind: 'fix',
  id: 'open-settings',
  label: 'Mở Cấu hình',
}

const MIN_FREE_BYTES = 2 * 1024 ** 3

async function lines(d: Deps, argv: string[], cwd: string, timeoutMs = 30_000) {
  const out: string[] = []
  try {
    const { code } = await d.run({
      argv,
      cwd,
      onLine: (l) => out.push(l),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return { code, out }
  } catch (e) {
    return { code: -2, out, error: String((e as Error)?.message ?? e) }
  }
}

export async function claudeInstalled(d: Deps): Promise<Draft> {
  const r = await lines(d, ['claude', '--version'], tmpdir(), 15_000)
  const v = /(\d+(?:\.\d+)+)/.exec(r.out.join('\n'))?.[1]
  if (r.code === 0) return { result: 'pass', detail: v ?? 'đã cài' }
  return {
    result: 'fail',
    detail: 'chưa cài',
    fix: {
      componentId: 'claude-code',
      kind: 'terminal',
      id: 'terminal',
      label: 'Mở PowerShell để cài',
      needsConsent: { command: 'irm https://claude.ai/install.ps1 | iex' },
    },
  }
}

export async function claudeSeesSquarel(d: Deps, ctx: CheckCtx): Promise<Draft> {
  const r = await lines(d, ['claude', 'mcp', 'list'], ctx.squarelDir ?? tmpdir())
  if (r.code !== 0) return { result: 'fail', detail: r.error ?? `claude mcp list thoát với mã ${r.code}` }
  if (/^squarel:.*(✓|Connected)/m.test(r.out.join('\n'))) return { result: 'pass', detail: 'squarel ✓' }
  return {
    result: 'fail',
    detail: 'không thấy server squarel',
    fix: { componentId: 'squarel', kind: 'fix', id: 'register-mcp', label: 'Đăng ký lại' },
  }
}

export async function mcpStarts(
  d: Deps,
  ctx: CheckCtx,
  smoke: NonNullable<CheckCtx['smoke']>,
): Promise<Draft> {
  if (!ctx.squarelDir) return { result: 'fail', detail: 'chưa chọn thư mục Squarel' }
  const r = await smoke(ctx.squarelDir, d)
  return r.ok
    ? { result: 'pass', detail: `${r.tools} tool · ${r.ms} ms` }
    : { result: 'fail', detail: r.error ?? 'không khởi động được' }
}

export function bridgeListening(b: BridgeState): Draft {
  const addr = `127.0.0.1:${b.port}`
  switch (b.mode) {
    case 'own':
      return { result: 'pass', detail: addr }
    case 'attached':
      return { result: 'pass', detail: `${addr} (tiến trình khác giữ)` }
    case 'foreign':
      return { result: 'fail', detail: b.message ?? `cổng ${b.port} bị chương trình khác chiếm` }
    default:
      return { result: 'fail', detail: b.message ?? 'bridge chưa chạy' }
  }
}

export async function cloudflareToken(d: Deps, env: EnvDoc): Promise<Draft> {
  const token = getVar(env, 'CLOUDFLARE_API_TOKEN')?.trim()
  if (!token) return { result: 'warn', detail: 'chưa có token', fix: OPEN_SETTINGS }
  const account = getVar(env, 'CLOUDFLARE_ACCOUNT_ID')?.trim()
  const base = 'https://api.cloudflare.com/client/v4'
  const urls = [`${base}/user/tokens/verify`]
  if (account) urls.push(`${base}/accounts/${encodeURIComponent(account)}/tokens/verify`)
  const t0 = performance.now()
  let last = 'không xác minh được'
  for (const url of urls) {
    let res: Response
    try {
      res = await d.fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10_000),
      })
    } catch {
      return { result: 'warn', detail: 'không kết nối được tới Cloudflare' }
    }
    if (res.status === 401 || res.status === 404) {
      last = `Cloudflare trả ${res.status}`
      continue
    }
    let status: unknown
    try {
      status = ((await res.json()) as { result?: { status?: unknown } })?.result?.status
    } catch {}
    if (res.ok && status === 'active')
      return { result: 'pass', detail: `verify · ${Math.round(performance.now() - t0)} ms` }
    return {
      result: 'fail',
      detail: typeof status === 'string' ? `token ${status}` : `Cloudflare trả ${res.status}`,
      fix: OPEN_SETTINGS,
    }
  }
  return { result: 'fail', detail: last, fix: OPEN_SETTINGS }
}

export function retroDiffusionKey(env: EnvDoc): Draft {
  return getVar(env, 'RETRO_DIFFUSION_API_KEY')?.trim()
    ? { result: 'pass', detail: 'đã có key' }
    : { result: 'warn', detail: 'chưa có key (tuỳ chọn)', fix: { ...OPEN_SETTINGS, label: 'Thêm key' } }
}

export async function dataDirWritable(d: Deps, dataDir: string): Promise<Draft> {
  const probe = join(dataDir, '.squarel-write-test')
  try {
    await d.fs.mkdir(dataDir, { recursive: true })
    await d.fs.writeFile(probe, 'ok')
    await d.fs.rm(probe, { force: true })
    return { result: 'pass', detail: dataDir }
  } catch (e) {
    return {
      result: 'fail',
      detail: `không ghi được: ${String((e as Error)?.message ?? e)}`,
      fix: OPEN_SETTINGS,
    }
  }
}

export async function diskSpace(d: Deps, dataDir: string): Promise<Draft> {
  const { freeBytes } = await d.statfs(dataDir)
  const gb = freeBytes / 1024 ** 3
  const detail = `${gb >= 10 ? Math.round(gb) : gb.toFixed(1)} GB trống`
  return freeBytes < MIN_FREE_BYTES ? { result: 'warn', detail } : { result: 'pass', detail }
}

// ---- integrations -------------------------------------------------------------------------

async function readVersion(d: Deps, file: string): Promise<string | undefined> {
  try {
    const v = (JSON.parse(String(await d.fs.readFile(file, 'utf8'))) as { version?: unknown }).version
    return typeof v === 'string' ? v : undefined
  } catch {
    return undefined
  }
}

function isUnc(p: string): boolean {
  return /^[\\/]{2}/.test(p)
}

async function extensionVersion(i: LoadedIntegration, ctx: CheckCtx, d: Deps): Promise<Draft> {
  const ext = i.manifest.extension
  if (!ext) return { result: 'fail', detail: 'tích hợp không khai báo extension' }
  const base = i.source === 'squarel' ? ctx.squarelDir : i.dir
  if (!base) return { result: 'fail', detail: 'chưa chọn thư mục Squarel' }
  const src = ext.version.source
  if (win32.isAbsolute(src) || !isInsideDir(base, src))
    return { result: 'fail', detail: 'đường dẫn extension nằm ngoài thư mục tích hợp' }
  const installedPath = expandEnv(ext.version.installed, d.env)
  if (!installedPath || isUnc(installedPath) || !win32.isAbsolute(installedPath))
    return { result: 'fail', detail: 'không xác định được thư mục extension đã cài' }
  const bundled = await readVersion(d, join(base, src))
  if (!bundled) return { result: 'fail', detail: 'không đọc được phiên bản extension trong Squarel' }
  const installed = await readVersion(d, installedPath)
  const fix: ActionRef = {
    componentId: i.manifest.id,
    kind: 'extension',
    id: 'install',
    label: 'Cài extension',
    needsConsent: { command: ext.install.run.join(' ') },
  }
  if (!installed) return { result: 'warn', detail: 'chưa cài extension', fix }
  return compareVersions(installed, bundled) === 0
    ? { result: 'pass', detail: `${installed} = ${bundled}` }
    : { result: 'warn', detail: `${installed} ≠ ${bundled}`, fix }
}

export async function integrationCheck(
  i: LoadedIntegration,
  check: LoadedIntegration['manifest']['checks'][number],
  ctx: CheckCtx,
  d: Deps,
): Promise<Draft> {
  const m = i.manifest
  if (check.builtin === 'detect') {
    const det = await detectIntegration(i, ctx.env, d)
    return det.installed
      ? { result: 'pass', detail: det.version ?? 'đã cài' }
      : { result: 'fail', detail: det.note ?? 'chưa cài' }
  }
  if (check.builtin === 'bridge-client') {
    const c = ctx.bridge.clients.find((x) => x.name === m.bridge?.client)
    return c
      ? { result: 'pass', detail: c.app ?? c.name }
      : { result: 'warn', detail: `${m.name} chưa kết nối bridge` }
  }
  if (check.builtin === 'extension-version') return extensionVersion(i, ctx, d)
  if (check.run) {
    const cwd = i.source === 'squarel' ? ctx.squarelDir : i.dir
    if (!cwd) return { result: 'fail', detail: 'chưa chọn thư mục Squarel' }
    let argv: string[]
    try {
      argv = check.run.map((a) =>
        substitute(a, { toolsDir: join(d.env.LOCALAPPDATA ?? tmpdir(), 'SquarelArt', 'tools', m.id) }),
      )
    } catch (e) {
      return { result: 'fail', detail: String((e as Error)?.message ?? e) }
    }
    const r = await lines(d, argv, cwd, 120_000)
    return r.code === 0
      ? { result: 'pass', detail: 'thoát với mã 0' }
      : { result: 'fail', detail: r.error ?? `thoát với mã ${r.code}` }
  }
  return { result: 'fail', detail: 'kiểm tra không hợp lệ' }
}

export const BUILTIN_DESC: Record<string, string> = {
  detect: 'Tìm thấy file chạy và đọc được phiên bản.',
  'bridge-client': 'Công cụ đã nối vào bridge của Squarel.',
  'extension-version': 'So bản cài trong công cụ với bản trong Squarel.',
}
