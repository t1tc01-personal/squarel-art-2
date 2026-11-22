-- Minimal mock of the Aseprite scripting API used by sync.lua (for tests under fengari).
ColorMode = { RGB = 0, GRAYSCALE = 1, INDEXED = 2 }

function Point(x, y) return { x = x, y = y } end

function Color(t) return { red = t.r or t.red or 0, green = t.g or t.green or 0, blue = t.b or t.blue or 0, alpha = t.a or t.alpha or 255 } end

local PaletteMT = { __len = function(p) return p._n end }
PaletteMT.__index = {
  getColor = function(self, i) return self._c[i] or Color { r = 0, g = 0, b = 0, a = 0 } end,
  setColor = function(self, i, c) self._c[i] = c end,
}
function Palette(n) return setmetatable({ _n = n, _c = {} }, PaletteMT) end

-- Image with Aseprite 1.3's `bytes` property (one byte per pixel in INDEXED mode).
-- Set MOCK_NO_BYTES = true to emulate older versions without it (exercises the slow path).
local imageMethods = {
  getPixel = function(self, x, y) return rawget(self, '_px')[y * rawget(self, 'width') + x + 1] or 0 end,
  drawPixel = function(self, x, y, v) rawget(self, '_px')[y * rawget(self, 'width') + x + 1] = v end,
}
local ImageMT = {
  __index = function(self, k)
    if k == 'bytes' then
      if MOCK_NO_BYTES then error('no bytes property') end
      local t = {}
      for i = 1, rawget(self, 'width') * rawget(self, 'height') do t[i] = string.char(rawget(self, '_px')[i] or 0) end
      return table.concat(t)
    end
    return imageMethods[k]
  end,
  __newindex = function(self, k, v)
    if k == 'bytes' then
      if MOCK_NO_BYTES then error('no bytes property') end
      local px = {}
      for i = 1, #v do px[i] = v:byte(i) end
      rawset(self, '_px', px)
    else
      rawset(self, k, v)
    end
  end,
}
function Image(w, h, mode)
  return setmetatable({ width = w, height = h, colorMode = mode, _px = {} }, ImageMT)
end

local function newLayer(sprite, name)
  local data = { name = name, isVisible = true, opacity = 255, isEditable = true, properties = {}, _cels = {}, sprite = sprite }
  local layer
  layer = setmetatable({}, {
    __index = function(_, k)
      if k == 'cel' then
        return function(_, fi) return data._cels[fi] end
      elseif k == 'stackIndex' then
        for i, l in ipairs(sprite.layers) do if l == layer then return i end end
      end
      return data[k]
    end,
    __newindex = function(_, k, v)
      if k == 'stackIndex' then
        for i, l in ipairs(sprite.layers) do
          if l == layer then table.remove(sprite.layers, i); break end
        end
        table.insert(sprite.layers, math.max(1, math.min(#sprite.layers + 1, v)), layer)
      else
        data[k] = v
      end
    end,
  })
  return layer, data
end

local SpriteMT = {}
SpriteMT.__index = {
  setPalette = function(self, p) self.palettes[1] = p end,
  newLayer = function(self)
    local l = newLayer(self, 'Layer ' .. (#self.layers + 1))
    table.insert(self.layers, l)
    return l
  end,
  deleteLayer = function(self, layer)
    for i, l in ipairs(self.layers) do if l == layer then table.remove(self.layers, i); return end end
  end,
  newEmptyFrame = function(self)
    local f = { duration = 0.1 }
    table.insert(self.frames, f)
    return f
  end,
  deleteFrame = function(self, frame)
    for i, f in ipairs(self.frames) do
      if f == frame then
        table.remove(self.frames, i)
        for _, l in ipairs(self.layers) do table.remove(rawget(getmetatable(l), '__data') or {}, i) end
        return
      end
    end
  end,
  newCel = function(self, layer, fi, image, pos)
    local cel = { image = image, position = pos or Point(0, 0), layer = layer, frameNumber = fi }
    local cels = layer._cels
    cels[fi] = cel
    return cel
  end,
  deleteCel = function(self, cel)
    cel.layer._cels[cel.frameNumber] = nil
  end,
  crop = function(self, x, y, w, h) self.width = w; self.height = h end,
}

function Sprite(w, h, mode)
  local s = setmetatable({ width = w, height = h, colorMode = mode or ColorMode.RGB, layers = {}, frames = {}, palettes = { Palette(1) }, properties = {}, transparentColor = 0 }, SpriteMT)
  table.insert(s.layers, (newLayer(s, 'Layer 1')))
  table.insert(s.frames, { duration = 0.1 })
  return s
end

ENV = { Sprite = Sprite, Image = Image, Palette = Palette, Color = Color, Point = Point, ColorMode = ColorMode }
