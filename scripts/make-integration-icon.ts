/**
 * Generate integrations/aseprite/icon.png: the 8×8 Squarel pixel logo in the Aseprite accent colour,
 * scaled ×2 to 16×16, transparent background.
 *
 *   node scripts/make-integration-icon.ts
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { encodePng } from '../src/core/png.ts'

const BITMAP = [
  '..####..',
  '.#....#.',
  '#.#..#.#',
  '#......#',
  '#.####.#',
  '#......#',
  '.#....#.',
  '..####..',
]
const COLOR = [0xff, 0x77, 0xa8, 0xff] // #FF77A8
const SCALE = 2

function iconRaster(bitmap = BITMAP, color = COLOR, scale = SCALE) {
  const width = bitmap[0].length * scale
  const height = bitmap.length * scale
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (bitmap[Math.floor(y / scale)][Math.floor(x / scale)] === '#') data.set(color, (y * width + x) * 4)
  return { width, height, data }
}

const out = join(import.meta.dirname, '..', 'integrations', 'aseprite', 'icon.png')
writeFileSync(out, encodePng(iconRaster()))
console.log(`wrote ${out}`)
