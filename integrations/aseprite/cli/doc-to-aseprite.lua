-- Batch: write a Squarel PixelDoc JSON to an .aseprite file.
-- aseprite -b --script-param in=<doc.json> --script-param out=<file.aseprite> --script doc-to-aseprite.lua
-- Input JSON: { "slug": "...", "baseVersion": "v000001", "doc": PixelDocJSON }
-- `dir` param (passed by the bridge) points at the extension folder; fall back to the debug library.
SQUAREL_DIR = app.params['dir']
if not SQUAREL_DIR then
  local here = debug.getinfo(1, 'S').source:gsub('^@', ''):match('^(.*)[/\\][^/\\]*$') or '.'
  SQUAREL_DIR = here .. '/../squarel'
end
local sync = dofile(SQUAREL_DIR .. '/sync.lua')
local json = sync.json

local inPath = app.params['in']
local outPath = app.params['out']
assert(inPath and outPath, 'usage: --script-param in=<doc.json> --script-param out=<file.aseprite>')

local f = assert(io.open(inPath, 'rb'))
local data = json.decode(f:read('a'))
f:close()

local env = { Sprite = Sprite, Image = Image, Palette = Palette, Color = Color, Point = Point, ColorMode = ColorMode }
local doc = data.doc
local sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
sync.applyDoc(sprite, doc, env)
if data.slug then sync.setProp(sprite, 'squarel_slug', data.slug) end
if data.baseVersion then sync.setProp(sprite, 'squarel_base', data.baseVersion) end
sprite:saveAs(outPath)
sprite:close()
print('ok ' .. outPath)
