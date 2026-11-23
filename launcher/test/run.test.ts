import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  cmdShimArgs,
  isProcessRunning,
  parseProgressLine,
  quoteForCmd,
  resolveExecutable,
  runCommand,
} from '../src/main/run'
import { system32, systemRoot } from '../src/main/system-root'

const dirs: string[] = []
const tmp = async (name: string) => {
  const d = await mkdtemp(join(tmpdir(), `${name}-`))
  dirs.push(d)
  return d
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

const VI_ARG = 'D:\\Dự án\\a b'

/** Runs argv and collects stdout/stderr lines. */
async function collect(argv: string[], cwd: string, signal?: AbortSignal, env?: Record<string, string>) {
  const out: string[] = []
  const err: string[] = []
  const { code } = await runCommand({
    argv,
    cwd,
    signal,
    env,
    onLine: (line, stream) => (stream === 'stdout' ? out : err).push(line),
  })
  return { code, out, err }
}

/** Creates `<dir>/echo-arg.cmd`, a shim (like pnpm.cmd) that forwards %* to node, which prints argv as JSON. */
async function makeEchoShim(parent: string) {
  const dir = join(parent, 'shim dir (Dự án) & co')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'echo-arg.js'), 'console.log(JSON.stringify(process.argv.slice(2)))\n')
  await writeFile(join(dir, 'echo-arg.cmd'), '@node "%~dp0echo-arg.js" %*\r\n')
  return join(dir, 'echo-arg.cmd')
}

describe('runCommand', () => {
  it('runs node with an argument containing spaces and Vietnamese', async () => {
    const cwd = await tmp('run Dự án')
    const r = await collect(['node', '-e', 'console.log(process.argv[1])', VI_ARG], cwd)
    expect(r).toEqual({ code: 0, out: [VI_ARG], err: [] })
  })

  it('passes hostile arguments to an .exe verbatim (no shell)', async () => {
    const cwd = await tmp('run-exe')
    const hostile = ['a&echo PWNED', '%PATH%', '!x!', 'say "hi"', 'C:\\a b\\', '', '|<>()^']
    const r = await collect(
      ['node', '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', ...hostile],
      cwd,
    )
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out[0] as string)).toEqual(hostile)
    expect(r.out).toHaveLength(1)
  })

  it('runs a .cmd shim with the same argument unchanged', async () => {
    const cwd = await tmp('run-cmd')
    const shim = await makeEchoShim(cwd)
    const r = await collect([shim, VI_ARG], cwd)
    expect(r).toEqual({ code: 0, out: [JSON.stringify([VI_ARG])], err: [] })
  })

  it('a .cmd shim always runs through System32 cmd.exe, never the ComSpec of the env', async () => {
    const cwd = await tmp('run-cmd-comspec')
    const shim = await makeEchoShim(cwd)
    // node.exe as "ComSpec" would treat /d as a script path and fail.
    const r = await collect([shim, VI_ARG], cwd, undefined, { ComSpec: process.execPath })
    expect(r).toEqual({ code: 0, out: [JSON.stringify([VI_ARG])], err: [] })
  })

  it('a .cmd shim receives hostile arguments byte-identical and never runs injected commands', async () => {
    const cwd = await tmp('run-cmd-hostile')
    const shim = await makeEchoShim(cwd)
    const hostile = [
      'a&echo PWNED',
      'a&calc',
      'a b^&c',
      '%PATH%',
      '%cd%',
      '%%',
      '%~dp0',
      '%1',
      '%*',
      '%cd:~,%',
      '!x!',
      '!PATH!',
      '(x)',
      '^',
      '^^',
      '|',
      '<nul >x',
      'a,b;c=d',
      'x\\',
      'C:\\a b\\',
      'C:\\a b\\\\',
      '',
      ' ',
      VI_ARG,
      'plain',
    ]
    const r = await collect([shim, ...hostile], cwd)
    expect(r.err).toEqual([])
    expect(r.out).toHaveLength(1)
    expect(JSON.parse(r.out[0] as string)).toEqual(hostile)
    expect(r.code).toBe(0)
  })

  it('a .cmd shim rejects arguments that cannot be passed safely', async () => {
    const cwd = await tmp('run-cmd-reject')
    const shim = await makeEchoShim(cwd)
    for (const bad of ['a"&echo PWNED', 'line\nbreak', 'cr\rx', 'nul\0x']) {
      await expect(runCommand({ argv: [shim, bad], cwd })).rejects.toThrow()
    }
  })

  it('streams lines to onLine in order and returns the exit code', async () => {
    const cwd = await tmp('run-lines')
    const script = [
      'const w = (s) => new Promise((r) => process.stdout.write(s, r));',
      'const sleep = (ms) => new Promise((r) => setTimeout(r, ms));',
      '(async () => {',
      "  await w('one\\r\\ntw'); await sleep(30);",
      "  await w('o\\n\\nthr'); await sleep(30);",
      "  await w('ee \\u00e1\\u00e0 \\u1ea1'); await sleep(30);",
      "  await w('\\r\\nfour (no newline)');",
      "  process.stderr.write('err 1\\nerr 2');",
      '  process.exitCode = 3;',
      '})()',
    ].join('\n')
    const r = await collect(['node', '-e', script], cwd)
    expect(r.out).toEqual(['one', 'two', '', 'three áà ạ', 'four (no newline)'])
    expect(r.err).toEqual(['err 1', 'err 2'])
    expect(r.code).toBe(3)
  })

  it('decodes UTF-8 split across chunk boundaries', async () => {
    const cwd = await tmp('run-utf8')
    // "ạ" is E1 BA A1 in UTF-8; write it one byte per chunk.
    const script = [
      'const b = Buffer.from("x\\u1ea1y\\n", "utf8");',
      '(async () => { for (const byte of b) { await new Promise((r) => process.stdout.write(Buffer.from([byte]), r)); await new Promise((r) => setTimeout(r, 10)); } })()',
    ].join('\n')
    const r = await collect(['node', '-e', script], cwd)
    expect(r.out).toEqual(['xạy'])
  })

  it('abort signal kills the child', async () => {
    const cwd = await tmp('run-abort')
    const ac = new AbortController()
    const started = Date.now()
    const p = collect(['node', '-e', "console.log('ready'); setInterval(() => {}, 1000)"], cwd, ac.signal)
    setTimeout(() => ac.abort(), 500)
    const r = await p
    expect(r.code).toBe(-1)
    expect(r.out).toEqual(['ready'])
    expect(Date.now() - started).toBeLessThan(10_000)
  })

  it('abort kills the whole process tree behind a .cmd shim', async () => {
    const cwd = await tmp('run-abort-tree')
    const pidFile = join(cwd, 'grandchild.pid')
    await writeFile(
      join(cwd, 'hang.js'),
      `require('node:fs').writeFileSync(process.argv[2], String(process.pid)); console.log('ready'); setInterval(() => {}, 1000)\n`,
    )
    await writeFile(join(cwd, 'hang.cmd'), '@node "%~dp0hang.js" %*\r\n')
    const ac = new AbortController()
    const r = await runCommand({
      argv: [join(cwd, 'hang.cmd'), pidFile],
      cwd,
      signal: ac.signal,
      onLine: (line) => {
        if (line === 'ready') ac.abort()
      },
    })
    expect(r.code).toBe(-1)
    const pid = Number(await readFile(pidFile, 'utf8'))
    expect(pid).toBeGreaterThan(0)
    const alive = () => {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }
    const deadline = Date.now() + 5000
    while (alive() && Date.now() < deadline) await new Promise((res) => setTimeout(res, 100))
    expect(alive()).toBe(false)
  })

  it('an already-aborted signal does not start the process', async () => {
    const cwd = await tmp('run-preabort')
    const marker = join(cwd, 'ran.txt')
    const r = await runCommand({
      argv: ['node', '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x')`],
      cwd,
      signal: AbortSignal.abort(),
    })
    expect(r.code).toBe(-1)
    await expect(readFile(marker)).rejects.toThrow()
  })

  it('rejects with a clear message when the program does not exist', async () => {
    const cwd = await tmp('run-enoent')
    await expect(runCommand({ argv: ['squarel-no-such-tool-xyz', '--version'], cwd })).rejects.toThrow(
      /squarel-no-such-tool-xyz/,
    )
    await expect(runCommand({ argv: [join(cwd, 'missing.exe')], cwd })).rejects.toThrow(/missing\.exe/)
    await expect(runCommand({ argv: [], cwd })).rejects.toThrow()
    await expect(runCommand({ argv: ['node', '-v'], cwd: join(cwd, 'no-such-dir') })).rejects.toThrow(
      /no-such-dir/,
    )
  })

  it('env overrides are merged case-insensitively with the parent environment', async () => {
    const cwd = await tmp('run-env')
    const nodeDir = dirname(process.execPath)
    const script = [
      'const keys = Object.keys(process.env).filter((k) => k.toUpperCase() === "PATH");',
      'console.log(JSON.stringify([keys.length, process.env.PATH, process.env.SQUAREL_RUN_TEST]))',
    ].join('\n')
    const r = await collect(['node', '-e', script], cwd, undefined, {
      pAtH: nodeDir,
      SQUAREL_RUN_TEST: 'Dự án',
    })
    expect(r.code).toBe(0)
    expect(JSON.parse(r.out[0] as string)).toEqual([1, nodeDir, 'Dự án'])
  })
})

describe('cmdShimArgs', () => {
  it('pins cmd.exe flags: no AutoRun, extensions on, outer quotes only, no delayed expansion', () => {
    expect(cmdShimArgs('C:\\x y\\pnpm.cmd', ['install', '%PATH%'])).toEqual([
      '/d',
      '/e:on',
      '/s',
      '/v:off',
      '/c',
      '""C:\\x y\\pnpm.cmd" install "%%cd:~,%PATH%%cd:~,%""',
    ])
  })

  it('/e:on keeps % neutralisation working even when extensions are disabled by default', async () => {
    // EnableExtensions=0 in the registry behaves like /e:off; simulate it on the command line
    // instead of touching the user's registry.
    const cwd = await tmp('run-ext')
    const shim = await makeEchoShim(cwd)
    const hostile = ['%PATH%', '%cd%', 'a&echo PWNED']
    const comspec = process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe'
    const run = (args: string[]) =>
      spawnSync(comspec, args, { cwd, windowsVerbatimArguments: true, encoding: 'utf8', windowsHide: true })
    const good = cmdShimArgs(shim, hostile)
    expect(JSON.parse(run(good).stdout)).toEqual(hostile)
    const extOff = good.map((a) => (a === '/e:on' ? '/e:off' : a))
    expect(run(extOff).stdout.trim()).not.toBe(JSON.stringify(hostile))
  })
})

describe('quoteForCmd', () => {
  it('quoteForCmd escapes metacharacters and rejects quotes/newlines', () => {
    expect(quoteForCmd('plain-arg_1.0')).toBe('plain-arg_1.0')
    expect(quoteForCmd('C:\\tools\\x.exe')).toBe('C:\\tools\\x.exe')
    // Anything else is quoted so cmd metacharacters stay literal through both the
    // cmd /c parse and the shim's own re-parse of %*.
    expect(quoteForCmd('a b')).toBe('"a b"')
    expect(quoteForCmd('a&calc')).toBe('"a&calc"')
    expect(quoteForCmd('a|b<c>d(e)^f!g')).toBe('"a|b<c>d(e)^f!g"')
    expect(quoteForCmd('')).toBe('""')
    // % expands even inside quotes: each % becomes %%cd:~,% (an empty substring after it).
    expect(quoteForCmd('%PATH%')).toBe('"%%cd:~,%PATH%%cd:~,%"')
    // Trailing backslashes are doubled so they do not escape the closing quote.
    expect(quoteForCmd('C:\\a b\\')).toBe('"C:\\a b\\\\"')
    for (const bad of ['"', 'a"b', 'a\nb', 'a\rb', 'a\0b']) expect(() => quoteForCmd(bad)).toThrow()
  })
})

describe('resolveExecutable', () => {
  it('searches PATH (any key case) with PATHEXT and reports the kind', async () => {
    const root = await tmp('resolve')
    const a = join(root, 'a dir')
    const b = join(root, 'b')
    await mkdir(a)
    await mkdir(b)
    await writeFile(join(b, 'tool.exe'), '')
    await writeFile(join(a, 'pnpm.cmd'), '')
    await writeFile(join(a, 'old.bat'), '')
    await writeFile(join(a, 'script.js'), '')
    const env = { Path: `${a};"${b}";;`, PATHEXT: '.COM;.EXE;.BAT;.CMD;.JS' }
    expect(resolveExecutable('tool', env)).toEqual({ path: join(b, 'tool.exe'), kind: 'exe' })
    expect(resolveExecutable('TOOL.EXE', env)?.kind).toBe('exe')
    expect(resolveExecutable('pnpm', env)).toEqual({ path: join(a, 'pnpm.cmd'), kind: 'cmd' })
    expect(resolveExecutable('old', env)).toEqual({ path: join(a, 'old.bat'), kind: 'cmd' })
    expect(resolveExecutable('script', env)).toBeUndefined()
    expect(resolveExecutable('missing', env)).toBeUndefined()
    expect(resolveExecutable('tool', { PATH: b })).toEqual({ path: join(b, 'tool.exe'), kind: 'exe' })
    expect(resolveExecutable('tool', {})).toBeUndefined()
  })

  it('absolute paths pass through; relative paths with separators are not searched', async () => {
    const root = await tmp('resolve-abs')
    await writeFile(join(root, 'x.exe'), '')
    await writeFile(join(root, 'y.cmd'), '')
    expect(resolveExecutable(join(root, 'x.exe'), {})).toEqual({ path: join(root, 'x.exe'), kind: 'exe' })
    expect(resolveExecutable(join(root, 'y.cmd'), {})).toEqual({ path: join(root, 'y.cmd'), kind: 'cmd' })
    expect(resolveExecutable(join(root, 'y'), {})).toEqual({ path: join(root, 'y.cmd'), kind: 'cmd' })
    expect(resolveExecutable(join(root, 'nope.exe'), {})).toBeUndefined()
    expect(resolveExecutable('.\\x.exe', { PATH: root })).toBeUndefined()
  })
})

describe('parseProgressLine', () => {
  it('parseProgressLine reads @@progress JSON and ignores other lines', () => {
    expect(parseProgressLine('@@progress {"step":2,"total":6,"label":"Tải mã nguồn","percent":40}')).toEqual({
      step: 2,
      total: 6,
      label: 'Tải mã nguồn',
      percent: 40,
    })
    expect(parseProgressLine('@@progress {"step":1,"total":6,"label":"x","message":"m"}')).toEqual({
      step: 1,
      total: 6,
      label: 'x',
    })
    expect(parseProgressLine('[12/400] Building CXX object')).toBeUndefined()
    expect(parseProgressLine('@@progress not json')).toBeUndefined()
    expect(parseProgressLine('@@progress {"step":"1","total":6,"label":"x"}')).toBeUndefined()
    expect(parseProgressLine('@@progress {"step":1,"total":6}')).toBeUndefined()
    expect(parseProgressLine('@@progress [1,2]')).toBeUndefined()
    expect(parseProgressLine('  @@progress {"step":1,"total":6,"label":"x"}')).toBeUndefined()
    expect(parseProgressLine('')).toBeUndefined()
  })
})

describe('isProcessRunning', () => {
  it('finds a running image and rejects unsafe names', async () => {
    expect(await isProcessRunning('node.exe')).toBe(true)
    expect(await isProcessRunning('NODE.EXE')).toBe(true)
    expect(await isProcessRunning('squarel-not-running-xyz.exe')).toBe(false)
    for (const bad of ['node', 'a b.exe', 'x.exe" & calc', '*.exe', '../x.exe']) {
      await expect(isProcessRunning(bad)).rejects.toThrow()
    }
  })
})

describe('systemRoot', () => {
  it('uses a plain drive path from SystemRoot (any key case)', () => {
    expect(systemRoot({ SYSTEMROOT: 'D:\\Win' })).toBe('D:\\Win')
    expect(system32({ SystemRoot: 'D:\\Win' }, 'cmd.exe')).toBe('D:\\Win\\System32\\cmd.exe')
  })

  it('falls back to C:\\Windows for a missing, relative, quoted or %-expanding SystemRoot', () => {
    for (const bad of [
      undefined,
      '',
      'Windows',
      '\\\\host\\share',
      'C:\\x" & calc',
      'C:\\%TEMP%',
      'C:/Windows',
    ])
      expect(systemRoot(bad === undefined ? {} : { SystemRoot: bad })).toBe('C:\\Windows')
    expect(system32({ SystemRoot: 'C:\\x"y' }, 'cmd.exe')).toBe('C:\\Windows\\System32\\cmd.exe')
  })
})
