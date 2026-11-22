/**
 * Integration manifest schema (`integrations/<id>/integration.json`), schema version 1.
 *
 * This is the public extension contract of the Squarel launcher: the launcher builds the rail icon,
 * the tool page, the launch menu and the health checks of every integration purely from its manifest.
 * See docs/superpowers/specs/2026-11-22-launcher-design.md §7.
 *
 * Rules:
 * - `run` is always an argv array (never a shell string), run from the Squarel folder
 *   (or from the integration's own folder for user integrations).
 * - Strings may contain only the fixed substitution variables in SUBST_VARS, written `{name}`.
 * - Paths may use Windows `%VAR%` environment references; the launcher expands them.
 */
import { z } from 'zod'

/** The only substitution variables a manifest may use, written `{toolsDir}`, `{exe}`, … */
export const SUBST_VARS = ['toolsDir', 'exe', 'exeDir', 'version', 'recentProject'] as const
export type SubstVar = (typeof SUBST_VARS)[number]

/** Platforms a manifest can target (Node's `process.platform` names). */
export const PLATFORMS = ['win32', 'darwin', 'linux'] as const
export type Platform = (typeof PLATFORMS)[number]

/** Health checks implemented by the launcher itself. */
export const BUILTIN_CHECKS = ['detect', 'bridge-client', 'extension-version'] as const
export type BuiltinCheck = (typeof BUILTIN_CHECKS)[number]

/** `{name}` tokens; `{` / `}` outside such a token are left alone (e.g. regex quantifiers). */
const VAR_TOKEN = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Replace `{var}` tokens in one argument. Throws on a variable outside SUBST_VARS, or on a known
 * variable with no value. Values are inserted literally (never re-expanded).
 */
export function substitute(arg: string, vars: Partial<Record<SubstVar, string>>): string {
  return arg.replace(VAR_TOKEN, (_, name: string) => {
    if (!(SUBST_VARS as readonly string[]).includes(name)) throw new Error(`unknown variable {${name}}`)
    const value = vars[name as SubstVar]
    if (value === undefined) throw new Error(`no value for variable {${name}}`)
    return value
  })
}

/** Variables used in a string that are not in SUBST_VARS. */
function unknownVars(s: string): string[] {
  return [...s.matchAll(VAR_TOKEN)]
    .map((m) => m[1])
    .filter((n) => !(SUBST_VARS as readonly string[]).includes(n))
}

/** A string that may contain only known `{var}` tokens. */
const templ = z
  .string()
  .min(1)
  .superRefine((s, ctx) => {
    for (const n of unknownVars(s)) ctx.addIssue({ code: 'custom', message: `unknown variable {${n}}` })
  })

// ---------------------------------------------------------------------------------------------
// Types (the launcher and integration authors code against these)

/** argv array, run without a shell. Each element may contain `{var}` tokens. */
export type Run = string[]

export type Detect = {
  /** Environment variable holding the executable path (checked first). */
  env?: string
  /** Candidate executable paths, `%VAR%` references allowed; first existing one wins. */
  candidates?: string[]
  /** How to read the installed version: run `exe ...args`, first capture group of `pattern`. */
  version?: { args: string[]; pattern: string }
}

/** Where the latest available version comes from. */
export type Latest = {
  type: 'git-tags'
  repo: string
  /** Only plain release tags (no beta/rc). */
  stable?: boolean
}

/** One way of installing the tool; the user picks one. Exactly one of `run` | `pickFile`. */
export type InstallOption = {
  id: string
  label: string
  note?: string
  run?: Run
  /** Let the user pick an existing executable with this file name. */
  pickFile?: string
  /** Store the picked path in this environment variable (only with `pickFile`). */
  setEnv?: string
}

/** A command that must not run while `requiresClosed` (a process image name) is running. */
export type Task = { run: Run; requiresClosed?: string }

export type Extension = {
  /** Paths to the bundled and the installed extension `package.json` (field `version`). */
  version: { source: string; installed: string }
  install: Task
}

/** An entry of the launch menu. Exactly one of `run` | `bridgeTool` | `reveal`. */
export type LaunchAction = {
  id: string
  label: string
  /** Exactly one action per manifest is the default (the main Open button). */
  default?: boolean
  run?: Run
  /** Extra environment variables for `run`. */
  env?: Record<string, string>
  /** Send this tool call over the bridge, as Claude would. */
  bridgeTool?: string
  /** Ask the user for a Squarel project first (passed to `bridgeTool`). */
  pickProject?: boolean
  /** Open this folder in the file manager. */
  reveal?: string
}

/** A health check. Exactly one of `builtin` | `run` (a run check passes on exit code 0). */
export type CheckSpec = {
  id: string
  label: string
  builtin?: BuiltinCheck
  run?: Run
  /** Only run when the user asks (slow or intrusive). */
  manual?: boolean
}

export type IntegrationManifestT = {
  schema: 1
  /** Matches `^[a-z][a-z0-9-]{1,31}$` and the integration's folder name. */
  id: string
  name: string
  description: string
  /** 16×16 PNG file, relative to the integration folder. */
  icon: string
  /** `#RRGGBB`. */
  accent: string
  platforms: Platform[]
  detect: Detect
  latest?: Latest
  install: InstallOption[]
  update?: Task
  extension?: Extension
  /** Set when the tool talks the bridge protocol (`hello` with this `client`). */
  bridge?: { client: string }
  launch: LaunchAction[]
  checks: CheckSpec[]
}

export type CatalogEntryT = {
  id: string
  name: string
  description: string
  /** Short monogram (1–2 characters) drawn on an `accent` tile; catalog entries ship no icon file. */
  icon: string
  accent: string
}

/** `integrations/catalog.json`: integrations shown as "coming soon" in the library. */
export type CatalogT = { schema: 1; comingSoon: CatalogEntryT[] }

// ---------------------------------------------------------------------------------------------
// Schemas

const ID = /^[a-z][a-z0-9-]{1,31}$/
const id = z.string().regex(ID, 'id must match ^[a-z][a-z0-9-]{1,31}$')
const accent = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'accent must be #RRGGBB')
const text = z.string().min(1)
const run = z.array(templ).min(1)
const iconFile = z.string().regex(/^[\w.-]+\.png$/, 'icon must be a .png file name in the integration folder')

/** Exactly one of the given keys is present. */
function exactlyOne<T extends object>(keys: (keyof T & string)[]) {
  return (v: T, ctx: z.RefinementCtx) => {
    const present = keys.filter((k) => v[k] !== undefined)
    if (present.length !== 1)
      ctx.addIssue({ code: 'custom', message: `needs exactly one of ${keys.join(' | ')}` })
  }
}

function uniqueIds(list: { id: string }[], ctx: z.RefinementCtx) {
  const seen = new Set<string>()
  list.forEach((item, i) => {
    if (seen.has(item.id))
      ctx.addIssue({ code: 'custom', message: `duplicate id "${item.id}"`, path: [i, 'id'] })
    seen.add(item.id)
  })
}

const DetectSchema = z
  .strictObject({
    env: text.optional(),
    candidates: z.array(text).min(1).optional(),
    version: z.strictObject({ args: z.array(text), pattern: text }).optional(),
  })
  .superRefine((d, ctx) => {
    if (!d.env && !d.candidates) ctx.addIssue({ code: 'custom', message: 'detect needs env or candidates' })
  })

const LatestSchema = z.strictObject({
  type: z.literal('git-tags'),
  repo: z.url(),
  stable: z.boolean().optional(),
})

const InstallSchema = z
  .strictObject({
    id,
    label: templ,
    note: text.optional(),
    run: run.optional(),
    pickFile: text.optional(),
    setEnv: text.optional(),
  })
  .superRefine(exactlyOne(['run', 'pickFile']))
  .superRefine((o, ctx) => {
    if (o.setEnv && !o.pickFile) ctx.addIssue({ code: 'custom', message: 'setEnv needs pickFile' })
  })

const TaskSchema = z.strictObject({ run, requiresClosed: text.optional() })

const ExtensionSchema = z.strictObject({
  version: z.strictObject({ source: text, installed: text }),
  install: TaskSchema,
})

const LaunchSchema = z
  .strictObject({
    id,
    label: templ,
    default: z.boolean().optional(),
    run: run.optional(),
    env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()).optional(),
    bridgeTool: text.optional(),
    pickProject: z.boolean().optional(),
    reveal: templ.optional(),
  })
  .superRefine(exactlyOne(['run', 'bridgeTool', 'reveal']))
  .superRefine((a, ctx) => {
    if (a.env && !a.run) ctx.addIssue({ code: 'custom', message: 'env only applies to run' })
    if (a.pickProject && !a.bridgeTool)
      ctx.addIssue({ code: 'custom', message: 'pickProject needs bridgeTool' })
  })

const CheckSchema = z
  .strictObject({
    id,
    label: templ,
    builtin: z.enum(BUILTIN_CHECKS).optional(),
    run: run.optional(),
    manual: z.boolean().optional(),
  })
  .superRefine(exactlyOne(['builtin', 'run']))

export const IntegrationManifest: z.ZodType<IntegrationManifestT> = z.strictObject({
  schema: z.literal(1),
  id,
  name: text,
  description: text,
  icon: iconFile,
  accent,
  platforms: z.array(z.enum(PLATFORMS)).min(1),
  detect: DetectSchema,
  latest: LatestSchema.optional(),
  install: z.array(InstallSchema).superRefine(uniqueIds),
  update: TaskSchema.optional(),
  extension: ExtensionSchema.optional(),
  bridge: z.strictObject({ client: id }).optional(),
  launch: z
    .array(LaunchSchema)
    .min(1)
    .superRefine(uniqueIds)
    .superRefine((list, ctx) => {
      const n = list.filter((a) => a.default === true).length
      if (n !== 1)
        ctx.addIssue({ code: 'custom', message: `exactly one launch action must be default (found ${n})` })
    }),
  checks: z.array(CheckSchema).superRefine(uniqueIds),
})

const CatalogEntry = z.strictObject({
  id,
  name: text,
  description: text,
  icon: z.string().min(1).max(2),
  accent,
})

export const Catalog: z.ZodType<CatalogT> = z.strictObject({
  schema: z.literal(1),
  comingSoon: z.array(CatalogEntry).superRefine(uniqueIds),
})
