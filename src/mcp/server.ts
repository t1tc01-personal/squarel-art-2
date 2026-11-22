import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { ALL_TOOLS, runTool } from '../tools/registry.ts'
import { type ToolContext, ToolError } from '../tools/types.ts'

export const SERVER_INSTRUCTIONS = `Squarel Art: pixel-art toolkit.
Workflow: project_list/project_open or project_create → canvas_view (look before and after changes) → edit → export.
Prefer free deterministic tools (draw_pixels, recolor, add_outline, apply_palette, reduce_colors, remove_background, flip, scale, crop_to_content) over AI tools.
AI tools (generate_image, edit_image, animate) create PROPOSALS; show the numbered sheet and let the user pick, then accept_variant adds a new layer.
Never pass confirm_cost: true unless the user approved the quoted price in this conversation.
open_in_editor shows the project in Aseprite for hand drawing; edits sync back as new versions.`

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

export function createMcpServer(ctx: ToolContext, version = '0.1.0'): McpServer {
  const server = new McpServer({ name: 'squarel', version }, { instructions: SERVER_INSTRUCTIONS })
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
          return toMcpResult(await runTool(tool.name, args, callCtx))
        } catch (e) {
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
