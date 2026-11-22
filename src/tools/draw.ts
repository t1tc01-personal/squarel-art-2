import { z } from 'zod'
import {
  addFrame,
  addLayer,
  findFrame,
  findLayer,
  getCel,
  mergeDown,
  removeFrame,
  removeLayer,
  reorderLayer,
  resolveColor,
} from '../core/doc.ts'
import { ellipse, floodFill, line, rect, setPixel } from '../core/draw.ts'
import { setPaletteColor } from '../core/ops.ts'
import { colorArg, frameArg, layerArg, mutate, previewArg, projectArg } from './common.ts'
import { defineTool, ToolError } from './types.ts'

const point = z.tuple([z.number().int(), z.number().int()])

const drawOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('set'), points: z.array(point).min(1).max(4096), color: colorArg }),
  z.object({ op: z.literal('line'), from: point, to: point, color: colorArg }),
  z.object({
    op: z.literal('rect'),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    color: colorArg,
    fill: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('ellipse'),
    x: z.number().int(),
    y: z.number().int(),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
    color: colorArg,
    fill: z.boolean().optional(),
  }),
  z.object({
    op: z.literal('fill'),
    x: z.number().int(),
    y: z.number().int(),
    color: colorArg,
    contiguous: z.boolean().optional().describe('false = replace that color everywhere on the layer'),
  }),
])

export const drawTools = [
  defineTool({
    name: 'draw_pixels',
    title: 'Draw pixels',
    description:
      'Draw directly on a layer: set points, lines, rectangles, ellipses, flood fill. Coordinates are 0-based, x right, y down. Use canvas_view with coords first. Free and exact — prefer this for small, precise edits.',
    input: z.object({
      project: projectArg,
      layer: layerArg.describe('Layer id or name (default: top layer)'),
      frame: frameArg,
      ops: z.array(drawOp).min(1).max(200),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `draw ${i.ops.length} op(s)`,
        (doc) => {
          const layer = findLayer(doc, i.layer)
          if (layer.locked) throw new ToolError('INVALID', `layer "${layer.name}" is locked`)
          const frame = findFrame(doc, i.frame)
          const c = { data: getCel(doc, layer.id, frame.id), width: doc.width, height: doc.height }
          let n = 0
          for (const op of i.ops) {
            const v = resolveColor(doc, op.color)
            if (op.op === 'set') for (const [x, y] of op.points) n += setPixel(c, x, y, v)
            else if (op.op === 'line') n += line(c, op.from[0], op.from[1], op.to[0], op.to[1], v)
            else if (op.op === 'rect') n += rect(c, op.x, op.y, op.w, op.h, v, op.fill ?? false)
            else if (op.op === 'ellipse') n += ellipse(c, op.x, op.y, op.w, op.h, v, op.fill ?? false)
            else n += floodFill(c, op.x, op.y, v, op.contiguous ?? true)
          }
          return `Changed ${n} pixel(s) on layer "${layer.name}", frame ${doc.frames.indexOf(frame)}.`
        },
        { preview: i.preview, frame: i.frame },
      )
    },
  }),
  defineTool({
    name: 'layer_add',
    title: 'Add layer',
    description: 'Add an empty layer (on top, or above a given layer).',
    input: z.object({
      project: projectArg,
      name: z.string().min(1).max(60),
      above: layerArg,
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `add layer ${i.name}`,
        (doc) => {
          const above = i.above ? findLayer(doc, i.above).id : undefined
          const l = addLayer(doc, { name: i.name, aboveId: above, origin: 'claude' })
          return `Added layer "${l.name}" (id ${l.id}).`
        },
        { preview: i.preview ?? 0 },
      )
    },
  }),
  defineTool({
    name: 'layer_remove',
    title: 'Remove layer',
    description: 'Delete a layer (it stays recoverable through history/undo).',
    input: z.object({ project: projectArg, layer: z.string(), preview: previewArg }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `remove layer ${i.layer}`,
        (doc) => {
          const l = findLayer(doc, i.layer)
          removeLayer(doc, l.id)
          return `Removed layer "${l.name}".`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'layer_merge_down',
    title: 'Merge layer down',
    description: 'Merge a layer into the one below it (e.g. after accepting an AI proposal).',
    input: z.object({ project: projectArg, layer: z.string(), preview: previewArg }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `merge ${i.layer}`,
        (doc) => {
          const l = findLayer(doc, i.layer)
          mergeDown(doc, l.id)
          return `Merged "${l.name}" down.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'layer_reorder',
    title: 'Reorder layer',
    description: 'Move a layer to an index (0 = bottom).',
    input: z.object({
      project: projectArg,
      layer: z.string(),
      to_index: z.number().int().min(0),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `move ${i.layer}`,
        (doc) => {
          const l = findLayer(doc, i.layer)
          reorderLayer(doc, l.id, i.to_index)
          return `Moved "${l.name}" to index ${doc.layers.indexOf(l)}.`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'layer_set',
    title: 'Set layer properties',
    description: 'Rename, hide/show, change opacity (0-255) or lock a layer.',
    input: z.object({
      project: projectArg,
      layer: z.string(),
      name: z.string().min(1).max(60).optional(),
      visible: z.boolean().optional(),
      opacity: z.number().int().min(0).max(255).optional(),
      locked: z.boolean().optional(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `layer ${i.layer} props`,
        (doc) => {
          const l = findLayer(doc, i.layer)
          if (i.name !== undefined) l.name = i.name
          if (i.visible !== undefined) l.visible = i.visible
          if (i.opacity !== undefined) l.opacity = i.opacity
          if (i.locked !== undefined) l.locked = i.locked
          return `Updated layer "${l.name}".`
        },
        { preview: i.preview },
      )
    },
  }),
  defineTool({
    name: 'frame_add',
    title: 'Add frame',
    description: 'Append an animation frame (empty or copied from another frame).',
    input: z.object({
      project: projectArg,
      duration_ms: z.number().int().min(10).max(10000).optional(),
      copy_from: frameArg,
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        'add frame',
        (doc) => {
          const from = i.copy_from !== undefined ? findFrame(doc, i.copy_from).id : undefined
          addFrame(doc, { durationMs: i.duration_ms, copyFromId: from })
          return `Added frame ${doc.frames.length - 1}.`
        },
        { preview: i.preview ?? 0 },
      )
    },
  }),
  defineTool({
    name: 'frame_remove',
    title: 'Remove frame',
    description: 'Delete an animation frame by index.',
    input: z.object({ project: projectArg, frame: z.number().int().min(0), preview: previewArg }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `remove frame ${i.frame}`,
        (doc) => {
          removeFrame(doc, findFrame(doc, i.frame).id)
          return `Removed frame ${i.frame}; ${doc.frames.length} left.`
        },
        { preview: i.preview ?? 0 },
      )
    },
  }),
  defineTool({
    name: 'frame_set',
    title: 'Set frame duration',
    description: 'Change how long a frame shows (ms).',
    input: z.object({
      project: projectArg,
      frame: z.number().int().min(0),
      duration_ms: z.number().int().min(10).max(10000),
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `frame ${i.frame} duration`,
        (doc) => {
          findFrame(doc, i.frame).durationMs = i.duration_ms
          return `Frame ${i.frame} now lasts ${i.duration_ms}ms.`
        },
        { preview: 0 },
      )
    },
  }),
  defineTool({
    name: 'palette_set_color',
    title: 'Change palette color',
    description: 'Change one palette entry; every pixel using that index changes color.',
    input: z.object({
      project: projectArg,
      index: z.number().int().min(1).max(255),
      color: z.string(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      return mutate(
        ctx,
        i.project,
        `palette ${i.index} → ${i.color}`,
        (doc) => {
          setPaletteColor(doc, i.index, i.color)
          return `Palette index ${i.index} is now ${doc.palette[i.index]}.`
        },
        { preview: i.preview },
      )
    },
  }),
]
