-- Squarel codec: base64 + RLE (varint run length, u8 palette index).
-- Must stay byte-compatible with src/core/codec.ts. Lua 5.3+ (Aseprite ships 5.4).
local M = {}

local B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
local DEC = {}
for i = 1, 64 do DEC[B64:byte(i)] = i - 1 end

function M.b64encode(s)
  local out = {}
  local n = #s
  local i = 1
  while i + 2 <= n do
    local a, b, c = s:byte(i, i + 2)
    local v = (a << 16) | (b << 8) | c
    out[#out + 1] = string.char(
      B64:byte(((v >> 18) & 63) + 1), B64:byte(((v >> 12) & 63) + 1),
      B64:byte(((v >> 6) & 63) + 1), B64:byte((v & 63) + 1))
    i = i + 3
  end
  local rest = n - i + 1
  if rest == 1 then
    local v = s:byte(i) << 16
    out[#out + 1] = string.char(B64:byte(((v >> 18) & 63) + 1), B64:byte(((v >> 12) & 63) + 1)) .. '=='
  elseif rest == 2 then
    local a, b = s:byte(i, i + 1)
    local v = (a << 16) | (b << 8)
    out[#out + 1] = string.char(B64:byte(((v >> 18) & 63) + 1), B64:byte(((v >> 12) & 63) + 1),
      B64:byte(((v >> 6) & 63) + 1)) .. '='
  end
  return table.concat(out)
end

function M.b64decode(s)
  s = s:gsub('[^%w%+/]', '')
  local out = {}
  local len = math.floor(#s * 3 / 4)
  local produced = 0
  for i = 1, #s, 4 do
    local a = DEC[s:byte(i)] or 0
    local b = DEC[s:byte(i + 1) or 65] or 0
    local c = DEC[s:byte(i + 2) or 65] or 0
    local d = DEC[s:byte(i + 3) or 65] or 0
    local v = (a << 18) | (b << 12) | (c << 6) | d
    local bytes = { (v >> 16) & 255, (v >> 8) & 255, v & 255 }
    for k = 1, 3 do
      if produced < len then
        out[#out + 1] = string.char(bytes[k])
        produced = produced + 1
      end
    end
  end
  return table.concat(out)
end

--- Decode RLE bytes (string) into a string of `size` palette indices (1 byte each).
function M.rleDecode(bytes, size)
  local out = {}
  local total = 0
  local i = 1
  local n = #bytes
  while i <= n do
    local run, shift = 0, 0
    while true do
      local b = bytes:byte(i)
      if b == nil then error('truncated RLE varint') end
      i = i + 1
      run = run | ((b & 0x7f) << shift)
      if (b & 0x80) == 0 then break end
      shift = shift + 7
    end
    local v = bytes:byte(i)
    if v == nil then error('truncated RLE value') end
    i = i + 1
    if total + run > size then error('RLE overflows cel size') end
    out[#out + 1] = string.rep(string.char(v), run)
    total = total + run
  end
  if total ~= size then error(('RLE length %d ~= %d'):format(total, size)) end
  return table.concat(out)
end

--- Encode a string of palette indices to RLE bytes.
function M.rleEncode(pixels)
  local out = {}
  local n = #pixels
  local i = 1
  while i <= n do
    local v = pixels:byte(i)
    local j = i + 1
    while j <= n and pixels:byte(j) == v do j = j + 1 end
    local run = j - i
    while run >= 0x80 do
      out[#out + 1] = string.char((run & 0x7f) | 0x80)
      run = run >> 7
    end
    out[#out + 1] = string.char(run, v)
    i = j
  end
  return table.concat(out)
end

function M.encodeCel(pixels) return M.b64encode(M.rleEncode(pixels)) end
function M.decodeCel(s, size) return M.rleDecode(M.b64decode(s), size) end

return M
