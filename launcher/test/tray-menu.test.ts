import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import type { BridgeState } from '../src/main/bridge/types'
import { bridgeLabel, logoPng, trayItems } from '../src/main/tray-menu'

const bridge = (mode: BridgeState['mode'], port = 4321): BridgeState => ({
  mode,
  port,
  clients: [],
  since: '2026-01-01T00:00:00.000Z',
})

describe('tray menu', () => {
  it('lists open, one entry per integration, bridge status, quit', () => {
    const ref = { componentId: 'aseprite', kind: 'launch' as const, id: 'open', label: 'Mở Aseprite' }
    const items = trayItems({ integrations: [{ name: 'Aseprite', ref }], bridge: bridge('own') })
    expect(items.map((i) => (i.type === 'separator' ? '---' : i.label))).toEqual([
      'Mở launcher',
      'Mở Aseprite…',
      '---',
      'Bridge: launcher đang giữ (cổng 4321)',
      '---',
      'Thoát',
    ])
    expect(items[0]).toMatchObject({ action: { kind: 'show' } })
    expect(items[1]).toMatchObject({ action: { kind: 'launch', ref } })
    expect(items[3]).toMatchObject({ enabled: false })
    expect(items.at(-1)).toMatchObject({ action: { kind: 'quit' } })
  })

  it('bridge labels per mode', () => {
    expect(bridgeLabel(bridge('own', 5000))).toBe('Bridge: launcher đang giữ (cổng 5000)')
    expect(bridgeLabel(bridge('attached'))).toBe('Bridge: dùng chung (cổng 4321)')
    expect(bridgeLabel(bridge('foreign'))).toBe('Bridge: cổng 4321 bị chương trình khác giữ')
    expect(bridgeLabel(bridge('down'))).toBe('Bridge: chưa chạy')
  })

  it('logo icon is a valid RGBA PNG of the requested size with the S drawn in brand yellow', () => {
    const png = logoPng(16)
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(png.readUInt32BE(16)).toBe(16) // IHDR width
    expect(png.readUInt32BE(20)).toBe(16) // IHDR height
    expect(png[24]).toBe(8) // bit depth
    expect(png[25]).toBe(6) // RGBA
    const idat = png.indexOf('IDAT')
    const len = png.readUInt32BE(idat - 4)
    const raw = inflateSync(png.subarray(idat + 4, idat + 4 + len))
    expect(raw.length).toBe(16 * (1 + 16 * 4))
    const px = (x: number, y: number) => {
      const o = y * (1 + 16 * 4) + 1 + x * 4
      return [...raw.subarray(o, o + 4)]
    }
    expect(px(0, 0)[3]).toBe(0) // transparent corner
    const opaque: number[][] = []
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) if (px(x, y)[3] === 255) opaque.push(px(x, y))
    expect(opaque.length).toBeGreaterThan(20)
    expect(opaque.every(([r, g, b]) => r === 0xff && g === 0xec && b === 0x27)).toBe(true)
    expect(logoPng(32).readUInt32BE(16)).toBe(32)
  })
})
