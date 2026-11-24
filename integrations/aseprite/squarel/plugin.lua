-- Squarel extension for Aseprite: live two-way sync with Squarel projects over a local WebSocket.
-- Requires Aseprite 1.3+ (WebSocket, Timer, sprite events, properties).

local function here(plugin) return plugin.path end

local sync, codec, json
local state = {
  ws = nil,
  connected = false,
  arts = {},
  bound = {},       -- ref -> sprite
  applying = false, -- true while we apply a remote doc (ignore our own change events)
  dirty = {},       -- ref -> true when local edits are waiting to be sent
  timer = nil,
  watchdog = nil,
  wantConnection = false, -- true after connect(), false after disconnect()
  lastAttempt = 0,        -- os.time() of the last connect()
  lastSeen = 0,           -- os.time() of the last message from the bridge (pongs included)
  plugin = nil,
  pendingPick = false,
}
local RECONNECT_AFTER = 10 -- seconds without a connection before the watchdog opens a fresh socket
local DEAD_AFTER = 15      -- seconds of silence (no pong) after which a "connected" socket is considered dead

local env = {}

-- Optional trace file: start Aseprite with SQUAREL_ASEPRITE_LOG=<path> to debug the extension.
local function trace(msg)
  local path = os.getenv('SQUAREL_ASEPRITE_LOG')
  if not path or path == '' then return end
  pcall(function()
    local f = io.open(path, 'a')
    if f then
      f:write(os.date('%H:%M:%S ') .. tostring(msg) .. '\n')
      f:close()
    end
  end)
end

-- Aseprite ignores errors raised inside an extension's init(): report them ourselves.
local function report(err)
  trace('ERROR ' .. tostring(err))
  print('Squarel: ' .. tostring(err))
end

local function prefs() return state.plugin.preferences end
local function url()
  local p = prefs()
  local port = p.port or 4321
  local token = p.token
  return ('ws://127.0.0.1:%d/bridge%s'):format(port, token and token ~= '' and ('?token=' .. token) or '')
end

local function send(msg)
  if not (state.ws and state.connected) then return false end
  local ok, err = pcall(function() state.ws:sendText(json.encode(msg)) end)
  if not ok then
    -- the socket died under us: let the watchdog reconnect (and re-send dirty sprites on OPEN)
    trace('send failed: ' .. tostring(err))
    state.connected = false
  end
  return ok
end

local function spriteAlive(sprite)
  if not sprite then return false end
  for _, s in ipairs(app.sprites) do if s == sprite then return true end end
  return false
end

local function refOf(sprite) return sprite and sync.getProp(sprite, 'squarel_ref') end

local function flush()
  for ref in pairs(state.dirty) do
    local sprite = state.bound[ref]
    if spriteAlive(sprite) then
      local ok, doc = pcall(sync.spriteToDoc, sprite, env)
      if ok then
        send({ type = 'cels', ref = ref, baseVersion = sync.getProp(sprite, 'squarel_base'), doc = doc, label = 'Aseprite edit' })
      else
        app.alert { title = 'Squarel', text = tostring(doc) }
      end
    end
  end
  state.dirty = {}
end

local function scheduleFlush(ref)
  state.dirty[ref] = true
  if state.timer then
    state.timer:stop()
    state.timer:start()
  else
    flush()
  end
end

local function bind(ref, sprite)
  state.bound[ref] = sprite
  sync.setProp(sprite, 'squarel_ref', ref)
  sprite.events:on('change', function(ev)
    if state.applying then return end
    scheduleFlush(ref)
  end)
end

local function applyRemote(ref, versionId, doc, label)
  local sprite = state.bound[ref]
  local created = false
  if not spriteAlive(sprite) then
    sprite = nil
    for _, s in ipairs(app.sprites) do
      if refOf(s) == ref then sprite = s end
    end
    if not sprite then
      sprite = Sprite(doc.width, doc.height, ColorMode.INDEXED)
      pcall(function() sprite.filename = (ref:match('[^/]+$') or ref) end)
      created = true
    end
    bind(ref, sprite)
  end
  state.applying = true
  local ok, err = pcall(function()
    app.transaction(label or 'Squarel update', function() sync.applyDoc(sprite, doc, env) end)
    sync.setProp(sprite, 'squarel_base', versionId)
  end)
  state.applying = false
  if not ok then app.alert { title = 'Squarel', text = 'Could not apply update: ' .. tostring(err) } end
  if created then app.activeSprite = sprite end
  app.refresh()
end

local function pickArt()
  if #state.arts == 0 then
    app.alert { title = 'Squarel', text = 'No art yet. Open Claude Code in a Squarel project and ask it to create one.' }
    return
  end
  local names, refs = {}, {}
  for _, a in ipairs(state.arts) do
    local label = (a.projectName or a.project) .. ' / ' .. (a.name or a.art)
    names[#names + 1] = label
    refs[label] = a.ref
  end
  local dlg = Dialog { title = 'Open Squarel art' }
  dlg:combobox { id = 'art', label = 'Art', options = names, option = names[1] }
  dlg:button { id = 'ok', text = 'Open' }
  dlg:button { id = 'cancel', text = 'Cancel' }
  dlg:show()
  if dlg.data.ok and refs[dlg.data.art] then send({ type = 'open', ref = refs[dlg.data.art] }) end
end

local handlers = {}
function handlers.welcome(m)
  state.arts = m.arts or {}
end
function handlers.arts(m)
  state.arts = m.arts or {}
  if state.pendingPick then
    state.pendingPick = false
    pickArt()
  end
end
handlers['doc'] = function(m) applyRemote(m.ref, m.versionId, m.doc, 'Squarel: open ' .. m.ref) end
handlers['doc.updated'] = function(m)
  if state.dirty[m.ref] then
    flush() -- our pending strokes go first; the bridge answers with a merged `rebased` doc
    return
  end
  applyRemote(m.ref, m.versionId, m.doc, (m.source == 'claude' and 'Claude: ' or 'Squarel: ') .. (m.label or ''))
end
function handlers.rebased(m)
  applyRemote(m.ref, m.versionId, m.doc, 'Squarel: merged')
end
function handlers.ack(m)
  local sprite = state.bound[m.ref]
  if spriteAlive(sprite) then sync.setProp(sprite, 'squarel_base', m.versionId) end
end
handlers['open.request'] = function(m) send({ type = 'open', ref = m.ref }) end
function handlers.tool_result(m)
  app.alert { title = 'Squarel', text = m.text }
end
function handlers.error(m)
  if m.code == 'extension-outdated' then
    app.alert { title = 'Squarel', text = m.message or 'Update the Squarel extension.' }
    return
  end
  app.alert { title = 'Squarel error', text = (m.code or '') .. ': ' .. (m.message or '') }
end

local function onReceive(mt, data, err)
  state.lastSeen = os.time()
  if mt == WebSocketMessageType.OPEN then
    state.connected = true
    trace('connected')
    send({ type = 'hello', client = 'aseprite', protocol = 2, ext = '0.4.0', aseprite = tostring(app.version) })
    -- (Re)connected: re-announce every linked sprite with its last known base version. The bridge merges
    -- strokes drawn while offline, and knows to push Claude's changes for these projects again.
    for ref, sprite in pairs(state.bound) do
      if spriteAlive(sprite) then state.dirty[ref] = true end
    end
    flush()
  elseif mt == WebSocketMessageType.TEXT then
    local ok, m = pcall(json.decode, data)
    if ok and type(m) == 'table' and handlers[m.type] then
      trace('recv ' .. m.type)
      local ok2, herr = pcall(handlers[m.type], m)
      if not ok2 then report(herr) end
    end
  elseif mt == WebSocketMessageType.CLOSE then
    state.connected = false
    trace('closed')
  elseif mt == WebSocketMessageType.ERROR then
    state.connected = false
    trace('socket error: ' .. tostring(err ~= '' and err or data))
  end
end

local function connect()
  if state.ws then pcall(function() state.ws:close() end) end
  state.connected = false
  state.wantConnection = true
  state.lastAttempt = os.time()
  local ok, err = pcall(function()
    local sock
    sock = WebSocket {
      url = url(),
      -- ignore late events from a socket we already replaced (e.g. its CLOSE after a watchdog reconnect)
      onreceive = function(mt, data, e) if state.ws == sock then onReceive(mt, data, e) end end,
      deflate = false, minreconnectwait = 1, maxreconnectwait = 30,
    }
    state.ws = sock
    sock:connect()
  end)
  if ok then trace('connecting to ' .. url()) else report(err) end
end

local function disconnect()
  state.wantConnection = false
  if state.ws then pcall(function() state.ws:close() end) end
  state.ws = nil
  state.connected = false
end

-- Heartbeat + watchdog. When the bridge process is killed, Aseprite's WebSocket may never report a CLOSE
-- (seen on Windows with a real Aseprite 1.3.18), so liveness is judged by pongs, not by socket events.
local function watchdogTick()
  if not state.wantConnection then return end
  local now = os.time()
  if state.connected then
    if now - state.lastSeen >= DEAD_AFTER then
      trace('watchdog: no reply for ' .. (now - state.lastSeen) .. 's, reconnecting')
      connect()
    else
      send({ type = 'ping' })
    end
  elseif now - state.lastAttempt >= RECONNECT_AFTER then
    trace('watchdog: still offline, reconnecting')
    connect()
  end
end

local function setup(plugin)
  state.plugin = plugin
  local dir = here(plugin)
  SQUAREL_DIR = dir
  codec = dofile(app.fs.joinPath(dir, 'codec.lua'))
  json = dofile(app.fs.joinPath(dir, 'json.lua'))
  sync = dofile(app.fs.joinPath(dir, 'sync.lua'))
  env = { Sprite = Sprite, Image = Image, Palette = Palette, Color = Color, Point = Point, ColorMode = ColorMode }
  if plugin.preferences.autoconnect == nil then plugin.preferences.autoconnect = true end

  state.timer = Timer { interval = 0.5, ontick = function()
    state.timer:stop()
    flush()
  end }
  state.watchdog = Timer { interval = 5, ontick = watchdogTick }
  state.watchdog:start()

  -- Extensions cannot add top-level menus (an unknown parent group silently drops the item), so the
  -- "Squarel" submenu goes into the File menu right after "Scripts" (group `file_scripts`).
  local group = 'file_scripts'
  local ok = pcall(function()
    plugin:newMenuGroup { id = 'squarel_menu', title = 'Squarel', group = 'file_scripts' }
  end)
  if ok then group = 'squarel_menu' end

  plugin:newCommand { id = 'SquarelConnect', title = 'Connect', group = group, onclick = connect }
  plugin:newCommand { id = 'SquarelOpen', title = 'Open art…', group = group, onclick = function()
    if not state.connected then connect() end
    state.pendingPick = true
    send({ type = 'list' })
  end }
  plugin:newCommand { id = 'SquarelSync', title = 'Sync now', group = group, onclick = function()
    local ref = refOf(app.activeSprite)
    if ref then
      state.dirty[ref] = true
      flush()
    else
      app.alert { title = 'Squarel', text = 'This sprite is not linked to a Squarel art.' }
    end
  end }
  plugin:newCommand { id = 'SquarelExport', title = 'Export…', group = group, onclick = function()
    local ref = refOf(app.activeSprite)
    if not ref then return app.alert { title = 'Squarel', text = 'This sprite is not linked to a Squarel art.' } end
    local dlg = Dialog { title = 'Squarel export' }
    dlg:combobox { id = 'preset', label = 'Preset', option = 'game-spritesheet', options = {
      'game-png', 'game-spritesheet', 'game-gif', 'print-png', 'print-svg', 'print-pdf',
      'social-avatar', 'social-emoji', 'social-sticker', 'social-anim', 'craft-beads' } }
    dlg:button { id = 'ok', text = 'Export' }
    dlg:button { id = 'cancel', text = 'Cancel' }
    dlg:show()
    if dlg.data.ok then
      flush()
      send({ type = 'tool', id = tostring(os.time()), name = 'export', ref = ref, input = { preset = dlg.data.preset } })
    end
  end }
  plugin:newCommand { id = 'SquarelSettings', title = 'Settings…', group = group, onclick = function()
    local p = plugin.preferences
    local dlg = Dialog { title = 'Squarel settings' }
    dlg:number { id = 'port', label = 'Bridge port', text = tostring(p.port or 4321), decimals = 0 }
    dlg:entry { id = 'token', label = 'Token (optional)', text = p.token or '' }
    dlg:check { id = 'autoconnect', label = 'Connect on startup', selected = p.autoconnect ~= false }
    dlg:button { id = 'ok', text = 'Save' }
    dlg:show()
    if dlg.data.ok then
      p.port = math.floor(dlg.data.port)
      p.token = dlg.data.token
      p.autoconnect = dlg.data.autoconnect
      connect()
    end
  end }
  plugin:newCommand { id = 'SquarelDisconnect', title = 'Disconnect', group = group, onclick = disconnect }

  trace('init done, autoconnect=' .. tostring(plugin.preferences.autoconnect))
  -- The launcher's "open without sync" starts Aseprite with SQUAREL_NO_SYNC=1: stay offline until the user clicks Connect.
  if os.getenv('SQUAREL_NO_SYNC') == '1' then
    trace('no-sync mode')
  elseif plugin.preferences.autoconnect then
    connect()
  end
end

function init(plugin)
  local ok, err = xpcall(setup, (debug and debug.traceback) or tostring, plugin)
  if not ok then report(err) end
end

function exit(plugin)
  if state.timer then state.timer:stop() end
  if state.watchdog then state.watchdog:stop() end
  disconnect()
end
