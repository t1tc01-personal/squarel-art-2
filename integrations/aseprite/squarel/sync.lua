-- Map a Squarel PixelDoc (JSON form) to an Aseprite sprite and back.
-- `env` carries the Aseprite API constructors (Sprite, Image, Palette, Color, Point, ColorMode)
-- so this module can be unit-tested outside Aseprite with mocks.
local M = {}

-- Directory of this file: SQUAREL_DIR (set by plugin.lua / CLI scripts) or the debug library.
local function moduleDir()
  if SQUAREL_DIR then return SQUAREL_DIR end
  if debug and debug.getinfo then
    local here = debug.getinfo(1, 'S').source:gsub('^@', '')
    return here:match('^(.*)[/\\][^/\\]*$') or '.'
  end
  return '.'
end

local function loadSibling(name)
  return dofile(moduleDir() .. '/' .. name .. '.lua')
end

local codec = loadSibling('codec')
local json = loadSibling('json')
M.codec, M.json = codec, json

-- ---------- properties (Aseprite >= 1.3 user properties; fall back to a Lua side table) ----------
local fallbackProps = setmetatable({}, { __mode = 'k' })

function M.getProp(obj, key)
  local ok, v = pcall(function() return obj.properties[key] end)
  if ok and v ~= nil then return v end
  local t = fallbackProps[obj]
  return t and t[key] or nil
end

function M.setProp(obj, key, value)
  local ok = pcall(function() obj.properties[key] = value end)
  if not ok then
    fallbackProps[obj] = fallbackProps[obj] or {}
    fallbackProps[obj][key] = value
  end
end

local function newId(prefix)
  local chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  local t = {}
  for i = 1, 8 do
    local k = math.random(1, #chars)
    t[i] = chars:sub(k, k)
  end
  return prefix .. '_' .. table.concat(t)
end
M.newId = newId

local function hex2(n) return ('%02x'):format(math.max(0, math.min(255, math.floor(n + 0.5)))) end

local function parseHex(h)
  return tonumber(h:sub(2, 3), 16), tonumber(h:sub(4, 5), 16), tonumber(h:sub(6, 7), 16), tonumber(h:sub(8, 9), 16) or 255
end

-- ---------- image pixel access (fast path: image.bytes) ----------
local function readImageBytes(img)
  local ok, b = pcall(function() return img.bytes end)
  if ok and type(b) == 'string' and #b == img.width * img.height then return b end
  local rows = {}
  for y = 0, img.height - 1 do
    local row = {}
    for x = 0, img.width - 1 do row[x + 1] = string.char(img:getPixel(x, y) & 255) end
    rows[y + 1] = table.concat(row)
  end
  return table.concat(rows)
end

local function writeImageBytes(img, bytes)
  local ok = pcall(function() img.bytes = bytes end)
  if ok then
    local ok2, back = pcall(function() return img.bytes end)
    if ok2 and back == bytes then return end
  end
  local w = img.width
  for i = 1, #bytes do
    local v = bytes:byte(i)
    if v ~= 0 then img:drawPixel((i - 1) % w, (i - 1) // w, v) end
  end
end

--- Full-canvas index string for one cel (cel image may be trimmed and offset).
local function celPixels(sprite, cel)
  local W, H = sprite.width, sprite.height
  if not cel then return string.rep('\0', W * H) end
  local img = cel.image
  local px, py = cel.position.x, cel.position.y
  if px == 0 and py == 0 and img.width == W and img.height == H then return readImageBytes(img) end
  local src = readImageBytes(img)
  local rows = {}
  for y = 0, H - 1 do
    local sy = y - py
    if sy < 0 or sy >= img.height then
      rows[y + 1] = string.rep('\0', W)
    else
      local x0 = math.max(0, px)
      local x1 = math.min(W, px + img.width)
      if x1 <= x0 then
        rows[y + 1] = string.rep('\0', W)
      else
        local seg = src:sub(sy * img.width + (x0 - px) + 1, sy * img.width + (x1 - px))
        rows[y + 1] = string.rep('\0', x0) .. seg .. string.rep('\0', W - x1)
      end
    end
  end
  return table.concat(rows)
end

local function layerIsBlank(sprite, layer)
  for fi = 1, #sprite.frames do
    local cel = layer:cel(fi)
    if cel and cel.image and readImageBytes(cel.image):find('[^\0]') then return false end
  end
  return true
end

local function isImageLayer(layer)
  local okG, g = pcall(function() return layer.isGroup end)
  if okG and g then return false end
  local okR, r = pcall(function() return layer.isReference end)
  if okR and r then return false end
  return true
end

--- Read frame ids stored on the sprite; extend with new ids for frames added in Aseprite.
local function frameIds(sprite, count)
  local stored = M.getProp(sprite, 'squarel_frames') or ''
  local ids = {}
  for id in stored:gmatch('[^,]+') do ids[#ids + 1] = id end
  for i = #ids + 1, count do ids[i] = newId('f') end
  while #ids > count do table.remove(ids) end
  M.setProp(sprite, 'squarel_frames', table.concat(ids, ','))
  return ids
end

--- Sprite → PixelDoc (JSON form). Requires INDEXED color mode.
function M.spriteToDoc(sprite, env)
  if env and env.ColorMode and sprite.colorMode ~= env.ColorMode.INDEXED then
    error('Squarel needs Indexed color mode (Sprite > Color Mode > Indexed)')
  end
  local W, H = sprite.width, sprite.height
  local pal = sprite.palettes[1]
  local n = math.min(#pal, 256)
  local palette = json.array({ '#00000000' })
  for i = 1, n - 1 do
    local c = pal:getColor(i)
    palette[#palette + 1] = '#' .. hex2(c.red) .. hex2(c.green) .. hex2(c.blue) .. hex2(c.alpha)
  end
  local fids = frameIds(sprite, #sprite.frames)
  local frames = json.array({})
  for i, f in ipairs(sprite.frames) do
    frames[i] = { id = fids[i], durationMs = math.floor((f.duration or 0.1) * 1000 + 0.5) }
  end
  local layers = json.array({})
  local cels = {}
  for _, layer in ipairs(sprite.layers) do
    if isImageLayer(layer) then
      local id = M.getProp(layer, 'squarel_id')
      if not id then
        id = newId('l')
        M.setProp(layer, 'squarel_id', id)
      end
      local okE, editable = pcall(function() return layer.isEditable end)
      layers[#layers + 1] = {
        id = id,
        name = layer.name,
        visible = layer.isVisible,
        opacity = layer.opacity or 255,
        locked = okE and editable == false or false,
      }
      for fi = 1, #sprite.frames do
        local pixels = celPixels(sprite, layer:cel(fi))
        if #palette < 256 then
          -- clamp indices that point past the (truncated) palette
          pixels = pixels:gsub('.', function(ch)
            return ch:byte() >= #palette and '\0' or nil
          end)
        end
        cels[id .. ':' .. fids[fi]] = codec.encodeCel(pixels)
      end
    end
  end
  return {
    v = 1,
    width = W,
    height = H,
    palette = palette,
    layers = layers,
    frames = frames,
    cels = cels,
    meta = { purpose = M.getProp(sprite, 'squarel_purpose') or 'game' },
  }
end

--- Apply a PixelDoc to a sprite (create/update/remove layers, frames, cels, palette).
function M.applyDoc(sprite, doc, env)
  local W, H = doc.width, doc.height
  if sprite.width ~= W or sprite.height ~= H then sprite:crop(0, 0, W, H) end
  -- palette
  local pal = env.Palette(#doc.palette)
  for i, hex in ipairs(doc.palette) do
    local r, g, b, a = parseHex(hex)
    pal:setColor(i - 1, env.Color { r = r, g = g, b = b, a = a })
  end
  sprite:setPalette(pal)
  pcall(function() sprite.transparentColor = 0 end)
  -- frames
  while #sprite.frames < #doc.frames do sprite:newEmptyFrame() end
  while #sprite.frames > #doc.frames do sprite:deleteFrame(sprite.frames[#sprite.frames]) end
  local fids = {}
  for i, f in ipairs(doc.frames) do
    sprite.frames[i].duration = (f.durationMs or 100) / 1000
    fids[i] = f.id
  end
  M.setProp(sprite, 'squarel_frames', table.concat(fids, ','))
  -- layers: match by stored id, create missing, delete synced layers that disappeared
  local byId = {}
  local unsynced = {}
  for _, layer in ipairs(sprite.layers) do
    if isImageLayer(layer) then
      local id = M.getProp(layer, 'squarel_id')
      if id then byId[id] = layer else unsynced[#unsynced + 1] = layer end
    end
  end
  local wanted = {}
  for _, l in ipairs(doc.layers) do wanted[l.id] = true end
  for id, layer in pairs(byId) do
    if not wanted[id] then
      sprite:deleteLayer(layer)
      byId[id] = nil
    end
  end
  -- a brand-new sprite has one empty default layer without id: reuse it for the first doc layer
  -- (the extension links the sprite to its slug before the first applyDoc, so don't test the slug here)
  if #unsynced == 1 and next(byId) == nil and layerIsBlank(sprite, unsynced[1]) then
    byId[doc.layers[1].id] = unsynced[1]
    M.setProp(unsynced[1], 'squarel_id', doc.layers[1].id)
  end
  for i, l in ipairs(doc.layers) do
    local layer = byId[l.id]
    if not layer then
      layer = sprite:newLayer()
      M.setProp(layer, 'squarel_id', l.id)
      byId[l.id] = layer
    end
    layer.name = l.name
    layer.isVisible = l.visible ~= false
    layer.opacity = l.opacity or 255
    pcall(function() layer.isEditable = not l.locked end)
    pcall(function() layer.stackIndex = i end)
  end
  -- cels
  local size = W * H
  local zero = string.rep('\0', size)
  for _, l in ipairs(doc.layers) do
    local layer = byId[l.id]
    for fi, f in ipairs(doc.frames) do
      local enc = doc.cels[l.id .. ':' .. f.id]
      local pixels = enc and codec.decodeCel(enc, size) or zero
      local cel = layer:cel(fi)
      if pixels == zero then
        if cel then sprite:deleteCel(cel) end
      else
        local img = env.Image(W, H, env.ColorMode.INDEXED)
        writeImageBytes(img, pixels)
        if cel then
          cel.image = img
          cel.position = env.Point(0, 0)
        else
          sprite:newCel(layer, fi, img, env.Point(0, 0))
        end
      end
    end
  end
  if doc.meta and doc.meta.purpose then M.setProp(sprite, 'squarel_purpose', doc.meta.purpose) end
end

return M
