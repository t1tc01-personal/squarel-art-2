/**
 * Git linked-worktree detection by reading `.git` files through Deps.fs (no git binary). Same
 * algorithm as Squarel's `mainCheckoutOf` (src/store/worktree.ts); the launcher is a separate
 * package, so it is ported here, not imported.
 */
import { win32 } from 'node:path'
import type { Deps } from './deps'

const { basename, dirname, join, relative, resolve } = win32
const MAX_WALK = 32

async function kind(d: Deps, p: string): Promise<'dir' | 'file' | undefined> {
  try {
    const st = await d.fs.stat(p)
    return st.isDirectory() ? 'dir' : st.isFile() ? 'file' : undefined
  } catch {
    return undefined
  }
}

/**
 * For a folder inside a linked worktree: the same relative folder inside the main checkout.
 * Undefined when not a linked worktree, for a bare repo, or when the main checkout is gone.
 */
export async function worktreeMain(d: Deps, folder: string): Promise<string | undefined> {
  const start = resolve(folder)
  let dir = start
  for (let i = 0; i < MAX_WALK; i++) {
    const dotGit = join(dir, '.git')
    const k = await kind(d, dotGit)
    if (k === 'dir') return undefined
    if (k === 'file') {
      try {
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(String(await d.fs.readFile(dotGit, 'utf8')))
        if (!m) return undefined
        const gitdir = resolve(dir, m[1] ?? '')
        const rel = String(await d.fs.readFile(join(gitdir, 'commondir'), 'utf8')).trim()
        const common = resolve(gitdir, rel)
        if (basename(common) !== '.git' || (await kind(d, common)) !== 'dir') return undefined
        return join(dirname(common), relative(dir, start))
      } catch {
        return undefined
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}
