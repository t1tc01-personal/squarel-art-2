import { decode, encode } from 'fast-png'
import type { Raster } from './preview.ts'

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const dv = new DataView(out.buffer)
  dv.setUint32(0, data.length)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)))
  return out
}

/** Insert a pHYs chunk (pixels per metre) right after IHDR. */
export function withDpi(png: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const body = new Uint8Array(9)
  const dv = new DataView(body.buffer)
  dv.setUint32(0, ppm)
  dv.setUint32(4, ppm)
  body[8] = 1
  const phys = chunk('pHYs', body)
  const ihdrEnd = 8 + 12 + 13 // signature + IHDR chunk
  const out = new Uint8Array(png.length + phys.length)
  out.set(png.subarray(0, ihdrEnd), 0)
  out.set(phys, ihdrEnd)
  out.set(png.subarray(ihdrEnd), ihdrEnd + phys.length)
  return out
}

/** Read DPI from a pHYs chunk if present. */
export function readDpi(png: Uint8Array): number | undefined {
  let p = 8
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength)
  while (p + 8 <= png.length) {
    const len = dv.getUint32(p)
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8))
    if (type === 'pHYs' && png[p + 16] === 1) return Math.round(dv.getUint32(p + 8) * 0.0254)
    if (type === 'IDAT') return undefined
    p += 12 + len
  }
  return undefined
}

export function encodePng(r: Raster, o: { dpi?: number } = {}): Uint8Array {
  const png = encode({ width: r.width, height: r.height, data: r.data, channels: 4, depth: 8 })
  return o.dpi ? withDpi(png, o.dpi) : png
}

export function decodePng(bytes: Uint8Array): Raster {
  const d = decode(bytes)
  const out = new Uint8ClampedArray(d.width * d.height * 4)
  const n = d.width * d.height
  const src = d.data
  const shift = d.depth === 16 ? 8 : 0
  if (d.palette) {
    const pal = d.palette as unknown as number[][]
    for (let p = 0; p < n; p++) {
      const c = pal[src[p]] ?? [0, 0, 0, 0]
      out[p * 4] = c[0]
      out[p * 4 + 1] = c[1]
      out[p * 4 + 2] = c[2]
      out[p * 4 + 3] = c.length > 3 ? c[3] : (d.transparency?.[src[p]] ?? 255)
    }
    return { data: out, width: d.width, height: d.height }
  }
  const ch = d.channels
  for (let p = 0; p < n; p++) {
    const v = (k: number) => src[p * ch + k] >> shift
    if (ch === 1 || ch === 2) {
      out[p * 4] = out[p * 4 + 1] = out[p * 4 + 2] = v(0)
      out[p * 4 + 3] = ch === 2 ? v(1) : 255
    } else {
      out[p * 4] = v(0)
      out[p * 4 + 1] = v(1)
      out[p * 4 + 2] = v(2)
      out[p * 4 + 3] = ch === 4 ? v(3) : 255
    }
  }
  return { data: out, width: d.width, height: d.height }
}
