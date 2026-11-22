export type RGBA = [number, number, number, number]
export type Lab = [number, number, number]

export function parseHex(hex: string): RGBA {
  let h = hex.trim().replace(/^#/, '').toLowerCase()
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('')
  if (h.length === 6) h += 'ff'
  if (!/^[0-9a-f]{8}$/.test(h)) throw new Error(`invalid color "${hex}"`)
  return [
    Number.parseInt(h.slice(0, 2), 16),
    Number.parseInt(h.slice(2, 4), 16),
    Number.parseInt(h.slice(4, 6), 16),
    Number.parseInt(h.slice(6, 8), 16),
  ]
}

const hex2 = (n: number) =>
  Math.max(0, Math.min(255, Math.round(n)))
    .toString(16)
    .padStart(2, '0')

export function toHex(r: number, g: number, b: number, a = 255): string {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${hex2(a)}`
}

/** Normalize any accepted color string to "#rrggbbaa". */
export function normHex(hex: string): string {
  const [r, g, b, a] = parseHex(hex)
  return toHex(r, g, b, a)
}

const srgbToLinear = (c: number) => {
  const x = c / 255
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
}
const linearToSrgb = (x: number) => {
  const v = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, Math.round(v * 255)))
}

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = srgbToLinear(r)
  const lg = srgbToLinear(g)
  const lb = srgbToLinear(b)
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

export function oklabToRgb(L: number, a: number, b: number): [number, number, number] {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

export function labDist2(a: Lab, b: Lab): number {
  const dl = a[0] - b[0]
  const da = a[1] - b[1]
  const db = a[2] - b[2]
  return dl * dl + da * da + db * db
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = parseHex(hex)
  return rgbToOklab(r, g, b)
}

/** Precomputed palette lookup: nearest opaque palette index (index 0 = transparent is skipped). */
export class PaletteMatcher {
  readonly palette: string[]
  private labs: (Lab | null)[]
  private cache = new Map<number, number>()
  constructor(palette: string[]) {
    this.palette = palette
    this.labs = palette.map((h, i) => {
      if (i === 0) return null
      const [r, g, b, a] = parseHex(h)
      return a === 0 ? null : rgbToOklab(r, g, b)
    })
  }
  nearest(r: number, g: number, b: number): number {
    const key = (r << 16) | (g << 8) | b
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const lab = rgbToOklab(r, g, b)
    let best = -1
    let bestD = Number.POSITIVE_INFINITY
    for (let i = 1; i < this.labs.length; i++) {
      const l = this.labs[i]
      if (!l) continue
      const d = labDist2(lab, l)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (best < 0) best = 0
    this.cache.set(key, best)
    return best
  }
}

/** Rotate hue in OKLCh by `degrees`. */
export function shiftHueHex(hex: string, degrees: number): string {
  const [r, g, b, a] = parseHex(hex)
  const [L, A, B] = rgbToOklab(r, g, b)
  const C = Math.hypot(A, B)
  const h = Math.atan2(B, A) + (degrees * Math.PI) / 180
  const [nr, ng, nb] = oklabToRgb(L, C * Math.cos(h), C * Math.sin(h))
  return toHex(nr, ng, nb, a)
}
