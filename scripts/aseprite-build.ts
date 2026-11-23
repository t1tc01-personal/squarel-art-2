/**
 * Build Aseprite from source (Windows, personal use) and point ASEPRITE_PATH in .env at the result.
 *
 *   pnpm aseprite:build                     clone/update vendor/aseprite at the latest stable tag, build, update .env
 *   pnpm aseprite:build -- --check          only report what is installed / missing
 *   pnpm aseprite:build -- --install-deps   first install VS 2022 Build Tools (C++, Windows SDK, CMake, Ninja) via winget
 *   options: --ref v1.3.18.6|main   --src D:\aseprite   --clean (rebuild from scratch)   --no-env (leave .env alone)
 *
 * Mirrors Aseprite's INSTALL.md / build.sh: MSVC x64 + CMake + Ninja + the prebuilt Skia named in laf/misc/skia-tag.txt.
 * Aseprite's EULA allows compiling for personal use only — vendor/ is git-ignored; never commit or share the build.
 */
import { spawn, spawnSync } from 'node:child_process'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statfsSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { REPO_ROOT } from '../src/config.ts'
import {
  ASEPRITE_GIT,
  BUILD_STEPS,
  type BuildProgress,
  cmakeConfigureArgs,
  counterTracker,
  overallPercent,
  parseBuildArgs,
  parseSetOutput,
  pickLatestStableTag,
  skiaAsset,
  upsertEnv,
  VC_TOOLS_COMPONENT,
  VS_BUILD_TOOLS_WINGET,
  vsDevEnvCommand,
  vsModifyArgs,
} from './lib/aseprite-build.ts'

const VS_INSTALLER_DIR = join(
  process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
  'Microsoft Visual Studio',
  'Installer',
)
const VSWHERE = join(VS_INSTALLER_DIR, 'vswhere.exe')
const WIN_TAR = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') // bsdtar: can unzip
const MIN_FREE_GB = 10

const HELP = `Usage: pnpm aseprite:build [-- options]

  (no options)     clone or update vendor/aseprite at the newest stable tag, build it, set ASEPRITE_PATH in .env
  --check          only show which build tools are installed
  --install-deps   install Visual Studio 2022 Build Tools (C++ compiler, Windows SDK, CMake, Ninja) with winget
  --ref <tag|main> build a specific tag (e.g. v1.3.18.6) or a branch
  --src <dir>      keep the Aseprite source somewhere else (default: vendor/aseprite)
  --clean          delete the build folder and rebuild from scratch
  --no-env         do not touch .env
  --json-progress  also print '@@progress {json}' lines on stdout (used by the launcher)

Aseprite's EULA allows compiling it for your own use only: do not share the source checkout or the build.`

let jsonProgress = false
function emitProgress(p: Omit<BuildProgress, 'total' | 'overall' | 'plan'>) {
  if (!jsonProgress) return
  const record: BuildProgress = {
    step: p.step,
    total: 6,
    label: p.label,
    percent: p.percent,
    overall: overallPercent(p.step, p.percent),
    detail: p.detail,
    plan: BUILD_STEPS,
    message: p.message,
  }
  console.log(`@@progress ${JSON.stringify(record)}`)
}
const step = (title: string) => {
  console.log(`\n== ${title}`)
  const m = /^(\d+)\/6 (.*)$/.exec(title)
  if (m) emitProgress({ step: Number(m[1]), label: m[2].replace(/ \(.*$/, '') })
}
function fail(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

function run(cmd: string, args: string[], opts: { cwd?: string; env?: Record<string, string> } = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  const r = spawnSync(cmd, args, { stdio: 'inherit', cwd: opts.cwd, env: opts.env })
  if (r.error) fail(`${cmd}: ${r.error.message}`)
  if (r.status !== 0) fail(`${cmd} exited with code ${r.status}`)
}

/** Like run(), but forwards stdout line by line and prints @@progress lines for ninja's [n/total] counters. */
function runWithProgress(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string> },
  stepNo: number,
  label: string,
) {
  console.log(`$ ${cmd} ${args.join(' ')}`)
  return new Promise<void>((done) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], env: opts.env })
    const track = counterTracker()
    let last: string | undefined
    let buf = ''
    const onLine = (line: string) => {
      console.log(line)
      const p = track(line)
      // One record per compiled file would flood the launcher: report when the counter
      // moves by a percent or every 10 files.
      const key = p && `${p.percent}:${Math.floor(Number(p.detail.split('/')[0]) / 10)}`
      if (p && key !== last) {
        last = key
        emitProgress({ step: stepNo, label, percent: p.percent, detail: p.detail })
      }
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      buf += chunk
      const lines = buf.split(/\r?\n/)
      buf = lines.pop() ?? ''
      lines.forEach(onLine)
    })
    child.on('error', (e) => fail(`${cmd}: ${e.message}`))
    child.on('close', (code) => {
      if (buf) onLine(buf)
      if (code !== 0) fail(`${cmd} exited with code ${code}`)
      done()
    })
  })
}

function capture(
  cmd: string,
  args: string[],
  opts: { env?: Record<string, string>; verbatim?: boolean } = {},
): string | undefined {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    env: opts.env,
    windowsVerbatimArguments: opts.verbatim,
    maxBuffer: 64 * 1024 * 1024,
  })
  return r.status === 0 ? r.stdout : undefined
}

interface VsInstall {
  path: string
  version: string
  name: string
}

function findVs(): VsInstall | undefined {
  if (!existsSync(VSWHERE)) return undefined
  const out = capture(VSWHERE, [
    '-latest',
    '-products',
    '*',
    '-requires',
    VC_TOOLS_COMPONENT,
    '-format',
    'json',
    '-utf8',
  ])
  const vs = JSON.parse(out || '[]')[0]
  return vs ? { path: vs.installationPath, version: vs.installationVersion, name: vs.displayName } : undefined
}

function vsDevEnv(vs: VsInstall): Record<string, string> {
  const out = capture('cmd.exe', ['/d', '/s', '/c', vsDevEnvCommand(vs.path)], { verbatim: true })
  if (!out) fail(`could not load the Visual Studio developer environment from ${vs.path}`)
  return parseSetOutput(out)
}

const firstLine = (s: string | undefined) => s?.split(/\r?\n/)[0].trim() || undefined

function freeGb(path: string): number | undefined {
  let p = resolve(path)
  while (!existsSync(p) && dirname(p) !== p) p = dirname(p)
  try {
    const s = statfsSync(p)
    return (s.bavail * s.bsize) / 1024 ** 3
  } catch {
    return undefined
  }
}

async function download(url: string, file: string) {
  console.log(`↓ ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) fail(`download failed: HTTP ${res.status} ${url}`)
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(file))
}

async function main() {
  let args: ReturnType<typeof parseBuildArgs>
  try {
    args = parseBuildArgs(process.argv.slice(2))
  } catch (e) {
    fail((e as Error).message)
  }
  jsonProgress = args.jsonProgress
  if (args.help) {
    console.log(HELP)
    return
  }
  if (process.platform !== 'win32') {
    fail('this script builds on Windows only. On macOS/Linux follow INSTALL.md in the Aseprite repo.')
  }
  const src = resolve(args.src ?? join(REPO_ROOT, 'vendor', 'aseprite'))
  const depsDir = join(REPO_ROOT, 'vendor', 'deps')
  const buildDir = join(src, 'build')

  // ---------------------------------------------------------------- toolchain
  step('1/6 Build tools')
  let vs = findVs()
  if (!vs && args.installDeps) {
    console.log(
      'Installing Visual Studio 2022 Build Tools (~7 GB). Answer the winget and Windows (admin) prompts, then click Install in the Visual Studio Installer window…',
    )
    run('winget', VS_BUILD_TOOLS_WINGET)
    vs = findVs()
  }
  let env = vs ? vsDevEnv(vs) : undefined
  let cmake = env && firstLine(capture('cmake', ['--version'], { env }))
  let ninja = env && firstLine(capture('ninja', ['--version'], { env }))
  if (vs && (!cmake || !ninja) && args.installDeps) {
    console.log('Adding the "C++ CMake tools" component (CMake + Ninja) to Visual Studio…')
    console.log('The Visual Studio Installer opens its own window: click Modify there.')
    run(join(VS_INSTALLER_DIR, 'setup.exe'), vsModifyArgs(vs.path))
    env = vsDevEnv(vs)
    cmake = firstLine(capture('cmake', ['--version'], { env }))
    ninja = firstLine(capture('ninja', ['--version'], { env }))
  }
  const cl = env && firstLine(capture('where', ['cl.exe'], { env }))
  const git = firstLine(capture('git', ['--version']))
  const free = freeGb(src)
  const rows: [string, string | undefined][] = [
    ['Visual Studio (C++)', vs && `${vs.name} ${vs.version}`],
    ['MSVC compiler', cl],
    ['CMake', cmake],
    ['Ninja', ninja],
    ['Git', git],
  ]
  for (const [k, v] of rows) console.log(`  ${v ? '✓' : '✗'} ${k.padEnd(20)} ${v ?? 'MISSING'}`)
  if (free !== undefined) {
    console.log(
      `  ${free >= MIN_FREE_GB ? '✓' : '!'} ${'Free disk'.padEnd(20)} ${free.toFixed(1)} GB at ${src}`,
    )
  }
  const missing = rows.filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) {
    const hint = !git
      ? 'Install Git: winget install Git.Git'
      : 'Run again with --install-deps (opens winget and the Visual Studio Installer for VS 2022 Build Tools with the C++ workload, Windows 11 SDK, CMake and Ninja; you accept the terms and click Install there),\n  or install them yourself: see docs/setup.md, section 6.'
    fail(`missing: ${missing.join(', ')}.\n  ${hint}`)
  }
  if (args.check) {
    console.log('\nAll build tools found.')
    return
  }
  if (free !== undefined && free < MIN_FREE_GB) {
    console.warn(`! Only ${free.toFixed(1)} GB free; a build needs about ${MIN_FREE_GB} GB.`)
  }
  const buildEnv = env!

  // ---------------------------------------------------------------- source
  step('2/6 Aseprite source')
  let ref = args.ref
  if (!ref) {
    ref = pickLatestStableTag(capture('git', ['ls-remote', '--tags', '--refs', ASEPRITE_GIT]) ?? '')
    if (!ref) fail('could not list Aseprite release tags (no network?). Pass --ref v1.3.x explicitly.')
  }
  console.log(`ref: ${ref}  →  ${src}`)
  if (!existsSync(join(src, '.git'))) {
    mkdirSync(dirname(src), { recursive: true })
    run('git', ['-c', 'core.longpaths=true', 'clone', '--recursive', '--branch', ref, ASEPRITE_GIT, src])
  } else {
    run('git', ['-C', src, 'fetch', '--tags', 'origin'])
    run('git', ['-C', src, 'checkout', ref])
    if (!/^v\d/.test(ref)) run('git', ['-C', src, 'pull', '--ff-only'])
    run('git', ['-C', src, 'submodule', 'update', '--init', '--recursive'])
  }

  // ---------------------------------------------------------------- skia
  step('3/6 Skia (prebuilt)')
  const tagFile = join(src, 'laf', 'misc', 'skia-tag.txt')
  if (!existsSync(tagFile)) fail(`${tagFile} not found: is ${src} an Aseprite 1.3+ checkout?`)
  const skia = skiaAsset(readFileSync(tagFile, 'utf8'), depsDir)
  const marker = join(skia.dir, '.skia-tag')
  const have = existsSync(marker) ? readFileSync(marker, 'utf8').trim() : ''
  if (existsSync(skia.lib) && have === skia.tag) {
    console.log(`up to date: ${skia.tag} in ${skia.dir}`)
  } else {
    rmSync(skia.dir, { recursive: true, force: true })
    mkdirSync(skia.dir, { recursive: true })
    const zip = join(skia.dir, skia.file)
    await download(skia.url, zip)
    run(WIN_TAR, ['-xf', zip, '-C', skia.dir])
    rmSync(zip, { force: true })
    if (!existsSync(skia.lib)) fail(`${skia.lib} missing after unpacking ${skia.file}`)
    writeFileSync(marker, skia.tag)
  }

  // ---------------------------------------------------------------- configure + build
  step('4/6 Configure (CMake)')
  if (args.clean) rmSync(buildDir, { recursive: true, force: true })
  if (existsSync(join(buildDir, 'build.ninja'))) {
    console.log('already configured (use --clean to start over)')
  } else {
    run('cmake', cmakeConfigureArgs({ src, build: buildDir, skia }), { env: buildEnv })
  }

  step('5/6 Build (first time takes 15–40 minutes)')
  const started = Date.now()
  const buildArgs = ['--build', buildDir, '--target', 'aseprite']
  if (args.jsonProgress) await runWithProgress('cmake', buildArgs, { env: buildEnv }, 5, 'Build')
  else run('cmake', buildArgs, { env: buildEnv })
  console.log(`built in ${Math.round((Date.now() - started) / 60000)} min`)

  // ---------------------------------------------------------------- verify + .env
  step('6/6 Check and configure')
  const exe = join(buildDir, 'bin', 'aseprite.exe')
  if (!existsSync(exe)) fail(`${exe} not found after the build`)
  console.log(`✓ ${firstLine(capture(exe, ['-b', '--version'])) ?? 'aseprite.exe'}  (${exe})`)
  if (args.writeEnv) {
    const envFile = join(REPO_ROOT, '.env')
    const example = join(REPO_ROOT, '.env.example')
    const base = existsSync(envFile)
      ? readFileSync(envFile, 'utf8')
      : existsSync(example)
        ? readFileSync(example, 'utf8')
        : ''
    writeFileSync(envFile, upsertEnv(base, 'ASEPRITE_PATH', exe))
    console.log('✓ ASEPRITE_PATH written to .env')
  }
  console.log(`
Next:
  pnpm aseprite:test     real round-trip through this Aseprite
  pnpm aseprite:pack     then double-click squarel.aseprite-extension (or Edit → Preferences → Extensions)
  Start Aseprite:        ${exe}
Restart Claude Code so the MCP server re-reads .env.`)
}

await main()
