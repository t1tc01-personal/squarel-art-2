/**
 * Tray menu model and icon, pure so they can be unit-tested without Electron (tray.ts turns them
 * into a Menu / nativeImage).
 */
import { deflateSync } from 'node:zlib'
import type { ActionRef } from '../shared/model'
import type { BridgeState } from './bridge/types'

export type TrayAction = { kind: 'show' } | { kind: 'launch'; ref: ActionRef } | { kind: 'quit' }

export type TrayItem =
  | { type: 'separator' }
  | { type?: 'normal'; label: string; enabled?: boolean; action?: TrayAction }

export interface TrayModel {
  /** Selected integrations with their manifest `default` launch action. */
  integrations: { name: string; ref: ActionRef }[]
  bridge: BridgeState
}

export function bridgeLabel(b: BridgeState): string {
  switch (b.mode) {
    case 'own':
      return `Bridge: launcher đang giữ (cổng ${b.port})`
    case 'attached':
      return `Bridge: dùng chung (cổng ${b.port})`
    case 'foreign':
      return `Bridge: cổng ${b.port} bị chương trình khác giữ`
    default:
      return 'Bridge: chưa chạy'
  }
}

/** "Mở launcher", "Mở <tích hợp>…" for each, "Bridge: <mode>" (status only), "Thoát". */
export function trayItems(m: TrayModel): TrayItem[] {
  return [
    { label: 'Mở launcher', action: { kind: 'show' } },
    ...m.integrations.map(
      (i): TrayItem => ({ label: `Mở ${i.name}…`, action: { kind: 'launch', ref: i.ref } }),
    ),
    { type: 'separator' },
    { label: bridgeLabel(m.bridge), enabled: false },
    { type: 'separator' },
    { label: 'Thoát', action: { kind: 'quit' } },
  ]
}

/** The title-bar logo "S" of docs/launcher/design.md (6×7 grid, `--accent-brand`). */
const LOGO = ['.####.', '#....#', '#.....', '.####.', '.....#', '#....#', '.####.'] as const
const BRAND = [0xff, 0xec, 0x27] as const

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = (CRC_TABLE[(c ^ b) & 0xff] as number) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

/** The logo as a square RGBA PNG of `size` px (pixel cells, centred, transparent around). */
export function logoPng(size: number): Buffer {
  const rows = LOGO.length
  const cols = LOGO[0].length
  const cell = Math.max(1, Math.floor(size / Math.max(rows, cols)))
  const offX = Math.floor((size - cols * cell) / 2)
  const offY = Math.floor((size - rows * cell) / 2)
  const stride = 1 + size * 4
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor((x - offX) / cell)
      const gy = Math.floor((y - offY) / cell)
      const on = x >= offX && y >= offY && LOGO[gy]?.[gx] === '#'
      if (!on) continue
      const o = y * stride + 1 + x * 4
      raw[o] = BRAND[0]
      raw[o + 1] = BRAND[1]
      raw[o + 2] = BRAND[2]
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
