import type { z } from 'zod'
import type { Config } from '../config.ts'
import type { Logger } from '../log.ts'
import type { ProviderRouter } from '../providers/router.ts'
import type { Source } from '../shared/types.ts'
import type { Store } from '../store/store.ts'
import type { Workspace } from '../store/workspace.ts'

export type ErrorCode =
  | 'NOT_FOUND'
  | 'INVALID'
  | 'CONFLICT'
  | 'BUDGET'
  | 'NEEDS_CONFIRM'
  | 'PROVIDER'
  | 'TIMEOUT'
  | 'UNAVAILABLE'

export class ToolError extends Error {
  readonly code: ErrorCode
  readonly data?: unknown
  constructor(code: ErrorCode, message: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
  }
}

export interface ToolImage {
  png: Uint8Array
  alt: string
}

export interface ToolResult {
  text: string
  images?: ToolImage[]
  files?: string[]
  data?: unknown
}

export interface EditorHost {
  /** Ask the editor integration (Aseprite bridge) to show a project. */
  open(slug: string): Promise<string>
}

export interface ToolContext {
  store: Store
  router: ProviderRouter
  config: Config
  log: Logger
  session: {
    activeProject?: string
    /** Workspace ("Dự án") detected at MCP startup; CLI and the standalone bridge have none. */
    workspace?: Workspace
  }
  /** Who is making changes: recorded on every version. */
  source: Source
  signal?: AbortSignal
  progress?: (done: number, total: number, message?: string) => void
  editor?: EditorHost
  /** Called after every commit (the in-process bridge pushes it to Aseprite immediately). */
  onCommit?: (slug: string, versionId: string) => void
}

export interface ToolDef<S extends z.ZodObject<any> = z.ZodObject<any>> {
  name: string
  title: string
  description: string
  input: S
  annotations?: { readOnly?: boolean; costly?: boolean; openWorld?: boolean }
  handler(ctx: ToolContext, input: z.infer<S>): Promise<ToolResult>
}

export function defineTool<S extends z.ZodObject<any>>(def: ToolDef<S>): ToolDef<any> {
  return def as ToolDef<any>
}
