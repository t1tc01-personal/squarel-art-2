import sharp from 'sharp'
import { z } from 'zod'
import { encodePng } from '../core/png.ts'
import { renderDoc } from '../core/preview.ts'
import { artRef } from '../shared/ref.ts'
import type { PixelDoc } from '../shared/types.ts'
import type { Store } from '../store/store.ts'
import { readWorkspace, type Workspace } from '../store/workspace.ts'
import { type ToolContext, ToolError, type ToolImage, type ToolResult } from './types.ts'

export const NO_PROJECT_TEXT =
  'No Squarel project here. Art lives inside a project folder: create one in Squarel Art Launcher (Dự án → Dự án mới), then open Claude Code in that folder.'

/** The project's art store; art tools fail with NO_PROJECT outside a project. */
export function artStore(ctx: ToolContext): Store {
  if (!ctx.arts) throw new ToolError('NO_PROJECT', NO_PROJECT_TEXT)
  return ctx.arts
}

export const artArg = z
  .string()
  .optional()
  .describe('Art id in this project. Defaults to the art opened with art_open / art_create.')

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

export async function artSlug(ctx: ToolContext, art?: string): Promise<string> {
  const store = artStore(ctx)
  const slug = art ?? ctx.session.activeProject
  if (!slug)
    throw new ToolError('NOT_FOUND', 'no art selected: call art_list / art_open, or art_create first')
  if (!(await store.hasProject(slug)))
    throw new ToolError('NOT_FOUND', `art "${slug}" not found (see art_list)`)
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
      fresh.home = ws.home // resolved at detection (worktree → main checkout)
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
  art: string | undefined,
  label: string,
  fn: (doc: PixelDoc) => string | Promise<string>,
  o: { preview?: number; frame?: number } = {},
): Promise<ToolResult> {
  const slug = await artSlug(ctx, art)
  const prefix =
    ctx.source === 'claude'
      ? 'Claude'
      : ctx.source === 'cli'
        ? 'CLI'
        : ctx.source === 'editor'
          ? 'Editor'
          : 'AI'
  const { versionId, doc, result } = await artStore(ctx).withHead(slug, ctx.source, `${prefix}: ${label}`, fn)
  ctx.onCommit?.(slug, versionId)
  return {
    text: `${result}\nSaved as ${versionId} in "${slug}".`,
    images: preview(ctx, doc, o.preview, { frame: o.frame }),
    data: {
      art: slug,
      ref: ctx.session.workspace ? artRef(ctx.session.workspace.id, slug) : slug,
      version: versionId,
    },
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
