import { ZodError } from 'zod'
import { BudgetError } from '../providers/router.ts'
import { ProviderError } from '../providers/types.ts'
import { ConflictError } from '../store/store.ts'
import { aiTools } from './ai.ts'
import { drawTools } from './draw.ts'
import { editorTools, exportTools, historyTools, importTools } from './misc.ts'
import { opsTools } from './ops.ts'
import { projectTools } from './project.ts'
import { type ToolContext, type ToolDef, ToolError, type ToolResult } from './types.ts'

export const ALL_TOOLS: ToolDef<any>[] = [
  ...projectTools,
  ...drawTools,
  ...opsTools,
  ...importTools,
  ...aiTools,
  ...historyTools,
  ...exportTools,
  ...editorTools,
]

const byName = new Map(ALL_TOOLS.map((t) => [t.name, t]))

export function getTool(name: string): ToolDef<any> {
  const t = byName.get(name)
  if (!t) throw new ToolError('NOT_FOUND', `unknown tool "${name}"`)
  return t
}

export function toToolError(e: unknown): ToolError {
  if (e instanceof ToolError) return e
  if (e instanceof ZodError)
    return new ToolError(
      'INVALID',
      e.issues.map((x) => `${x.path.join('.') || 'input'}: ${x.message}`).join('; '),
    )
  if (e instanceof ConflictError) return new ToolError('CONFLICT', e.message)
  if (e instanceof BudgetError) return new ToolError('BUDGET', e.message)
  if (e instanceof ProviderError) return new ToolError('PROVIDER', e.message)
  const msg = e instanceof Error ? e.message : String(e)
  if (/not found/i.test(msg)) return new ToolError('NOT_FOUND', msg)
  return new ToolError('INVALID', msg)
}

/** Validate input and run a tool. Errors are normalized to ToolError. */
export async function runTool(name: string, input: unknown, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(name)
  try {
    const parsed = tool.input.parse(input ?? {})
    return await tool.handler(ctx, parsed)
  } catch (e) {
    const err = toToolError(e)
    if (!(e instanceof ToolError) && !(e instanceof ZodError))
      ctx.log.warn('tool error', { tool: name, error: String(e) })
    throw err
  }
}
