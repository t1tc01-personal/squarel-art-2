/**
 * Pure helpers for `pnpm aseprite:build` (scripts/aseprite-build.ts). No I/O here so they can be unit-tested.
 * The build follows Aseprite's own INSTALL.md / build.sh: MSVC (x64) + CMake + Ninja + prebuilt Skia.
 */
import { join } from 'node:path'

export const ASEPRITE_GIT = 'https://github.com/aseprite/aseprite.git'
export const VC_TOOLS_COMPONENT = 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64'

/**
 * winget command that installs the minimum MSVC toolchain Aseprite needs (C++ compiler, Win11 SDK, CMake+Ninja).
 * No --passive / --quiet / --accept-*: winget asks about its terms and the Visual Studio Installer opens its
 * own window, where the user reads the licence and clicks Install.
 */
export const VS_BUILD_TOOLS_WINGET = [
  'install',
  '--id',
  'Microsoft.VisualStudio.2022.BuildTools',
  '-e',
  '--source',
  'winget',
  '--override',
  [
    '--wait --norestart',
    '--add Microsoft.VisualStudio.Workload.VCTools',
    `--add ${VC_TOOLS_COMPONENT}`,
    '--add Microsoft.VisualStudio.Component.Windows11SDK.26100',
    '--add Microsoft.VisualStudio.Component.VC.CMake.Project',
  ].join(' '),
]

/** VS Installer `modify` that adds CMake + Ninja to an existing install; its window asks the user (no --passive). */
export function vsModifyArgs(installPath: string): string[] {
  return [
    'modify',
    '--installPath',
    installPath,
    '--add',
    'Microsoft.VisualStudio.Component.VC.CMake.Project',
    '--norestart',
  ]
}

function versionKey(tag: string): number[] {
  return tag
    .slice(1)
    .split('.')
    .map((n) => Number(n))
}

/** Newest stable release tag (vX.Y.Z[.W], no -beta/-rc) from `git ls-remote --tags --refs` output. */
export function pickLatestStableTag(lsRemote: string): string | undefined {
  const tags = lsRemote
    .split(/\r?\n/)
    .map((l) => l.split('\t')[1]?.replace('refs/tags/', '').trim())
    .filter((t): t is string => !!t && /^v\d+(\.\d+)+$/.test(t))
  tags.sort((a, b) => {
    const x = versionKey(a)
    const y = versionKey(b)
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] ?? 0) - (y[i] ?? 0)
      if (d) return d
    }
    return 0
  })
  return tags.at(-1)
}

/** Where to download the prebuilt Skia that matches laf/misc/skia-tag.txt (same naming as Aseprite's build.sh). */
export function skiaAsset(tag: string, depsDir: string, build: 'Release' | 'Debug' = 'Release', cpu = 'x64') {
  const clean = tag.trim()
  const file = `Skia-Windows-${build}-${cpu}.zip`
  const dir = join(depsDir, `skia-${clean.split('-')[0]}`)
  const libDir = join(dir, 'out', `${build}-${cpu}`)
  return {
    tag: clean,
    url: `https://github.com/aseprite/skia/releases/download/${clean}/${file}`,
    file,
    dir,
    libDir,
    lib: join(libDir, 'skia.lib'),
  }
}

/** Parse the output of cmd's `set` into an environment object (used to capture the VS developer environment). */
export function parseSetOutput(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i <= 0) continue // skip blanks and cmd's hidden "=C:=C:\..." entries
    env[line.slice(0, i)] = line.slice(i + 1)
  }
  return env
}

/** cmd.exe command line that loads VsDevCmd.bat for x64 and prints the resulting environment. */
export function vsDevEnvCommand(vsInstallPath: string): string {
  const bat = join(vsInstallPath, 'Common7', 'Tools', 'VsDevCmd.bat')
  return `""${bat}" -arch=x64 -host_arch=x64 -no_logo && set"`
}

/** Set KEY=value in a .env file's text: replaces an existing (uncommented) line or appends one. Keeps line endings. */
export function upsertEnv(content: string, key: string, value: string): string {
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const line = `${key}=${value}`
  const re = new RegExp(`^${key}=.*$`, 'm')
  if (re.test(content)) return content.replace(re, () => line)
  const sep = content === '' || content.endsWith('\n') ? '' : eol
  return `${content}${sep}${line}${eol}`
}

export function cmakeConfigureArgs(o: {
  src: string
  build: string
  skia: ReturnType<typeof skiaAsset>
  buildType?: string
}): string[] {
  return [
    '-S',
    o.src,
    '-B',
    o.build,
    '-G',
    'Ninja',
    `-DCMAKE_BUILD_TYPE=${o.buildType ?? 'RelWithDebInfo'}`,
    '-DLAF_BACKEND=skia',
    `-DSKIA_DIR=${o.skia.dir}`,
    `-DSKIA_LIBRARY_DIR=${o.skia.libDir}`,
    `-DSKIA_LIBRARY=${o.skia.lib}`,
  ]
}

export interface BuildArgs {
  src?: string
  ref?: string
  check: boolean
  installDeps: boolean
  clean: boolean
  writeEnv: boolean
  jsonProgress: boolean
  help: boolean
}

export function parseBuildArgs(argv: string[]): BuildArgs {
  const out: BuildArgs = {
    check: false,
    installDeps: false,
    clean: false,
    writeEnv: true,
    jsonProgress: false,
    help: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--') continue // pnpm forwards the separator
    if (a === '--src' || a === '--ref') {
      const v = argv[++i]
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a value`)
      if (a === '--src') out.src = v
      else out.ref = v
    } else if (a === '--check') out.check = true
    else if (a === '--install-deps') out.installDeps = true
    else if (a === '--clean') out.clean = true
    else if (a === '--no-env') out.writeEnv = false
    else if (a === '--json-progress') out.jsonProgress = true
    else if (a === '--help' || a === '-h') out.help = true
    else throw new Error(`unknown option "${a}" (see --help)`)
  }
  return out
}

/** One machine-readable progress record, printed as `@@progress {json}` on stdout for the launcher. */
export interface BuildProgress {
  step: number
  total: 6
  label: string
  percent?: number
  message?: string
}

/** Recognise ninja's `[1000/1575] Building CXX ...` counter. */
export function parseNinjaProgress(line: string): { done: number; total: number } | undefined {
  const m = /^\[(\d+)\/(\d+)\]/.exec(line)
  if (!m) return undefined
  const done = Number(m[1])
  const total = Number(m[2])
  return total > 0 ? { done, total } : undefined
}

/** Feed build output lines; returns a percent (0-100) for ninja lines, never lower than before. Noise gives undefined. */
export function progressTracker(): (line: string) => number | undefined {
  let best = 0
  return (line) => {
    const p = parseNinjaProgress(line)
    if (!p) return undefined
    best = Math.max(best, Math.min(100, Math.floor((p.done / p.total) * 100)))
    return best
  }
}
