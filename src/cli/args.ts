import type { z } from 'zod'

/** True when the schema (through optional/nullable/default wrappers) is a plain string. */
function isStringSchema(schema: unknown): boolean {
  let s = schema as { def?: { type?: string; innerType?: unknown } } | undefined
  for (let i = 0; i < 8 && s?.def; i++) {
    if (s.def.type === 'string') return true
    if (!['optional', 'nullable', 'default'].includes(s.def.type ?? '')) return false
    s = s.def.innerType as typeof s
  }
  return false
}

/**
 * CLI arguments → tool input: one JSON object, or `--key value` flags. A flag value is parsed as JSON
 * when possible, except for keys the tool's schema declares as strings (a slug like `2048` or `true`
 * must stay text).
 */
export function parseArgs(argv: string[], input?: z.ZodObject<any>): Record<string, unknown> {
  if (argv.length === 1 && argv[0].trim().startsWith('{')) return JSON.parse(argv[0])
  const out: Record<string, unknown> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) throw new Error(`unexpected argument "${a}"`)
    const key = a.slice(2).replace(/-/g, '_')
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) {
      out[key] = true
      continue
    }
    i++
    if (isStringSchema(input?.shape?.[key])) {
      out[key] = next
      continue
    }
    try {
      out[key] = JSON.parse(next)
    } catch {
      out[key] = next
    }
  }
  return out
}
