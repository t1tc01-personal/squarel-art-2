-- Minimal JSON for the Squarel extension (Aseprite's built-in `json` is not available in every version).
local M = {}

M.null = setmetatable({}, { __tostring = function() return 'null' end })
local ARRAY = {}

--- Mark a table so it encodes as a JSON array even when empty.
function M.array(t)
  return setmetatable(t or {}, ARRAY)
end

local function isArray(t)
  if getmetatable(t) == ARRAY then return true end
  local n = 0
  for k in pairs(t) do
    if type(k) ~= 'number' or k < 1 or math.floor(k) ~= k then return false end
    n = n + 1
  end
  return n > 0 and n == #t
end

local ESC = { ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }

local function encodeString(s)
  return '"' .. s:gsub('[%c"\\]', function(c)
    return ESC[c] or ('\\u%04x'):format(c:byte())
  end) .. '"'
end

local function encode(v, out)
  local t = type(v)
  if v == nil or v == M.null then
    out[#out + 1] = 'null'
  elseif t == 'boolean' then
    out[#out + 1] = v and 'true' or 'false'
  elseif t == 'number' then
    if v ~= v or v == math.huge or v == -math.huge then error('cannot encode non-finite number') end
    if math.type and math.type(v) == 'integer' then out[#out + 1] = tostring(v)
    elseif v == math.floor(v) and math.abs(v) < 2^53 then out[#out + 1] = ('%d'):format(v)
    else out[#out + 1] = ('%.14g'):format(v) end
  elseif t == 'string' then
    out[#out + 1] = encodeString(v)
  elseif t == 'table' then
    if isArray(v) then
      out[#out + 1] = '['
      for i = 1, #v do
        if i > 1 then out[#out + 1] = ',' end
        encode(v[i], out)
      end
      out[#out + 1] = ']'
    else
      out[#out + 1] = '{'
      local keys = {}
      for k in pairs(v) do keys[#keys + 1] = tostring(k) end
      table.sort(keys)
      for i, k in ipairs(keys) do
        if i > 1 then out[#out + 1] = ',' end
        out[#out + 1] = encodeString(k)
        out[#out + 1] = ':'
        encode(v[k], out)
      end
      out[#out + 1] = '}'
    end
  else
    error('cannot encode ' .. t)
  end
end

function M.encode(v)
  local out = {}
  encode(v, out)
  return table.concat(out)
end

local function utf8char(cp)
  if utf8 and utf8.char then return utf8.char(cp) end
  return string.char(cp < 256 and cp or 63)
end

function M.decode(s)
  local pos = 1
  local function ws() pos = s:find('[^ \t\r\n]', pos) or #s + 1 end
  local function err(m) error(('json: %s at %d'):format(m, pos)) end
  local value
  local function str()
    pos = pos + 1
    local buf = {}
    while true do
      local c = s:sub(pos, pos)
      if c == '' then err('unterminated string') end
      if c == '"' then pos = pos + 1; break end
      if c == '\\' then
        local e = s:sub(pos + 1, pos + 1)
        local map = { b = '\b', f = '\f', n = '\n', r = '\r', t = '\t', ['"'] = '"', ['\\'] = '\\', ['/'] = '/' }
        if e == 'u' then
          local cp = tonumber(s:sub(pos + 2, pos + 5), 16) or err('bad \\u escape')
          if cp >= 0xD800 and cp <= 0xDBFF and s:sub(pos + 6, pos + 7) == '\\u' then
            local lo = tonumber(s:sub(pos + 8, pos + 11), 16)
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00)
            pos = pos + 6
          end
          buf[#buf + 1] = utf8char(cp)
          pos = pos + 6
        else
          buf[#buf + 1] = map[e] or err('bad escape')
          pos = pos + 2
        end
      else
        local j = s:find('["\\]', pos) or #s + 1
        buf[#buf + 1] = s:sub(pos, j - 1)
        pos = j
      end
    end
    return table.concat(buf)
  end
  function value()
    ws()
    local c = s:sub(pos, pos)
    if c == '{' then
      pos = pos + 1
      local t = {}
      ws()
      if s:sub(pos, pos) == '}' then pos = pos + 1; return t end
      while true do
        ws()
        if s:sub(pos, pos) ~= '"' then err('expected key') end
        local k = str()
        ws()
        if s:sub(pos, pos) ~= ':' then err('expected :') end
        pos = pos + 1
        t[k] = value()
        ws()
        local d = s:sub(pos, pos)
        pos = pos + 1
        if d == '}' then return t end
        if d ~= ',' then err('expected , or }') end
      end
    elseif c == '[' then
      pos = pos + 1
      local t = M.array({})
      ws()
      if s:sub(pos, pos) == ']' then pos = pos + 1; return t end
      while true do
        t[#t + 1] = value()
        ws()
        local d = s:sub(pos, pos)
        pos = pos + 1
        if d == ']' then return t end
        if d ~= ',' then err('expected , or ]') end
      end
    elseif c == '"' then
      return str()
    elseif s:sub(pos, pos + 3) == 'true' then pos = pos + 4; return true
    elseif s:sub(pos, pos + 4) == 'false' then pos = pos + 5; return false
    elseif s:sub(pos, pos + 3) == 'null' then pos = pos + 4; return M.null
    else
      local num = s:match('^-?%d+%.?%d*[eE]?[-+]?%d*', pos)
      if not num or num == '' then err('unexpected character') end
      pos = pos + #num
      return math.tointeger and math.tointeger(tonumber(num)) or tonumber(num)
    end
  end
  local v = value()
  ws()
  if pos <= #s then err('trailing data') end
  return v
end

return M
