import { cp, readdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, relative } from 'node:path'
import type { Logger } from '../log.ts'
import { ToolError } from '../tools/types.ts'
import { exists, readJson, withLock, writeAtomic } from './fsutil.ts'
import { readVersionFile, type Store } from './store.ts'
import { writeCatalog } from './workspace.ts'

type ImportFs = Pick<typeof import('node:fs/promises'), 'cp' | 'rename' | 'rm'>

/** Files that are not art: the project lock and half-written temp files. */
const skip = (name: string) => name === '.lock' || name.endsWith('.tmp')

/** Relative file path → size, for every art file under `dir`. */
async function tree(dir: string, base = dir, out = new Map<string, number>()): Promise<Map<string, number>> {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (skip(e.name)) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await tree(p, base, out)
    else out.set(relative(base, p), (await stat(p)).size)
  }
  return out
}

function sameTree(a: Map<string, number>, b: Map<string, number>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v)
}

/**
 * Move a legacy art (DATA_DIR/projects/<slug>) into `target`. The source is removed only after the
 * copy is complete, verified (same files and sizes, head version decodes) and in place under its final
 * id; any earlier failure leaves the source untouched and removes the partial copy.
 */
export async function importLegacyArt(
  legacy: Store,
  target: Store,
  slug: string,
  o: { log?: Logger; fs?: ImportFs } = {},
): Promise<{ slug: string; from: string; to: string }> {
  const fs: ImportFs = o.fs ?? { cp, rename, rm }
  if (!(await legacy.hasProject(slug)))
    throw new ToolError('NOT_FOUND', `legacy art "${slug}" not found (art_list { legacy: true })`)
  const from = legacy.projectPath(slug)
  return withLock(legacy.projectPath(slug, '.lock'), async () => {
    await target.init()
    const temp = join(target.root, `.${slug}.importing`)
    await rm(temp, { recursive: true, force: true }) // leftover of a crashed import
    let copy = temp // whatever partial copy exists, so a failure can remove it
    let final = slug
    try {
      await fs.cp(from, temp, { recursive: true, filter: (src) => !skip(basename(src)) })
      const before = await tree(from)
      if (!sameTree(before, await tree(temp))) throw new Error('copy does not match the source')
      const { head } = await readJson<{ head: string }>(join(temp, 'project.json'))
      await readVersionFile(join(temp, 'versions', `${head}.json.gz`))

      final = await target.freeSlug(slug)
      const dest = target.projectPath(final)
      try {
        await fs.rename(temp, dest)
      } catch (e: any) {
        if (e?.code !== 'EXDEV') throw e
        copy = dest
        await fs.cp(temp, dest, { recursive: true })
        await rm(temp, { recursive: true, force: true })
      }
      copy = dest
      const info = await readJson<Record<string, unknown>>(join(dest, 'project.json'))
      delete info.workspace
      info.slug = final
      await writeAtomic(join(dest, 'project.json'), JSON.stringify(info, null, 2))

      try {
        await fs.rm(from, { recursive: true, force: true })
      } catch (e) {
        // Never lose data: drop the copy only while the source is still whole.
        if (!(await exists(from)) || !sameTree(before, await tree(from).catch(() => new Map()))) {
          copy = ''
          o.log?.warn('art import: source only partly removed; the copy is kept', { slug, to: dest })
        }
        throw e
      }
    } catch (e) {
      if (copy) await rm(copy, { recursive: true, force: true }).catch(() => {})
      throw e
    }
    return { slug: final, from, to: target.projectPath(final) }
  }).then(async (r) => {
    try {
      const { doc } = await target.readHead(r.slug)
      await target.writeThumb(r.slug, doc)
      if (target.project) await writeCatalog(target, target.project, o.log)
    } catch (e) {
      o.log?.warn('art import: thumb/catalog update failed', { slug: r.slug, error: String(e) })
    }
    return r
  })
}
