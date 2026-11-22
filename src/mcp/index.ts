#!/usr/bin/env node
/**
 * Squarel MCP server (stdio). Claude Code starts it from .mcp.json.
 * stdout carries the MCP protocol: never print to it — log via createLogger (stderr + file).
 */
import { readFileSync } from 'node:fs'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { BridgeServer, readBridgeToken } from '../bridge/server.ts'
import { createToolContext } from '../tools/context.ts'
import { startPresence } from './presence.ts'
import { createMcpServer } from './server.ts'

const VERSION: string = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
).version

async function main() {
  const ctx = await createToolContext({ source: 'claude', logName: 'mcp' })
  const bridge = new BridgeServer(ctx, {
    port: ctx.config.bridgePort,
    token: readBridgeToken(ctx.config.dataDir),
  })
  let bridgeUp = false
  if (process.env.SQUAREL_NO_BRIDGE !== '1') {
    try {
      bridgeUp = await bridge.start()
    } catch (e) {
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
    ctx.editor = {
      open: async (slug) =>
        `Another Squarel bridge is running on port ${ctx.config.bridgePort}; it will show "${slug}" when Aseprite opens it from the Squarel menu.`,
    }
  }
  const presence = startPresence({
    dataDir: ctx.config.dataDir,
    version: VERSION,
    bridge: process.env.SQUAREL_NO_BRIDGE === '1' ? 'none' : bridgeUp ? 'own' : 'shared',
  })
  const server = createMcpServer(ctx, { version: VERSION, onToolCall: (name) => presence.touch(name) })
  await server.connect(new StdioServerTransport())
  ctx.log.info('mcp server ready', { dataDir: ctx.config.dataDir, bridge: bridgeUp })
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
