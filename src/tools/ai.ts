import sharp from 'sharp'
import { z } from 'zod'
import { decodeCel, encodeCel } from '../core/codec.ts'
import { parseHex } from '../core/color.ts'
import { addFrame, addLayer, composeFrame, newId, usedColorIndices } from '../core/doc.ts'
import { type NormalizeReport, normalize } from '../core/normalize.ts'
import { compactPalette, pasteIndexed } from '../core/ops.ts'
import { encodePng } from '../core/png.ts'
import { contactSheet, type Raster } from '../core/preview.ts'
import { BudgetError } from '../providers/router.ts'
import {
  type GenRequest,
  type ImageProvider,
  ProviderError,
  type Quote,
  type RawImage,
  type Task,
} from '../providers/types.ts'
import { paletteColors } from '../shared/palettes.ts'
import type { PixelDoc, Rect } from '../shared/types.ts'
import type { ProposalMeta } from '../store/store.ts'
import { artArg, artSlug, artStore, decodeImage, mutate, previewArg, short, sniffExt } from './common.ts'
import { defineTool, type ToolContext, ToolError, type ToolResult } from './types.ts'

const COST_NOTE =
  'quality "free" uses free providers (Cloudflare free tier / local GPU / mock). quality "high" uses Retro Diffusion (paid): the first call returns a price, ask the user, then call again with confirm_cost: true.'

const qualityArg = z.enum(['free', 'high']).default('free')
const providerArg = z
  .enum(['cloudflare', 'retrodiffusion', 'local-sd', 'mock'])
  .optional()
  .describe('Force a provider (normally chosen automatically)')
const confirmArg = z
  .boolean()
  .optional()
  .describe('Required true for paid providers, after the user approved the quoted price')

interface VariantData {
  width: number
  height: number
  palette: string[]
  frames: string[]
  region?: Rect
}

function paletteInput(doc: PixelDoc, p: string | string[] | undefined): string[] | undefined {
  if (p === undefined || p === 'auto') return undefined
  if (p === 'doc') return doc.palette.slice(1).filter((c) => !c.endsWith('00'))
  if (typeof p === 'string') {
    const c = paletteColors(p)
    if (!c)
      throw new ToolError(
        'INVALID',
        `unknown palette "${p}" (use a preset name, "doc", "auto" or a color list)`,
      )
    return c
  }
  return p
}

/** Pick provider, enforce cost confirmation + budget, run with fallback. */
async function runProvider(
  ctx: ToolContext,
  task: Task,
  quality: 'free' | 'high',
  explicit: ImageProvider['id'] | undefined,
  confirmCost: boolean | undefined,
  variants: number,
  call: (p: ImageProvider) => Promise<RawImage[]>,
  project: string,
  quoteReq: GenRequest,
): Promise<{ provider: ImageProvider; images: RawImage[]; quote: Quote; usd: number }> {
  let chain: ImageProvider[]
  try {
    chain = await ctx.router.chain(task, quality, explicit)
  } catch (e: any) {
    throw new ToolError('UNAVAILABLE', e.message)
  }
  let lastErr: unknown
  for (const p of chain) {
    let quote: Quote
    try {
      quote = await p.quote(task, quoteReq)
    } catch (e: any) {
      lastErr = e
      continue
    }
    if (p.capabilities.paid && !confirmCost)
      throw new ToolError(
        'NEEDS_CONFIRM',
        `${p.id} is a paid provider: estimated $${quote.usd.toFixed(3)} (${quote.units} ${quote.unitKind}s) for ${variants} variant(s). Ask the user to approve this price, then call again with confirm_cost: true.`,
        { provider: p.id, quote },
      )
    let usd: number
    try {
      usd = (await ctx.router.checkBudget(quote)).effectiveUsd
    } catch (e) {
      if (e instanceof BudgetError) throw new ToolError('BUDGET', e.message)
      throw e
    }
    try {
      ctx.progress?.(0, variants, `calling ${p.id}`)
      const images = await call(p)
      await ctx.router.record({
        provider: p.id,
        model: quote.model,
        op: task,
        units: quote.units,
        unitKind: quote.unitKind,
        usd,
        project,
        ok: true,
      })
      return { provider: p, images, quote, usd }
    } catch (e: any) {
      lastErr = e
      await ctx.router.record({
        provider: p.id,
        model: quote.model,
        op: task,
        units: 0,
        unitKind: quote.unitKind,
        usd: 0,
        project,
        ok: false,
      })
      ctx.log.warn('provider failed, trying next', { provider: p.id, error: e?.message })
      if (p.capabilities.paid) break // never fall through from a paid call to another provider silently
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr)
  throw new ToolError('PROVIDER', `all providers failed: ${msg}`)
}

async function normalizeRaw(
  bytes: Uint8Array,
  doc: PixelDoc,
  palette: string[] | undefined,
  maxColors: number,
): Promise<{ data: VariantData; report: NormalizeReport }> {
  const img = await decodeImage(bytes)
  const r = normalize(img, { target: { width: doc.width, height: doc.height }, palette, maxColors })
  return {
    data: { width: r.width, height: r.height, palette: r.palette, frames: [encodeCel(r.pixels)] },
    report: r.report,
  }
}

function variantRaster(v: VariantData, frame = 0): Raster {
  const pix = decodeCel(v.frames[frame], v.width * v.height)
  const pal = v.palette.map(parseHex)
  const data = new Uint8ClampedArray(v.width * v.height * 4)
  for (let p = 0; p < pix.length; p++) if (pix[p]) data.set(pal[pix[p]], p * 4)
  return { data, width: v.width, height: v.height }
}

async function saveProposal(
  ctx: ToolContext,
  slug: string,
  base: Omit<ProposalMeta, 'variants' | 'id' | 'createdAt' | 'status'>,
  raws: RawImage[],
  variants: { data: VariantData; report: NormalizeReport }[],
): Promise<ToolResult> {
  const id = newId('p')
  const files: Record<string, Uint8Array | string> = {}
  const meta: ProposalMeta = {
    ...base,
    id,
    createdAt: new Date().toISOString(),
    status: 'open',
    variants: variants.map((v, n) => {
      const ext = sniffExt(raws[n]?.bytes ?? new Uint8Array())
      files[`raw-${n + 1}.${ext}`] = raws[n]?.bytes ?? new Uint8Array()
      files[`v${n + 1}.json`] = JSON.stringify(v.data)
      return { n: n + 1, raw: `raw-${n + 1}.${ext}`, normalized: `v${n + 1}.json`, metrics: v.report }
    }),
  }
  const sheet = contactSheet(
    variants.map((v) => variantRaster(v.data)),
    variants.length > 2 ? 128 : 192,
  )
  files['sheet.png'] = encodePng(sheet)
  await artStore(ctx).saveProposal(slug, meta, files)
  const lines = meta.variants.map(
    (v) =>
      `  ${v.n}: ${v.metrics.colorCount} colors, grid confidence ${v.metrics.gridConfidence}${v.metrics.warnings.length ? ` ⚠ ${v.metrics.warnings.join('; ')}` : ''}`,
  )
  return {
    text: [
      `Proposal ${id} (${meta.kind}, ${meta.provider}/${meta.model}, cost ~$${meta.costUsd.toFixed(3)}):`,
      ...lines,
      `Nothing on the canvas changed yet. Show the user the numbered sheet and call accept_variant(proposal: "${id}", variant: N) — it is added as a NEW layer — or discard_proposal.`,
    ].join('\n'),
    images: [{ png: files['sheet.png'] as Uint8Array, alt: `numbered variants of proposal ${id}` }],
    data: meta,
  }
}

/** Upscale an RGBA raster with integer nearest-neighbor; transparent → magenta so models see a flat bg. */
async function providerInput(r: Raster, target = 512): Promise<Uint8Array> {
  const scale = Math.max(1, Math.floor(target / Math.max(r.width, r.height)))
  const w = r.width * scale
  const h = r.height * scale
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (Math.floor(y / scale) * r.width + Math.floor(x / scale)) * 4
      const oi = (y * w + x) * 4
      if (r.data[si + 3] < 128) out.set([255, 0, 255, 255], oi)
      else out.set([r.data[si], r.data[si + 1], r.data[si + 2], 255], oi)
    }
  return encodePng({ data: out, width: w, height: h })
}

function maskPng(doc: PixelDoc, region: Rect, target = 512): Uint8Array {
  const scale = Math.max(1, Math.floor(target / Math.max(doc.width, doc.height)))
  const w = doc.width * scale
  const h = doc.height * scale
  const out = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const px = Math.floor(x / scale)
      const py = Math.floor(y / scale)
      const on = px >= region.x && py >= region.y && px < region.x + region.w && py < region.y + region.h
      out.set(on ? [255, 255, 255, 255] : [0, 0, 0, 255], (y * w + x) * 4)
    }
  return encodePng({ data: out, width: w, height: h })
}

const regionArg = z
  .object({
    x: z.number().int().min(0),
    y: z.number().int().min(0),
    w: z.number().int().min(1),
    h: z.number().int().min(1),
  })
  .optional()
  .describe('Only change this rectangle (pixels outside stay untouched)')

export const aiTools = [
  defineTool({
    name: 'generate_image',
    title: 'Generate pixel art (AI)',
    description: `Generate pixel-art variants for the active art's canvas size. Results are cleaned to a true pixel grid and palette and stored as a PROPOSAL (canvas unchanged until accept_variant). ${COST_NOTE}`,
    input: z.object({
      art: artArg,
      prompt: z.string().min(2).max(500).describe('Subject and style, in English for best results'),
      palette: z
        .union([z.string(), z.array(z.string())])
        .optional()
        .describe('"auto" (default), "doc" = current palette, a preset name, or colors'),
      max_colors: z.number().int().min(2).max(64).default(16),
      variants: z.number().int().min(1).max(4).default(4),
      quality: qualityArg,
      provider: providerArg,
      confirm_cost: confirmArg,
      seed: z.number().int().optional(),
    }),
    annotations: { openWorld: true, costly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const { versionId, doc } = await artStore(ctx).readHead(slug)
      const palette = paletteInput(doc, i.palette)
      const req = {
        prompt: i.prompt,
        width: doc.width,
        height: doc.height,
        palette,
        variants: i.variants,
        seed: i.seed,
      }
      const run = await runProvider(
        ctx,
        'generate',
        i.quality,
        i.provider,
        i.confirm_cost,
        i.variants,
        (p) => p.generate(req, ctx.signal),
        slug,
        req,
      )
      const variants = []
      for (const [n, raw] of run.images.entries()) {
        let v = await normalizeRaw(raw.bytes, doc, palette, i.max_colors)
        if (
          v.report.gridConfidence < 0.6 &&
          !run.provider.capabilities.paid &&
          !run.provider.capabilities.nativePixel
        ) {
          // one free retry with a different seed
          try {
            const [again] = await run.provider.generate(
              { ...req, variants: 1, seed: (raw.seed ?? n) + 7777 },
              ctx.signal,
            )
            const v2 = await normalizeRaw(again.bytes, doc, palette, i.max_colors)
            if (v2.report.gridConfidence > v.report.gridConfidence) {
              v = v2
              run.images[n] = again
            }
          } catch {
            /* keep the first attempt */
          }
        }
        variants.push(v)
        ctx.progress?.(n + 1, run.images.length, `variant ${n + 1} cleaned`)
      }
      return saveProposal(
        ctx,
        slug,
        {
          kind: 'generate',
          baseVersion: versionId,
          request: {
            prompt: i.prompt,
            palette: i.palette ?? 'auto',
            quality: i.quality,
            max_colors: i.max_colors,
          },
          provider: run.provider.id,
          model: run.quote.model,
          costUsd: run.usd,
        },
        run.images,
        variants,
      )
    },
  }),
  defineTool({
    name: 'edit_image',
    title: 'Edit with AI',
    description: `Change the current artwork from an instruction ("give him a red cape"), optionally only inside a rectangle. Output is cleaned and stored as a PROPOSAL; accept_variant adds it as a new layer. Prefer the free deterministic tools (recolor, add_outline, draw_pixels…) when they can do the job. ${COST_NOTE}`,
    input: z.object({
      art: artArg,
      instruction: z.string().min(2).max(500),
      region: regionArg,
      keep_palette: z.boolean().default(true).describe('Snap the result to the current palette'),
      strength: z.number().min(0.1).max(1).default(0.6),
      variants: z.number().int().min(1).max(4).default(2),
      quality: qualityArg,
      provider: providerArg,
      confirm_cost: confirmArg,
      frame: z.number().int().min(0).default(0),
    }),
    annotations: { openWorld: true, costly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const { versionId, doc } = await artStore(ctx).readHead(slug)
      const frame = doc.frames[i.frame]
      if (!frame) throw new ToolError('INVALID', `frame ${i.frame} out of range`)
      if (i.region && (i.region.x + i.region.w > doc.width || i.region.y + i.region.h > doc.height))
        throw new ToolError('INVALID', `region is outside the ${doc.width}×${doc.height} canvas`)
      const image = await providerInput({
        data: composeFrame(doc, frame.id),
        width: doc.width,
        height: doc.height,
      })
      const palette = i.keep_palette ? doc.palette.slice(1).filter((c) => !c.endsWith('00')) : undefined
      const req = {
        prompt: i.instruction,
        width: doc.width,
        height: doc.height,
        palette,
        variants: i.variants,
        image,
        mask: i.region ? maskPng(doc, i.region) : undefined,
        strength: i.strength,
      }
      const run = await runProvider(
        ctx,
        'edit',
        i.quality,
        i.provider,
        i.confirm_cost,
        i.variants,
        (p) => {
          if (!p.edit) throw new ProviderError(`${p.id} cannot edit`)
          return p.edit(req, ctx.signal)
        },
        slug,
        req,
      )
      const variants = []
      for (const raw of run.images) {
        const v = await normalizeRaw(raw.bytes, doc, palette, palette?.length ?? 16)
        if (i.region) v.data.region = i.region
        variants.push(v)
      }
      return saveProposal(
        ctx,
        slug,
        {
          kind: 'edit',
          baseVersion: versionId,
          request: {
            instruction: i.instruction,
            region: i.region,
            keep_palette: i.keep_palette,
            frame: i.frame,
            quality: i.quality,
          },
          provider: run.provider.id,
          model: run.quote.model,
          costUsd: run.usd,
        },
        run.images,
        variants,
      )
    },
  }),
  defineTool({
    name: 'animate',
    title: 'Animate with AI',
    description: `Generate an animation (walk cycle, idle, attack…) at the canvas size. Stored as a PROPOSAL; accept_variant adds the frames on a new layer. Needs a provider that can animate (quality "high" = Retro Diffusion, or provider "mock" for testing). ${COST_NOTE}`,
    input: z.object({
      art: artArg,
      prompt: z.string().min(2).max(300).describe('What the character looks like'),
      action: z.string().min(2).max(80).describe('e.g. "walking", "idle", "attack"'),
      frames: z.number().int().min(2).max(16).default(4),
      direction: z.string().max(20).optional(),
      variants: z.number().int().min(1).max(2).default(1),
      quality: qualityArg,
      provider: providerArg,
      confirm_cost: confirmArg,
    }),
    annotations: { openWorld: true, costly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const { versionId, doc } = await artStore(ctx).readHead(slug)
      const req = {
        prompt: i.prompt,
        action: i.action,
        frames: i.frames,
        direction: i.direction,
        width: doc.width,
        height: doc.height,
        variants: i.variants,
      }
      const run = await runProvider(
        ctx,
        'animate',
        i.quality,
        i.provider,
        i.confirm_cost,
        i.variants,
        (p) => {
          if (!p.animate) throw new ProviderError(`${p.id} cannot animate`)
          return p.animate(req, ctx.signal)
        },
        slug,
        req,
      )
      const variants = []
      for (const raw of run.images) {
        const sheet = await decodeImage(raw.bytes)
        const n = raw.frames ?? i.frames
        const fw = Math.floor(sheet.width / n)
        let palette: string[] | undefined
        const data: VariantData = { width: doc.width, height: doc.height, palette: [], frames: [] }
        let report: NormalizeReport | undefined
        for (let f = 0; f < n; f++) {
          const { data: px, info } = await sharp(
            Buffer.from(sheet.data.buffer, sheet.data.byteOffset, sheet.data.length),
            {
              raw: { width: sheet.width, height: sheet.height, channels: 4 },
            },
          )
            .extract({ left: f * fw, top: 0, width: fw, height: sheet.height })
            .raw()
            .toBuffer({ resolveWithObject: true })
          const r = normalize(
            {
              data: new Uint8ClampedArray(px.buffer, px.byteOffset, px.length),
              width: info.width,
              height: info.height,
            },
            { target: { width: doc.width, height: doc.height }, palette, maxColors: 16 },
          )
          if (!palette) {
            palette = r.palette.slice(1)
            data.palette = r.palette
            report = r.report
          }
          data.frames.push(encodeCel(r.pixels))
        }
        variants.push({ data, report: report! })
      }
      return saveProposal(
        ctx,
        slug,
        {
          kind: 'animate',
          baseVersion: versionId,
          request: {
            prompt: i.prompt,
            action: i.action,
            frames: i.frames,
            direction: i.direction,
            quality: i.quality,
          },
          provider: run.provider.id,
          model: run.quote.model,
          costUsd: run.usd,
        },
        run.images,
        variants,
      )
    },
  }),
  defineTool({
    name: 'accept_variant',
    title: 'Accept AI variant',
    description:
      'Put a proposal variant onto the canvas as a NEW layer (never overwrites existing pixels). Animation proposals fill frames on that layer, adding frames if needed.',
    input: z.object({
      art: artArg,
      proposal: z.string(),
      variant: z.number().int().min(1).max(4),
      layer_name: z.string().max(60).optional(),
      preview: previewArg,
    }),
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const meta = await artStore(ctx).readProposal(slug, i.proposal)
      if (meta.status !== 'open')
        throw new ToolError('INVALID', `proposal ${meta.id} is already ${meta.status}`)
      const v = meta.variants.find((x) => x.n === i.variant)
      if (!v)
        throw new ToolError(
          'NOT_FOUND',
          `variant ${i.variant} not in proposal (has ${meta.variants.map((x) => x.n).join(', ')})`,
        )
      const data = JSON.parse(
        new TextDecoder().decode(await artStore(ctx).readProposalFile(slug, meta.id, v.normalized)),
      ) as VariantData
      const label = String(meta.request.prompt ?? meta.request.instruction ?? 'AI')
      const res = await mutate(
        ctx,
        slug,
        `accept ${meta.id} #${i.variant}`,
        (doc) => {
          if (doc.width !== data.width || doc.height !== data.height)
            throw new ToolError(
              'CONFLICT',
              `canvas is now ${doc.width}×${doc.height} but the proposal is ${data.width}×${data.height}; generate again`,
            )
          const empty = usedColorIndices(doc).size === 0
          if (empty && meta.kind !== 'edit') doc.palette = ['#00000000', ...data.palette.slice(1)]
          const keep = meta.request.keep_palette === true
          const layer = addLayer(doc, { name: i.layer_name ?? `AI: ${short(label, 28)}`, origin: 'ai' })
          while (doc.frames.length < data.frames.length) addFrame(doc, { durationMs: 120 })
          let mask: Uint8Array | undefined
          if (data.region) {
            mask = new Uint8Array(doc.width * doc.height)
            for (let y = data.region.y; y < data.region.y + data.region.h; y++)
              for (let x = data.region.x; x < data.region.x + data.region.w; x++) mask[y * doc.width + x] = 1
          }
          const targetFrames =
            meta.kind === 'edit' ? [doc.frames[Number(meta.request.frame ?? 0)]] : doc.frames
          data.frames.forEach((cel, f) => {
            const frame = targetFrames[f]
            if (!frame) return
            pasteIndexed(
              doc,
              layer.id,
              frame.id,
              {
                width: data.width,
                height: data.height,
                palette: data.palette,
                pixels: decodeCel(cel, data.width * data.height),
              },
              { x: 0, y: 0 },
              { keepPalette: keep, mask },
            )
          })
          if (empty) compactPalette(doc)
          return `Accepted ${meta.id} variant ${i.variant} as layer "${layer.name}" (id ${layer.id}). Merge it down with layer_merge_down or hide it with layer_set.`
        },
        { preview: i.preview },
      )
      meta.status = 'accepted'
      meta.acceptedVariant = i.variant
      meta.acceptedInVersion = (res.data as { version: string }).version
      await artStore(ctx).updateProposal(slug, meta)
      return res
    },
  }),
  defineTool({
    name: 'discard_proposal',
    title: 'Discard proposal',
    description: 'Mark an AI proposal as discarded (files are kept for reference).',
    input: z.object({ art: artArg, proposal: z.string() }),
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const meta = await artStore(ctx).readProposal(slug, i.proposal)
      meta.status = 'discarded'
      await artStore(ctx).updateProposal(slug, meta)
      return { text: `Discarded ${meta.id}.` }
    },
  }),
  defineTool({
    name: 'proposal_list',
    title: 'List proposals',
    description: 'List AI proposals of an art (open ones first).',
    input: z.object({ art: artArg, status: z.enum(['open', 'accepted', 'discarded']).optional() }),
    annotations: { readOnly: true },
    async handler(ctx, i) {
      const slug = await artSlug(ctx, i.art)
      const list = await artStore(ctx).listProposals(slug, i.status)
      return {
        text: list.length
          ? list
              .map(
                (p) =>
                  `${p.id} [${p.status}] ${p.kind} "${short(String(p.request.prompt ?? p.request.instruction ?? ''), 40)}" — ${p.variants.length} variant(s), ${p.provider}`,
              )
              .join('\n')
          : 'No proposals.',
        data: list,
      }
    },
  }),
]
