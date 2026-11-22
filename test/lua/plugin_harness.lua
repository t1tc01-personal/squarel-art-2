-- Fakes for running integrations/aseprite/squarel/plugin.lua under fengari (load after aseprite_mock.lua).
-- Controllable clock, recorded WebSocket instances and Timers, a fake `plugin` object.

NOW = 1000
os.time = function() return NOW end

WebSocketMessageType = { TEXT = 1, BINARY = 11, OPEN = 2, CLOSE = 3, ERROR = 4, PING = 5, PONG = 6, FRAGMENT = 7 }
SOCKETS = {}
function WebSocket(opts)
  local s = { url = opts.url, onreceive = opts.onreceive, closed = false, sent = {}, connectCalls = 0 }
  function s:connect() self.connectCalls = self.connectCalls + 1 end
  function s:close() self.closed = true end
  function s:sendText(t)
    if self.dead then error('WebSocket is not connected, can\'t send text') end
    table.insert(self.sent, t)
  end
  table.insert(SOCKETS, s)
  return s
end

TIMERS = {}
function Timer(o)
  local t = { interval = o.interval, ontick = o.ontick, running = false }
  function t:start() self.running = true end
  function t:stop() self.running = false end
  table.insert(TIMERS, t)
  return t
end
-- advance the clock and fire every running timer with this interval
function tick(seconds, interval)
  NOW = NOW + seconds
  for _, t in ipairs(TIMERS) do
    if t.interval == interval and t.running then t.ontick() end
  end
end

ALERTS = {}
app = {
  version = '1.3.18-test',
  apiVersion = 41,
  sprites = {},
  fs = { joinPath = function(a, b) return a .. '/' .. b end },
  transaction = function(a, b) if type(a) == 'function' then a() else b() end end,
  refresh = function() end,
  alert = function(t) table.insert(ALERTS, type(t) == 'table' and t.text or t) end,
}

local RawSprite = Sprite
function Sprite(w, h, mode)
  local s = RawSprite(w, h, mode)
  s.events = { on = function() end }
  table.insert(app.sprites, s)
  return s
end

function Dialog() error('dialogs are not available in tests') end

PLUGIN = { path = SQUAREL_DIR, preferences = { autoconnect = true }, commands = {}, groups = {} }
function PLUGIN:newMenuGroup(t) table.insert(self.groups, t) end
function PLUGIN:newCommand(t) self.commands[t.id] = t end
