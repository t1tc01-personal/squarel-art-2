import type { Frame, Layer, PixelDoc } from '../shared/types.ts'
import { celKey } from './codec.ts'
import {
  addFrame,
  addLayer,
  cloneDoc,
  ensureColor,
  getCel,
  normalizeCels,
  removeFrame,
  removeLayer,
} from './doc.ts'

/** Pixel-level change set between two docs, expressed in colors (not indices) so it can be replayed on any palette. */
export interface Patch {
  /** Dimensions differ: last writer wins with this full doc. */
  replace?: PixelDoc
  cels: { layerId: string; frameId: string; changes: [pos: number, color: string][] }[]
  addedLayers: { layer: Layer; below?: string }[]
  removedLayers: string[]
  layerProps: (Partial<Layer> & { id: string })[]
  layerOrder: string[]
  addedFrames: Frame[]
  removedFrames: string[]
  frameDurations: { id: string; durationMs: number }[]
  pixelCount: number
}

export function isEmptyPatch(p: Patch): boolean {
  return (
    !p.replace &&
    p.pixelCount === 0 &&
    !p.addedLayers.length &&
    !p.removedLayers.length &&
    !p.layerProps.length &&
    !p.addedFrames.length &&
    !p.removedFrames.length &&
    !p.frameDurations.length
  )
}

export function diff(base: PixelDoc, next: PixelDoc): Patch {
  const patch: Patch = {
    cels: [],
    addedLayers: [],
    removedLayers: [],
    layerProps: [],
    layerOrder: next.layers.map((l) => l.id),
    addedFrames: [],
    removedFrames: [],
    frameDurations: [],
    pixelCount: 0,
  }
  if (base.width !== next.width || base.height !== next.height) {
    patch.replace = cloneDoc(next)
    return patch
  }
  const baseLayers = new Map(base.layers.map((l) => [l.id, l]))
  const nextLayers = new Map(next.layers.map((l) => [l.id, l]))
  for (const l of base.layers) if (!nextLayers.has(l.id)) patch.removedLayers.push(l.id)
  next.layers.forEach((l, i) => {
    const b = baseLayers.get(l.id)
    if (!b) {
      patch.addedLayers.push({ layer: { ...l }, below: next.layers[i - 1]?.id })
      return
    }
    const props: Partial<Layer> & { id: string } = { id: l.id }
    let changed = false
    for (const k of ['name', 'visible', 'opacity', 'locked'] as const)
      if (b[k] !== l[k]) {
        ;(props as any)[k] = l[k]
        changed = true
      }
    if (changed) patch.layerProps.push(props)
  })
  const baseFrames = new Map(base.frames.map((f) => [f.id, f]))
  const nextFrames = new Set(next.frames.map((f) => f.id))
  for (const f of base.frames) if (!nextFrames.has(f.id)) patch.removedFrames.push(f.id)
  for (const f of next.frames) {
    const b = baseFrames.get(f.id)
    if (!b) patch.addedFrames.push({ ...f })
    else if (b.durationMs !== f.durationMs) patch.frameDurations.push({ id: f.id, durationMs: f.durationMs })
  }
  const size = next.width * next.height
  const empty = new Uint8Array(size)
  for (const l of next.layers)
    for (const f of next.frames) {
      const nc = next.cels[celKey(l.id, f.id)] ?? empty
      const bc =
        (baseLayers.has(l.id) && baseFrames.has(f.id) ? base.cels[celKey(l.id, f.id)] : undefined) ?? empty
      const changes: [number, string][] = []
      for (let p = 0; p < size; p++) {
        const a = base.palette[bc[p]]
        const b = next.palette[nc[p]]
        if (a !== b) changes.push([p, b])
      }
      if (changes.length) {
        patch.cels.push({ layerId: l.id, frameId: f.id, changes })
        patch.pixelCount += changes.length
      }
    }
  return patch
}

export interface RebaseResult {
  doc: PixelDoc
  warnings: string[]
}

export const RECOVERY_LAYER = 'Nét vẽ khôi phục'

/** Replay a patch on top of `head` (which may have moved on since the patch's base). */
export function rebase(patch: Patch, head: PixelDoc): RebaseResult {
  const warnings: string[] = []
  if (patch.replace) {
    warnings.push('canvas size changed in the editor: editor version replaces the latest version')
    return { doc: cloneDoc(patch.replace), warnings }
  }
  const doc = cloneDoc(head)
  for (const f of patch.addedFrames) if (!doc.frames.some((x) => x.id === f.id)) addFrameWithId(doc, f)
  for (const id of patch.removedFrames)
    if (doc.frames.some((x) => x.id === id) && doc.frames.length > 1) removeFrame(doc, id)
  for (const fd of patch.frameDurations) {
    const f = doc.frames.find((x) => x.id === fd.id)
    if (f) f.durationMs = fd.durationMs
  }
  for (const { layer, below } of patch.addedLayers)
    if (!doc.layers.some((l) => l.id === layer.id)) {
      const l = addLayer(doc, { name: layer.name, id: layer.id, aboveId: below, origin: layer.origin })
      Object.assign(l, { visible: layer.visible, opacity: layer.opacity, locked: layer.locked })
    }
  for (const id of patch.removedLayers)
    if (doc.layers.some((l) => l.id === id) && doc.layers.length > 1) removeLayer(doc, id)
  for (const p of patch.layerProps) {
    const l = doc.layers.find((x) => x.id === p.id)
    if (l) Object.assign(l, p)
  }
  // reorder: layers known to the editor follow its order; head-only layers stay on top
  const known = patch.layerOrder.filter((id) => doc.layers.some((l) => l.id === id))
  const headOnly = doc.layers.filter((l) => !patch.layerOrder.includes(l.id))
  doc.layers = [...known.map((id) => doc.layers.find((l) => l.id === id)!), ...headOnly]

  let recovery: string | undefined
  const size = doc.width * doc.height
  for (const c of patch.cels) {
    let layerId = c.layerId
    if (!doc.layers.some((l) => l.id === layerId)) {
      if (!recovery) {
        recovery = addLayer(doc, { name: RECOVERY_LAYER, origin: 'user' }).id
        warnings.push(`layer ${c.layerId} was removed meanwhile; strokes moved to "${RECOVERY_LAYER}"`)
      }
      layerId = recovery
    }
    if (!doc.frames.some((f) => f.id === c.frameId)) {
      warnings.push(`frame ${c.frameId} was removed meanwhile; its strokes were dropped`)
      continue
    }
    const cel = getCel(doc, layerId, c.frameId)
    for (const [pos, color] of c.changes) {
      if (pos >= size) continue
      cel[pos] = ensureColor(doc, color, 256)
    }
  }
  normalizeCels(doc)
  return { doc, warnings }
}

function addFrameWithId(doc: PixelDoc, f: Frame) {
  const added = addFrame(doc, { durationMs: f.durationMs })
  for (const l of doc.layers) {
    const k = celKey(l.id, added.id)
    doc.cels[celKey(l.id, f.id)] = doc.cels[k]
    delete doc.cels[k]
  }
  added.id = f.id
}
