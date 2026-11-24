import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import sharp from 'sharp'
import { z } from 'zod'
import { inboxDir } from '../config.ts'
import { celKey } from '../core/codec.ts'
import { addLayer, createDoc, docSummary, resolvePaletteInput } from '../core/doc.ts'
import { findPreset, PRESETS } from '../core/export.ts'
import { normalize } from '../core/normalize.ts'
import { pasteIndexed } from '../core/ops.ts'
import { decodePng, encodePng } from '../core/png.ts'
import { renderRGBA } from '../core/preview.ts'
import { MAX_SIDE, PURPOSES, type Purpose } from '../shared/types.ts'
import { resolveExportDir, writeCatalog } from '../store/workspace.ts'
import { SQUAREL_VERSION } from '../version.ts'
import { artStore, currentWorkspace, mutate, preview, previewArg, projectArg, projectSlug } from './common.ts'
import { defineTool, ToolError } from './types.ts'

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff'])

export const historyTools = [
  defineTool({
    name: 'history',
    title: 'History',
    description: 'List recent versions (newest first) with who changed what.',
    input: z.object({ project: projectArg, limit: z.number().int().min(1).max(200).default(15) }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const slug = await projectSlug(ctx, i.project)
      const list = await artStore(ctx).history(slug, i.limit)
      return {
        text: list
          .map((v) => `${v.id}  ${v.ts.slice(0, 19).replace('T', ' ')}  [${v.source}] ${v.label}`)
          .join('\n'),
        data: list,
      }
    },
  }),
  defineTool({
    name: 'undo',
    title: 'Undo',
    description:
      'Go back one step. Creates a new version with the previous content; history is never lost (call again to keep going back).',
    input: z.object({ project: projectArg, preview: previewArg }),
    async handler(ctx, i) {
      const slug = await projectSlug(ctx, i.project)
      try {
        const r = await artStore(ctx).undo(slug, ctx.source)
        ctx.onCommit?.(slug, r.versionId)
        return {
          text: `Restored content of ${r.restored} as ${r.versionId}.`,
          images: preview(ctx, r.doc, i.preview),
        }
      } catch (e: any) {
        if (/nothing to undo/.test(e.message)) throw new ToolError('INVALID', e.message)
        throw e
      }
    },
  }),
  defineTool({
    name: 'restore_version',
    title: 'Restore version',
    description: 'Bring back any earlier version (as a new version on top).',
    input: z.object({ project: projectArg, version: z.string().regex(/^v\d{6}$/), preview: previewArg }),
    async handler(ctx, i) {
      const slug = await projectSlug(ctx, i.project)
      const r = await artStore(ctx).restore(slug, i.version, ctx.source)
      ctx.onCommit?.(slug, r.versionId)
      return { text: `Restored ${i.version} as ${r.versionId}.`, images: preview(ctx, r.doc, i.preview) }
    },
  }),
]

export const exportTools = [
  defineTool({
    name: 'export_presets',
    title: 'Export presets',
    description: 'List export presets and their options, grouped by purpose (game, print, digital, craft).',
    input: z.object({ purpose: z.enum(PURPOSES as ['game', 'print', 'digital', 'craft']).optional() }),
    annotations: { readOnly: true },
    async handler(_ctx, i) {
      const list = PRESETS.filter((p) => !i.purpose || p.purpose === i.purpose)
      return {
        text: list
          .map((p) => {
            const shape = (p.options as z.ZodObject<any>).shape ?? {}
            const opts = Object.keys(shape).join(', ')
            return `${p.id} [${p.purpose}] — ${p.label}${opts ? ` (options: ${opts})` : ''}`
          })
          .join('\n'),
        data: list.map((p) => ({ id: p.id, purpose: p.purpose, label: p.label })),
      }
    },
  }),
  defineTool({
    name: 'export',
    title: 'Export files',
    description:
      'Write production-ready files to the project exports/ folder: sprite sheets + JSON, GIF, 300-DPI print PNG, SVG, PDF, avatars, WebP stickers, bead patterns. When the art belongs to a workspace with an export folder, the files are also copied there. Returns absolute file paths.',
    input: z.object({
      project: projectArg,
      preset: z.string().describe(`One of: ${PRESETS.map((p) => p.id).join(', ')}`),
      options: z.record(z.string(), z.unknown()).optional(),
      name: z
        .string()
        .regex(/^[\w-]{1,60}$/)
        .optional()
        .describe('Base file name (default: project slug)'),
    }),
    async handler(ctx, i) {
      const slug = await projectSlug(ctx, i.project)
      let preset: ReturnType<typeof findPreset>
      try {
        preset = findPreset(i.preset)
      } catch (e: any) {
        throw new ToolError('NOT_FOUND', e.message)
      }
      const parsed = preset.options.safeParse(i.options ?? {})
      if (!parsed.success)
        throw new ToolError('INVALID', `bad options for ${preset.id}: ${parsed.error.message}`)
      const ws = await currentWorkspace(ctx)
      // A bad export folder never fails the export: files still go to exports/, the copy is skipped.
      let copyDir: string | undefined
      let copySkipped: string | undefined
      try {
        copyDir = ws ? resolveExportDir(ws) : undefined
      } catch (e: any) {
        copySkipped = `Warning: not copied to the project export folder: ${e.message}. Fix the export folder of project "${ws?.name}" in the launcher.`
      }
      const { versionId, doc } = await artStore(ctx).readHead(slug)
      const files = await preset.run(doc, parsed.data, i.name ?? slug, { appVersion: SQUAREL_VERSION })
      const paths: string[] = []
      const notes: string[] = []
      let firstImage: Uint8Array | undefined
      for (const f of files) {
        let bytes = f.bytes
        if (f.convertTo === 'webp')
          bytes = new Uint8Array(await sharp(f.bytes).webp({ lossless: true }).toBuffer())
        if (!firstImage && f.mime === 'image/png') firstImage = f.bytes
        paths.push(await artStore(ctx).writeExport(slug, f.name, bytes))
        if (f.note) notes.push(f.note)
      }
      const copies: string[] = []
      if (copyDir) {
        await mkdir(copyDir, { recursive: true })
        for (const p of paths) {
          const dest = join(copyDir, basename(p))
          await copyFile(p, dest)
          copies.push(dest)
        }
      }
      if (ws) await writeCatalog(artStore(ctx), ws, ctx.log)
      let images: { png: Uint8Array; alt: string }[] | undefined
      if (firstImage) {
        const img = decodePng(firstImage)
        images = [{ png: encodePng(renderRGBA(img, { maxSide: 192 })), alt: 'export preview' }]
      }
      return {
        text: `Exported ${preset.id} from ${versionId}:\n${paths.map((p) => `- ${p}`).join('\n')}${copies.length ? `\nAlso copied to ${copyDir}:\n${copies.map((p) => `- ${p}`).join('\n')}` : ''}${notes.length ? `\n${notes.join('\n')}` : ''}${copySkipped ? `\n${copySkipped}` : ''}`,
        files: paths,
        images,
        data: { files: paths, copies, ...(copySkipped ? { copySkipped } : {}) },
      }
    },
  }),
]

export const importTools = [
  defineTool({
    name: 'photo_to_pixel',
    title: 'Photo → pixel art',
    description:
      'Convert a local image (photo, drawing, screenshot) into pixel art without AI: resize, reduce colors, clean specks. Creates a new project or adds a layer to the active one. Free.',
    input: z.object({
      path: z.string().describe('Absolute path, or a file name inside DATA_DIR/inbox'),
      width: z.number().int().min(4).max(MAX_SIDE),
      height: z.number().int().min(4).max(MAX_SIDE).optional().describe('Default keeps the aspect ratio'),
      colors: z.number().int().min(2).max(64).default(16),
      palette: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('Force a preset or color list'),
      remove_background: z.boolean().default(false),
      as_new_project: z.boolean().default(true),
      name: z.string().max(80).optional(),
      purpose: z
        .enum(PURPOSES as ['game', 'print', 'digital', 'craft'])
        .optional()
        .describe('Purpose of a new project (default: the workspace default, else digital)'),
      project: projectArg.describe('Target project when as_new_project is false'),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      artStore(ctx)
      const file = isAbsolute(i.path) ? resolve(i.path) : join(inboxDir(ctx.config), basename(i.path))
      if (!IMAGE_EXT.has(extname(file).toLowerCase()))
        throw new ToolError('INVALID', 'only image files (png, jpg, webp, gif, bmp, tif) are accepted')
      let size: number
      try {
        size = (await stat(file)).size
      } catch {
        throw new ToolError('NOT_FOUND', `file not found: ${file}`)
      }
      if (size > 20 * 1024 * 1024) throw new ToolError('INVALID', 'image larger than 20MB')
      const meta = await sharp(file).metadata()
      const w = i.width
      const h =
        i.height ?? Math.max(1, Math.min(MAX_SIDE, Math.round((w * (meta.height ?? w)) / (meta.width ?? w))))
      const { data, info } = await sharp(file)
        .rotate()
        .resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'lanczos3' })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      let palette: string[] | undefined
      try {
        palette = i.palette ? resolvePaletteInput(i.palette) : undefined
      } catch (e: any) {
        throw new ToolError('INVALID', e.message)
      }
      const r = normalize(
        {
          data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.length),
          width: info.width,
          height: info.height,
        },
        {
          target: { width: w, height: h },
          maxColors: i.colors,
          palette,
          removeBackground: i.remove_background,
        },
      )
      const img = { width: r.width, height: r.height, palette: r.palette, pixels: r.pixels }
      if (i.as_new_project) {
        const ws = await currentWorkspace(ctx)
        const doc = createDoc({
          width: w,
          height: h,
          purpose: (i.purpose ?? ws?.config.defaults?.purpose ?? 'digital') as Purpose,
          palette: [],
          title: i.name,
        })
        doc.palette = r.palette
        doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)] = r.pixels
        doc.layers[0].name = 'Photo'
        const info2 = await artStore(ctx).createProject({
          name: i.name ?? basename(file, extname(file)),
          doc,
          source: ctx.source,
        })
        ctx.session.activeProject = info2.slug
        ctx.onCommit?.(info2.slug, info2.head)
        return {
          text: `Created project "${info2.slug}" from ${basename(file)} (${r.report.colorCount} colors).\n${docSummary(doc)}`,
          images: preview(ctx, doc, i.preview),
        }
      }
      return mutate(
        ctx,
        i.project,
        `photo ${basename(file)}`,
        (doc) => {
          const layer = addLayer(doc, { name: 'Photo', origin: 'user' })
          pasteIndexed(doc, layer.id, doc.frames[0].id, img, {
            x: Math.floor((doc.width - img.width) / 2),
            y: Math.floor((doc.height - img.height) / 2),
          })
          return `Added layer "Photo" (${r.report.colorCount} colors).`
        },
        { preview: i.preview },
      )
    },
  }),
]

export const editorTools = [
  defineTool({
    name: 'open_in_editor',
    title: 'Open in Aseprite',
    description:
      'Show the project in Aseprite for hand drawing. Changes made there sync back automatically (with the Squarel extension) or when the file is saved.',
    input: z.object({ project: projectArg }),
    async handler(ctx, i) {
      const slug = await projectSlug(ctx, i.project)
      if (!ctx.editor)
        throw new ToolError('UNAVAILABLE', 'no editor integration in this process (run `pnpm bridge`)')
      return { text: await ctx.editor.open(slug) }
    },
  }),
  defineTool({
    name: 'usage_today',
    title: 'Image API usage',
    description:
      'Spend on image providers today / this month, Cloudflare free neurons left, daily cap, configured providers.',
    input: z.object({}),
    annotations: { readOnly: true },
    async handler(ctx) {
      const s = await ctx.router.status()
      return {
        text: [
          `Today: $${s.todayUsd.toFixed(3)} of $${s.dailyBudgetUsd} cap, ${s.todayCalls} call(s); this month: $${s.monthUsd.toFixed(3)}`,
          `Cloudflare free neurons left today: ${Math.round(s.cloudflareFreeNeuronsLeft)}`,
          `Providers: ${s.providers.map((p) => `${p.id}${p.default ? ' (default)' : ''}${p.configured ? '' : ' [not configured]'}${p.paid ? ' [paid]' : ''}`).join(', ')}`,
        ].join('\n'),
        data: s,
      }
    },
  }),
]
