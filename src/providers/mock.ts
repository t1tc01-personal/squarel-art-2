import { parseHex, shiftHueHex, toHex } from '../core/color.ts'
import { decodePng, encodePng } from '../core/png.ts'
import { rng } from '../core/quantize.ts'
import type { AnimRequest, EditRequest, GenRequest, ImageProvider, Quote, RawImage } from './types.ts'

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return h >>> 0
}

const DEFAULT_COLORS = ['#2b2b3a', '#d04648', '#f2c94c', '#6daa2c', '#597dce', '#deeed6']

/** Symmetric "identicon" sprite on a magenta background, upscaled like an AI image would be. */
export function mockSprite(seed: number, grid: number, colors: string[], scale = 512 / grid, noise = 8) {
  const rand = rng(seed)
  const cols = colors.length ? colors : DEFAULT_COLORS
  const cells: (string | null)[] = new Array(grid * grid).fill(null)
  const pad = Math.max(1, Math.floor(grid / 8))
  for (let y = pad; y < grid - pad; y++)
    for (let x = pad; x <= Math.floor((grid - 1) / 2); x++) {
      if (rand() < 0.55) {
        const c = cols[Math.floor(rand() * cols.length)]
        cells[y * grid + x] = c
        cells[y * grid + (grid - 1 - x)] = c
      }
    }
  const size = Math.round(grid * scale)
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = cells[Math.floor(y / scale) * grid + Math.floor(x / scale)]
      const [r, g, b] = c ? parseHex(c) : [255, 0, 255]
      const n = (rand() - 0.5) * noise
      const i = (y * size + x) * 4
      data[i] = r + n
      data[i + 1] = g + n
      data[i + 2] = b + n
      data[i + 3] = 255
    }
  return { data, width: size, height: size }
}

/** Offline provider for development and tests: deterministic, free, no network. */
export class MockProvider implements ImageProvider {
  readonly id = 'mock' as const
  readonly capabilities = {
    generate: true,
    edit: true,
    inpaint: true,
    animate: true,
    nativePixel: false,
    paletteInput: true,
    paid: false,
  }
  configured() {
    return true
  }
  async health() {
    return true
  }
  async quote(): Promise<Quote> {
    return { usd: 0, units: 0, unitKind: 'none', model: 'mock' }
  }
  async generate(req: GenRequest): Promise<RawImage[]> {
    const grid = Math.max(8, Math.min(32, Math.max(req.width, req.height)))
    return Array.from({ length: req.variants }, (_, i) => {
      const seed = (req.seed ?? hash(req.prompt)) + i * 7919
      return {
        bytes: encodePng(mockSprite(seed, grid, req.palette ?? [], Math.max(4, Math.floor(512 / grid)))),
        seed,
      }
    })
  }
  /** Edit = hue-rotate the masked (or whole) area of the input, so tests can see a change. */
  async edit(req: EditRequest): Promise<RawImage[]> {
    const img = decodePng(req.image)
    const mask = req.mask ? decodePng(req.mask) : null
    return Array.from({ length: req.variants }, (_, v) => {
      const out = new Uint8ClampedArray(img.data)
      for (let p = 0; p < img.width * img.height; p++) {
        const i = p * 4
        if (mask && mask.data[i] < 128) continue
        if (out[i + 3] === 0) continue
        const [r, g, b] = parseHex(shiftHueHex(toHex(out[i], out[i + 1], out[i + 2]), 120 + v * 30))
        out[i] = r
        out[i + 1] = g
        out[i + 2] = b
      }
      return { bytes: encodePng({ data: out, width: img.width, height: img.height }), seed: v }
    })
  }
  async animate(req: AnimRequest): Promise<RawImage[]> {
    const grid = Math.max(8, Math.min(32, Math.max(req.width, req.height)))
    const scale = Math.max(4, Math.floor(256 / grid))
    return Array.from({ length: req.variants }, (_, v) => {
      const base = mockSprite((req.seed ?? hash(req.prompt)) + v, grid, req.palette ?? [], scale, 0)
      const fw = base.width
      const sheet = new Uint8ClampedArray(fw * req.frames * base.height * 4)
      for (let f = 0; f < req.frames; f++) {
        const dy = (f % 2) * scale // bob up and down
        for (let y = 0; y < base.height; y++)
          for (let x = 0; x < fw; x++) {
            const sy = Math.min(base.height - 1, Math.max(0, y - dy))
            const si = (sy * fw + x) * 4
            const oi = (y * fw * req.frames + f * fw + x) * 4
            sheet.set(base.data.subarray(si, si + 4), oi)
          }
      }
      return {
        bytes: encodePng({ data: sheet, width: fw * req.frames, height: base.height }),
        frames: req.frames,
      }
    })
  }
}
