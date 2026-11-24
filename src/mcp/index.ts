#!/usr/bin/env node
/**
 * Squarel MCP server (stdio). Claude Code starts it from .mcp.json.
 * stdout carries the MCP protocol: never print to it — log via createLogger (stderr + file).
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { openViaBridge } from '../bridge/remote.ts'
import { BridgeServer, readBridgeToken } from '../bridge/server.ts'
import { workspaceArts, writeCatalog } from '../store/workspace.ts'
import { createToolContext } from '../tools/context.ts'
import { SQUAREL_VERSION as VERSION } from '../version.ts'
import { bridgeMode, startPresence } from './presence.ts'
import { createMcpServer, serverInstructions } from './server.ts'

async function main() {
  const ctx = await createToolContext({
    source: 'claude',
    logName: 'mcp',
    projectStart: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
  })
  const workspace = ctx.session.workspace
  // Cheap: reads each art's project.json only (no document decode), so it can run before connect.
  const arts = ctx.arts ? await workspaceArts(ctx.arts).catch(() => []) : []
  const legacyCount = workspace ? 0 : (await ctx.legacy.listProjects().catch(() => [])).length
  // The catalog decodes every art's head; run it in the background so a large library never delays
  // startup. writeCatalog never rejects (failures are logged).
  if (workspace && ctx.arts) void writeCatalog(ctx.arts, workspace, ctx.log)
  const bridge = new BridgeServer(ctx, {
    port: ctx.config.bridgePort,
    token: readBridgeToken(ctx.config.dataDir),
  })
  let bridgeUp = false
  let startThrew = false
  if (process.env.SQUAREL_NO_BRIDGE !== '1') {
    try {
      bridgeUp = await bridge.start()
    } catch (e) {
      startThrew = true
      ctx.log.warn('bridge failed to start', { error: String(e) })
    }
  }
  if (bridgeUp) {
    ctx.editor = bridge
    ctx.onCommit = (slug, versionId) => {
      bridge.notify(slug, versionId).catch((e) => ctx.log.warn('bridge notify failed', { error: String(e) }))
    }
  } else {
    // Another process owns the port (e.g. `pnpm bridge`); it sees our commits through its file watcher.
    const port = ctx.config.bridgePort
    const token = readBridgeToken(ctx.config.dataDir)
    ctx.editor = { open: (slug) => openViaBridge({ port, token, slug }) }
  }
  const presence = startPresence({
    dataDir: ctx.config.dataDir,
    version: VERSION,
    bridge: bridgeMode({ disabled: process.env.SQUAREL_NO_BRIDGE === '1', up: bridgeUp, startThrew }),
    workspace,
  })
  const server = createMcpServer(ctx, {
    version: VERSION,
    onToolCall: (name) => presence.touch(name),
    instructions: serverInstructions({
      workspace,
      arts,
      legacyCount,
      duplicateOf: ctx.session.duplicateOf,
    }),
  })
  await server.connect(new StdioServerTransport())
  ctx.log.info('mcp server ready', {
    dataDir: ctx.config.dataDir,
    bridge: bridgeUp,
    workspace: workspace?.id,
  })
  const shutdown = async () => {
    await presence.stop().catch(() => {})
    await bridge.stop().catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  process.stdin.on('close', shutdown)
}

main().catch((e) => {
  process.stderr.write(`squarel-mcp fatal: ${e?.stack ?? e}\n`)
  process.exit(1)
})
