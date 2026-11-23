/** Register Squarel with Claude Code (user-scope MCP server) and install its pixel-* skills. */
import type { Dirent } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Deps } from './deps'

/** Throwaway server name used to check that `claude mcp add` works before the old entry is removed. */
const CHECK_NAME = 'squarel-launcher-check'

export async function registerMcp(squarelDir: string, d: Deps): Promise<{ ok: boolean; output: string }> {
  if (!isAbsolute(squarelDir)) {
    return { ok: false, output: 'Đường dẫn thư mục Squarel phải là đường dẫn tuyệt đối.' }
  }
  const entry = join(squarelDir, 'src', 'mcp', 'index.ts')
  try {
    if (!(await d.fs.stat(entry)).isFile()) throw new Error('not a file')
  } catch {
    return { ok: false, output: `Không tìm thấy máy chủ MCP của Squarel: ${entry}` }
  }
  const lines: string[] = []
  const onLine = (l: string) => void lines.push(l)
  const claude = (...args: string[]) => d.run({ argv: ['claude', 'mcp', ...args], cwd: squarelDir, onLine })
  const server = ['--scope', 'user', '--', 'node', entry]
  // `claude mcp add` refuses an existing name, so the old registration has to go before the new
  // one is added. Prove first that an add works (under a throwaway name), so a failing add never
  // leaves Claude Code without Squarel. Remove results are irrelevant (the name may not exist).
  await claude('remove', CHECK_NAME, '--scope', 'user')
  const probe = await claude('add', CHECK_NAME, ...server)
  await claude('remove', CHECK_NAME, '--scope', 'user')
  if (probe.code !== 0) return { ok: false, output: lines.join('\n') }
  await claude('remove', 'squarel', '--scope', 'user')
  const add = await claude('add', 'squarel', ...server)
  return { ok: add.code === 0, output: lines.join('\n') }
}

async function copyDir(src: string, dst: string, d: Deps): Promise<void> {
  await d.fs.mkdir(dst, { recursive: true })
  const entries = (await d.fs.readdir(src, { withFileTypes: true })) as Dirent[]
  for (const e of entries) {
    if (e.isSymbolicLink()) continue
    const from = join(src, e.name)
    const to = join(dst, e.name)
    if (e.isDirectory()) await copyDir(from, to, d)
    else if (e.isFile()) await d.fs.writeFile(to, await d.fs.readFile(from))
  }
}

/** The pixel-* skill folders Squarel ships (`<squarel>/.claude/skills`), sorted. */
export async function skillNames(squarelDir: string, d: Deps): Promise<string[]> {
  let entries: Dirent[]
  try {
    entries = (await d.fs.readdir(join(squarelDir, '.claude', 'skills'), { withFileTypes: true })) as Dirent[]
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name.startsWith('pixel-'))
    .map((e) => e.name)
    .sort()
}

/** Every file below `dir` as relative path → content (forward slashes). */
async function readTree(dir: string, d: Deps, prefix = ''): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const entries = (await d.fs.readdir(dir, { withFileTypes: true })) as Dirent[]
  for (const e of entries) {
    const rel = prefix ? `${prefix}/${e.name}` : e.name
    if (e.isDirectory()) for (const [k, v] of await readTree(join(dir, e.name), d, rel)) out.set(k, v)
    else if (e.isFile()) out.set(rel, String(await d.fs.readFile(join(dir, e.name), 'utf8')))
  }
  return out
}

/**
 * Which of Squarel's skills Claude Code has in `~/.claude/skills`: missing (no folder) or
 * outdated (a file differs or is missing; extra files in the copy are ignored).
 */
export async function skillStatus(
  squarelDir: string,
  homeDir: string,
  d: Deps,
): Promise<{ names: string[]; missing: string[]; outdated: string[] }> {
  const names = await skillNames(squarelDir, d)
  const missing: string[] = []
  const outdated: string[] = []
  for (const name of names) {
    const src = await readTree(join(squarelDir, '.claude', 'skills', name), d)
    let dst: Map<string, string>
    try {
      dst = await readTree(join(homeDir, '.claude', 'skills', name), d)
    } catch {
      missing.push(name)
      continue
    }
    if (!dst.has('SKILL.md')) missing.push(name)
    else if ([...src].some(([k, v]) => dst.get(k) !== v)) outdated.push(name)
  }
  return { names, missing, outdated }
}

export async function copySkills(squarelDir: string, homeDir: string, d: Deps): Promise<string[]> {
  const srcRoot = join(squarelDir, '.claude', 'skills')
  const dstRoot = join(homeDir, '.claude', 'skills')
  const names = await skillNames(squarelDir, d)
  if (names.length === 0) return []
  await d.fs.mkdir(dstRoot, { recursive: true })
  for (const leftover of (await d.fs.readdir(dstRoot)) as string[]) {
    if (/^\.pixel-.*\.(tmp|bak)-/.test(leftover)) {
      await d.fs.rm(join(dstRoot, leftover), { recursive: true, force: true }).catch(() => {})
    }
  }
  for (const name of names) {
    const tmp = join(dstRoot, `.${name}.tmp-${process.pid}`)
    const bak = join(dstRoot, `.${name}.bak-${process.pid}`)
    const live = join(dstRoot, name)
    try {
      await copyDir(join(srcRoot, name), tmp, d)
    } catch (e) {
      await d.fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      throw e
    }
    // Move the old copy aside (not delete) so a failed swap can be rolled back.
    let movedAside = true
    try {
      await d.fs.rename(live, bak)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        await d.fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
        throw e
      }
      movedAside = false
    }
    try {
      await d.fs.rename(tmp, live)
    } catch (e) {
      if (movedAside) await d.fs.rename(bak, live).catch(() => {})
      await d.fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      throw e
    }
    if (movedAside) await d.fs.rm(bak, { recursive: true, force: true }).catch(() => {})
  }
  return names
}
