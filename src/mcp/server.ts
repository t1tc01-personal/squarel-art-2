import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { ProjectInfo } from '../store/store.ts'
import { describeDefaults, type Workspace } from '../store/workspace.ts'
import { ALL_TOOLS, runTool } from '../tools/registry.ts'
import { type ToolContext, ToolError } from '../tools/types.ts'
import { SQUAREL_VERSION } from '../version.ts'

export const SERVER_INSTRUCTIONS = `Squarel Art: pixel-art toolkit.
Workflow: project_list/project_open or project_create → canvas_view (look before and after changes) → edit → export.
Prefer free deterministic tools (draw_pixels, recolor, add_outline, apply_palette, reduce_colors, remove_background, flip, scale, crop_to_content) over AI tools.
AI tools (generate_image, edit_image, animate) create PROPOSALS; show the numbered sheet and let the user pick, then accept_variant adds a new layer.
Never pass confirm_cost: true unless the user approved the quoted price in this conversation.
open_in_editor shows the project in Aseprite for hand drawing; edits sync back as new versions.`

/** Server instructions paragraph for the workspace detected at startup (arts newest first). */
export function workspaceInstructions(ws: Workspace, arts: ProjectInfo[]): string {
  const newest = arts
    .slice(0, 5)
    .map((p) => `${p.slug} ("${p.name}")`)
    .join(', ')
  return [
    `Active workspace: "${ws.name}" (id ${ws.id}), folder ${ws.folder}. In this session "project" in tool names means one art; the user calls the workspace their project ("Dự án").`,
    `Defaults for new art: ${describeDefaults(ws.config.defaults)}. project_create fills in missing width/height/purpose/palette from them, and new art joins this workspace.`,
    `${arts.length} art${arts.length === 1 ? '' : 's'} in this workspace${newest ? `; newest: ${newest}` : ''}.`,
    'The brief is in AGENTS.md in the workspace folder (workspace_info shows it too); the art catalog is .squarel/arts.md. Follow the brief and do not ask again for what it already decides.',
    "project_list shows only this workspace's art; project_list with all: true shows everything. workspace_add_art moves an art into this workspace.",
  ].join('\n')
}

/** SERVER_INSTRUCTIONS, plus the workspace paragraph when one is active. */
export function serverInstructions(w?: { workspace: Workspace; arts: ProjectInfo[] }): string {
  return w ? `${SERVER_INSTRUCTIONS}\n\n${workspaceInstructions(w.workspace, w.arts)}` : SERVER_INSTRUCTIONS
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
