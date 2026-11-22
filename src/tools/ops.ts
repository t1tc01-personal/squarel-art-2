import { z } from 'zod'
import { resolvePaletteInput } from '../core/doc.ts'
import {
  addOutline,
  applyPalette,
  cropToContent,
  flip,
  recolor,
  reduceColors,
  removeBackground,
  resizeCanvas,
  rotate90,
  scaleTo,
  shiftHue,
} from '../core/ops.ts'
import { PALETTES } from '../shared/palettes.ts'
import { MAX_SIDE } from '../shared/types.ts'
import { colorArg, layerArg, mutate, previewArg, projectArg } from './common.ts'
import { defineTool, ToolError } from './types.ts'

const FREE = 'Deterministic, instant and free (no AI).'

export const opsTools = [
  defineTool({
    name: 'recolor',
    title: 'Recolor',
    description: `Replace one color with another on one or all layers. ${FREE}`,
    input: z.object({
      project: projectArg,
      from: colorArg,
      to: colorArg,
      layer: layerArg.describe('Only this layer (default all)'),
      tolerance: z
        .number()
        .min(0)
        .max(0.5)
        .optional()
        .describe('OKLab distance to also catch similar shades (e.g. 0.05)'),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `recolor ${i.from} → ${i.to}`,
        (doc) => {
          const n = recolor(doc, i.from, i.to, { layer: i.layer, tolerance: i.tolerance })
          return `Recolored ${n} pixel(s).`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'apply_palette',
    title: 'Apply palette',
    description: `Map the artwork onto a palette preset (${Object.keys(PALETTES).join(', ')}) or a list of colors, optionally with ordered dithering. ${FREE}`,
    input: z.object({
      project: projectArg,
      palette: z.union([z.string(), z.array(z.string()).min(1).max(255)]),
      dither: z.boolean().optional(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `apply palette ${typeof i.palette === 'string' ? i.palette : `${i.palette.length} colors`}`,
        (doc) => {
          let colors: string[]
          try {
            colors = resolvePaletteInput(i.palette)
          } catch (e: any) {
            throw new ToolError('INVALID', e.message)
          }
          applyPalette(doc, colors, { dither: i.dither })
          return `Applied palette; ${doc.palette.length - 1} color(s) in use.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'reduce_colors',
    title: 'Reduce colors',
    description: `Reduce the artwork to at most n colors (perceptual k-means). ${FREE}`,
    input: z.object({ project: projectArg, n: z.number().int().min(1).max(255), preview: previewArg }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `reduce to ${i.n} colors`,
        (doc) => {
          const before = doc.palette.length - 1
          reduceColors(doc, i.n)
          return `Palette ${before} → ${doc.palette.length - 1} color(s).`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'add_outline',
    title: 'Add outline',
    description: `Draw a 1px outline around the visible sprite (outer) or along its inner edge. Written into the given layer (default top). ${FREE}`,
    input: z.object({
      project: projectArg,
      color: colorArg,
      mode: z.enum(['outer', 'inner']).default('outer'),
      diagonal: z.boolean().optional().describe('Also outline diagonally (thicker look)'),
      layer: layerArg,
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `${i.mode} outline ${i.color}`,
        (doc) => {
          const n = addOutline(doc, i.color, { mode: i.mode, diagonal: i.diagonal, layer: i.layer })
          return `Outlined ${n} pixel(s).`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'remove_background',
    title: 'Remove background',
    description: `Clear the flat background color connected to the canvas edges. ${FREE}`,
    input: z.object({
      project: projectArg,
      layer: layerArg.describe('Only this layer (default all)'),
      tolerance: z.number().min(0).max(0.5).optional(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        'remove background',
        (doc) => `Cleared ${removeBackground(doc, i)} pixel(s).`,
        {
          preview: i.preview,
        },
      )
    },
  }),
  defineTool({
    name: 'resize_canvas',
    title: 'Resize canvas',
    description: `Change canvas size without scaling the art (crop or pad around an anchor). ${FREE}`,
    input: z.object({
      project: projectArg,
      width: z.number().int().min(1).max(MAX_SIDE),
      height: z.number().int().min(1).max(MAX_SIDE),
      anchor: z
        .enum([
          'center',
          'top-left',
          'top',
          'top-right',
          'left',
          'right',
          'bottom-left',
          'bottom',
          'bottom-right',
        ])
        .default('center'),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `canvas ${i.width}×${i.height}`,
        (doc) => {
          resizeCanvas(doc, i.width, i.height, i.anchor)
          return `Canvas is now ${doc.width}×${doc.height}.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'scale',
    title: 'Scale artwork',
    description: `Nearest-neighbor scale the whole artwork (integer factor or exact size). ${FREE}`,
    input: z.object({
      project: projectArg,
      factor: z.number().positive().optional(),
      width: z.number().int().min(1).max(MAX_SIDE).optional(),
      height: z.number().int().min(1).max(MAX_SIDE).optional(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        'scale',
        (doc) => {
          const w = i.width ?? (i.factor ? Math.round(doc.width * i.factor) : undefined)
          const h = i.height ?? (i.factor ? Math.round(doc.height * i.factor) : undefined)
          if (!w || !h) throw new ToolError('INVALID', 'give factor, or width and height')
          scaleTo(doc, w, h)
          return `Scaled to ${w}×${h}.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'flip',
    title: 'Flip',
    description: `Mirror horizontally or vertically (one layer or all). ${FREE}`,
    input: z.object({
      project: projectArg,
      axis: z.enum(['horizontal', 'vertical']),
      layer: layerArg,
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `flip ${i.axis}`,
        (doc) => {
          flip(doc, i.axis, i.layer)
          return `Flipped ${i.axis}.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'rotate90',
    title: 'Rotate 90°',
    description: `Rotate the whole canvas 90° clockwise or counter-clockwise. ${FREE}`,
    input: z.object({
      project: projectArg,
      direction: z.enum(['cw', 'ccw']).default('cw'),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `rotate ${i.direction}`,
        (doc) => {
          rotate90(doc, i.direction)
          return `Rotated ${i.direction}; canvas ${doc.width}×${doc.height}.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'crop_to_content',
    title: 'Crop to content',
    description: `Trim empty borders (optionally keep padding). ${FREE}`,
    input: z.object({
      project: projectArg,
      padding: z.number().int().min(0).max(64).default(0),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        'crop to content',
        (doc) => {
          try {
            cropToContent(doc, i.padding)
          } catch (e: any) {
            throw new ToolError('INVALID', e.message)
          }
          return `Cropped to ${doc.width}×${doc.height}.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'shift_hue',
    title: 'Shift hue',
    description: `Rotate the hue of all palette colors (or selected indices). ${FREE}`,
    input: z.object({
      project: projectArg,
      degrees: z.number().min(-360).max(360),
      indices: z.array(z.number().int().min(1).max(255)).optional(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `hue ${i.degrees}°`,
        (doc) => `Shifted ${shiftHue(doc, i.degrees, i.indices)} color(s).`,
        {
          preview: i.preview,
        },
      )
    },
  }),
]
