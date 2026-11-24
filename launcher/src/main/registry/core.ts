/** Core components the launcher always knows about; each one detects itself through Deps. */
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Deps } from '../deps'
import { type EnvDoc, readVar } from '../env-store'
import { type Latest, latestGitTag } from '../versions'

export interface Detected {
  installed: boolean
  version?: string
  path?: string
  note?: string
}

export interface Ctx {
  squarelDir?: string
  launcherVersion: string
  isDev: boolean
  env: EnvDoc
  /** A launcher update electron-updater finished downloading (installable now). */
  launcherUpdateReady?: string
  /** Newer launcher version found by the last update check (electron-updater downloads it). */
  launcherLatest?: string
}

export interface InstallSpec {
  /** winget package id; installed in a visible terminal where the user answers winget's prompts. */
  winget?: string
  /** `--override` for the package's own installer (fixed text, never user input). */
  override?: string
  terminal?: { command: string; url: string }
  sizeHint?: string
}

export type CoreId =
  | 'launcher'
  | 'squarel'
  | 'claude-code'
  | 'node'
  | 'pnpm'
  | 'git'
  | 'vs-build-tools'
  | 'local-sd'

export interface CoreComponent {
  id: CoreId
  name: string
  description: string
  icon: string
  required: boolean
  detect(d: Deps, ctx: Ctx): Promise<Detected>
  latest?(d: Deps, ctx: Ctx): Promise<Latest>
  install?: InstallSpec
}

export const MIN_NODE = '22.18'

/** Runs argv and returns the output lines, or undefined when it cannot run or exits non-zero. */
async function output(d: Deps, argv: string[], cwd = tmpdir()): Promise<string[] | undefined> {
  const lines: string[] = []
  try {
    const { code } = await d.run({
      argv,
      cwd,
      onLine: (l) => lines.push(l),
      signal: AbortSignal.timeout(15_000),
    })
    return code === 0 ? lines : undefined
  } catch {
    return undefined
  }
}

function versionDetector(argv: string[], pattern: RegExp) {
  return async (d: Deps): Promise<Detected> => {
    const lines = await output(d, argv)
    if (!lines) return { installed: false }
    const m = pattern.exec(lines.join('\n'))
    return m?.[1] ? { installed: true, version: m[1] } : { installed: true, note: 'Không đọc được phiên bản' }
  }
}

async function exists(d: Deps, path: string): Promise<boolean> {
  try {
    await d.fs.stat(path)
    return true
  } catch {
    return false
  }
}

export const CORE: CoreComponent[] = [
  {
    id: 'launcher',
    name: 'Squarel Launcher',
    description: 'Ứng dụng quản lý Squarel Art và các công cụ đi kèm.',
    icon: 'home',
    required: true,
    async detect(_d, ctx) {
      return { installed: true, version: ctx.launcherVersion, note: ctx.isDev ? 'dev' : undefined }
    },
  },
  {
    id: 'squarel',
    name: 'Squarel Art',
    description: 'Bộ công cụ pixel-art và cầu nối MCP cho Claude.',
    icon: 'grid',
    required: true,
    async detect(d, ctx) {
      if (!ctx.squarelDir) return { installed: false }
      let pkg: { name?: unknown; version?: unknown }
      try {
        pkg = JSON.parse(String(await d.fs.readFile(join(ctx.squarelDir, 'package.json'), 'utf8')))
      } catch {
        return { installed: false }
      }
      if (pkg.name !== 'squarel-art') return { installed: false }
      const branch = (
        await output(d, ['git', 'rev-parse', '--abbrev-ref', 'HEAD'], ctx.squarelDir)
      )?.[0]?.trim()
      const dirty = ((await output(d, ['git', 'status', '--porcelain'], ctx.squarelDir)) ?? []).some(
        (l) => l.trim() !== '',
      )
      const note = [branch, dirty ? 'có thay đổi chưa commit' : undefined].filter(Boolean).join(', ')
      return {
        installed: true,
        version: typeof pkg.version === 'string' ? pkg.version : undefined,
        path: ctx.squarelDir,
        note: note || undefined,
      }
    },
    latest: (d) => latestGitTag('https://github.com/t1tc01-personal/squarel-art-2.git', d),
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Trợ lý lập trình của Anthropic, dùng Squarel qua MCP.',
    icon: 'sparkle',
    required: true,
    detect: versionDetector(['claude', '--version'], /(\d+(?:\.\d+)+)/),
    install: {
      terminal: { command: 'irm https://claude.ai/install.ps1 | iex', url: 'https://claude.ai/install.ps1' },
    },
  },
  {
    id: 'node',
    name: 'Node.js',
    description: `Chạy Squarel, cần phiên bản ${MIN_NODE} trở lên.`,
    icon: 'box',
    required: true,
    detect: versionDetector(['node', '--version'], /v?(\d+(?:\.\d+)+)/),
    install: { winget: 'OpenJS.NodeJS.LTS', sizeHint: '~30 MB' },
  },
  {
    id: 'pnpm',
    name: 'pnpm',
    description: 'Trình quản lý gói dùng để cài và build Squarel.',
    icon: 'box',
    required: true,
    detect: versionDetector(['pnpm', '-v'], /(\d+(?:\.\d+)+)/),
    install: { winget: 'pnpm.pnpm', sizeHint: '~30 MB' },
  },
  {
    id: 'git',
    name: 'Git',
    description: 'Tải mã nguồn và kiểm tra bản mới.',
    icon: 'link',
    required: true,
    detect: versionDetector(['git', '--version'], /(\d+(?:\.\d+)+)/),
    install: { winget: 'Git.Git', sizeHint: '~60 MB' },
  },
  {
    id: 'vs-build-tools',
    name: 'Visual Studio Build Tools',
    description: 'Cần để tự build Aseprite từ source.',
    icon: 'gear',
    required: false,
    // No --passive / --quiet: the Visual Studio Installer opens its own window and the user clicks
    // Install there (its license terms are shown in that window).
    install: {
      winget: 'Microsoft.VisualStudio.2022.BuildTools',
      override: [
        '--wait --norestart',
        '--add Microsoft.VisualStudio.Workload.VCTools',
        '--add Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '--add Microsoft.VisualStudio.Component.Windows11SDK.26100',
        '--add Microsoft.VisualStudio.Component.VC.CMake.Project',
      ].join(' '),
      sizeHint: '~7 GB',
    },
    async detect(d) {
      const pf = Object.entries(d.env).find(([k]) => k.toUpperCase() === 'PROGRAMFILES(X86)')?.[1]
      if (!pf) return { installed: false }
      const vswhere = join(pf, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
      if (!(await exists(d, vswhere))) return { installed: false }
      const lines = await output(d, [
        vswhere,
        '-products',
        '*',
        '-requires',
        'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
        '-latest',
        '-property',
        'installationVersion',
      ])
      const v = lines?.map((l) => l.trim()).find((l) => /^\d/.test(l))
      return v ? { installed: true, version: v, path: vswhere } : { installed: false }
    },
  },
  {
    id: 'local-sd',
    name: 'Stable Diffusion cục bộ',
    description: 'Máy chủ ảnh chạy trên máy bạn (chỉ phát hiện).',
    icon: 'chip',
    required: false,
    async detect(d, ctx) {
      const url = readVar(ctx.env, 'LOCAL_SD_URL')?.trim()
      if (!url) return { installed: false }
      try {
        const res = await d.fetch(`${url.replace(/\/+$/, '')}/health`, { signal: AbortSignal.timeout(3000) })
        return res.ok ? { installed: true, path: url } : { installed: false, note: `HTTP ${res.status}` }
      } catch {
        return { installed: false }
      }
    },
  },
]
