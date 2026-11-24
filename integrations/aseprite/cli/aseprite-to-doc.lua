-- Batch: read an .aseprite file into Squarel PixelDoc JSON.
-- aseprite -b --script-param in=<file.aseprite> --script-param out=<doc.json> --script aseprite-to-doc.lua
-- Output JSON: { "ref": "...", "baseVersion": "v000001", "doc": PixelDocJSON }
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
assert(inPath and outPath, 'usage: --script-param in=<file.aseprite> --script-param out=<doc.json>')

local sprite = assert(app.open(inPath), 'cannot open ' .. inPath)
if sprite.colorMode ~= ColorMode.INDEXED then app.command.ChangePixelFormat { format = 'indexed' } end
local env = { Sprite = Sprite, Image = Image, Palette = Palette, Color = Color, Point = Point, ColorMode = ColorMode }
local doc = sync.spriteToDoc(sprite, env)
local out = {
  ref = sync.getProp(sprite, 'squarel_ref'),
  baseVersion = sync.getProp(sprite, 'squarel_base'),
  doc = doc,
}
local f = assert(io.open(outPath, 'wb'))
f:write(json.encode(out))
f:close()
sprite:close()
print('ok ' .. outPath)
