import { MAX_SIDE, type PixelDoc, TRANSPARENT } from '../shared/types.ts'
import { celKey } from './codec.ts'
import { type Lab, labDist2, normHex, PaletteMatcher, parseHex, rgbToOklab, shiftHueHex } from './color.ts'
import { ensureColor, flattenIndices, getCel } from './doc.ts'
import { kmeansPalette } from './quantize.ts'

/** Layers an op applies to: one layer (id or name) or all layers. */
function targetLayers(doc: PixelDoc, layer?: string) {
  if (!layer) return doc.layers
  const l = doc.layers.find((x) => x.id === layer || x.name === layer)
  if (!l) throw new Error(`layer "${layer}" not found`)
  return [l]
}

function eachCel(doc: PixelDoc, layer: string | undefined, fn: (cel: Uint8Array) => void) {
  for (const l of targetLayers(doc, layer)) for (const f of doc.frames) fn(getCel(doc, l.id, f.id))
}

/** Replace pixels of one color with another. `tolerance` (OKLab ΔE) also catches similar colors. */
export function recolor(
  doc: PixelDoc,
  from: string | number,
  to: string | number,
  o: { layer?: string; tolerance?: number } = {},
): number {
  const toIdx = typeof to === 'number' ? to : to === 'transparent' ? 0 : ensureColor(doc, to)
  const sources = new Set<number>()
  if (typeof from === 'number') sources.add(from)
  else {
    const hex = normHex(from)
    const fromLab = hexLab(hex)
    const tol = o.tolerance ?? 0
    doc.palette.forEach((c, i) => {
      if (i === 0) return
      if (c === hex || (tol > 0 && labDist2(hexLab(c), fromLab) <= tol * tol)) sources.add(i)
    })
    if (sources.size === 0) throw new Error(`color ${from} is not in the palette`)
  }
  sources.delete(toIdx)
  let n = 0
  eachCel(doc, o.layer, (cel) => {
    for (let i = 0; i < cel.length; i++)
      if (sources.has(cel[i])) {
        cel[i] = toIdx
        n++
      }
  })
  return n
}

function hexLab(hex: string): Lab {
  const [r, g, b] = parseHex(hex)
  return rgbToOklab(r, g, b)
}

export function setPaletteColor(doc: PixelDoc, index: number, color: string): void {
  if (index <= 0 || index >= doc.palette.length) throw new Error(`palette index ${index} out of range`)
  doc.palette[index] = normHex(color)
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]

/** Replace the palette with `colors` and remap every pixel to the nearest new color. */
export function applyPalette(
  doc: PixelDoc,
  colors: string[],
  o: { dither?: boolean; ditherStrength?: number } = {},
) {
  const newPalette = [TRANSPARENT, ...colors.map(normHex).filter((c) => c !== TRANSPARENT)]
  if (newPalette.length > 256) throw new Error('palette exceeds 256 colors')
  const old = doc.palette.map(parseHex)
  const matcher = new PaletteMatcher(newPalette)
  const direct = old.map(([r, g, b, a], i) => (i === 0 || a === 0 ? 0 : matcher.nearest(r, g, b)))
  const strength = o.ditherStrength ?? 24
  for (const l of doc.layers)
    for (const f of doc.frames) {
      const cel = getCel(doc, l.id, f.id)
      for (let p = 0; p < cel.length; p++) {
        const v = cel[p]
        if (v === 0) continue
        if (!o.dither) {
          cel[p] = direct[v]
          continue
        }
        const x = p % doc.width
        const y = (p - x) / doc.width
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 16 - 0.5) * strength
        const [r, g, b] = old[v]
        cel[p] = matcher.nearest(clamp(r + t), clamp(g + t), clamp(b + t))
      }
    }
  doc.palette = newPalette
  compactPalette(doc)
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/** Reduce to at most n colors (weighted k-means over used colors). */
export function reduceColors(doc: PixelDoc, n: number): string[] {
  const counts = new Map<number, number>()
  for (const c of Object.values(doc.cels)) for (const v of c) if (v) counts.set(v, (counts.get(v) ?? 0) + 1)
  if (counts.size <= n) return doc.palette.slice(1)
  const colors = [...counts.entries()].map(([idx, count]) => {
    const [r, g, b] = parseHex(doc.palette[idx])
    return { rgb: (r << 16) | (g << 8) | b, count, lab: rgbToOklab(r, g, b) }
  })
  const pal = kmeansPalette(colors, n, { seed: 7 })
  applyPalette(doc, pal)
  return pal
}

/** Drop unused palette entries and remap indices (index 0 stays transparent). */
export function compactPalette(doc: PixelDoc): void {
  const used = new Set<number>()
  for (const c of Object.values(doc.cels)) for (const v of c) used.add(v)
  const remap = new Uint8Array(doc.palette.length)
  const next = [TRANSPARENT]
  const seen = new Map<string, number>()
  for (let i = 1; i < doc.palette.length; i++) {
    if (!used.has(i)) continue
    const hex = doc.palette[i]
    const existing = seen.get(hex)
    if (existing !== undefined) {
      remap[i] = existing
      continue
    }
    remap[i] = next.length
    seen.set(hex, next.length)
    next.push(hex)
  }
  for (const c of Object.values(doc.cels)) for (let p = 0; p < c.length; p++) c[p] = remap[c[p]]
  doc.palette = next
}

/** Draw an outline around the visible sprite into `layer` (default: top layer). */
export function addOutline(
  doc: PixelDoc,
  color: string | number,
  o: { mode?: 'outer' | 'inner'; layer?: string; diagonal?: boolean } = {},
): number {
  const idx = typeof color === 'number' ? color : ensureColor(doc, color)
  const target = targetLayers(doc, o.layer ?? doc.layers[doc.layers.length - 1].id)[0]
  const { width: w, height: h } = doc
  let n = 0
  for (const f of doc.frames) {
    const mask = flattenIndices(doc, f.id)
    const cel = getCel(doc, target.id, f.id)
    const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 0
    const neighbors = (x: number, y: number) => {
      const ns: [number, number][] = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ]
      if (o.diagonal) ns.push([x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1])
      return ns
    }
    const writes: number[] = []
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const isOpaque = opaque(x, y)
        if ((o.mode ?? 'outer') === 'outer') {
          if (!isOpaque && neighbors(x, y).some(([a, b]) => opaque(a, b))) writes.push(y * w + x)
        } else if (isOpaque && neighbors(x, y).some(([a, b]) => !opaque(a, b))) writes.push(y * w + x)
      }
    for (const p of writes)
      if (cel[p] !== idx) {
        cel[p] = idx
        n++
      }
  }
  return n
}

/** Clear the region connected to the canvas edges that has the dominant border color. */
export function removeBackground(doc: PixelDoc, o: { layer?: string; tolerance?: number } = {}): number {
  const { width: w, height: h } = doc
  const labs = doc.palette.map((c, i) => (i === 0 ? null : hexLab(c)))
  const tol = (o.tolerance ?? 0.02) ** 2
  let n = 0
  eachCel(doc, o.layer, (cel) => {
    const counts = new Map<number, number>()
    const border: number[] = []
    for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x)
    for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1)
    for (const p of border) if (cel[p]) counts.set(cel[p], (counts.get(cel[p]) ?? 0) + 1)
    if (counts.size === 0) return
    const bg = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    const bgLab = labs[bg]!
    const match = (v: number) => v !== 0 && (v === bg || labDist2(labs[v]!, bgLab) <= tol)
    const seen = new Uint8Array(w * h)
    const stack = border.filter((p) => match(cel[p]))
    while (stack.length) {
      const p = stack.pop()!
      if (seen[p] || !match(cel[p])) continue
      seen[p] = 1
      cel[p] = 0
      n++
      const x = p % w
      const y = (p - x) / w
      if (x > 0) stack.push(p - 1)
      if (x < w - 1) stack.push(p + 1)
      if (y > 0) stack.push(p - w)
      if (y < h - 1) stack.push(p + w)
    }
  })
  return n
}

export type Anchor =
  | 'center'
  | 'top-left'
  | 'top'
  | 'top-right'
  | 'left'
  | 'right'
  | 'bottom-left'
  | 'bottom'
  | 'bottom-right'

function remapCels(doc: PixelDoc, nw: number, nh: number, src: (x: number, y: number) => number | null) {
  if (nw < 1 || nh < 1 || nw > MAX_SIDE || nh > MAX_SIDE) throw new Error(`size must be 1..${MAX_SIDE}`)
  const ow = doc.width
  for (const [k, cel] of Object.entries(doc.cels)) {
    const out = new Uint8Array(nw * nh)
    for (let y = 0; y < nh; y++)
      for (let x = 0; x < nw; x++) {
        const s = src(x, y)
        if (s !== null) out[y * nw + x] = cel[s]
      }
    doc.cels[k] = out
  }
  void ow
  doc.width = nw
  doc.height = nh
}

export function resizeCanvas(doc: PixelDoc, width: number, height: number, anchor: Anchor = 'center'): void {
  const ow = doc.width
  const oh = doc.height
  const ax = anchor.includes('left') ? 0 : anchor.includes('right') ? 1 : 0.5
  const ay = anchor.startsWith('top') ? 0 : anchor.startsWith('bottom') ? 1 : 0.5
  const dx = Math.round((width - ow) * ax)
  const dy = Math.round((height - oh) * ay)
  remapCels(doc, width, height, (x, y) => {
    const sx = x - dx
    const sy = y - dy
    return sx >= 0 && sy >= 0 && sx < ow && sy < oh ? sy * ow + sx : null
  })
}

/** Nearest-neighbor scale to an exact size. */
export function scaleTo(doc: PixelDoc, width: number, height: number): void {
  const ow = doc.width
  const oh = doc.height
  remapCels(doc, width, height, (x, y) => Math.floor((y * oh) / height) * ow + Math.floor((x * ow) / width))
}

export function flip(doc: PixelDoc, axis: 'horizontal' | 'vertical', layer?: string): void {
  const { width: w, height: h } = doc
  eachCel(doc, layer, (cel) => {
    const src = cel.slice()
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        cel[y * w + x] = axis === 'horizontal' ? src[y * w + (w - 1 - x)] : src[(h - 1 - y) * w + x]
  })
}

export function rotate90(doc: PixelDoc, direction: 'cw' | 'ccw' = 'cw'): void {
  const ow = doc.width
  const oh = doc.height
  remapCels(doc, oh, ow, (x, y) => (direction === 'cw' ? (oh - 1 - x) * ow + y : x * ow + (ow - 1 - y)))
}

export function contentBounds(doc: PixelDoc): { x: number; y: number; w: number; h: number } | null {
  let x0 = doc.width
  let y0 = doc.height
  let x1 = -1
  let y1 = -1
  for (const cel of Object.values(doc.cels))
    for (let p = 0; p < cel.length; p++)
      if (cel[p]) {
        const x = p % doc.width
        const y = (p - x) / doc.width
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function cropToContent(doc: PixelDoc, padding = 0): void {
  const b = contentBounds(doc)
  if (!b) throw new Error('canvas is empty')
  const x = Math.max(0, b.x - padding)
  const y = Math.max(0, b.y - padding)
  const w = Math.min(doc.width - x, b.w + padding * 2)
  const h = Math.min(doc.height - y, b.h + padding * 2)
  crop(doc, x, y, w, h)
}

export function crop(doc: PixelDoc, x: number, y: number, w: number, h: number): void {
  const ow = doc.width
  remapCels(doc, w, h, (cx, cy) => (cy + y) * ow + (cx + x))
}

/** Rotate hue of palette entries (all, or only those given). */
export function shiftHue(doc: PixelDoc, degrees: number, indices?: number[]): number {
  const set = indices ? new Set(indices) : null
  let n = 0
  doc.palette = doc.palette.map((c, i) => {
    if (i === 0 || (set && !set.has(i))) return c
    n++
    return shiftHueHex(c, degrees)
  })
  return n
}

/** Paste an indexed image (own palette) into a cel at (x,y), mapping colors into the doc palette. */
export function pasteIndexed(
  doc: PixelDoc,
  layerId: string,
  frameId: string,
  img: { width: number; height: number; palette: string[]; pixels: Uint8Array },
  at: { x: number; y: number } = { x: 0, y: 0 },
  o: { keepPalette?: boolean; mask?: Uint8Array } = {},
): void {
  const cel = getCel(doc, layerId, frameId)
  const map = new Uint8Array(img.palette.length)
  const matcher = o.keepPalette ? new PaletteMatcher(doc.palette) : null
  for (let i = 1; i < img.palette.length; i++) {
    if (matcher) {
      const [r, g, b] = parseHex(img.palette[i])
      map[i] = matcher.nearest(r, g, b)
    } else map[i] = ensureColor(doc, img.palette[i])
  }
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const v = img.pixels[y * img.width + x]
      if (!v) continue
      const tx = x + at.x
      const ty = y + at.y
      if (tx < 0 || ty < 0 || tx >= doc.width || ty >= doc.height) continue
      const p = ty * doc.width + tx
      if (o.mask && !o.mask[p]) continue
      cel[p] = map[v]
    }
}

export { celKey }
