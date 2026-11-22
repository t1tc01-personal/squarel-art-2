/** Register Squarel with Claude Code (user-scope MCP server) and install its pixel-* skills. */
import type { Dirent } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Deps } from './deps'

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
  // A stale registration may or may not exist; its exit code is irrelevant.
  await d.run({
    argv: ['claude', 'mcp', 'remove', 'squarel', '--scope', 'user'],
    cwd: squarelDir,
    onLine,
  })
  const add = await d.run({
    argv: ['claude', 'mcp', 'add', 'squarel', '--scope', 'user', '--', 'node', entry],
    cwd: squarelDir,
    onLine,
  })
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

export async function copySkills(squarelDir: string, homeDir: string, d: Deps): Promise<string[]> {
  const srcRoot = join(squarelDir, '.claude', 'skills')
  const dstRoot = join(homeDir, '.claude', 'skills')
  let entries: Dirent[]
  try {
    entries = (await d.fs.readdir(srcRoot, { withFileTypes: true })) as Dirent[]
  } catch {
    return []
  }
  const names = entries
    .filter((e) => e.isDirectory() && !e.isSymbolicLink() && e.name.startsWith('pixel-'))
    .map((e) => e.name)
    .sort()
  if (names.length === 0) return []
  await d.fs.mkdir(dstRoot, { recursive: true })
  for (const name of names) {
    const tmp = join(dstRoot, `.${name}.tmp-${process.pid}`)
    await d.fs.rm(tmp, { recursive: true, force: true })
    try {
      await copyDir(join(srcRoot, name), tmp, d)
      await d.fs.rm(join(dstRoot, name), { recursive: true, force: true })
      await d.fs.rename(tmp, join(dstRoot, name))
    } catch (e) {
      await d.fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
      throw e
    }
  }
  return names
}
