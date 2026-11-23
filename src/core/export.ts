import * as gifenc from 'gifenc'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'
import { z } from 'zod'
import { BEAD_BRANDS, type BeadColor } from '../shared/beads.ts'
import type { PixelDoc, Purpose } from '../shared/types.ts'
import { hexToLab, labDist2, PaletteMatcher, parseHex, rgbToOklab } from './color.ts'
import { composeFrame } from './doc.ts'
import { encodePng } from './png.ts'
import type { Raster } from './preview.ts'

export interface ExportFile {
  name: string
  bytes: Uint8Array
  mime: string
  /** Asks the Node layer to transcode (core stays dependency-free). */
  convertTo?: 'webp'
  note?: string
}

export interface ExportPreset<S extends z.ZodTypeAny = z.ZodTypeAny> {
  id: string
  purpose: Purpose
  label: string
  options: S
  run(doc: PixelDoc, opts: z.infer<S>, baseName: string, info: ExportInfo): Promise<ExportFile[]>
}

/** Facts about the running app that go into exported metadata (core never reads files itself). */
export interface ExportInfo {
  /** Squarel version (SQUAREL_VERSION), written as `meta.version` of sprite sheet JSON. */
  appVersion: string
}

const enc = new TextEncoder()

// gifenc ships CJS (Node) and ESM (bundlers/vitest) builds with different export shapes.
function gifEncoder() {
  const ns = gifenc as unknown as { GIFEncoder?: () => any; default?: { GIFEncoder?: () => any } }
  const make = ns.GIFEncoder ?? ns.default?.GIFEncoder
  if (!make) throw new Error('gifenc: GIFEncoder export not found')
  return make()
}

function frameRaster(doc: PixelDoc, frameIndex = 0): Raster {
  const f = doc.frames[Math.max(0, Math.min(doc.frames.length - 1, frameIndex))]
  return { data: composeFrame(doc, f.id), width: doc.width, height: doc.height }
}

export function upscale(r: Raster, scale: number): Raster {
  if (scale === 1) return r
  const w = r.width * scale
  const h = r.height * scale
  const data = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const si = (Math.floor(y / scale) * r.width + Math.floor(x / scale)) * 4
      data.set(r.data.subarray(si, si + 4), (y * w + x) * 4)
    }
  return { data, width: w, height: h }
}

/** Place raster centered on a transparent square canvas of `size` with the largest integer scale that fits. */
function fitSquare(r: Raster, size: number): Raster {
  const scale = Math.max(1, Math.floor(size / Math.max(r.width, r.height)))
  const up = upscale(r, scale)
  const out = new Uint8ClampedArray(size * size * 4)
  const ox = Math.floor((size - up.width) / 2)
  const oy = Math.floor((size - up.height) / 2)
  for (let y = 0; y < up.height; y++)
    for (let x = 0; x < up.width; x++) {
      const tx = x + ox
      const ty = y + oy
      if (tx < 0 || ty < 0 || tx >= size || ty >= size) continue
      out.set(up.data.subarray((y * up.width + x) * 4, (y * up.width + x) * 4 + 4), (ty * size + tx) * 4)
    }
  return { data: out, width: size, height: size }
}

export function encodeGif(doc: PixelDoc, scale: number): Uint8Array {
  const gif = gifEncoder()
  const palette = doc.palette.map((h) => parseHex(h).slice(0, 3))
  const matcher = new PaletteMatcher(doc.palette)
  for (const f of doc.frames) {
    const rgba = composeFrame(doc, f.id)
    const w = doc.width * scale
    const h = doc.height * scale
    const idx = new Uint8Array(w * h)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const si = (Math.floor(y / scale) * doc.width + Math.floor(x / scale)) * 4
        idx[y * w + x] = rgba[si + 3] < 128 ? 0 : matcher.nearest(rgba[si], rgba[si + 1], rgba[si + 2])
      }
    gif.writeFrame(idx, w, h, {
      palette,
      delay: f.durationMs,
      transparent: true,
      transparentIndex: 0,
      repeat: 0,
    })
  }
  gif.finish()
  return gif.bytes()
}

export function encodeSvg(r: Raster, o: { widthMm?: number } = {}): string {
  const paths = new Map<string, string[]>()
  for (let y = 0; y < r.height; y++) {
    let x = 0
    while (x < r.width) {
      const i = (y * r.width + x) * 4
      if (r.data[i + 3] === 0) {
        x++
        continue
      }
      const key = `${r.data[i]},${r.data[i + 1]},${r.data[i + 2]},${r.data[i + 3]}`
      let run = 1
      while (x + run < r.width) {
        const j = (y * r.width + x + run) * 4
        if (`${r.data[j]},${r.data[j + 1]},${r.data[j + 2]},${r.data[j + 3]}` !== key) break
        run++
      }
      let list = paths.get(key)
      if (!list) {
        list = []
        paths.set(key, list)
      }
      list.push(`M${x} ${y}h${run}v1h-${run}z`)
      x += run
    }
  }
  const size = o.widthMm
    ? ` width="${o.widthMm}mm" height="${((o.widthMm * r.height) / r.width).toFixed(2)}mm"`
    : ` width="${r.width * 8}" height="${r.height * 8}"`
  const body = [...paths.entries()]
    .map(([k, d]) => {
      const [rr, g, b, a] = k.split(',').map(Number)
      const hex = `#${[rr, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
      return `<path fill="${hex}"${a < 255 ? ` fill-opacity="${(a / 255).toFixed(3)}"` : ''} d="${d.join('')}"/>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r.width} ${r.height}"${size} shape-rendering="crispEdges">\n${body}\n</svg>\n`
}

const MM = 72 / 25.4

async function encodePrintPdf(r: Raster, widthMm: number, marginMm: number): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const heightMm = (widthMm * r.height) / r.width
  const page = pdf.addPage([(widthMm + 2 * marginMm) * MM, (heightMm + 2 * marginMm) * MM])
  const cell = (widthMm * MM) / r.width
  const ox = marginMm * MM
  const top = (marginMm + heightMm) * MM
  for (let y = 0; y < r.height; y++) {
    let x = 0
    while (x < r.width) {
      const i = (y * r.width + x) * 4
      if (r.data[i + 3] === 0) {
        x++
        continue
      }
      let run = 1
      while (
        x + run < r.width &&
        r.data[i + run * 4] === r.data[i] &&
        r.data[i + run * 4 + 1] === r.data[i + 1] &&
        r.data[i + run * 4 + 2] === r.data[i + 2] &&
        r.data[i + run * 4 + 3] === r.data[i + 3]
      )
        run++
      page.drawRectangle({
        x: ox + x * cell,
        y: top - (y + 1) * cell,
        width: run * cell + 0.05,
        height: cell + 0.05,
        color: rgb(r.data[i] / 255, r.data[i + 1] / 255, r.data[i + 2] / 255),
        opacity: r.data[i + 3] / 255,
      })
      x += run
    }
  }
  pdf.setTitle('Squarel Art print')
  pdf.setProducer('squarel-art')
  return pdf.save()
}

const SYMBOLS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789#$%&*+=?@'

export interface BeadPlan {
  brand: string
  width: number
  height: number
  boardSize: number
  boardsX: number
  boardsY: number
  /** per pixel: index into `colors`, -1 = empty */
  grid: Int16Array
  colors: (BeadColor & { symbol: string; count: number })[]
  total: number
}

export function planBeads(
  doc: PixelDoc,
  brand: keyof typeof BEAD_BRANDS,
  boardSize = 29,
  frameIndex = 0,
): BeadPlan {
  const beads = BEAD_BRANDS[brand]
  const labs = beads.map((b) => hexToLab(b.hex))
  const r = frameRaster(doc, frameIndex)
  const grid = new Int16Array(r.width * r.height).fill(-1)
  const cache = new Map<number, number>()
  const counts = new Map<number, number>()
  for (let p = 0; p < grid.length; p++) {
    const i = p * 4
    if (r.data[i + 3] < 128) continue
    const key = (r.data[i] << 16) | (r.data[i + 1] << 8) | r.data[i + 2]
    let b = cache.get(key)
    if (b === undefined) {
      const lab = rgbToOklab(r.data[i], r.data[i + 1], r.data[i + 2])
      let best = 0
      let bd = Number.POSITIVE_INFINITY
      labs.forEach((l, k) => {
        const d = labDist2(lab, l)
        if (d < bd) {
          bd = d
          best = k
        }
      })
      b = best
      cache.set(key, b)
    }
    counts.set(b, (counts.get(b) ?? 0) + 1)
    grid[p] = b
  }
  const order = [...counts.entries()].sort((a, b) => b[1] - a[1])
  const remap = new Map<number, number>()
  const colors = order.map(([b, count], i) => {
    remap.set(b, i)
    return { ...beads[b], symbol: SYMBOLS[i % SYMBOLS.length], count }
  })
  for (let p = 0; p < grid.length; p++) if (grid[p] >= 0) grid[p] = remap.get(grid[p])!
  return {
    brand,
    width: r.width,
    height: r.height,
    boardSize,
    boardsX: Math.ceil(r.width / boardSize),
    boardsY: Math.ceil(r.height / boardSize),
    grid,
    colors,
    total: order.reduce((a, [, c]) => a + c, 0),
  }
}

async function encodeBeadPdf(plan: BeadPlan): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const A4: [number, number] = [595.28, 841.89]
  // legend page
  let page = pdf.addPage(A4)
  let y = A4[1] - 50
  page.drawText('Squarel Art - bead pattern', { x: 40, y, size: 18, font: bold })
  y -= 24
  page.drawText(
    `${plan.brand.toUpperCase()} | ${plan.width} x ${plan.height} beads | ${plan.boardsX * plan.boardsY} board(s) of ${plan.boardSize}x${plan.boardSize} | total ${plan.total} beads`,
    { x: 40, y, size: 10, font },
  )
  y -= 28
  const header = ['Sym', 'Code', 'Name', 'Count']
  const cols = [40, 90, 150, 330]
  for (const [i, h] of header.entries()) page.drawText(h, { x: cols[i], y, size: 10, font: bold })
  y -= 16
  for (const c of plan.colors) {
    if (y < 50) {
      page = pdf.addPage(A4)
      y = A4[1] - 50
    }
    const [r, g, b] = parseHex(c.hex)
    page.drawRectangle({ x: 40, y: y - 3, width: 14, height: 14, color: rgb(r / 255, g / 255, b / 255) })
    page.drawText(c.symbol, { x: 60, y, size: 10, font: bold })
    page.drawText(c.code, { x: cols[1], y, size: 10, font })
    page.drawText(c.name, { x: cols[2], y, size: 10, font })
    page.drawText(String(c.count), { x: cols[3], y, size: 10, font })
    y -= 18
  }
  // one page per board
  for (let by = 0; by < plan.boardsY; by++)
    for (let bx = 0; bx < plan.boardsX; bx++) {
      const p = pdf.addPage(A4)
      p.drawText(`Board ${by * plan.boardsX + bx + 1}  (column ${bx + 1}, row ${by + 1})`, {
        x: 40,
        y: A4[1] - 50,
        size: 12,
        font: bold,
      })
      const cell = Math.min((A4[0] - 80) / plan.boardSize, (A4[1] - 140) / plan.boardSize)
      const top = A4[1] - 80
      for (let gy = 0; gy < plan.boardSize; gy++)
        for (let gx = 0; gx < plan.boardSize; gx++) {
          const x = bx * plan.boardSize + gx
          const yy = by * plan.boardSize + gy
          const px = 40 + gx * cell
          const py = top - (gy + 1) * cell
          const inside = x < plan.width && yy < plan.height
          const ci = inside ? plan.grid[yy * plan.width + x] : -1
          if (ci >= 0) {
            const c = plan.colors[ci]
            const [r, g, b] = parseHex(c.hex)
            p.drawRectangle({
              x: px,
              y: py,
              width: cell,
              height: cell,
              color: rgb(r / 255, g / 255, b / 255),
            })
            const lum = 0.299 * r + 0.587 * g + 0.114 * b
            p.drawText(c.symbol, {
              x: px + cell * 0.28,
              y: py + cell * 0.28,
              size: cell * 0.55,
              font,
              color: lum > 140 ? rgb(0, 0, 0) : rgb(1, 1, 1),
            })
          }
          p.drawRectangle({
            x: px,
            y: py,
            width: cell,
            height: cell,
            borderColor: rgb(0.75, 0.75, 0.75),
            borderWidth: gx % 5 === 0 || gy % 5 === 0 ? 0.6 : 0.25,
            opacity: 0,
          })
        }
    }
  pdf.setTitle('Squarel Art bead pattern')
  pdf.setProducer('squarel-art')
  return pdf.save()
}

function beadCsv(plan: BeadPlan): string {
  return [
    'symbol,code,name,hex,count',
    ...plan.colors.map((c) => `${c.symbol},${c.code},"${c.name}",${c.hex},${c.count}`),
  ].join('\n')
}

function spriteSheet(
  doc: PixelDoc,
  scale: number,
  columns: number | undefined,
  baseName: string,
  appVersion: string,
) {
  const n = doc.frames.length
  const cols = Math.max(1, Math.min(n, columns ?? n))
  const rows = Math.ceil(n / cols)
  const fw = doc.width * scale
  const fh = doc.height * scale
  const sheet: Raster = {
    width: cols * fw,
    height: rows * fh,
    data: new Uint8ClampedArray(cols * fw * rows * fh * 4),
  }
  const frames = doc.frames.map((f, i) => {
    const r = upscale({ data: composeFrame(doc, f.id), width: doc.width, height: doc.height }, scale)
    const ox = (i % cols) * fw
    const oy = Math.floor(i / cols) * fh
    for (let y = 0; y < fh; y++)
      sheet.data.set(r.data.subarray(y * fw * 4, (y + 1) * fw * 4), ((oy + y) * sheet.width + ox) * 4)
    return {
      filename: `${baseName} ${i}.png`,
      frame: { x: ox, y: oy, w: fw, h: fh },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
      sourceSize: { w: fw, h: fh },
      duration: f.durationMs,
    }
  })
  const json = {
    frames,
    meta: {
      app: 'squarel-art',
      version: appVersion,
      image: `${baseName}-sheet.png`,
      format: 'RGBA8888',
      size: { w: sheet.width, h: sheet.height },
      scale: String(scale),
      frameTags: (doc.meta.tags ?? []).map((t) => ({
        name: t.name,
        from: t.from,
        to: t.to,
        direction: 'forward',
      })),
    },
  }
  return { sheet, json }
}

const scaleOpt = z.number().int().min(1).max(32)

export const PRESETS: ExportPreset<any>[] = [
  {
    id: 'game-png',
    purpose: 'game',
    label: 'PNG (transparent), one file per frame',
    options: z.object({ scale: scaleOpt.default(1) }),
    async run(doc, o, base) {
      return doc.frames.map((_, i) => ({
        name: doc.frames.length > 1 ? `${base}-f${i}@${o.scale}x.png` : `${base}@${o.scale}x.png`,
        bytes: encodePng(upscale(frameRaster(doc, i), o.scale)),
        mime: 'image/png',
      }))
    },
  },
  {
    id: 'game-spritesheet',
    purpose: 'game',
    label: 'Sprite sheet PNG + Aseprite-style JSON (array)',
    options: z.object({ scale: scaleOpt.default(1), columns: z.number().int().min(1).optional() }),
    async run(doc, o, base, info) {
      const { sheet, json } = spriteSheet(doc, o.scale, o.columns, base, info.appVersion)
      return [
        { name: `${base}-sheet.png`, bytes: encodePng(sheet), mime: 'image/png' },
        {
          name: `${base}-sheet.json`,
          bytes: enc.encode(JSON.stringify(json, null, 2)),
          mime: 'application/json',
        },
      ]
    },
  },
  {
    id: 'game-gif',
    purpose: 'game',
    label: 'Animated GIF',
    options: z.object({ scale: scaleOpt.default(4) }),
    async run(doc, o, base) {
      return [{ name: `${base}@${o.scale}x.gif`, bytes: encodeGif(doc, o.scale), mime: 'image/gif' }]
    },
  },
  {
    id: 'print-png',
    purpose: 'print',
    label: 'Print PNG (nearest-neighbor upscale, DPI embedded)',
    options: z.object({
      widthMm: z.number().positive().default(300),
      dpi: z.number().int().min(72).max(1200).default(300),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      const targetPx = (o.widthMm / 25.4) * o.dpi
      const scale = Math.max(1, Math.round(targetPx / doc.width))
      const r = upscale(frameRaster(doc, o.frame), scale)
      const realMm = ((r.width / o.dpi) * 25.4).toFixed(1)
      return [
        {
          name: `${base}-print-${r.width}x${r.height}-${o.dpi}dpi.png`,
          bytes: encodePng(r, { dpi: o.dpi }),
          mime: 'image/png',
          note: `${r.width}×${r.height}px = ${realMm}mm wide at ${o.dpi} DPI (pixel scale ×${scale})`,
        },
      ]
    },
  },
  {
    id: 'print-svg',
    purpose: 'print',
    label: 'SVG vector (crisp at any size)',
    options: z.object({
      widthMm: z.number().positive().optional(),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      return [
        {
          name: `${base}.svg`,
          bytes: enc.encode(encodeSvg(frameRaster(doc, o.frame), o)),
          mime: 'image/svg+xml',
        },
      ]
    },
  },
  {
    id: 'print-pdf',
    purpose: 'print',
    label: 'Vector PDF sized for print',
    options: z.object({
      widthMm: z.number().positive().default(200),
      marginMm: z.number().min(0).default(10),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      return [
        {
          name: `${base}-print.pdf`,
          bytes: await encodePrintPdf(frameRaster(doc, o.frame), o.widthMm, o.marginMm),
          mime: 'application/pdf',
        },
      ]
    },
  },
  {
    id: 'social-avatar',
    purpose: 'digital',
    label: 'Square avatar PNG',
    options: z.object({
      size: z.union([z.literal(512), z.literal(1024)]).default(512),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      return [
        {
          name: `${base}-avatar-${o.size}.png`,
          bytes: encodePng(fitSquare(frameRaster(doc, o.frame), o.size)),
          mime: 'image/png',
        },
      ]
    },
  },
  {
    id: 'social-emoji',
    purpose: 'digital',
    label: 'Emoji PNG 128×128',
    options: z.object({
      size: z.number().int().min(16).max(256).default(128),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      return [
        {
          name: `${base}-emoji-${o.size}.png`,
          bytes: encodePng(fitSquare(frameRaster(doc, o.frame), o.size)),
          mime: 'image/png',
        },
      ]
    },
  },
  {
    id: 'social-sticker',
    purpose: 'digital',
    label: 'Sticker WebP 512×512',
    options: z.object({
      size: z.number().int().min(64).max(1024).default(512),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      return [
        {
          name: `${base}-sticker-${o.size}.webp`,
          bytes: encodePng(fitSquare(frameRaster(doc, o.frame), o.size)),
          mime: 'image/webp',
          convertTo: 'webp',
        },
      ]
    },
  },
  {
    id: 'social-anim',
    purpose: 'digital',
    label: 'Animated GIF for chat/social',
    options: z.object({ scale: scaleOpt.default(8) }),
    async run(doc, o, base) {
      return [{ name: `${base}-anim@${o.scale}x.gif`, bytes: encodeGif(doc, o.scale), mime: 'image/gif' }]
    },
  },
  {
    id: 'craft-beads',
    purpose: 'craft',
    label: 'Fuse-bead pattern PDF + CSV (Perler/Hama), split into pegboards',
    options: z.object({
      brand: z.enum(['perler', 'hama']).default('perler'),
      boardSize: z.number().int().min(5).max(64).default(29),
      frame: z.number().int().min(0).default(0),
    }),
    async run(doc, o, base) {
      const plan = planBeads(doc, o.brand, o.boardSize, o.frame)
      return [
        {
          name: `${base}-beads-${o.brand}.pdf`,
          bytes: await encodeBeadPdf(plan),
          mime: 'application/pdf',
          note: `${plan.total} beads, ${plan.colors.length} colors, ${plan.boardsX * plan.boardsY} board(s)`,
        },
        { name: `${base}-beads-${o.brand}.csv`, bytes: enc.encode(beadCsv(plan)), mime: 'text/csv' },
      ]
    },
  },
]

export function findPreset(id: string): ExportPreset<any> {
  const p = PRESETS.find((x) => x.id === id)
  if (!p) throw new Error(`unknown preset "${id}". Available: ${PRESETS.map((x) => x.id).join(', ')}`)
  return p
}
