import { describe, expect, it } from 'vitest'
import {
  addLayer,
  addOutline,
  applyPalette,
  celKey,
  composeFrame,
  createDoc,
  cropToContent,
  decodeCel,
  decodePng,
  deserializeDoc,
  diff,
  ellipse,
  encodeCel,
  encodePng,
  flip,
  floodFill,
  fromBase64,
  isEmptyPatch,
  line,
  mergeDown,
  normalize,
  parseHex,
  RECOVERY_LAYER,
  readDpi,
  rebase,
  recolor,
  rect,
  reduceColors,
  removeBackground,
  removeLayer,
  renderDoc,
  resizeCanvas,
  rleDecode,
  rleEncode,
  rotate90,
  scaleTo,
  serializeDoc,
  shiftHue,
  toBase64,
  usedColorIndices,
  validateDoc,
} from '../src/core/index.ts'
import { asLetters, celOf, fakeAiImage, SPRITE, spriteDoc } from './helpers.ts'

describe('codec', () => {
  it('base64 round-trips all lengths', () => {
    for (let n = 0; n < 40; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 37 + n) & 255)
      expect(fromBase64(toBase64(b))).toEqual(b)
      expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'))
    }
  })
  it('RLE round-trips including long runs (varint)', () => {
    const a = new Uint8Array(70000)
    a.fill(3, 100, 60000)
    a[69999] = 7
    const enc = rleEncode(a)
    expect(enc.length).toBeLessThan(20)
    expect(rleDecode(enc, a.length)).toEqual(a)
  })
  it('rejects RLE with wrong size', () => {
    expect(() => rleDecode(rleEncode(new Uint8Array(10)), 11)).toThrow()
  })
  it('serializes and deserializes docs losslessly', () => {
    const doc = spriteDoc()
    const back = deserializeDoc(JSON.parse(JSON.stringify(serializeDoc(doc))))
    expect(back).toEqual(doc)
    expect(decodeCel(encodeCel(celOf(doc)), 64)).toEqual(celOf(doc))
  })
})

describe('doc', () => {
  it('creates a valid doc with transparent index 0 and preset palette', () => {
    const doc = createDoc({ width: 32, height: 16, purpose: 'game', palette: 'pico8' })
    expect(doc.palette[0]).toBe('#00000000')
    expect(doc.palette).toHaveLength(17)
    expect(() => validateDoc(doc)).not.toThrow()
  })
  it('rejects oversize canvases and bad palettes', () => {
    expect(() => createDoc({ width: 300, height: 10, purpose: 'game' })).toThrow()
    expect(() => createDoc({ width: 8, height: 8, purpose: 'game', palette: 'nope' })).toThrow()
  })
  it('validate catches out-of-palette indices', () => {
    const doc = spriteDoc()
    celOf(doc)[0] = 200
    expect(() => validateDoc(doc)).toThrow(/index out of palette/)
  })
  it('composes layers with top layer winning', () => {
    const doc = spriteDoc()
    const top = addLayer(doc, { name: 'top' })
    const c = doc.cels[celKey(top.id, doc.frames[0].id)]
    c[2] = 1
    const rgba = composeFrame(doc)
    expect([...rgba.slice(8, 12)]).toEqual(parseHex(doc.palette[1]))
    mergeDown(doc, top.id)
    expect(doc.layers).toHaveLength(1)
    expect(celOf(doc)[2]).toBe(1)
  })
})

describe('draw', () => {
  const canvas = () => ({ data: new Uint8Array(100), width: 10, height: 10 })
  it('line, rect, ellipse, flood fill', () => {
    const c = canvas()
    expect(line(c, 0, 0, 9, 9, 1)).toBe(10)
    const r = canvas()
    expect(rect(r, 1, 1, 4, 3, 2, false)).toBe(10)
    expect(rect(r, 1, 1, 4, 3, 2, true)).toBe(2)
    const e = canvas()
    expect(ellipse(e, 0, 0, 10, 10, 3, true)).toBeGreaterThan(60)
    const f = canvas()
    rect(f, 0, 0, 10, 10, 4, false)
    expect(floodFill(f, 5, 5, 5)).toBe(64)
    expect(floodFill(f, 0, 0, 6, false)).toBe(36)
  })
})

describe('normalize (pixel cleanup of AI-like images)', () => {
  it('recovers the exact sprite from a noisy 16× upscale on a flat background', () => {
    const img = fakeAiImage(16)
    const r = normalize(img, { target: { width: 8, height: 8 }, maxColors: 8 })
    expect(r.report.blockSize).toBe(16)
    expect(r.report.gridConfidence).toBeGreaterThan(0.8)
    expect(r.report.backgroundRemoved).toBe(true)
    expect(r.report.colorCount).toBe(4)
    const letters = SPRITE.map((row, y) =>
      [...row]
        .map((ch, x) => (ch === '.' ? r.pixels[y * 8 + x] === 0 : r.pixels[y * 8 + x] !== 0))
        .every(Boolean),
    )
    expect(letters.every(Boolean)).toBe(true)
  })
  it('handles a grid offset and maps onto a forced palette', () => {
    const img = fakeAiImage(12, { offset: 5 })
    const r = normalize(img, {
      target: { width: 8, height: 8 },
      palette: ['#ff0000', '#ffffff', '#ffcc99', '#000000'],
    })
    expect(r.palette).toEqual(['#00000000', '#ff0000ff', '#ffffffff', '#ffcc99ff', '#000000ff'])
    expect(r.pixels[0]).toBe(0)
    expect(r.palette[r.pixels[2]]).toBe('#ff0000ff')
    expect(r.palette[r.pixels[5 * 8 + 3]]).toBe('#000000ff')
  })
  it('is deterministic', () => {
    const a = normalize(fakeAiImage(10), { target: { width: 8, height: 8 } })
    const b = normalize(fakeAiImage(10), { target: { width: 8, height: 8 } })
    expect(a.pixels).toEqual(b.pixels)
    expect(a.palette).toEqual(b.palette)
  })
  it('every pixel is in the palette and alpha is binary (property)', () => {
    for (const scale of [4, 6, 9]) {
      const r = normalize(fakeAiImage(scale, { noise: 20 }), {
        target: { width: 16, height: 16 },
        maxColors: 6,
      })
      expect(r.palette.length - 1).toBeLessThanOrEqual(6)
      for (const v of r.pixels) expect(v).toBeLessThan(r.palette.length)
    }
  })
  it('contains non-square images into the target with transparent padding', () => {
    const img = fakeAiImage(8)
    const wide = { data: new Uint8ClampedArray(128 * 64 * 4), width: 128, height: 64 }
    for (let y = 0; y < 64; y++) wide.data.set(img.data.subarray(y * 64 * 4, (y + 1) * 64 * 4), y * 128 * 4)
    const r = normalize(wide, { target: { width: 16, height: 16 }, removeBackground: false })
    expect(r.width).toBe(16)
    expect(r.height).toBe(16)
    expect(r.pixels[0]).toBe(0) // top padding row
  })
})

describe('ops', () => {
  it('recolor replaces only matching pixels', () => {
    const doc = spriteDoc()
    const n = recolor(doc, '#d03030', '#3030d0')
    expect(n).toBe(SPRITE.join('').split('R').length - 1)
    expect(doc.palette).toContain('#3030d0ff')
  })
  it('outline outer surrounds the sprite', () => {
    const doc = createDoc({ width: 5, height: 5, purpose: 'game', palette: ['#ff0000'] })
    celOf(doc)[12] = 1
    expect(addOutline(doc, '#000000')).toBe(4)
    const d2 = createDoc({ width: 5, height: 5, purpose: 'game', palette: ['#ff0000'] })
    celOf(d2)[12] = 1
    expect(addOutline(d2, '#000000', { mode: 'outer', diagonal: true })).toBe(8)
    const d3 = createDoc({ width: 5, height: 5, purpose: 'game', palette: ['#ff0000'] })
    celOf(d3).fill(1, 5, 20)
    expect(addOutline(d3, '#000000', { mode: 'inner' })).toBe(12)
  })
  it('full-pipeline sprite keeps single-pixel details (eyes)', () => {
    const r = normalize(fakeAiImage(16), { target: { width: 8, height: 8 } })
    expect(r.palette[r.pixels[5 * 8 + 3]]).toBe(r.palette[r.pixels[5 * 8 + 5]])
    expect(r.pixels[5 * 8 + 3]).not.toBe(r.pixels[5 * 8 + 2])
  })
  it('removeBackground clears border-connected flat color only', () => {
    const doc = createDoc({ width: 6, height: 6, purpose: 'game', palette: ['#ffffff', '#ff0000'] })
    const c = celOf(doc)
    c.fill(1)
    c[14] = 2
    c[15] = 1 // white inside but connected to border → cleared
    expect(removeBackground(doc)).toBe(35)
    expect(c[14]).toBe(2)
  })
  it('flip, rotate, resize, scale, crop keep content consistent', () => {
    const doc = spriteDoc()
    flip(doc, 'horizontal')
    expect(asLetters(doc)[1]).toBe([...SPRITE[1]].reverse().join(''))
    flip(doc, 'horizontal')
    rotate90(doc, 'cw')
    rotate90(doc, 'ccw')
    expect(asLetters(doc)).toEqual(SPRITE)
    resizeCanvas(doc, 12, 10, 'center')
    expect(doc.width).toBe(12)
    cropToContent(doc)
    expect([doc.width, doc.height]).toEqual([8, 8])
    expect(asLetters(doc)).toEqual(SPRITE)
    scaleTo(doc, 16, 16)
    expect(doc.width).toBe(16)
    expect(() => validateDoc(doc)).not.toThrow()
  })
  it('applyPalette and reduceColors limit colors', () => {
    const doc = spriteDoc()
    applyPalette(doc, ['#000000', '#ffffff', '#ff0000'])
    expect(doc.palette.length).toBeLessThanOrEqual(4)
    const d2 = spriteDoc()
    reduceColors(d2, 2)
    expect(usedColorIndices(d2).size).toBeLessThanOrEqual(2)
    expect(() => validateDoc(d2)).not.toThrow()
    const d3 = spriteDoc()
    applyPalette(d3, ['#000000', '#888888', '#ffffff'], { dither: true })
    expect(() => validateDoc(d3)).not.toThrow()
  })
  it('shiftHue changes palette only', () => {
    const doc = spriteDoc()
    const before = celOf(doc).slice()
    shiftHue(doc, 120)
    expect(celOf(doc)).toEqual(before)
    expect(doc.palette[1]).not.toBe('#d03030ff')
  })
})

describe('diff / rebase', () => {
  it('empty diff for identical docs; detects pixel changes by color', () => {
    const a = spriteDoc()
    expect(isEmptyPatch(diff(a, a))).toBe(true)
    const b = deserializeDoc(serializeDoc(a))
    celOf(b)[0] = 1
    const p = diff(a, b)
    expect(p.pixelCount).toBe(1)
    expect(p.cels[0].changes[0]).toEqual([0, a.palette[1]])
  })
  it('rebases editor strokes on top of a concurrent Claude edit (both survive)', () => {
    const base = spriteDoc()
    const editor = deserializeDoc(serializeDoc(base))
    celOf(editor)[0] = editor.palette.indexOf('#202020ff') // stroke at (0,0)
    const head = deserializeDoc(serializeDoc(base))
    addOutline(head, '#0000ff') // Claude: outline (touches (0,0)? no: (0,0) is far from sprite? it is adjacent)
    recolor(head, '#f8f8f8', '#00ff00')
    const { doc } = rebase(diff(base, editor), head)
    expect(doc.palette[celOf(doc)[0]]).toBe('#202020ff')
    expect(doc.palette).toContain('#00ff00ff')
    const usedHex = [...usedColorIndices(doc)].map((i) => doc.palette[i])
    expect(usedHex).not.toContain('#f8f8f8ff')
    expect(() => validateDoc(doc)).not.toThrow()
  })
  it('moves strokes on a layer deleted meanwhile into a recovery layer', () => {
    const base = spriteDoc()
    const extra = addLayer(base, { name: 'extra' })
    const editor = deserializeDoc(serializeDoc(base))
    editor.cels[celKey(extra.id, editor.frames[0].id)][5] = 1
    const head = deserializeDoc(serializeDoc(base))
    removeLayer(head, extra.id)
    const { doc, warnings } = rebase(diff(base, editor), head)
    expect(doc.layers.map((l) => l.name)).toContain(RECOVERY_LAYER)
    expect(warnings.length).toBe(1)
  })
  it('replays added layers, prop changes and replaces on size change', () => {
    const base = spriteDoc()
    const editor = deserializeDoc(serializeDoc(base))
    editor.layers[0].visible = false
    const nl = addLayer(editor, { name: 'new' })
    editor.cels[celKey(nl.id, editor.frames[0].id)][3] = 1
    const { doc } = rebase(diff(base, editor), base)
    expect(doc.layers[0].visible).toBe(false)
    expect(doc.layers.find((l) => l.id === nl.id)).toBeTruthy()
    const resized = deserializeDoc(serializeDoc(base))
    resizeCanvas(resized, 10, 10)
    expect(rebase(diff(base, resized), base).doc.width).toBe(10)
  })
})

describe('png & preview', () => {
  it('encodes/decodes RGBA PNG and embeds DPI', () => {
    const r = renderDoc(spriteDoc(), { maxSide: 64, grid: true, coords: true })
    const png = encodePng(r, { dpi: 300 })
    expect(readDpi(png)).toBe(300)
    const back = decodePng(png)
    expect(back.width).toBe(r.width)
    expect(back.data).toEqual(r.data)
  })
})
