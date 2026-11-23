/**
 * Writes build/icon.ico (the Windows app/installer icon) from the logo bitmap of the tray, so the
 * repo carries no binary icon asset. Runs before electron-builder (`pnpm dist`).
 * ICO entries are PNG-compressed (supported since Windows Vista); 256 px is what electron-builder needs.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { logoPng } from '../src/main/tray-menu.ts'

const SIZES = [16, 24, 32, 48, 64, 128, 256]
const pngs = SIZES.map((s) => logoPng(s))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0) // reserved
header.writeUInt16LE(1, 2) // type: icon
header.writeUInt16LE(SIZES.length, 4)

let offset = 6 + 16 * SIZES.length
const entries = SIZES.map((size, i) => {
  const e = Buffer.alloc(16)
  e[0] = size >= 256 ? 0 : size // 0 means 256
  e[1] = size >= 256 ? 0 : size
  e[2] = 0 // palette colours
  e[3] = 0 // reserved
  e.writeUInt16LE(1, 4) // colour planes
  e.writeUInt16LE(32, 6) // bits per pixel
  e.writeUInt32LE(pngs[i].length, 8)
  e.writeUInt32LE(offset, 12)
  offset += pngs[i].length
  return e
})

const dir = join(import.meta.dirname, '..', 'build')
mkdirSync(dir, { recursive: true })
writeFileSync(join(dir, 'icon.ico'), Buffer.concat([header, ...entries, ...pngs]))
process.stdout.write(`icon: build/icon.ico (${SIZES.join(', ')} px)\n`)
