/** Git worktree detection by reading `.git` files directly (no git binary needed). */
import { readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

const MAX_WALK = 32

type GitLocation = { root: string; common: string; linked: boolean }

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory()
  } catch {
    return false
  }
}

/** Walk up (at most 32 levels) to the first `.git`; resolve the common git dir. */
async function locate(folder: string): Promise<GitLocation | undefined> {
  let dir = resolve(folder)
  for (let i = 0; i < MAX_WALK; i++) {
    const dotGit = join(dir, '.git')
    let st: Awaited<ReturnType<typeof stat>> | undefined
    try {
      st = await stat(dotGit)
    } catch {
      st = undefined
    }
    if (st?.isDirectory()) return { root: dir, common: dotGit, linked: false }
    if (st?.isFile()) {
      try {
        const m = /^gitdir:\s*(.+?)\s*$/m.exec(await readFile(dotGit, 'utf8'))
        if (!m) return undefined
        const gitdir = isAbsolute(m[1]) ? resolve(m[1]) : resolve(dir, m[1])
        const rel = (await readFile(join(gitdir, 'commondir'), 'utf8')).trim()
        return { root: dir, common: resolve(gitdir, rel), linked: true }
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

/** The `.git` directory itself, or the shared common dir of a linked worktree. */
export async function gitCommonDir(folder: string): Promise<string | undefined> {
  const loc = await locate(folder)
  return loc && (await isDir(loc.common)) ? loc.common : undefined
}

/**
 * For a folder inside a linked worktree: the same relative folder inside the main checkout.
 * Undefined when not a linked worktree, for a bare repo, or when the main checkout is gone.
 */
export async function mainCheckoutOf(folder: string): Promise<string | undefined> {
  const loc = await locate(folder)
  if (!loc?.linked) return undefined
  if (basename(loc.common) !== '.git' || !(await isDir(loc.common))) return undefined
  return join(dirname(loc.common), relative(loc.root, resolve(folder)))
}
