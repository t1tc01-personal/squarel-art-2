import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { celKey, createDoc, ensureColor } from '../src/core/index.ts'
import type { PixelDoc } from '../src/shared/types.ts'

/** 8×8 "mushroom" sprite: 0 = transparent, letters = colors. */
export const SPRITE = [
  '..RRRR..',
  '.RRWWRR.',
  'RRWWRRRR',
  'RRRRRWWR',
  '..SSSS..',
  '..SKSK..',
  '..SSSS..',
  '...SS...',
]
export const SPRITE_COLORS: Record<string, string> = {
  R: '#d03030',
  W: '#f8f8f8',
  S: '#e8c890',
  K: '#202020',
}

export function spriteDoc(): PixelDoc {
  const doc = createDoc({ width: 8, height: 8, purpose: 'game', palette: [] })
  const cel = doc.cels[celKey(doc.layers[0].id, doc.frames[0].id)]
  for (const [y, row] of SPRITE.entries())
    for (const [x, ch] of [...row].entries())
      if (ch !== '.') cel[y * 8 + x] = ensureColor(doc, SPRITE_COLORS[ch])
  return doc
}

/** Render SPRITE as an "AI-like" RGBA image: upscaled, on a flat background, with mild noise. */
export function fakeAiImage(
  scale = 16,
  o: { bg?: [number, number, number]; noise?: number; offset?: number } = {},
) {
  // providers are prompted for a flat magenta background (chroma key)
  const bg = o.bg ?? [255, 0, 255]
  const off = o.offset ?? 0
  const size = 8 * scale + off * 2
  const data = new Uint8ClampedArray(size * size * 4)
  let seed = 42
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const sx = Math.floor((x - off) / scale)
      const sy = Math.floor((y - off) / scale)
      const ch = sx >= 0 && sy >= 0 && sx < 8 && sy < 8 ? SPRITE[sy][sx] : '.'
      const hex = ch === '.' ? null : SPRITE_COLORS[ch]
      const base = hex ? [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)) : bg
      const n = (o.noise ?? 6) * (rand() - 0.5)
      const i = (y * size + x) * 4
      data[i] = base[0] + n
      data[i + 1] = base[1] + n
      data[i + 2] = base[2] + n
      data[i + 3] = 255
    }
  return { data, width: size, height: size }
}

export function tempDir(prefix = 'squarel-test-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

export function celOf(doc: PixelDoc, layerIndex = 0, frameIndex = 0): Uint8Array {
  return doc.cels[celKey(doc.layers[layerIndex].id, doc.frames[frameIndex].id)]
}

/** Render doc's first layer as letters using SPRITE_COLORS reverse lookup ('.' = transparent, '?' = other). */
export function asLetters(doc: PixelDoc, layerIndex = 0): string[] {
  const rev = new Map(Object.entries(SPRITE_COLORS).map(([k, v]) => [`${v}ff`, k]))
  const cel = celOf(doc, layerIndex)
  const rows: string[] = []
  for (let y = 0; y < doc.height; y++) {
    let s = ''
    for (let x = 0; x < doc.width; x++) {
      const v = cel[y * doc.width + x]
      s += v === 0 ? '.' : (rev.get(doc.palette[v]) ?? '?')
    }
    rows.push(s)
  }
  return rows
}

/** A project folder (`.squarel/project.json`) inside `dir`; returns its path. */
export function makeProjectFolder(dir: string, id = 'game', name = 'Game'): string {
  const folder = join(dir, `proj-${id}`)
  mkdirSync(join(folder, '.squarel'), { recursive: true })
  writeFileSync(join(folder, '.squarel', 'project.json'), JSON.stringify({ schema: 1, id, name }))
  return folder
}
