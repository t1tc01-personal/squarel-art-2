import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ProjectInfo } from '../store/store.ts'
import { artsDirOf, describeDefaults, type Workspace } from '../store/workspace.ts'
import { NO_PROJECT_TEXT } from '../tools/common.ts'
import { ALL_TOOLS, runTool } from '../tools/registry.ts'
import { type ToolContext, ToolError } from '../tools/types.ts'
import { SQUAREL_VERSION } from '../version.ts'

export const SERVER_INSTRUCTIONS = `Squarel Art: pixel-art toolkit.
Art lives inside a project folder (the user's "Dự án"). Workflow: art_list/art_open or art_create → canvas_view (look before and after changes) → edit → export.
Prefer free deterministic tools (draw_pixels, recolor, add_outline, apply_palette, reduce_colors, remove_background, flip, scale, crop_to_content) over AI tools.
AI tools (generate_image, edit_image, animate) create PROPOSALS; show the numbered sheet and let the user pick, then accept_variant adds a new layer.
Never pass confirm_cost: true unless the user approved the quoted price in this conversation.
open_in_editor shows the art in Aseprite for hand drawing; edits sync back as new versions.`

/** Server instructions paragraph for the project detected at startup (arts newest first). */
export function workspaceInstructions(ws: Workspace, arts: ProjectInfo[]): string {
  const newest = arts
    .slice(0, 5)
    .map((p) => `${p.slug} ("${p.name}")`)
    .join(', ')
  const lines = [
    `Active workspace: "${ws.name}" (id ${ws.id}), folder ${ws.folder}. The user calls it their project ("Dự án"); each art is one pixel-art canvas inside it, and art tools take an \`art\` id.`,
    `Defaults for new art: ${describeDefaults(ws.config.defaults)}. art_create fills in missing width/height/purpose/palette from them, and new art joins this workspace.`,
    `${arts.length} art${arts.length === 1 ? '' : 's'} in this workspace${newest ? `; newest: ${newest}` : ''}.`,
    'The brief is in AGENTS.md in the project folder (project_info shows it too); the art catalog is .squarel/arts.md. Follow the brief and do not ask again for what it already decides.',
    'art_list shows the arts of this project.',
  ]
  if (ws.home !== ws.folder)
    lines.push(
      `This folder is a git worktree. Art lives in ${artsDirOf(ws)}, in the main checkout. This worktree's squarel_art/ is a stale checkout: do not read or edit it with file tools. New art shows as uncommitted changes in the main checkout.`,
    )
  return lines.join('\n')
}

export interface InstructionState {
  workspace?: Workspace
  arts: ProjectInfo[]
  /** Arts still waiting in DATA_DIR/projects. */
  legacyCount?: number
  /** Id of another project folder this one's id collides with; writes are blocked. */
  duplicateOf?: string
}

/** SERVER_INSTRUCTIONS plus the project paragraph, or the no-project note. */
export function serverInstructions(s: InstructionState = { arts: [] }): string {
  const parts = [SERVER_INSTRUCTIONS]
  if (s.workspace) {
    parts.push(workspaceInstructions(s.workspace, s.arts))
    if (s.duplicateOf)
      parts.push(
        `Writes are blocked: project id "${s.workspace.id}" is also used by ${s.duplicateOf}. Change the id in .squarel/project.json of one of the two folders (or rename it in Squarel Art Launcher), then restart Claude Code.`,
      )
  } else {
    parts.push(NO_PROJECT_TEXT)
    if (s.legacyCount)
      parts.push(
        `${s.legacyCount} older art${s.legacyCount === 1 ? '' : 's'} wait in DATA_DIR/projects; inside a project, art_import moves one in.`,
      )
  }
  return parts.join('\n\n')
}

export function toMcpResult(r: { text: string; images?: { png: Uint8Array }[] }): CallToolResult {
  return {
    content: [
      { type: 'text' as const, text: r.text },
      ...(r.images ?? []).map((im) => ({
        type: 'image' as const,
        data: Buffer.from(im.png).toString('base64'),
        mimeType: 'image/png',
      })),
    ],
  }
}

export function createMcpServer(
  ctx: ToolContext,
  opts: { version?: string; onToolCall?: (name: string) => void; instructions?: string } = {},
): McpServer {
  const server = new McpServer(
    { name: 'squarel', version: opts.version ?? SQUAREL_VERSION },
    { instructions: opts.instructions ?? SERVER_INSTRUCTIONS },
  )
  for (const tool of ALL_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.input,
        annotations: {
          title: tool.title,
          readOnlyHint: tool.annotations?.readOnly ?? false,
          destructiveHint: false,
          openWorldHint: tool.annotations?.openWorld ?? false,
        },
      },
      async (args: unknown, extra: any) => {
        const token = extra?._meta?.progressToken
        const callCtx: ToolContext = {
          ...ctx,
          signal: extra?.signal,
          progress:
            token !== undefined
              ? (progress, total, message) => {
                  extra
                    .sendNotification({
                      method: 'notifications/progress',
                      params: { progressToken: token, progress, total, message },
                    })
                    .catch(() => {})
                }
              : undefined,
        }
        try {
          const result = toMcpResult(await runTool(tool.name, args, callCtx))
          opts.onToolCall?.(tool.name)
          return result
        } catch (e) {
          opts.onToolCall?.(tool.name)
          const err = e instanceof ToolError ? e : new ToolError('INVALID', String(e))
          return {
            isError: true,
            content: [{ type: 'text' as const, text: `[${err.code}] ${err.message}` }],
          } satisfies CallToolResult
        }
      },
    )
  }
  return server
}
