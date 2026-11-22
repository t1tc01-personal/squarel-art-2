import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Write to a temp file then rename (atomic on the same volume). Retries transient Windows sharing errors. */
export async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`
  await writeFile(tmp, data)
  for (let i = 0; ; i++) {
    try {
      await rename(tmp, path)
      return
    } catch (e: any) {
      if (i >= 20 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) {
        await rm(tmp, { force: true })
        throw e
      }
      await sleep(15 * (i + 1))
    }
  }
}

export async function readJson<T>(path: string): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return JSON.parse(await readFile(path, 'utf8')) as T
    } catch (e: any) {
      if (i >= 10 || !['EPERM', 'EBUSY', 'EACCES'].includes(e?.code)) throw e
      await sleep(10 * (i + 1))
    }
  }
}

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

/**
 * Cross-process lock using an exclusive `mkdir`. A lock older than `staleMs`
 * (holder crashed) is broken. Waits up to `timeoutMs`.
 */
export async function withLock<T>(
  lockDir: string,
  fn: () => Promise<T>,
  o: { staleMs?: number; timeoutMs?: number } = {},
): Promise<T> {
  const stale = o.staleMs ?? 10_000
  const deadline = Date.now() + (o.timeoutMs ?? 8_000)
  for (let i = 0; ; i++) {
    try {
      await mkdir(lockDir)
      break
    } catch (e: any) {
      if (e?.code !== 'EEXIST') throw e
      try {
        const s = await stat(lockDir)
        if (Date.now() - s.mtimeMs > stale) {
          await rm(lockDir, { recursive: true, force: true })
          continue
        }
      } catch {
        continue
      }
      if (Date.now() > deadline) throw new Error(`timed out waiting for lock ${lockDir}`)
      await sleep(Math.min(100, 10 + i * 5))
    }
  }
  try {
    return await fn()
  } finally {
    await rm(lockDir, { recursive: true, force: true })
  }
}
