import { z } from 'zod'
import { createDoc, docSummary, usedColorIndices } from '../core/doc.ts'
import { encodePng } from '../core/png.ts'
import { paletteSwatches, renderDoc } from '../core/preview.ts'
import { PALETTES } from '../shared/palettes.ts'
import { MAX_SIDE, PURPOSES } from '../shared/types.ts'
import type { ProjectInfo } from '../store/store.ts'
import { describeDefaults } from '../store/workspace.ts'
import {
  artArg,
  artSlug,
  artStore,
  currentWorkspace,
  frameArg,
  layerArg,
  preview,
  previewArg,
} from './common.ts'
import { defineTool, ToolError } from './types.ts'

const SIZE_HINT =
  'Typical sizes: game sprites 16/32/64, print 64–128, avatars/emoji 32–128, bead patterns 29/58 (pegboard multiples).'

export const projectTools = [
  defineTool({
    name: 'art_list',
    title: 'List arts',
    description:
      'List the arts of the current project, most recently changed first. With legacy: true, list the older arts that still wait in DATA_DIR/projects (works outside a project too).',
    input: z.object({
      legacy: z.boolean().optional().describe('List the legacy arts in DATA_DIR/projects instead'),
    }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const ws = ctx.session.workspace
      const list = await (i.legacy ? ctx.legacy : artStore(ctx)).listProjects()
      const line = (p: ProjectInfo) =>
        `${p.slug === ctx.session.activeProject ? '* ' : '- '}${p.slug} - "${p.name}" (${p.purpose}, head ${p.head}, updated ${p.updatedAt})`
      if (i.legacy) {
        if (!list.length) return { text: 'No legacy art in DATA_DIR/projects.', data: [] }
        return {
          text: `Legacy arts (read-only; inside a project, art_import moves one in):\n${list.map(line).join('\n')}`,
          data: list,
        }
      }
      if (!list.length)
        return { text: `No art in project "${ws?.name}" yet. Create one with art_create.`, data: [] }
      return { text: `Project "${ws?.name}":\n${list.map(line).join('\n')}`, data: list }
    },
  }),
  defineTool({
    name: 'art_create',
    title: 'Create art',
    description: `Create a new pixel-art canvas in the current project and make it the active art. Width, height, purpose and palette default to the project's defaults. ${SIZE_HINT} Palette presets: ${Object.keys(PALETTES).join(', ')}.`,
    input: z.object({
      name: z.string().min(1).max(80),
      width: z
        .number()
        .int()
        .min(1)
        .max(MAX_SIDE)
        .optional()
        .describe('Required unless the project has a default'),
      height: z
        .number()
        .int()
        .min(1)
        .max(MAX_SIDE)
        .optional()
        .describe('Required unless the project has a default'),
      purpose: z
        .enum(PURPOSES as ['game', 'print', 'digital', 'craft'])
        .optional()
        .describe('Default: the project default, else game'),
      palette: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('Preset name or list of "#rrggbb" colors (default: the project default, else pico8)'),
      max_colors: z.number().int().min(2).max(255).optional().describe('Keep the palette at most this big'),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      const store = artStore(ctx)
      const ws = await currentWorkspace(ctx)
      const d = ws?.config.defaults
      const width = i.width ?? d?.width
      const height = i.height ?? d?.height
      if (!width || !height)
        throw new ToolError(
          'INVALID',
          ws
            ? `width and height are required: project "${ws.name}" has no default size (defaults: ${describeDefaults(d)})`
            : 'width and height are required',
        )
      const doc = createDoc({
        width,
        height,
        purpose: i.purpose ?? d?.purpose ?? 'game',
        palette: i.palette ?? d?.palette,
        title: i.name,
      })
      if (i.max_colors) doc.meta.maxColors = i.max_colors
      const info = await store.createProject({
        name: i.name,
        doc,
        source: ctx.source,
      })
      ctx.session.activeProject = info.slug
      ctx.onCommit?.(info.slug, info.head)
      return {
        text: `Created "${info.name}" as art "${info.slug}" (now active${ws ? `, in project "${ws.name}"` : ''}).\nFolder: ${store.projectPath(info.slug)}\n${docSummary(doc)}`,
        images: preview(ctx, doc, i.preview),
        data: info,
      }
    },
  }),
  defineTool({
    name: 'art_open',
    title: 'Open art',
    description: 'Make an art the active one for later tool calls and show it.',
    input: z.object({ art: z.string(), preview: previewArg }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      ctx.session.activeProject = slug
      const { versionId, doc } = await artStore(ctx).readHead(slug)
      const open = await artStore(ctx).listProposals(slug, 'open')
      return {
        text: `Active art: ${slug} (head ${versionId})\n${docSummary(doc)}${open.length ? `\nOpen AI proposals: ${open.map((p) => p.id).join(', ')}` : ''}`,
        images: preview(ctx, doc, i.preview),
        data: { art: slug, version: versionId },
      }
    },
  }),
  defineTool({
    name: 'art_info',
    title: 'Art info',
    description: 'Size, palette, layers, frames, head version and folder of an art (text only).',
    input: z.object({ art: artArg }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const store = artStore(ctx)
      const folder = store.projectPath(slug)
      const { versionId, doc } = await store.readHead(slug)
      return {
        text: `Art ${slug}, head ${versionId}\nFolder: ${folder}\n${docSummary(doc)}\nframes: ${doc.frames.map((f, n) => `${n}:${f.durationMs}ms`).join(' ')}`,
        data: {
          art: slug,
          folder,
          version: versionId,
          width: doc.width,
          height: doc.height,
          palette: doc.palette,
          layers: doc.layers,
          frames: doc.frames,
          usedColors: usedColorIndices(doc).size,
        },
      }
    },
  }),
  defineTool({
    name: 'canvas_view',
    title: 'View canvas',
    description:
      'Render the canvas as an image so you can see it. Use grid/coords to point at exact pixels (x right, y down, 0-based). Keep size small to save context.',
    input: z.object({
      art: artArg,
      size: z.number().int().min(32).max(512).optional().describe('Longest side in px (default 256)'),
      layer: layerArg.describe('Show only this layer'),
      frame: frameArg,
      grid: z.boolean().optional(),
      coords: z.boolean().optional().describe('Add rulers with pixel coordinates'),
    }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const { versionId, doc } = await artStore(ctx).readHead(slug)
      const frame = doc.frames[i.frame ?? 0]
      if (!frame)
        throw new ToolError('INVALID', `frame ${i.frame} out of range (0..${doc.frames.length - 1})`)
      const layer = i.layer ? doc.layers.find((l) => l.id === i.layer || l.name === i.layer) : undefined
      if (i.layer && !layer) throw new ToolError('NOT_FOUND', `layer "${i.layer}" not found`)
      const r = renderDoc(doc, {
        maxSide: i.size ?? ctx.config.previewPx,
        frameId: frame.id,
        layerId: layer?.id,
        grid: i.grid ?? doc.width <= 64,
        coords: i.coords,
      })
      return {
        text: `${slug} @ ${versionId}: ${doc.width}×${doc.height}, frame ${i.frame ?? 0}${layer ? `, layer ${layer.name}` : ''}`,
        images: [{ png: encodePng(r), alt: `canvas of ${slug}` }],
      }
    },
  }),
  defineTool({
    name: 'palette_view',
    title: 'View palette',
    description: 'Show palette colors with their indices (index 0 is transparent and not shown).',
    input: z.object({ art: artArg }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const { doc } = await artStore(ctx).readHead(slug)
      const used = usedColorIndices(doc)
      return {
        text: doc.palette
          .map((c, n) =>
            n === 0
              ? '0: transparent'
              : `${n}: ${c.slice(0, 7)}${c.endsWith('ff') ? '' : ` alpha ${c.slice(7)}`}${used.has(n) ? '' : ' (unused)'}`,
          )
          .join('\n'),
        images: [{ png: encodePng(paletteSwatches(doc.palette)), alt: 'palette swatches' }],
        data: doc.palette,
      }
    },
  }),
]
