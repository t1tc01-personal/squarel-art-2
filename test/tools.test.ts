import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { celKey, decodePng, encodePng, readDpi } from '../src/core/index.ts'
import { silentLogger } from '../src/log.ts'
import { MockProvider, mockSprite } from '../src/providers/mock.ts'
import type { GenRequest, ImageProvider, RawImage } from '../src/providers/types.ts'
import { createToolContext } from '../src/tools/context.ts'
import { ALL_TOOLS, runTool } from '../src/tools/registry.ts'
import type { ToolContext, ToolResult } from '../src/tools/types.ts'
import { SQUAREL_VERSION } from '../src/version.ts'
import { fakeAiImage, tempDir } from './helpers.ts'

/** A paid provider double (behaves like Retro Diffusion but offline). */
class FakePaid extends MockProvider {
  readonly id = 'retrodiffusion' as never
  readonly capabilities = { ...new MockProvider().capabilities, paid: true, nativePixel: true }
  calls = 0
  async quote() {
    return { usd: 0.03, units: 3, unitKind: 'credit' as const, model: 'rd_fast__default' }
  }
  async generate(req: GenRequest): Promise<RawImage[]> {
    this.calls++
    return super.generate(req)
  }
}

let t: ReturnType<typeof tempDir>
let ctx: ToolContext
let paid: FakePaid

async function call(name: string, input: Record<string, unknown> = {}): Promise<ToolResult> {
  return runTool(name, input, ctx)
}

async function expectCode(p: Promise<unknown>, code: string) {
  await expect(p).rejects.toMatchObject({ code })
}

beforeEach(async () => {
  t = tempDir()
  paid = new FakePaid()
  ctx = await createToolContext({
    config: { dataDir: t.dir, imageProvider: 'mock', dailyBudgetUsd: 0.05, previewPx: 128 },
    providers: { mock: new MockProvider(), retrodiffusion: paid as unknown as ImageProvider },
    log: silentLogger,
  })
})
afterEach(() => t.cleanup())

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50

describe('tool registry', () => {
  it('has unique, documented tools with object schemas', () => {
    const names = ALL_TOOLS.map((x) => x.name)
    expect(new Set(names).size).toBe(names.length)
    expect(names.length).toBeGreaterThanOrEqual(35)
    for (const tool of ALL_TOOLS) {
      expect(tool.description.length).toBeGreaterThan(20)
      expect(tool.name).toMatch(/^[a-z0-9_]+$/)
    }
  })
  it('maps errors to codes', async () => {
    await expectCode(call('canvas_view'), 'NOT_FOUND')
    await expectCode(call('project_create', { name: 'x', width: 0, height: 8 }), 'INVALID')
    await expectCode(call('nope'), 'NOT_FOUND')
  })
})

describe('project, view, draw, ops, history', () => {
  it('runs a full editing session with previews and versions', async () => {
    const created = await call('project_create', {
      name: 'Hiệp sĩ',
      width: 16,
      height: 16,
      purpose: 'game',
      palette: 'pico8',
    })
    expect(created.text).toContain('hiep-si')
    expect(isPng(created.images![0].png)).toBe(true)
    expect(ctx.session.activeProject).toBe('hiep-si')

    const view = await call('canvas_view', { grid: true, coords: true, size: 256 })
    expect(decodePng(view.images![0].png).width).toBeGreaterThan(200)

    await call('draw_pixels', {
      ops: [
        { op: 'rect', x: 4, y: 4, w: 8, h: 8, color: '#ff004d', fill: true },
        { op: 'line', from: [0, 0], to: [15, 0], color: 8 },
        { op: 'set', points: [[7, 7]], color: '#000000' },
      ],
    })
    await call('add_outline', { color: '#000000' })
    await call('recolor', { from: '#ff004d', to: '#29adff' })
    await call('flip', { axis: 'horizontal' })
    const info = await call('project_info')
    expect((info.data as { usedColors: number }).usedColors).toBe(3)

    const hist = await call('history')
    expect(hist.text.split('\n')).toHaveLength(5)
    expect(hist.text).toContain('[claude] Claude: flip horizontal')
    await call('undo')
    await call('undo')
    const pal = await call('palette_view')
    expect(pal.text).toContain('#ff004d')
    await expectCode(call('restore_version', { version: 'v999999' }), 'NOT_FOUND')
    await call('restore_version', { version: 'v000005' })
  })

  it('layers, frames and palette tools', async () => {
    await call('project_create', { name: 'L', width: 8, height: 8 })
    await call('layer_add', { name: 'fx' })
    await call('draw_pixels', { layer: 'fx', ops: [{ op: 'fill', x: 0, y: 0, color: 3 }] })
    await call('layer_set', { layer: 'fx', opacity: 100, name: 'effects' })
    await call('layer_reorder', { layer: 'effects', to_index: 0 })
    await call('layer_merge_down', { layer: 'Layer 1' })
    await call('frame_add', { copy_from: 0, duration_ms: 200 })
    await call('frame_set', { frame: 1, duration_ms: 80 })
    await call('palette_set_color', { index: 3, color: '#123456' })
    const info = (await call('project_info')).data as any
    expect(info.layers).toHaveLength(1)
    expect(info.frames).toHaveLength(2)
    expect(info.palette[3]).toBe('#123456ff')
    await call('layer_set', { layer: 'effects', locked: true })
    await expectCode(
      call('draw_pixels', { layer: 'effects', ops: [{ op: 'set', points: [[0, 0]], color: 1 }] }),
      'INVALID',
    )
    await expectCode(call('layer_remove', { layer: 'effects' }), 'INVALID')
  })

  it('palette & geometry ops keep the doc valid', async () => {
    await call('project_create', { name: 'G', width: 16, height: 16 })
    await call('draw_pixels', {
      ops: [{ op: 'ellipse', x: 2, y: 2, w: 10, h: 10, color: '#ff77a8', fill: true }],
    })
    await call('apply_palette', { palette: 'gameboy', dither: true })
    await call('reduce_colors', { n: 2 })
    await call('shift_hue', { degrees: 90 })
    await call('resize_canvas', { width: 20, height: 20, anchor: 'top-left' })
    await call('crop_to_content', { padding: 1 })
    await call('scale', { factor: 2 })
    await call('rotate90', { direction: 'ccw' })
    const info = (await call('project_info')).data as any
    expect(info.width).toBe(24)
    expect(info.usedColors).toBeLessThanOrEqual(2)
    await expectCode(call('apply_palette', { palette: 'nope' }), 'INVALID')
  })
})

describe('AI proposals (mock + paid provider double)', () => {
  it('generate → numbered sheet → accept as a new AI layer', async () => {
    await call('project_create', { name: 'AI', width: 16, height: 16 })
    const gen = await call('generate_image', { prompt: 'a tiny knight', variants: 3 })
    const id = (gen.data as { id: string }).id
    expect(gen.text).toContain('Nothing on the canvas changed yet')
    expect(isPng(gen.images![0].png)).toBe(true)
    expect((await call('proposal_list', { status: 'open' })).text).toContain(id)
    const acc = await call('accept_variant', { proposal: id, variant: 2 })
    expect(acc.text).toContain('as layer "AI: a tiny knight"')
    const info = (await call('project_info')).data as any
    expect(info.layers.map((l: any) => l.origin)).toContain('ai')
    expect(info.usedColors).toBeGreaterThan(0)
    await expectCode(call('accept_variant', { proposal: id, variant: 1 }), 'INVALID')
    const usage = await call('usage_today')
    expect(usage.text).toContain('Today: $0.000')
  })

  it('edit_image with a region only changes pixels inside it', async () => {
    await call('project_create', {
      name: 'E',
      width: 8,
      height: 8,
      palette: ['#ff0000', '#00ff00', '#0000ff'],
    })
    await call('draw_pixels', { ops: [{ op: 'rect', x: 0, y: 0, w: 8, h: 8, color: '#ff0000', fill: true }] })
    const ed = await call('edit_image', {
      instruction: 'make it blue',
      region: { x: 0, y: 0, w: 4, h: 4 },
      variants: 1,
      keep_palette: true,
    })
    await call('accept_variant', { proposal: (ed.data as any).id, variant: 1 })
    const { doc } = await ctx.store.readHead('e')
    const ai = doc.layers.find((l) => l.origin === 'ai')!
    const cel = doc.cels[celKey(ai.id, doc.frames[0].id)]
    let inside = 0
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        const v = cel[y * 8 + x]
        if (x >= 4 || y >= 4) expect(v).toBe(0)
        else if (v) inside++
      }
    expect(inside).toBe(16)
    await expectCode(call('edit_image', { instruction: 'x', region: { x: 6, y: 6, w: 4, h: 4 } }), 'INVALID')
  })

  it('animate → frames on one layer', async () => {
    await call('project_create', { name: 'Anim', width: 16, height: 16 })
    const an = await call('animate', { prompt: 'slime', action: 'idle', frames: 4, provider: 'mock' })
    await call('accept_variant', { proposal: (an.data as any).id, variant: 1 })
    const info = (await call('project_info')).data as any
    expect(info.frames).toHaveLength(4)
    const ex = await call('export', { preset: 'game-spritesheet', options: { scale: 2 } })
    const json = JSON.parse(readFileSync(ex.files!.find((f) => f.endsWith('.json'))!, 'utf8'))
    expect(json.frames).toHaveLength(4)
    expect(json.meta.size).toEqual({ w: 128, h: 32 })
    expect(json.meta.version).toBe(SQUAREL_VERSION)
  })

  it('paid provider: price first, confirm, budget cap', async () => {
    await call('project_create', { name: 'Paid', width: 16, height: 16 })
    await expectCode(
      call('generate_image', { prompt: 'knight', quality: 'high', variants: 1 }),
      'NEEDS_CONFIRM',
    )
    expect(paid.calls).toBe(0)
    const ok = await call('generate_image', {
      prompt: 'knight',
      quality: 'high',
      variants: 1,
      confirm_cost: true,
    })
    expect(ok.text).toContain('cost ~$0.030')
    expect(paid.calls).toBe(1)
    await expectCode(
      call('generate_image', { prompt: 'knight', quality: 'high', variants: 1, confirm_cost: true }),
      'BUDGET',
    )
    expect(paid.calls).toBe(1)
    const usage = await call('usage_today')
    expect(usage.text).toContain('$0.030')
  })
})

describe('export presets', () => {
  it('writes valid files for all four purposes', async () => {
    await call('project_create', { name: 'Exp', width: 30, height: 20, purpose: 'craft' })
    await call('draw_pixels', {
      ops: [
        { op: 'rect', x: 2, y: 2, w: 26, h: 16, color: '#ff004d', fill: true },
        { op: 'rect', x: 5, y: 5, w: 5, h: 5, color: '#29adff', fill: true },
      ],
    })
    await call('frame_add', { copy_from: 0 })
    const presets = (await call('export_presets')).data as { id: string }[]
    expect(presets.length).toBe(11)
    const sig = (f: string) => readFileSync(f).subarray(0, 8).toString('latin1')
    for (const p of presets) {
      const r = await call('export', { preset: p.id })
      expect(r.files!.length).toBeGreaterThan(0)
      for (const f of r.files!) {
        const s = sig(f)
        if (f.endsWith('.png')) expect(s.startsWith('\x89PNG')).toBe(true)
        else if (f.endsWith('.gif')) expect(s.startsWith('GIF8')).toBe(true)
        else if (f.endsWith('.pdf')) expect(s.startsWith('%PDF')).toBe(true)
        else if (f.endsWith('.svg')) expect(readFileSync(f, 'utf8')).toContain('<svg')
        else if (f.endsWith('.webp')) expect(s.startsWith('RIFF')).toBe(true)
        else if (f.endsWith('.csv'))
          expect(readFileSync(f, 'utf8').startsWith('symbol,code,name,hex,count')).toBe(true)
        else if (f.endsWith('.json')) expect(() => JSON.parse(readFileSync(f, 'utf8'))).not.toThrow()
      }
    }
    const print = await call('export', { preset: 'print-png', options: { widthMm: 100, dpi: 300 } })
    const png = new Uint8Array(readFileSync(print.files![0]))
    expect(readDpi(png)).toBe(300)
    expect(decodePng(png).width).toBe(30 * 39) // round(1181px / 30)
    const beads = await call('export', { preset: 'craft-beads', options: { brand: 'hama' } })
    expect(beads.text).toContain('416 beads')
    expect(beads.text).toContain('2 board(s)')
    await expectCode(call('export', { preset: 'nope' }), 'NOT_FOUND')
    await expectCode(call('export', { preset: 'print-png', options: { dpi: 5 } }), 'INVALID')
  })
})

describe('photo_to_pixel', () => {
  it('turns a local image into a new project', async () => {
    const img = fakeAiImage(10, { noise: 30 })
    const file = join(t.dir, 'inbox', 'photo.png')
    writeFileSync(file, encodePng(img))
    const r = await call('photo_to_pixel', { path: 'photo.png', width: 16, colors: 6, name: 'Ảnh mèo' })
    expect(r.text).toContain('anh-meo')
    const info = (await call('project_info')).data as any
    expect(info.width).toBe(16)
    expect(info.usedColors).toBeLessThanOrEqual(6)
    await expectCode(call('photo_to_pixel', { path: 'C:/Windows/win.ini', width: 16 }), 'INVALID')
    await expectCode(call('photo_to_pixel', { path: 'missing.png', width: 16 }), 'NOT_FOUND')
    const layer = await call('photo_to_pixel', { path: file, width: 8, as_new_project: false })
    expect(layer.text).toContain('Photo')
  })

  it('generate also works when mock sprites are noisy (normalize retry path)', async () => {
    await call('project_create', { name: 'N', width: 12, height: 12 })
    const big = encodePng(mockSprite(3, 12, [], 40, 60))
    expect(isPng(big)).toBe(true)
    const r = await call('generate_image', { prompt: 'noise test', variants: 1 })
    expect(r.text).toMatch(/grid confidence/)
  })
})
