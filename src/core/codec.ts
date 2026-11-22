import type { PixelDoc, PixelDocJSON } from '../shared/types.ts'

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP = new Int16Array(128).fill(-1)
for (let i = 0; i < B64.length; i++) B64_LOOKUP[B64.charCodeAt(i)] = i

export function toBase64(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}==`
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += `${B64[(n >> 18) & 63]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`
  }
  return out
}

export function fromBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '')
  const len = Math.floor((clean.length * 3) / 4)
  const out = new Uint8Array(len)
  let o = 0
  for (let i = 0; i < clean.length; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)]
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)]
    const c = i + 2 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 2)] : 0
    const d = i + 3 < clean.length ? B64_LOOKUP[clean.charCodeAt(i + 3)] : 0
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error('invalid base64')
    const n = (a << 18) | (b << 12) | (c << 6) | d
    if (o < len) out[o++] = (n >> 16) & 255
    if (o < len) out[o++] = (n >> 8) & 255
    if (o < len) out[o++] = n & 255
  }
  return out
}

/** RLE: sequence of [runLength as unsigned LEB128 varint, paletteIndex u8]. */
export function rleEncode(indices: Uint8Array): Uint8Array {
  const out: number[] = []
  let i = 0
  while (i < indices.length) {
    const v = indices[i]
    let run = 1
    while (i + run < indices.length && indices[i + run] === v) run++
    let n = run
    while (n >= 0x80) {
      out.push((n & 0x7f) | 0x80)
      n >>>= 7
    }
    out.push(n, v)
    i += run
  }
  return Uint8Array.from(out)
}

export function rleDecode(bytes: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength)
  let o = 0
  let i = 0
  while (i < bytes.length) {
    let run = 0
    let shift = 0
    for (;;) {
      if (i >= bytes.length) throw new Error('truncated RLE varint')
      const b = bytes[i++]
      run |= (b & 0x7f) << shift
      if ((b & 0x80) === 0) break
      shift += 7
    }
    if (i >= bytes.length) throw new Error('truncated RLE value')
    const v = bytes[i++]
    if (o + run > expectedLength) throw new Error('RLE overflows cel size')
    out.fill(v, o, o + run)
    o += run
  }
  if (o !== expectedLength) throw new Error(`RLE length ${o} != expected ${expectedLength}`)
  return out
}

export const encodeCel = (indices: Uint8Array): string => toBase64(rleEncode(indices))
export const decodeCel = (s: string, size: number): Uint8Array => rleDecode(fromBase64(s), size)

export function celKey(layerId: string, frameId: string): string {
  return `${layerId}:${frameId}`
}

export function serializeDoc(doc: PixelDoc): PixelDocJSON {
  const cels: Record<string, string> = {}
  for (const [k, v] of Object.entries(doc.cels)) cels[k] = encodeCel(v)
  return {
    v: 1,
    width: doc.width,
    height: doc.height,
    palette: [...doc.palette],
    layers: doc.layers.map((l) => ({ ...l })),
    frames: doc.frames.map((f) => ({ ...f })),
    cels,
    meta: structuredClone(doc.meta),
  }
}

export function deserializeDoc(json: PixelDocJSON): PixelDoc {
  const size = json.width * json.height
  const cels: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(json.cels)) cels[k] = decodeCel(v, size)
  return {
    v: 1,
    width: json.width,
    height: json.height,
    palette: [...json.palette],
    layers: json.layers.map((l) => ({ ...l })),
    frames: json.frames.map((f) => ({ ...f })),
    cels,
    meta: structuredClone(json.meta),
  }
}
