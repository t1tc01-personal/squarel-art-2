import sharp from 'sharp'
import { z } from 'zod'
import { encodePng } from '../core/png.ts'
import { renderDoc } from '../core/preview.ts'
import type { PixelDoc } from '../shared/types.ts'
import { readWorkspace, type Workspace } from '../store/workspace.ts'
import { type ToolContext, ToolError, type ToolImage, type ToolResult } from './types.ts'

export const projectArg = z
  .string()
  .optional()
  .describe('Project slug. Defaults to the project opened with project_open / project_create.')

export const previewArg = z
  .number()
  .int()
  .min(0)
  .max(512)
  .optional()
  .describe('Size (px, longest side) of the preview image returned; 0 = no image. Default 256.')

export const colorArg = z
  .union([z.string(), z.number().int().min(0).max(255)])
  .describe('Color as "#rrggbb" / "#rrggbbaa", a palette index, or "transparent"')

export const layerArg = z.string().optional().describe('Layer id or name (default depends on the tool)')
export const frameArg = z.number().int().min(0).optional().describe('Frame index (default 0)')

export async function projectSlug(ctx: ToolContext, project?: string): Promise<string> {
  const slug = project ?? ctx.session.activeProject
  if (!slug)
    throw new ToolError(
      'NOT_FOUND',
      'no project selected: call project_list / project_open, or project_create first',
    )
  if (!(await ctx.store.hasProject(slug)))
    throw new ToolError('NOT_FOUND', `project "${slug}" not found (see project_list)`)
  return slug
}

/**
 * The session's workspace, re-read from its `.squarel/project.json` so launcher edits apply without a
 * restart. Falls back to the copy detected at startup when the file is momentarily unreadable.
 */
export async function currentWorkspace(ctx: ToolContext): Promise<Workspace | undefined> {
  const ws = ctx.session.workspace
  if (!ws) return undefined
  try {
    const fresh = await readWorkspace(ws.folder)
    if (fresh.id === ws.id) {
      ctx.session.workspace = fresh
      return fresh
    }
  } catch (e) {
    ctx.log.warn('workspace re-read failed; using the startup copy', { error: String(e) })
  }
  return ws
}

export function preview(
  ctx: ToolContext,
  doc: PixelDoc,
  size?: number,
  o: { grid?: boolean; frame?: number } = {},
): ToolImage[] {
  const px = size ?? ctx.config.previewPx
  if (px <= 0) return []
  const frame = doc.frames[o.frame ?? 0] ?? doc.frames[0]
  const r = renderDoc(doc, { maxSide: px, grid: o.grid, frameId: frame.id })
  return [{ png: encodePng(r), alt: `${doc.width}×${doc.height} canvas preview` }]
}

/** Run a mutation on the head version, commit it and return a standard result. */
export async function mutate(
  ctx: ToolContext,
  project: string | undefined,
  label: string,
  fn: (doc: PixelDoc) => string | Promise<string>,
  o: { preview?: number; frame?: number } = {},
): Promise<ToolResult> {
  const slug = await projectSlug(ctx, project)
  const prefix =
    ctx.source === 'claude'
      ? 'Claude'
      : ctx.source === 'cli'
        ? 'CLI'
        : ctx.source === 'editor'
          ? 'Editor'
          : 'AI'
  const { versionId, doc, result } = await ctx.store.withHead(slug, ctx.source, `${prefix}: ${label}`, fn)
  ctx.onCommit?.(slug, versionId)
  return {
    text: `${result}\nSaved as ${versionId} in "${slug}".`,
    images: preview(ctx, doc, o.preview, { frame: o.frame }),
    data: { project: slug, version: versionId },
  }
}

export async function decodeImage(
  bytes: Uint8Array,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return {
    data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
    width: info.width,
    height: info.height,
  }
}

export function sniffExt(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'jpg'
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return 'webp'
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return 'gif'
  return 'bin'
}

export function short(s: string, n = 32): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}
