import { paletteColors } from '../shared/palettes.ts'
import {
  type Frame,
  type Layer,
  MAX_COLORS,
  MAX_SIDE,
  type PixelDoc,
  type Purpose,
  TRANSPARENT,
} from '../shared/types.ts'
import { celKey } from './codec.ts'
import { normHex, PaletteMatcher, parseHex } from './color.ts'

export function newId(prefix: string): string {
  const bytes = new Uint8Array(5)
  crypto.getRandomValues(bytes)
  return `${prefix}_${Array.from(bytes, (b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 8)}`
}

export interface CreateDocOptions {
  width: number
  height: number
  purpose: Purpose
  palette?: string[] | string
  title?: string
}

export function resolvePaletteInput(p: string[] | string | undefined): string[] {
  if (p === undefined) return paletteColors('pico8')!
  if (typeof p === 'string') {
    const c = paletteColors(p)
    if (!c) throw new Error(`unknown palette preset "${p}"`)
    return c
  }
  return p
}

export function createDoc(o: CreateDocOptions): PixelDoc {
  if (!Number.isInteger(o.width) || !Number.isInteger(o.height))
    throw new Error('width/height must be integers')
  if (o.width < 1 || o.height < 1 || o.width > MAX_SIDE || o.height > MAX_SIDE)
    throw new Error(`canvas must be 1..${MAX_SIDE} px per side`)
  const colors = resolvePaletteInput(o.palette).map(normHex)
  const palette = [TRANSPARENT, ...colors.filter((c) => c !== TRANSPARENT)]
  if (palette.length > MAX_COLORS) throw new Error(`palette exceeds ${MAX_COLORS} colors`)
  const layer: Layer = { id: newId('l'), name: 'Layer 1', visible: true, opacity: 255, locked: false }
  const frame: Frame = { id: newId('f'), durationMs: 100 }
  return {
    v: 1,
    width: o.width,
    height: o.height,
    palette,
    layers: [layer],
    frames: [frame],
    cels: { [celKey(layer.id, frame.id)]: new Uint8Array(o.width * o.height) },
    meta: { purpose: o.purpose, ...(o.title ? { title: o.title } : {}) },
  }
}

export function cloneDoc(doc: PixelDoc): PixelDoc {
  const cels: Record<string, Uint8Array> = {}
  for (const [k, v] of Object.entries(doc.cels)) cels[k] = v.slice()
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

export function getCel(doc: PixelDoc, layerId: string, frameId: string): Uint8Array {
  const k = celKey(layerId, frameId)
  let c = doc.cels[k]
  if (!c) {
    c = new Uint8Array(doc.width * doc.height)
    doc.cels[k] = c
  }
  return c
}

export function findLayer(doc: PixelDoc, ref?: string): Layer {
  if (ref === undefined) return doc.layers[doc.layers.length - 1]
  const l = doc.layers.find((x) => x.id === ref) ?? doc.layers.find((x) => x.name === ref)
  if (!l) throw new Error(`layer "${ref}" not found (layers: ${doc.layers.map((x) => x.name).join(', ')})`)
  return l
}

export function findFrame(doc: PixelDoc, ref?: string | number): Frame {
  if (ref === undefined) return doc.frames[0]
  if (typeof ref === 'number') {
    const f = doc.frames[ref]
    if (!f) throw new Error(`frame index ${ref} out of range (0..${doc.frames.length - 1})`)
    return f
  }
  const f = doc.frames.find((x) => x.id === ref)
  if (!f) throw new Error(`frame "${ref}" not found`)
  return f
}

export function validateDoc(doc: PixelDoc): void {
  const fail = (m: string) => {
    throw new Error(`invalid doc: ${m}`)
  }
  if (doc.v !== 1) fail('version')
  if (doc.width < 1 || doc.height < 1 || doc.width > MAX_SIDE || doc.height > MAX_SIDE) fail('size')
  if (doc.palette.length < 1 || doc.palette.length > MAX_COLORS) fail('palette size')
  if (doc.palette[0] !== TRANSPARENT) fail('palette[0] must be transparent')
  for (const c of doc.palette) if (!/^#[0-9a-f]{8}$/.test(c)) fail(`bad color ${c}`)
  if (doc.layers.length < 1) fail('no layers')
  if (doc.frames.length < 1) fail('no frames')
  const ids = new Set<string>()
  for (const x of [...doc.layers, ...doc.frames]) {
    if (ids.has(x.id)) fail(`duplicate id ${x.id}`)
    ids.add(x.id)
  }
  const size = doc.width * doc.height
  const expected = new Set<string>()
  for (const l of doc.layers)
    for (const f of doc.frames) {
      const k = celKey(l.id, f.id)
      expected.add(k)
      const c = doc.cels[k]
      if (!c) fail(`missing cel ${k}`)
      if (c.length !== size) fail(`cel ${k} has wrong size`)
      for (let i = 0; i < c.length; i++) if (c[i] >= doc.palette.length) fail(`cel ${k} index out of palette`)
    }
  for (const k of Object.keys(doc.cels)) if (!expected.has(k)) fail(`orphan cel ${k}`)
}

/** Fill in missing cels and drop orphan ones. */
export function normalizeCels(doc: PixelDoc): PixelDoc {
  const keep: Record<string, Uint8Array> = {}
  for (const l of doc.layers) for (const f of doc.frames) keep[celKey(l.id, f.id)] = getCel(doc, l.id, f.id)
  doc.cels = keep
  return doc
}

/** Find exact color or append it; when palette is full, return nearest. */
export function ensureColor(
  doc: PixelDoc,
  color: string,
  maxColors = doc.meta.maxColors ?? MAX_COLORS,
): number {
  const hex = normHex(color)
  if (parseHex(hex)[3] === 0) return 0
  const idx = doc.palette.indexOf(hex)
  if (idx >= 0) return idx
  if (doc.palette.length < Math.min(maxColors + 1, MAX_COLORS)) {
    doc.palette.push(hex)
    return doc.palette.length - 1
  }
  const [r, g, b] = parseHex(hex)
  return new PaletteMatcher(doc.palette).nearest(r, g, b)
}

/** Accept "#hex", palette index number, or "transparent". */
export function resolveColor(doc: PixelDoc, color: string | number): number {
  if (typeof color === 'number') {
    if (!Number.isInteger(color) || color < 0 || color >= doc.palette.length)
      throw new Error(`palette index ${color} out of range (0..${doc.palette.length - 1})`)
    return color
  }
  if (color === 'transparent') return 0
  return ensureColor(doc, color)
}

export function addLayer(
  doc: PixelDoc,
  o: { name: string; aboveId?: string; origin?: Layer['origin']; id?: string } = { name: 'Layer' },
): Layer {
  const layer: Layer = {
    id: o.id ?? newId('l'),
    name: o.name,
    visible: true,
    opacity: 255,
    locked: false,
    ...(o.origin ? { origin: o.origin } : {}),
  }
  const at = o.aboveId ? doc.layers.findIndex((l) => l.id === o.aboveId) + 1 : doc.layers.length
  doc.layers.splice(at <= 0 ? doc.layers.length : at, 0, layer)
  for (const f of doc.frames) getCel(doc, layer.id, f.id)
  return layer
}

export function removeLayer(doc: PixelDoc, layerId: string): void {
  if (doc.layers.length <= 1) throw new Error('cannot remove the last layer')
  const i = doc.layers.findIndex((l) => l.id === layerId)
  if (i < 0) throw new Error(`layer ${layerId} not found`)
  doc.layers.splice(i, 1)
  for (const f of doc.frames) delete doc.cels[celKey(layerId, f.id)]
}

export function reorderLayer(doc: PixelDoc, layerId: string, toIndex: number): void {
  const i = doc.layers.findIndex((l) => l.id === layerId)
  if (i < 0) throw new Error(`layer ${layerId} not found`)
  const [l] = doc.layers.splice(i, 1)
  doc.layers.splice(Math.max(0, Math.min(doc.layers.length, toIndex)), 0, l)
}

/** Merge layer onto the one below it (palette indices: top wins where non-transparent). */
export function mergeDown(doc: PixelDoc, layerId: string): void {
  const i = doc.layers.findIndex((l) => l.id === layerId)
  if (i <= 0) throw new Error('layer has nothing below it to merge into')
  const top = doc.layers[i]
  const below = doc.layers[i - 1]
  for (const f of doc.frames) {
    const t = getCel(doc, top.id, f.id)
    const b = getCel(doc, below.id, f.id)
    if (top.visible) for (let p = 0; p < t.length; p++) if (t[p] !== 0) b[p] = t[p]
  }
  removeLayer(doc, top.id)
}

export function addFrame(doc: PixelDoc, o: { durationMs?: number; copyFromId?: string } = {}): Frame {
  const frame: Frame = { id: newId('f'), durationMs: o.durationMs ?? 100 }
  doc.frames.push(frame)
  for (const l of doc.layers) {
    const src = o.copyFromId ? doc.cels[celKey(l.id, o.copyFromId)] : undefined
    doc.cels[celKey(l.id, frame.id)] = src ? src.slice() : new Uint8Array(doc.width * doc.height)
  }
  return frame
}

export function removeFrame(doc: PixelDoc, frameId: string): void {
  if (doc.frames.length <= 1) throw new Error('cannot remove the last frame')
  const i = doc.frames.findIndex((f) => f.id === frameId)
  if (i < 0) throw new Error(`frame ${frameId} not found`)
  doc.frames.splice(i, 1)
  for (const l of doc.layers) delete doc.cels[celKey(l.id, frameId)]
}

/** Composite visible layers of one frame to RGBA (straight alpha). */
export function composeFrame(
  doc: PixelDoc,
  frameId: string = doc.frames[0].id,
  o: { onlyLayerId?: string } = {},
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(doc.width * doc.height * 4)
  const pal = doc.palette.map(parseHex)
  for (const l of doc.layers) {
    if (o.onlyLayerId ? l.id !== o.onlyLayerId : !l.visible) continue
    const cel = doc.cels[celKey(l.id, frameId)]
    if (!cel) continue
    const lo = l.opacity / 255
    for (let p = 0; p < cel.length; p++) {
      const idx = cel[p]
      if (idx === 0) continue
      const [r, g, b, a] = pal[idx]
      const sa = (a / 255) * lo
      if (sa <= 0) continue
      const o4 = p * 4
      const da = out[o4 + 3] / 255
      const oa = sa + da * (1 - sa)
      if (oa <= 0) continue
      out[o4] = (r * sa + out[o4] * da * (1 - sa)) / oa
      out[o4 + 1] = (g * sa + out[o4 + 1] * da * (1 - sa)) / oa
      out[o4 + 2] = (b * sa + out[o4 + 2] * da * (1 - sa)) / oa
      out[o4 + 3] = oa * 255
    }
  }
  return out
}

/** Merged palette-index image of one frame (top-most non-transparent visible pixel wins). */
export function flattenIndices(doc: PixelDoc, frameId: string = doc.frames[0].id): Uint8Array {
  const out = new Uint8Array(doc.width * doc.height)
  for (const l of doc.layers) {
    if (!l.visible) continue
    const cel = doc.cels[celKey(l.id, frameId)]
    if (!cel) continue
    for (let p = 0; p < cel.length; p++) if (cel[p] !== 0) out[p] = cel[p]
  }
  return out
}

export function usedColorIndices(doc: PixelDoc): Set<number> {
  const s = new Set<number>()
  for (const c of Object.values(doc.cels)) for (let i = 0; i < c.length; i++) if (c[i]) s.add(c[i])
  return s
}

export function docSummary(doc: PixelDoc): string {
  const used = usedColorIndices(doc).size
  const layers = doc.layers
    .map(
      (l, i) => `${i}:${l.name}${l.visible ? '' : ' (hidden)'}${l.origin === 'ai' ? ' [ai]' : ''} id=${l.id}`,
    )
    .join('; ')
  return [
    `${doc.width}×${doc.height}px, purpose=${doc.meta.purpose}`,
    `palette: ${doc.palette.length - 1} colors (${used} used)`,
    `layers (bottom→top): ${layers}`,
    `frames: ${doc.frames.length}${doc.meta.tags?.length ? `, tags: ${doc.meta.tags.map((t) => t.name).join(', ')}` : ''}`,
  ].join('\n')
}
