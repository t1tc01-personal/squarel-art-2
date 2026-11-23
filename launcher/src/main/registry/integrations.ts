/** Loads integration manifests (Squarel's own and the user's) without ever aborting on a bad file. */
import { join, resolve, sep } from 'node:path'
import {
  Catalog,
  type CatalogEntryT,
  IntegrationManifest,
  type IntegrationManifestT,
} from '@squarel/integration-schema'
import type { Deps } from '../deps'

export type CatalogEntry = CatalogEntryT

export interface LoadedIntegration {
  manifest: IntegrationManifestT
  dir: string
  source: 'squarel' | 'user'
  incompatible?: string
}

export interface Problem {
  path: string
  error: string
}

export const ICON_FILE = /^[\w.-]+\.png$/

/** True when `name` resolves to a path strictly inside `dir`. */
export function isInsideDir(dir: string, name: string): boolean {
  const root = resolve(dir)
  const full = resolve(root, name)
  return full.startsWith(root.endsWith(sep) ? root : root + sep)
}

const INCOMPATIBLE = 'Cần launcher mới hơn'

const msg = (e: unknown) => String((e as Error)?.message ?? e)

/** Short, readable summary of a zod error (or any error). */
function summarize(e: unknown): string {
  const issues = (e as { issues?: { path: PropertyKey[]; message: string }[] })?.issues
  if (!Array.isArray(issues)) return msg(e)
  return issues
    .slice(0, 5)
    .map((i) => `${i.path.map(String).join('.') || '(root)'}: ${i.message}`)
    .join('; ')
}

async function listDir(d: Deps, dir: string): Promise<string[]> {
  try {
    return (await d.fs.readdir(dir)).map(String).sort()
  } catch {
    return []
  }
}

/** A manifest of a newer schema cannot be validated; keep just enough to list it. */
function stub(raw: Record<string, unknown>, id: string): IntegrationManifestT {
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v ? v : fallback)
  return {
    schema: 1,
    id,
    name: str(raw.name, id),
    description: str(raw.description, ''),
    icon: typeof raw.icon === 'string' && ICON_FILE.test(raw.icon) ? raw.icon : 'icon.png',
    accent: typeof raw.accent === 'string' && /^#[0-9A-Fa-f]{6}$/.test(raw.accent) ? raw.accent : '#808080',
    platforms: [],
    detect: {},
    install: [],
    launch: [],
    checks: [],
  }
}

const stripBom = (s: string) => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s)

export async function loadIntegrationsFrom(
  root: string,
  source: 'squarel' | 'user',
  platform: NodeJS.Platform,
  d: Deps,
  problems: Problem[],
): Promise<LoadedIntegration[]> {
  const out: LoadedIntegration[] = []
  for (const name of await listDir(d, root)) {
    const dir = join(root, name)
    const file = join(dir, 'integration.json')
    let text: string
    try {
      text = stripBom(String(await d.fs.readFile(file, 'utf8')))
    } catch {
      continue // not an integration folder
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch (e) {
      problems.push({ path: file, error: `JSON không hợp lệ: ${msg(e)}` })
      continue
    }
    const obj =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : undefined
    if (obj && typeof obj.schema === 'number' && obj.schema !== 1) {
      if (typeof obj.id === 'string' && /^[a-z][a-z0-9-]{1,31}$/.test(obj.id) && obj.id === name)
        out.push({ manifest: stub(obj, obj.id), dir, source, incompatible: INCOMPATIBLE })
      else problems.push({ path: file, error: `schema ${obj.schema}: ${INCOMPATIBLE}` })
      continue
    }
    const parsed = IntegrationManifest.safeParse(raw)
    if (!parsed.success) {
      problems.push({ path: file, error: summarize(parsed.error) })
      continue
    }
    if (parsed.data.id !== name) {
      problems.push({ path: file, error: `id "${parsed.data.id}" không trùng tên thư mục "${name}"` })
      continue
    }
    if (!parsed.data.platforms.includes(platform as 'win32')) continue
    out.push({ manifest: parsed.data, dir, source })
  }
  return out
}

export async function loadCatalog(file: string, d: Deps, problems: Problem[]): Promise<CatalogEntry[]> {
  let text: string
  try {
    text = stripBom(String(await d.fs.readFile(file, 'utf8')))
  } catch {
    return []
  }
  try {
    const parsed = Catalog.safeParse(JSON.parse(text))
    if (parsed.success) return parsed.data.comingSoon
    problems.push({ path: file, error: summarize(parsed.error) })
  } catch (e) {
    problems.push({ path: file, error: `JSON không hợp lệ: ${msg(e)}` })
  }
  return []
}
