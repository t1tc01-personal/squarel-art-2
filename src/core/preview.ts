import type { PixelDoc } from '../shared/types.ts'
import { composeFrame } from './doc.ts'

export interface Raster {
  data: Uint8ClampedArray
  width: number
  height: number
}

// 3×5 bitmap digits
const DIGITS: Record<string, string[]> = {
  '0': ['111', '101', '101', '101', '111'],
  '1': ['010', '110', '010', '010', '111'],
  '2': ['111', '001', '111', '100', '111'],
  '3': ['111', '001', '111', '001', '111'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '111', '001', '111'],
  '6': ['111', '100', '111', '101', '111'],
  '7': ['111', '001', '010', '010', '010'],
  '8': ['111', '101', '111', '101', '111'],
  '9': ['111', '101', '111', '001', '111'],
}

function fillRect(r: Raster, x: number, y: number, w: number, h: number, rgb: [number, number, number]) {
  for (let yy = Math.max(0, y); yy < Math.min(r.height, y + h); yy++)
    for (let xx = Math.max(0, x); xx < Math.min(r.width, x + w); xx++) {
      const i = (yy * r.width + xx) * 4
      r.data[i] = rgb[0]
      r.data[i + 1] = rgb[1]
      r.data[i + 2] = rgb[2]
      r.data[i + 3] = 255
    }
}

export function drawText(
  r: Raster,
  text: string,
  x: number,
  y: number,
  scale: number,
  rgb: [number, number, number],
) {
  let cx = x
  for (const ch of text) {
    const g = DIGITS[ch]
    if (g)
      for (let gy = 0; gy < 5; gy++)
        for (let gx = 0; gx < 3; gx++)
          if (g[gy][gx] === '1') fillRect(r, cx + gx * scale, y + gy * scale, scale, scale, rgb)
    cx += 4 * scale
  }
}

export interface RenderOptions {
  frameId?: string
  layerId?: string
  /** Longest side of the output in px (default 256). Scale is an integer ≥ 1. */
  maxSide?: number
  grid?: boolean
  coords?: boolean
  checker?: boolean
}

/** Render the doc to an RGB(A) preview: integer nearest-neighbor scale, checkerboard, optional grid & rulers. */
export function renderDoc(doc: PixelDoc, o: RenderOptions = {}): Raster {
  const rgba = composeFrame(doc, o.frameId ?? doc.frames[0].id, o.layerId ? { onlyLayerId: o.layerId } : {})
  return renderRGBA({ data: rgba, width: doc.width, height: doc.height }, o)
}

export function renderRGBA(src: Raster, o: RenderOptions = {}): Raster {
  const maxSide = o.maxSide ?? 256
  const scale = Math.max(1, Math.floor(maxSide / Math.max(src.width, src.height)))
  const margin = o.coords ? 14 : 0
  const out: Raster = {
    data: new Uint8ClampedArray((src.width * scale + margin) * (src.height * scale + margin) * 4),
    width: src.width * scale + margin,
    height: src.height * scale + margin,
  }
  if (margin) fillRect(out, 0, 0, out.width, out.height, [255, 255, 255])
  const checker = o.checker ?? true
  const cs = Math.max(2, Math.floor(scale / 2))
  for (let y = 0; y < src.height * scale; y++)
    for (let x = 0; x < src.width * scale; x++) {
      const si = (Math.floor(y / scale) * src.width + Math.floor(x / scale)) * 4
      const oi = ((y + margin) * out.width + (x + margin)) * 4
      const a = src.data[si + 3] / 255
      const bg = checker ? ((Math.floor(x / cs) + Math.floor(y / cs)) % 2 ? 204 : 238) : 255
      out.data[oi] = src.data[si] * a + bg * (1 - a)
      out.data[oi + 1] = src.data[si + 1] * a + bg * (1 - a)
      out.data[oi + 2] = src.data[si + 2] * a + bg * (1 - a)
      out.data[oi + 3] = 255
    }
  if (o.grid && scale >= 4) {
    for (let gx = 0; gx <= src.width; gx++) {
      const strong = gx % 8 === 0
      for (let y = 0; y < src.height * scale; y++)
        darken(out, Math.min(out.width - 1, margin + gx * scale), margin + y, strong ? 0.45 : 0.18)
    }
    for (let gy = 0; gy <= src.height; gy++) {
      const strong = gy % 8 === 0
      for (let x = 0; x < src.width * scale; x++)
        darken(out, margin + x, Math.min(out.height - 1, margin + gy * scale), strong ? 0.45 : 0.18)
    }
  }
  if (margin) {
    const step = scale >= 8 ? 4 : 8
    for (let v = 0; v < Math.max(src.width, src.height); v += step) {
      if (v < src.width) drawText(out, String(v), margin + v * scale + 1, 2, 2, [80, 80, 80])
      if (v < src.height) drawText(out, String(v), 0, margin + v * scale + 1, 1, [80, 80, 80])
    }
  }
  return out
}

function darken(r: Raster, x: number, y: number, k: number) {
  if (x < 0 || y < 0 || x >= r.width || y >= r.height) return
  const i = (y * r.width + x) * 4
  r.data[i] *= 1 - k
  r.data[i + 1] *= 1 - k
  r.data[i + 2] *= 1 - k
}

/** Lay out up to N images in a row, each labeled with its 1-based number. */
export function contactSheet(items: Raster[], cell = 160): Raster {
  const pad = 8
  const label = 16
  const cols = Math.min(items.length, 4)
  const rows = Math.ceil(items.length / 4)
  const out: Raster = {
    width: cols * (cell + pad) + pad,
    height: rows * (cell + pad + label) + pad,
    data: new Uint8ClampedArray(0),
  }
  out.data = new Uint8ClampedArray(out.width * out.height * 4)
  fillRect(out, 0, 0, out.width, out.height, [255, 255, 255])
  items.forEach((item, n) => {
    const r = renderRGBA(item, { maxSide: cell })
    const ox = pad + (n % 4) * (cell + pad)
    const oy = pad + Math.floor(n / 4) * (cell + pad + label)
    drawText(out, String(n + 1), ox, oy, 2, [20, 20, 20])
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++) {
        const si = (y * r.width + x) * 4
        const oi = ((oy + label + y) * out.width + (ox + x)) * 4
        out.data.set(r.data.subarray(si, si + 4), oi)
      }
  })
  return out
}

/** Palette swatch strip with index numbers. */
export function paletteSwatches(palette: string[], cell = 24): Raster {
  const cols = 8
  const n = palette.length - 1
  const rows = Math.max(1, Math.ceil(n / cols))
  const out: Raster = { width: cols * cell, height: rows * (cell + 10), data: new Uint8ClampedArray(0) }
  out.data = new Uint8ClampedArray(out.width * out.height * 4)
  fillRect(out, 0, 0, out.width, out.height, [255, 255, 255])
  for (let i = 1; i <= n; i++) {
    const h = palette[i]
    const rgb: [number, number, number] = [
      Number.parseInt(h.slice(1, 3), 16),
      Number.parseInt(h.slice(3, 5), 16),
      Number.parseInt(h.slice(5, 7), 16),
    ]
    const x = ((i - 1) % cols) * cell
    const y = Math.floor((i - 1) / cols) * (cell + 10)
    drawText(out, String(i), x + 1, y + 1, 1, [60, 60, 60])
    fillRect(out, x + 1, y + 8, cell - 2, cell - 2, rgb)
  }
  return out
}
