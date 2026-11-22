import { type Lab, labDist2, oklabToRgb, rgbToOklab, toHex } from './color.ts'

/** Deterministic PRNG (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface WeightedColor {
  lab: Lab
  rgb: number
  count: number
}

/** Collect opaque colors (alpha >= 128) with counts. */
export function histogram(rgba: Uint8ClampedArray | Uint8Array): WeightedColor[] {
  const counts = new Map<number, number>()
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    const key = (rgba[i] << 16) | (rgba[i + 1] << 8) | rgba[i + 2]
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([rgb, count]) => ({ rgb, count, lab: rgbToOklab((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255) }))
}

/**
 * Weighted k-means in OKLab with k-means++ init and a fixed seed (deterministic).
 * Clusters closer than `mergeDist` are merged. Returns "#rrggbbff" colors.
 */
export function kmeansPalette(
  colors: WeightedColor[],
  k: number,
  o: { seed?: number; iterations?: number; mergeDist?: number } = {},
): string[] {
  if (colors.length === 0) return []
  const toHexLab = (l: Lab) => {
    const [r, g, b] = oklabToRgb(l[0], l[1], l[2])
    return toHex(r, g, b, 255)
  }
  if (colors.length <= k) return dedupe(colors.map((c) => c.lab)).map(toHexLab)
  const rand = rng(o.seed ?? 1337)
  // k-means++ init: heaviest color first, then weighted by distance²
  const centers: Lab[] = [[...colors.reduce((a, b) => (b.count > a.count ? b : a)).lab] as Lab]
  const d2 = new Float64Array(colors.length).fill(Number.POSITIVE_INFINITY)
  while (centers.length < k) {
    const last = centers[centers.length - 1]
    let total = 0
    for (let i = 0; i < colors.length; i++) {
      d2[i] = Math.min(d2[i], labDist2(colors[i].lab, last))
      total += d2[i] * colors[i].count
    }
    if (total === 0) break
    let r = rand() * total
    let pick = colors.length - 1
    for (let i = 0; i < colors.length; i++) {
      r -= d2[i] * colors[i].count
      if (r <= 0) {
        pick = i
        break
      }
    }
    centers.push([...colors[pick].lab] as Lab)
  }
  const assign = new Int32Array(colors.length)
  for (let it = 0; it < (o.iterations ?? 16); it++) {
    let moved = false
    for (let i = 0; i < colors.length; i++) {
      let best = 0
      let bd = Number.POSITIVE_INFINITY
      for (let c = 0; c < centers.length; c++) {
        const d = labDist2(colors[i].lab, centers[c])
        if (d < bd) {
          bd = d
          best = c
        }
      }
      if (assign[i] !== best) moved = true
      assign[i] = best
    }
    const sums = centers.map(() => [0, 0, 0, 0])
    for (let i = 0; i < colors.length; i++) {
      const s = sums[assign[i]]
      const w = colors[i].count
      s[0] += colors[i].lab[0] * w
      s[1] += colors[i].lab[1] * w
      s[2] += colors[i].lab[2] * w
      s[3] += w
    }
    for (let c = 0; c < centers.length; c++)
      if (sums[c][3] > 0)
        centers[c] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]]
    if (!moved && it > 0) break
  }
  const merged = mergeClose(centers, o.mergeDist ?? 0.02)
  return dedupe(merged)
    .map(toHexLab)
    .filter((h, i, a) => a.indexOf(h) === i)
}

function mergeClose(centers: Lab[], dist: number): Lab[] {
  const out: Lab[] = []
  const d2 = dist * dist
  for (const c of centers) if (!out.some((o) => labDist2(o, c) < d2)) out.push(c)
  return out
}

function dedupe(labs: Lab[]): Lab[] {
  return mergeClose(labs, 1e-6)
}
