import { TRANSPARENT } from '../shared/types.ts'
import { labDist2, normHex, PaletteMatcher, rgbToOklab } from './color.ts'
import { histogram, kmeansPalette } from './quantize.ts'

export interface RGBAImage {
  data: Uint8ClampedArray | Uint8Array
  width: number
  height: number
}

export interface NormalizeOptions {
  target?: { width: number; height: number }
  /** Force output onto these colors (opaque hex; transparent added automatically). */
  palette?: string[]
  /** Max colors when no palette is given (default 16). */
  maxColors?: number
  /** Default: true when the image has no transparency. */
  removeBackground?: boolean
  /** Default: true. */
  despeckle?: boolean
  seed?: number
}

export interface NormalizeReport {
  blockSize: number
  offset: [number, number]
  gridConfidence: number
  colorCount: number
  transparentRatio: number
  backgroundRemoved: boolean
  warnings: string[]
}

export interface NormalizeResult {
  width: number
  height: number
  /** index 0 = transparent */
  palette: string[]
  pixels: Uint8Array
  report: NormalizeReport
}

const EDGE_DE = 0.03
const BG_DE = 0.06

function labAt(d: Uint8ClampedArray, i: number) {
  return rgbToOklab(d[i], d[i + 1], d[i + 2])
}

export function removeBackgroundRGBA(img: {
  data: Uint8ClampedArray
  width: number
  height: number
}): boolean {
  const { data, width: w, height: h } = img
  const counts = new Map<number, number>()
  const borderIdx: number[] = []
  for (let x = 0; x < w; x++) borderIdx.push(x, (h - 1) * w + x)
  for (let y = 0; y < h; y++) borderIdx.push(y * w, y * w + w - 1)
  for (const p of borderIdx) {
    const i = p * 4
    if (data[i + 3] === 0) continue
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  if (counts.size === 0) return false
  const [bestKey, bestCount] = [...counts.entries()].reduce((a, b) => (b[1] > a[1] ? b : a))
  if (bestCount < borderIdx.length * 0.3) return false // no dominant border color → probably not a flat background
  const bg = rgbToOklab(((bestKey >> 10) & 31) * 8 + 4, ((bestKey >> 5) & 31) * 8 + 4, (bestKey & 31) * 8 + 4)
  const thr = BG_DE * BG_DE
  const seen = new Uint8Array(w * h)
  const stack: number[] = []
  for (const p of borderIdx) stack.push(p)
  let removed = 0
  while (stack.length) {
    const p = stack.pop()!
    if (seen[p]) continue
    seen[p] = 1
    const i = p * 4
    if (data[i + 3] !== 0 && labDist2(labAt(data, i), bg) > thr) continue
    if (data[i + 3] !== 0) removed++
    data[i + 3] = 0
    const x = p % w
    const y = (p - x) / w
    if (x > 0) stack.push(p - 1)
    if (x < w - 1) stack.push(p + 1)
    if (y > 0) stack.push(p - w)
    if (y < h - 1) stack.push(p + w)
  }
  return removed > 0
}

function differs(d: Uint8ClampedArray, i: number, j: number): boolean {
  const ai = d[i + 3] > 0
  const aj = d[j + 3] > 0
  if (ai !== aj) return true
  if (!ai) return false
  if (d[i] === d[j] && d[i + 1] === d[j + 1] && d[i + 2] === d[j + 2]) return false
  return labDist2(labAt(d, i), labAt(d, j)) > EDGE_DE * EDGE_DE
}

/** Score candidate block sizes along one axis; returns best (size, offset, score). */
function detectAxis(signal: Float64Array, maxSize: number): { size: number; offset: number; score: number } {
  const total = signal.reduce((a, b) => a + b, 0)
  if (total === 0) return { size: 1, offset: 0, score: 0 }
  let best = { size: 1, offset: 0, score: 0 }
  for (let s = 2; s <= maxSize; s++) {
    for (let o = 0; o < s; o++) {
      let hit = 0
      for (let x = o === 0 ? s : o; x < signal.length; x += s) hit += signal[x]
      const raw = hit / total
      const chance = 1 / s
      const score = (raw - chance) / (1 - chance)
      // prefer larger sizes when scores are (nearly) tied: a true grid of 16 also scores perfectly at 8
      if (score > best.score + 0.02 || (score >= best.score - 0.02 && s > best.size && score > 0.5)) {
        best = { size: s, offset: o, score }
      }
    }
  }
  return best
}

export function detectGrid(img: { data: Uint8ClampedArray; width: number; height: number }) {
  const { data, width: w, height: h } = img
  const col = new Float64Array(w)
  const row = new Float64Array(h)
  for (let y = 0; y < h; y++)
    for (let x = 1; x < w; x++) if (differs(data, (y * w + x) * 4, (y * w + x - 1) * 4)) col[x]++
  for (let y = 1; y < h; y++)
    for (let x = 0; x < w; x++) if (differs(data, (y * w + x) * 4, ((y - 1) * w + x) * 4)) row[y]++
  const maxSize = Math.max(2, Math.min(64, Math.floor(Math.min(w, h) / 4)))
  const ax = detectAxis(col, maxSize)
  const ay = detectAxis(row, maxSize)
  let size = ax.size
  let conf = Math.min(ax.score, ay.score)
  if (ax.size !== ay.size) {
    // axes disagree: trust the stronger one but penalize confidence
    size = ax.score >= ay.score ? ax.size : ay.size
    conf *= 0.6
  }
  if (conf < 0.35) return { size: 1, offset: [0, 0] as [number, number], confidence: Math.max(0, conf) }
  return {
    size,
    offset: [ax.size === size ? ax.offset : 0, ay.size === size ? ay.offset : 0] as [number, number],
    confidence: conf,
  }
}

/** Mode color of a region (bucketed), with transparency majority. Returns [r,g,b,a]. */
function regionMode(
  d: Uint8ClampedArray,
  w: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): [number, number, number, number] {
  let transparent = 0
  let total = 0
  const buckets = new Map<number, [number, number, number, number]>()
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4
      total++
      if (d[i + 3] === 0) {
        transparent++
        continue
      }
      const key = ((d[i] >> 3) << 10) | ((d[i + 1] >> 3) << 5) | (d[i + 2] >> 3)
      const b = buckets.get(key)
      if (b) {
        b[0] += d[i]
        b[1] += d[i + 1]
        b[2] += d[i + 2]
        b[3]++
      } else buckets.set(key, [d[i], d[i + 1], d[i + 2], 1])
    }
  if (total === 0 || transparent * 2 > total || buckets.size === 0) return [0, 0, 0, 0]
  let best: [number, number, number, number] = [0, 0, 0, 0]
  let bestKey = -1
  for (const [k, b] of buckets)
    if (b[3] > best[3] || (b[3] === best[3] && k < bestKey)) {
      best = b
      bestKey = k
    }
  return [Math.round(best[0] / best[3]), Math.round(best[1] / best[3]), Math.round(best[2] / best[3]), 255]
}

function downsampleToGrid(
  img: { data: Uint8ClampedArray; width: number; height: number },
  size: number,
  offset: [number, number],
) {
  if (size <= 1) return { data: img.data, width: img.width, height: img.height }
  const nx = Math.floor((img.width - offset[0]) / size)
  const ny = Math.floor((img.height - offset[1]) / size)
  const out = new Uint8ClampedArray(nx * ny * 4)
  const inset = size >= 4 ? Math.floor(size / 4) : 0 // ignore anti-aliased cell borders
  for (let gy = 0; gy < ny; gy++)
    for (let gx = 0; gx < nx; gx++) {
      const x0 = offset[0] + gx * size
      const y0 = offset[1] + gy * size
      const c = regionMode(img.data, img.width, x0 + inset, y0 + inset, x0 + size - inset, y0 + size - inset)
      out.set(c, (gy * nx + gx) * 4)
    }
  return { data: out, width: nx, height: ny }
}

/** Resample by region mode into target size, preserving aspect ratio (contain + center). */
function resampleContain(
  img: { data: Uint8ClampedArray; width: number; height: number },
  tw: number,
  th: number,
) {
  if (img.width === tw && img.height === th) return img
  const scale = Math.min(tw / img.width, th / img.height)
  const cw = Math.max(1, Math.round(img.width * scale))
  const ch = Math.max(1, Math.round(img.height * scale))
  const ox = Math.floor((tw - cw) / 2)
  const oy = Math.floor((th - ch) / 2)
  const out = new Uint8ClampedArray(tw * th * 4)
  for (let y = 0; y < ch; y++)
    for (let x = 0; x < cw; x++) {
      const sx0 = Math.floor((x * img.width) / cw)
      const sy0 = Math.floor((y * img.height) / ch)
      const sx1 = Math.max(sx0 + 1, Math.floor(((x + 1) * img.width) / cw))
      const sy1 = Math.max(sy0 + 1, Math.floor(((y + 1) * img.height) / ch))
      out.set(regionMode(img.data, img.width, sx0, sy0, sx1, sy1), ((y + oy) * tw + (x + ox)) * 4)
    }
  return { data: out, width: tw, height: th }
}

/**
 * Remove stray specks: an opaque pixel whose 8 neighbours are all transparent becomes transparent,
 * and a transparent hole whose neighbours are all one opaque color is filled. Single-pixel details
 * inside a sprite (eyes, highlights) are intentional in pixel art and are kept.
 */
export function despeckle(pixels: Uint8Array, w: number, h: number): number {
  const src = pixels.slice()
  let changed = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = src[y * w + x]
      if (v !== 0 && !isolatedOnTransparent(src, w, h, x, y)) continue
      let other = -1
      let ok = true
      let n = 0
      for (let dy = -1; dy <= 1 && ok; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const nv = src[yy * w + xx]
          n++
          if (nv === v || (other !== -1 && nv !== other)) {
            ok = false
            break
          }
          other = nv
        }
      if (ok && n >= 3 && other !== -1) {
        pixels[y * w + x] = other
        changed++
      }
    }
  return changed
}

function isolatedOnTransparent(src: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
      if (src[yy * w + xx] !== 0) return false
    }
  return true
}

export function normalize(input: RGBAImage, o: NormalizeOptions = {}): NormalizeResult {
  const warnings: string[] = []
  const data = new Uint8ClampedArray(input.data)
  for (let i = 3; i < data.length; i += 4) data[i] = data[i] < 128 ? 0 : 255
  let img: { data: Uint8ClampedArray; width: number; height: number } = {
    data,
    width: input.width,
    height: input.height,
  }

  let hasAlpha = false
  for (let i = 3; i < data.length; i += 4)
    if (data[i] === 0) {
      hasAlpha = true
      break
    }
  let backgroundRemoved = false
  if (o.removeBackground ?? !hasAlpha) backgroundRemoved = removeBackgroundRGBA(img)

  const grid = detectGrid(img)
  img = downsampleToGrid(img, grid.size, grid.offset)
  if (o.target) img = resampleContain(img, o.target.width, o.target.height)
  let confidence = grid.confidence
  if (grid.size === 1) {
    if (o.target && input.width === o.target.width && input.height === o.target.height) confidence = 1
    else warnings.push('no pixel grid detected; image was resampled by area mode')
  }

  let palette: string[]
  if (o.palette && o.palette.length > 0) {
    palette = [TRANSPARENT, ...o.palette.map(normHex).filter((c) => c !== TRANSPARENT)]
  } else {
    const k = Math.max(2, Math.min(255, o.maxColors ?? 16))
    palette = [TRANSPARENT, ...kmeansPalette(histogram(img.data), k, { seed: o.seed })]
  }
  const matcher = new PaletteMatcher(palette)
  const pixels = new Uint8Array(img.width * img.height)
  for (let p = 0; p < pixels.length; p++) {
    const i = p * 4
    pixels[p] = img.data[i + 3] === 0 ? 0 : matcher.nearest(img.data[i], img.data[i + 1], img.data[i + 2])
  }
  if (o.despeckle ?? true) despeckle(pixels, img.width, img.height)

  // compact palette to used colors when it was generated (keep user palettes as-is)
  if (!o.palette) {
    const used = [...new Set(pixels)].filter((v) => v !== 0).sort((a, b) => a - b)
    const remap = new Uint8Array(palette.length)
    const compact = [TRANSPARENT]
    for (const u of used) {
      remap[u] = compact.length
      compact.push(palette[u])
    }
    for (let p = 0; p < pixels.length; p++) pixels[p] = remap[pixels[p]]
    palette = compact
  }

  let transparent = 0
  const usedSet = new Set<number>()
  for (const v of pixels) {
    if (v === 0) transparent++
    else usedSet.add(v)
  }
  const transparentRatio = transparent / pixels.length
  if (confidence < 0.6) warnings.push(`low grid confidence (${confidence.toFixed(2)})`)
  if (transparentRatio > 0.95) warnings.push('image is almost empty after background removal')
  return {
    width: img.width,
    height: img.height,
    palette,
    pixels,
    report: {
      blockSize: grid.size,
      offset: grid.offset,
      gridConfidence: Number(confidence.toFixed(3)),
      colorCount: usedSet.size,
      transparentRatio: Number(transparentRatio.toFixed(3)),
      backgroundRemoved,
      warnings,
    },
  }
}
