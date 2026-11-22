import { join } from 'node:path'
import { lauxlib, lua, lualib, to_luastring } from 'fengari'
import { describe, expect, it } from 'vitest'
import {
  addFrame,
  addLayer,
  celKey,
  deserializeDoc,
  diff,
  encodeCel,
  rleEncode,
  serializeDoc,
  toBase64,
} from '../src/core/index.ts'
import type { PixelDocJSON } from '../src/shared/types.ts'
import { spriteDoc } from './helpers.ts'

const ROOT = join(import.meta.dirname, '..').replace(/\\/g, '/')
const EXT = `${ROOT}/integrations/aseprite/squarel`
const MOCK = `${ROOT}/test/lua/aseprite_mock.lua`
const HARNESS = `${ROOT}/test/lua/plugin_harness.lua`

/** Run Lua code with globals; returns the RESULT global as a JS string. */
function runLua(code: string, globals: Record<string, string> = {}): string {
  const L = lauxlib.luaL_newstate()
  lualib.luaL_openlibs(L)
  for (const [k, v] of Object.entries({ SQUAREL_DIR: EXT, ...globals })) {
    lua.lua_pushstring(L, to_luastring(v))
    lua.lua_setglobal(L, to_luastring(k))
  }
  const status = lauxlib.luaL_dostring(L, to_luastring(code))
  if (status !== lua.LUA_OK) throw new Error(`lua error: ${lua.lua_tojsstring(L, -1)}`)
  lua.lua_getglobal(L, to_luastring('RESULT'))
  return lua.lua_tojsstring(L, -1)
}

function richDoc() {
  const doc = spriteDoc()
  const top = addLayer(doc, { name: 'Lớp trên ✓' }) // non-ASCII name must survive JSON both ways
  const f2 = addFrame(doc, { durationMs: 150, copyFromId: doc.frames[0].id })
  doc.cels[celKey(top.id, f2.id)][10] = 2
  doc.layers[0].opacity = 128
  doc.layers[1].visible = false
  return doc
}

describe('Aseprite extension: codec.lua is byte-compatible with core/codec.ts', () => {
  it('base64 and RLE encode identically', () => {
    const bytes = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 5)
    const asLuaString = String.fromCharCode(...bytes)
    const r = runLua(
      `local c = dofile(SQUAREL_DIR .. '/codec.lua')
       local s = ''
       for i = 1, #INPUT_HEX, 2 do s = s .. string.char(tonumber(INPUT_HEX:sub(i, i + 1), 16)) end
       RESULT = c.b64encode(s) .. '|' .. c.encodeCel(s) .. '|' .. tostring(c.decodeCel(c.encodeCel(s), #s) == s)`,
      { INPUT_HEX: [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('') },
    )
    const [b64, cel, roundtrip] = r.split('|')
    expect(b64).toBe(toBase64(bytes))
    expect(cel).toBe(encodeCel(bytes))
    expect(roundtrip).toBe('true')
    expect(asLuaString.length).toBe(300)
    expect(toBase64(rleEncode(bytes))).toBe(cel)
  })
  it('decodes long varint runs written by TypeScript', () => {
    const big = new Uint8Array(70000).fill(9)
    const r = runLua(
      `local c = dofile(SQUAREL_DIR .. '/codec.lua')
       local s = c.decodeCel(CEL, 70000)
       RESULT = tostring(#s) .. ':' .. s:byte(1) .. ':' .. s:byte(70000)`,
      { CEL: encodeCel(big) },
    )
    expect(r).toBe('70000:9:9')
  })
})

describe('Aseprite extension: json.lua', () => {
  it('round-trips nested data with unicode, escapes and empty arrays', () => {
    const input = { a: [1, 2.5, -3], s: 'Xin chào "đẹp" \\ / \n', e: [], o: { t: true, f: false, n: null } }
    const r = runLua(
      `local json = dofile(SQUAREL_DIR .. '/json.lua')
       RESULT = json.encode(json.decode(INPUT))`,
      { INPUT: JSON.stringify(input) },
    )
    expect(JSON.parse(r)).toEqual(input)
  })
})

describe('Aseprite extension: sync.lua (with a mock Aseprite API)', () => {
  const prelude = `dofile(MOCK)
    local sync = dofile(SQUAREL_DIR .. '/sync.lua')
    local json = sync.json`

  it('applyDoc → spriteToDoc round-trips layers, frames, palette and pixels', () => {
    const doc = richDoc()
    const out = runLua(
      `${prelude}
       local doc = json.decode(DOC)
       local sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
       sync.applyDoc(sprite, doc, ENV)
       RESULT = json.encode(sync.spriteToDoc(sprite, ENV))`,
      { MOCK, DOC: JSON.stringify(serializeDoc(doc)) },
    )
    const back = deserializeDoc(JSON.parse(out) as PixelDocJSON)
    expect(back.palette).toEqual(doc.palette)
    expect(back.layers).toEqual(doc.layers.map(({ origin: _o, ...l }) => l))
    expect(back.frames).toEqual(doc.frames)
    for (const k of Object.keys(doc.cels)) expect(back.cels[k]).toEqual(doc.cels[k])
    expect(diff(doc, back).pixelCount).toBe(0)
  })

  it('reuses the new sprite default layer even when the sprite is already linked (no stray empty layer)', () => {
    // The extension binds the sprite to its slug *before* the first applyDoc (found with real Aseprite).
    const doc = spriteDoc()
    const out = runLua(
      `${prelude}
       local doc = json.decode(DOC)
       local sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
       sync.setProp(sprite, 'squarel_slug', 'demo')
       sync.applyDoc(sprite, doc, ENV)
       RESULT = json.encode(sync.spriteToDoc(sprite, ENV))`,
      { MOCK, DOC: JSON.stringify(serializeDoc(doc)) },
    )
    const back = deserializeDoc(JSON.parse(out))
    expect(back.layers.map((l) => l.id)).toEqual(doc.layers.map((l) => l.id))
    expect(diff(doc, back).addedLayers).toEqual([])
  })

  it('a stroke drawn in Aseprite shows up as exactly that pixel change', () => {
    const doc = richDoc()
    const out = runLua(
      `${prelude}
       local doc = json.decode(DOC)
       local sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
       sync.applyDoc(sprite, doc, ENV)
       local layer = sprite.layers[1]
       layer:cel(1).image:drawPixel(0, 7, 3)
       RESULT = json.encode(sync.spriteToDoc(sprite, ENV))`,
      { MOCK, DOC: JSON.stringify(serializeDoc(doc)) },
    )
    const back = deserializeDoc(JSON.parse(out))
    const p = diff(doc, back)
    expect(p.pixelCount).toBe(1)
    expect(p.cels[0].changes[0]).toEqual([7 * 8, doc.palette[3]])
  })

  it('reads trimmed, offset cels and assigns ids to layers created in Aseprite', () => {
    const doc = spriteDoc()
    const out = runLua(
      `${prelude}
       local doc = json.decode(DOC)
       local sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
       sync.applyDoc(sprite, doc, ENV)
       local l = sprite:newLayer()
       l.name = 'drawn in aseprite'
       local img = Image(2, 1, ColorMode.INDEXED)
       img:drawPixel(0, 0, 1)
       img:drawPixel(1, 0, 2)
       sprite:newCel(l, 1, img, Point(3, 4))
       RESULT = json.encode(sync.spriteToDoc(sprite, ENV))`,
      { MOCK, DOC: JSON.stringify(serializeDoc(doc)) },
    )
    const back = deserializeDoc(JSON.parse(out))
    expect(back.layers).toHaveLength(2)
    const added = back.layers[1]
    expect(added.id).toMatch(/^l_[a-z0-9]{8}$/)
    const cel = back.cels[celKey(added.id, back.frames[0].id)]
    expect(cel[4 * 8 + 3]).toBe(1)
    expect(cel[4 * 8 + 4]).toBe(2)
    const p = diff(doc, back)
    expect(p.addedLayers).toHaveLength(1)
  })

  it('applying an updated doc removes deleted layers, adds new ones and resizes frames', () => {
    const v1 = richDoc()
    const v2 = deserializeDoc(serializeDoc(v1))
    v2.layers.splice(1, 1)
    for (const k of Object.keys(v2.cels))
      if (!v2.layers.some((l) => k.startsWith(`${l.id}:`))) delete v2.cels[k]
    const n = addLayer(v2, { name: 'AI: cape' })
    v2.cels[celKey(n.id, v2.frames[0].id)][0] = 1
    const out = runLua(
      `${prelude}
       local v1 = json.decode(V1)
       local sprite = Sprite(v1.width, v1.height, ColorMode.INDEXED)
       sync.applyDoc(sprite, v1, ENV)
       sync.applyDoc(sprite, json.decode(V2), ENV)
       RESULT = json.encode(sync.spriteToDoc(sprite, ENV))`,
      { MOCK, V1: JSON.stringify(serializeDoc(v1)), V2: JSON.stringify(serializeDoc(v2)) },
    )
    const back = deserializeDoc(JSON.parse(out))
    expect(back.layers.map((l) => l.name)).toEqual(v2.layers.map((l) => l.name))
    expect(diff(v2, back).pixelCount).toBe(0)
  })

  it('works without image.bytes (older Aseprite: getPixel/drawPixel path)', () => {
    const doc = richDoc()
    const out = runLua(
      `MOCK_NO_BYTES = true
       ${prelude}
       local doc = json.decode(DOC)
       local sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
       sync.applyDoc(sprite, doc, ENV)
       RESULT = json.encode(sync.spriteToDoc(sprite, ENV))`,
      { MOCK, DOC: JSON.stringify(serializeDoc(doc)) },
    )
    expect(diff(doc, deserializeDoc(JSON.parse(out))).pixelCount).toBe(0)
  })

  it('refuses non-indexed sprites with a clear message', () => {
    expect(() =>
      runLua(
        `${prelude}
         local sprite = Sprite(4, 4, ColorMode.RGB)
         sync.spriteToDoc(sprite, ENV)`,
        { MOCK },
      ),
    ).toThrow(/Indexed color mode/)
  })
})

describe('Aseprite extension: plugin.lua (fake WebSocket, Timer and clock)', () => {
  const boot = `dofile(MOCK)
    dofile(HARNESS)
    dofile(SQUAREL_DIR .. '/plugin.lua')
    local json = dofile(SQUAREL_DIR .. '/json.lua')
    init(PLUGIN)
    local s1 = SOCKETS[1]
    s1.onreceive(WebSocketMessageType.OPEN, '', '')
    s1.onreceive(WebSocketMessageType.TEXT, json.encode({ type = 'doc', slug = 'demo', versionId = 'v000001', doc = json.decode(DOC) }), '')`
  const sent = (raw: string[]) =>
    raw.map((t) => JSON.parse(t) as { type: string; slug?: string; baseVersion?: string })

  it('puts the Squarel menu in File (extensions cannot add top-level menus) and connects on startup', () => {
    const out = runLua(
      `${boot}
       RESULT = json.encode({ parent = PLUGIN.groups[1].group, commands = PLUGIN.commands.SquarelOpen.group,
         url = s1.url, connects = s1.connectCalls, sent = s1.sent, sprites = #app.sprites })`,
      { MOCK, HARNESS, DOC: JSON.stringify(serializeDoc(spriteDoc())) },
    )
    const r = JSON.parse(out)
    expect(r.parent).toBe('file_scripts')
    expect(r.commands).toBe('squarel_menu')
    expect(r.url).toBe('ws://127.0.0.1:4321/bridge')
    expect(r.connects).toBe(1)
    expect(sent(r.sent)[0]).toMatchObject({ type: 'hello' })
    expect(r.sprites).toBe(1)
  })

  it('pings while alive; a silent bridge (no CLOSE event) is replaced and linked sprites are re-announced', () => {
    const out = runLua(
      `${boot}
       tick(5, 5)                                       -- alive: heartbeat
       s1.onreceive(WebSocketMessageType.TEXT, '{"type":"pong"}', '')
       tick(5, 5)
       tick(20, 5)                                      -- bridge killed: nothing comes back, no CLOSE either
       local s2 = SOCKETS[2]
       s1.onreceive(WebSocketMessageType.CLOSE, '', '') -- a late CLOSE from the old socket is ignored
       s2.onreceive(WebSocketMessageType.OPEN, '', '')
       tick(5, 5)                                       -- the new socket is healthy: no extra reconnect
       RESULT = json.encode({ s1 = s1.sent, s1closed = s1.closed, s2 = s2.sent, n = #SOCKETS, alerts = #ALERTS })`,
      { MOCK, HARNESS, DOC: JSON.stringify(serializeDoc(spriteDoc())) },
    )
    const r = JSON.parse(out)
    expect(sent(r.s1).map((m) => m.type)).toEqual(['hello', 'ping', 'ping'])
    expect(r.s1closed).toBe(true)
    expect(r.n).toBe(2)
    const s2 = sent(r.s2)
    expect(s2.map((m) => m.type)).toEqual(['hello', 'cels', 'ping'])
    expect(s2[1]).toMatchObject({ slug: 'demo', baseVersion: 'v000001' })
    expect(r.alerts).toBe(0)
  })

  it('a failed send marks the socket offline and the watchdog reconnects', () => {
    const out = runLua(
      `${boot}
       s1.dead = true
       tick(5, 5)    -- ping fails → offline
       tick(10, 5)   -- offline for RECONNECT_AFTER → new socket
       RESULT = json.encode({ n = #SOCKETS, connects = SOCKETS[#SOCKETS].connectCalls })`,
      { MOCK, HARNESS, DOC: JSON.stringify(serializeDoc(spriteDoc())) },
    )
    expect(JSON.parse(out)).toEqual({ n: 2, connects: 1 })
  })
})
